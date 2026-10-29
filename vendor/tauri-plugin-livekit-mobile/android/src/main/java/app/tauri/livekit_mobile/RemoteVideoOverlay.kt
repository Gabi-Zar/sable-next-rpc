package app.tauri.livekit_mobile

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.core.view.doOnLayout
import io.livekit.android.room.Room
import io.livekit.android.room.track.RemoteTrackPublication
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import livekit.org.webrtc.RendererCommon.ScalingType
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlin.math.ceil
import kotlin.math.floor

/**
 * Resizes an overlay view without discarding the LayoutParams type its parent
 * installed. `addView` converts a bare [ViewGroup.LayoutParams] into the
 * parent's own subclass, so handing an already added child a fresh bare
 * instance downgrades it and the next measure pass fails: FrameLayout's
 * `measureChildWithMargins` casts to `MarginLayoutParams`.
 */
internal fun applyOverlaySize(view: View, width: Int, height: Int) {
    val params = view.layoutParams
    if (params == null) {
        view.layoutParams = ViewGroup.LayoutParams(width, height)
        return
    }
    if (params.width == width && params.height == height) return
    params.width = width
    params.height = height
    view.layoutParams = params
}

internal fun overlayTranslation(
    hostOffset: Int,
    hostTranslation: Float,
    parentPadding: Int,
    rectOffset: Int,
): Float = hostOffset - parentPadding + hostTranslation + rectOffset

internal fun translateOverlay(view: View, webView: View, parent: ViewGroup, rect: OverlayRect) {
    view.translationX =
        overlayTranslation(webView.left, webView.translationX, parent.paddingLeft, rect.left)
    view.translationY =
        overlayTranslation(webView.top, webView.translationY, parent.paddingTop, rect.top)
}

/** Physical-pixel rect for the overlay view: CSS rect converted and clipped. */
internal data class OverlayRect(
    val left: Int,
    val top: Int,
    val width: Int,
    val height: Int,
)

/** Raw overlay request kept for later rebinding while a track is detached. */
internal data class OverlaySpec(
    val x: Double,
    val y: Double,
    val width: Double,
    val height: Double,
    val devicePixelRatio: Double,
)

/** Outcome of pinning an overlay view over a reported rect. */
internal sealed interface OverlayAttachResult {
    data object Attached : OverlayAttachResult

    data object InvalidGeometry : OverlayAttachResult

    data object TrackUnavailable : OverlayAttachResult

    data object HostUnavailable : OverlayAttachResult

    data object Failed : OverlayAttachResult
}

private const val OVERLAY_MAIN_THREAD_TIMEOUT_MS = 3_000L

/** Runs a mutation on the main thread; bridge callers block briefly. */
internal fun <T> onOverlayMainThread(mainHandler: Handler, block: () -> T): T {
    if (Looper.myLooper() == Looper.getMainLooper()) return block()
    val latch = CountDownLatch(1)
    val box = arrayOfNulls<Result<T>>(1)
    mainHandler.post {
        box[0] = runCatching(block)
        latch.countDown()
    }
    if (!latch.await(OVERLAY_MAIN_THREAD_TIMEOUT_MS, TimeUnit.MILLISECONDS)) {
        throw TimeoutException("main thread did not run the overlay mutation")
    }
    return box[0]!!.getOrThrow()
}

/**
 * Converts a WebView-viewport-relative CSS rect into a physical Android pixel
 * rect clipped to the WebView itself (`viewportWidthPx`/`viewportHeightPx`).
 *
 * All edge math happens in the Double domain and the viewport intersection is
 * computed before any Int conversion, so huge-but-finite inputs clip cleanly
 * instead of overflowing. Edges convert with floor/ceil after clipping so any
 * pixel the intersection touches is covered. Offsets may be negative (an
 * element can straddle the viewport edge); size and ratio must be finite and
 * strictly positive. Returns null when the intersection is empty.
 */
internal fun overlayRectFromCss(
    x: Double,
    y: Double,
    width: Double,
    height: Double,
    devicePixelRatio: Double,
    viewportWidthPx: Int,
    viewportHeightPx: Int,
): OverlayRect? {
    if (!x.isFinite() || !y.isFinite() || !width.isFinite() || !height.isFinite() ||
        !devicePixelRatio.isFinite() ||
        width <= 0.0 || height <= 0.0 || devicePixelRatio <= 0.0
    ) {
        return null
    }
    if (viewportWidthPx <= 0 || viewportHeightPx <= 0) return null

    val left = x * devicePixelRatio
    val top = y * devicePixelRatio
    val right = left + width * devicePixelRatio
    val bottom = top + height * devicePixelRatio

    val clippedLeft = maxOf(left, 0.0)
    val clippedTop = maxOf(top, 0.0)
    val clippedRight = minOf(right, viewportWidthPx.toDouble())
    val clippedBottom = minOf(bottom, viewportHeightPx.toDouble())
    if (clippedRight <= clippedLeft || clippedBottom <= clippedTop) return null

    // Post-intersection conversion is bounded by the viewport: no overflow.
    val leftInt = floor(clippedLeft).toInt()
    val topInt = floor(clippedTop).toInt()
    val rightInt = ceil(clippedRight).toInt()
    val bottomInt = ceil(clippedBottom).toInt()
    return OverlayRect(
        left = leftInt,
        top = topInt,
        width = rightInt - leftInt,
        height = bottomInt - topInt,
    )
}

/**
 * Owns the overlay of one remote video track: one [PassThroughVideoRenderer]
 * sibling placed directly above the host WebView.
 *
 * Callers stay on the controller's bridge thread, so the fields are
 * single-writer; every view/renderer mutation is marshalled onto the main
 * thread and awaited so failures map onto a bounded outcome. `generation`
 * guards marshalled blocks against a teardown that landed between the bridge
 * capture and the main-thread run (and once more just before field commit, so
 * a block that outlived the marshal timeout still cannot resurrect state).
 *
 * Lifecycle model, driven by [reconcile] from LiveKit track events:
 * - ATTACHED: sink bound, tile visible.
 * - DETACHED: the track disappeared (unpublished/unsubscribed/left). The sink
 *   is detached and the tile hidden immediately, but the selection
 *   (identity, SID, geometry) is preserved so a later publish/subscribe event
 *   rebinds it automatically. No stale frame or track is ever shown.
 * - [clear] (explicit clear, disconnect, dispose) forgets the selection and
 *   releases everything.
 *
 * A track only resolves while its remote publication is `subscribed` and
 * carries a non-null [VideoTrack]; unsubscription detaches immediately.
 */
internal class RemoteVideoOverlay(
    private val webViewProvider: () -> WebView?,
) {

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var renderer: PassThroughVideoRenderer? = null

    /** Null while DETACHED: the selection survives, the sink does not. */
    @Volatile private var attachedTrack: VideoTrack? = null

    @Volatile private var selectedIdentity: String? = null

    @Volatile private var selectedTrackSid: String? = null

    @Volatile private var selectedSpec: OverlaySpec? = null

    @Volatile private var generation = 0L

    /** True while the tile owns the whole host window for picture-in-picture
     * and the geometry the JS lane reports no longer applies. */
    @Volatile private var fullWindow = false

    @Volatile var screenShare = false
        private set

    val bound: Boolean
        get() = attachedTrack != null

    /** A takeover has to follow the host window through the resize the PiP
     * transition causes: the mode change lands before the new layout does, so
     * the size read at that moment is still the pre-transition one. */
    private val hostLayoutListener =
        View.OnLayoutChangeListener { _, _, _, _, _, _, _, _, _ -> refreshPlacement() }

    /**
     * Attaches the remote camera track to the overlay. The same track only
     * re-lays the view; a different track moves the sink over. An unavailable
     * track records the selection, detaches/hides any current tile, and
     * reports [OverlayAttachResult.TrackUnavailable]; a later publish/subscribe
     * rebinds it via [reconcile]. Any failure after renderer/view creation or
     * attachment (including a marshal timeout whose queued block could still
     * run) invalidates the generation and rolls back to a fully released,
     * selection-less state.
     */
    fun attach(
        room: Room,
        participantIdentity: String,
        trackSid: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        devicePixelRatio: Double,
    ): OverlayAttachResult {
        val spec = OverlaySpec(x, y, width, height, devicePixelRatio)
        val track = resolveSubscribedVideoTrack(room, participantIdentity, trackSid)
        if (track == null) {
            // Record the selection so a later publish rebinds automatically;
            // hide any current tile without forgetting it.
            selectedIdentity = participantIdentity
            selectedTrackSid = trackSid
            selectedSpec = spec
            if (!detachOnMainThread()) {
                clear()
            }
            return OverlayAttachResult.TrackUnavailable
        }
        val capturedGeneration = generation
        return runCatching {
                onMainThread {
                    if (generation != capturedGeneration) {
                        return@onMainThread OverlayAttachResult.Failed
                    }
                    val webView = webViewProvider()
                        ?: return@onMainThread OverlayAttachResult.HostUnavailable
                    val parent = webView.parent as? ViewGroup
                        ?: return@onMainThread OverlayAttachResult.HostUnavailable
                    val rect =
                        overlayRectFromCss(
                            x,
                            y,
                            width,
                            height,
                            devicePixelRatio,
                            webView.width,
                            webView.height,
                        )
                            ?: return@onMainThread OverlayAttachResult.InvalidGeometry

                    val previous = renderer
                    val view = previous ?: PassThroughVideoRenderer(webView.context)
                    try {
                        if (previous == null) {
                            room.initVideoRenderer(view)
                        }
                        if (attachedTrack !== track) {
                            attachedTrack?.removeRenderer(view)
                            track.addRenderer(view)
                            applyScalingType(view, room, participantIdentity, trackSid)
                        }

                        place(view, webView, parent, rect)

                        if (generation != capturedGeneration) {
                            // The marshal timed out / a teardown landed while
                            // this block ran: rollback instead of resurrecting
                            // state the bridge already forgot.
                            rollbackFailedAttach(view, track)
                            return@onMainThread OverlayAttachResult.Failed
                        }
                        renderer = view
                        attachedTrack = track
                        selectedIdentity = participantIdentity
                        selectedTrackSid = trackSid
                        selectedSpec = spec
                        OverlayAttachResult.Attached
                    } catch (failure: Exception) {
                        rollbackFailedAttach(view, track)
                        OverlayAttachResult.Failed
                    }
                }
            }
            .getOrElse {
                // A queued block may still run later; invalidate it, then drop
                // any partial state through the wedged-main-safe clear path.
                generation++
                clear()
                OverlayAttachResult.Failed
            }
    }

    /**
     * Re-resolves the selection after a LiveKit track lifecycle event:
     * - ATTACHED + selection gone → detach + hide (selection preserved).
     * - ATTACHED + replaced track → rebind the sink in place.
     * - DETACHED + selection back (publish/subscribe) → rebind + show.
     * Any failure clears fully. No-op while nothing is selected.
     */
    fun reconcile(room: Room?) {
        val identity = selectedIdentity ?: return
        val trackSid = selectedTrackSid ?: return
        val spec = selectedSpec ?: return
        val resolved = room?.let { resolveSubscribedVideoTrack(it, identity, trackSid) }
        val view = renderer
        if (view == null) {
            // Nothing to detach; reattach from scratch once the track exists.
            if (room != null && resolved != null) {
                attach(room, identity, trackSid, spec.x, spec.y, spec.width, spec.height,
                    spec.devicePixelRatio)
            }
            return
        }
        if (resolved == null) {
            if (!detachOnMainThread()) {
                clear()
            }
            return
        }
        if (resolved === attachedTrack && view.visibility == View.VISIBLE) return
        val completed =
            runCatching {
                    onMainThread {
                        // The selection/view may have changed while queued.
                        if (renderer !== view || selectedIdentity != identity ||
                            selectedTrackSid != trackSid
                        ) {
                            return@onMainThread true
                        }
                        if (attachedTrack !== resolved) {
                            attachedTrack?.removeRenderer(view)
                            resolved.addRenderer(view)
                            attachedTrack = resolved
                            room?.let { applyScalingType(view, it, identity, trackSid) }
                            // A swap onto an already laid out tile never
                            // re-lays it, so nothing else would re-sample.
                            notifyVisibilityAfterLayout(view)
                        }
                        if (view.visibility != View.VISIBLE) {
                            val webView =
                                webViewProvider() ?: return@onMainThread false
                            val parent = webView.parent as? ViewGroup
                                ?: return@onMainThread false
                            val rect =
                                overlayRectFromCss(
                                    spec.x,
                                    spec.y,
                                    spec.width,
                                    spec.height,
                                    spec.devicePixelRatio,
                                    webView.width,
                                    webView.height,
                                )
                            // A degenerate viewport keeps the tile hidden; the
                            // sink stays bound so video resumes after layout.
                            if (rect != null) place(view, webView, parent, rect)
                        }
                        true
                    }
                }
                .getOrElse { false }
        if (!completed) clear()
    }

    /**
     * Explicit clear / disconnect / dispose: forget the selection and release
     * everything; never throws. The fields reset first on the caller thread,
     * so a wedged main thread still drops the sink/EGL eagerly while the
     * dying hierarchy discards the view.
     */
    fun clear() {
        generation++
        val view = renderer
        val track = attachedTrack
        val wasFullWindow = fullWindow
        renderer = null
        attachedTrack = null
        selectedIdentity = null
        selectedTrackSid = null
        selectedSpec = null
        fullWindow = false
        if (view == null && !wasFullWindow) return
        runCatching {
                onMainThread {
                    if (wasFullWindow) {
                        webViewProvider()?.removeOnLayoutChangeListener(hostLayoutListener)
                    }
                    if (view == null) return@onMainThread
                    if (track != null) runCatching { track.removeRenderer(view) }
                    (view.parent as? ViewGroup)?.removeView(view)
                    // May share the view with a timed-out attach rollback.
                    runCatching { view.release() }
                }
            }
            .onFailure {
                if (view == null) return@onFailure
                if (track != null) runCatching { track.removeRenderer(view) }
                runCatching { view.release() }
            }
    }

    /**
     * Enters or leaves a picture-in-picture takeover. In PiP the plugin hides
     * the WebView the tile is stacked on, so the tile stops following the
     * reported geometry and covers the host viewport instead; leaving restores
     * the reported geometry. Returns false when the main-thread step failed and
     * the caller should [clear] instead.
     */
    fun setFullWindow(enabled: Boolean): Boolean {
        if (fullWindow == enabled) return true
        fullWindow = enabled
        return runCatching {
                onMainThread {
                    val webView = webViewProvider()
                    if (enabled) {
                        webView?.addOnLayoutChangeListener(hostLayoutListener)
                    } else {
                        webView?.removeOnLayoutChangeListener(hostLayoutListener)
                        // The window is restored after the transition, so the
                        // reported rect only lines up again on the next layout.
                        webView?.doOnLayout { refreshPlacement() }
                    }
                    renderer?.translationZ = if (enabled) 1f else 0f
                    refreshPlacement()
                }
            }
            .isSuccess
    }

    /** Re-pins the tile from the remembered spec. Main thread only. */
    private fun refreshPlacement() {
        val view = renderer ?: return
        val webView = webViewProvider() ?: return
        val parent = webView.parent as? ViewGroup ?: return
        val spec = selectedSpec ?: return
        val rect =
            overlayRectFromCss(
                spec.x,
                spec.y,
                spec.width,
                spec.height,
                spec.devicePixelRatio,
                webView.width,
                webView.height,
            )
        place(view, webView, parent, rect)
    }

    /**
     * Sizes and positions the tile on the main thread, directly after the
     * WebView so the self-view stacks above it. A null rect only ever reaches
     * here from [refreshPlacement], where a takeover supplies its own geometry
     * and a spec that no longer intersects the shrunken viewport must not
     * abort the placement.
     */
    private fun place(
        view: PassThroughVideoRenderer,
        webView: WebView,
        parent: ViewGroup,
        rect: OverlayRect?,
    ) {
        val placed =
            if (fullWindow) OverlayRect(0, 0, webView.width, webView.height) else rect ?: return
        applyOverlaySize(view, placed.width, placed.height)
        if (view.parent !== parent) {
            (view.parent as? ViewGroup)?.removeView(view)
            val webViewIndex = parent.indexOfChild(webView)
            val index = if (webViewIndex >= 0) webViewIndex + 1 else parent.childCount
            parent.addView(view, index)
        }
        // The clipped rect is WebView viewport-relative; the view sits in the
        // WebView's parent, so translate by the parent-relative origin.
        // Translations survive parent re-layouts.
        translateOverlay(view, webView, parent, placed)
        view.visibility = View.VISIBLE
        notifyVisibilityAfterLayout(view)
    }

    /**
     * Re-samples the sink's visibility once the tile has real bounds.
     *
     * With `adaptiveStream` on, `RemoteVideoTrack.addRenderer` wraps the view in
     * the SDK's `ViewVisibility` and samples it there and then. A view that is
     * not attached to a window yet reports `windowVisibility == GONE` and a zero
     * size, so the publication keeps the `disabled = true` it is created with
     * and the SFU is told to stop sending. The SDK's own recovery is a 2 s
     * debounce off the layout observer, and re-setting an already-VISIBLE view
     * VISIBLE never fires `onVisibilityChanged`, so nothing else closes that
     * window. `recalculate` is the hook `ViewVisibility.Notifier` exists for.
     */
    private fun notifyVisibilityAfterLayout(view: PassThroughVideoRenderer) {
        view.doOnLayout { view.viewVisibility?.recalculate() }
    }

    /**
     * Temporary detach: drop the sink and hide the tile but keep the view,
     * renderer, and selection so [reconcile] can rebind. The `attachedTrack`
     * reference is retained until the main-thread removal actually succeeds,
     * since clearing it earlier would let a marshal timeout/failure orphan the
     * renderer as a sink on the old track, which the follow-up [clear] must
     * then still be able to reach. Returns false when the main-thread step
     * failed and callers should [clear] instead (the kept reference lets that
     * clear remove the sink through its wedged-main fallback).
     */
    private fun detachOnMainThread(): Boolean {
        val view = renderer ?: return true
        return runCatching {
                onMainThread {
                    if (renderer !== view) return@onMainThread
                    attachedTrack?.let { track ->
                        // Only forget the track once the sink is really gone.
                        track.removeRenderer(view)
                        attachedTrack = null
                    }
                    view.visibility = View.GONE
                }
            }
            .isSuccess
    }

    /**
     * Transactional rollback for a failed [attach]: detach the view from both
     * the previous and the attempted track, remove it from the hierarchy,
     * release its EGL resources, and forget every owner reference. Runs on the
     * main thread from the attach catch-block; every step is isolated so one
     * failure cannot mask the remaining cleanup.
     */
    private fun rollbackFailedAttach(
        view: PassThroughVideoRenderer,
        attemptedTrack: VideoTrack,
    ) {
        attachedTrack?.let { runCatching { it.removeRenderer(view) } }
        runCatching { attemptedTrack.removeRenderer(view) }
        runCatching { (view.parent as? ViewGroup)?.removeView(view) }
        runCatching { view.release() }
        renderer = null
        attachedTrack = null
        selectedIdentity = null
        selectedTrackSid = null
        selectedSpec = null
    }

    /**
     * Resolves a remote participant's video track by identity + track SID, but
     * only while the publication is subscribed and carries a non-null track;
     * an unsubscribed publication detaches immediately rather than replaying
     * its last frame.
     */
    private fun resolveSubscribedVideoTrack(
        room: Room,
        participantIdentity: String,
        trackSid: String,
    ): VideoTrack? =
        resolveSubscribedPublication(room, participantIdentity, trackSid)?.track as? VideoTrack

    private fun resolveSubscribedPublication(
        room: Room,
        participantIdentity: String,
        trackSid: String,
    ): RemoteTrackPublication? {
        val participant =
            room.remoteParticipants.entries
                .firstOrNull { (identity, _) -> identity.value == participantIdentity }
                ?.value
                ?: return null
        val publication =
            participant.trackPublications.values.firstOrNull { it.sid == trackSid }
                as? RemoteTrackPublication
                ?: return null
        if (!publication.subscribed) return null
        return publication
    }

    /**
     * A shared screen is letterboxed: VideoLayoutMeasure defaults to
     * SCALE_ASPECT_BALANCED, which crops to fill the tile and cuts the sides
     * off a desktop shown in a portrait slot. Cameras keep that default, where
     * filling the tile is what you want. Called only on a rebind: the scaling
     * follows the bound track, and setScalingType always requests a layout.
     */
    private fun applyScalingType(
        view: PassThroughVideoRenderer,
        room: Room,
        participantIdentity: String,
        trackSid: String,
    ) {
        val source = resolveSubscribedPublication(room, participantIdentity, trackSid)?.source
        screenShare = source == Track.Source.SCREEN_SHARE
        view.setScalingType(
            if (screenShare) {
                ScalingType.SCALE_ASPECT_FIT
            } else {
                ScalingType.SCALE_ASPECT_BALANCED
            }
        )
    }

    private fun <T> onMainThread(block: () -> T): T =
        onOverlayMainThread(mainHandler, block)
}

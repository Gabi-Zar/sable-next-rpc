package app.tauri.livekit_mobile

import android.os.Handler
import android.os.Looper
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import io.livekit.android.room.Room
import io.livekit.android.room.track.CameraPosition
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.VideoTrack
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * Owns the single local-camera self-view: one [PassThroughVideoRenderer] added
 * last among the WebView's siblings, so it floats above the remote overlay.
 *
 * Threading and lifecycle follow [RemoteVideoOverlay]: bridge-thread callers,
 * every view/renderer mutation marshalled onto the main thread and awaited, and
 * a `generation` guard so a teardown landing mid-marshal cannot resurrect
 * released state. There is no participant/track selection to remember here,
 * since the source is always the local CAMERA publication; only the geometry
 * survives a detach, so [reconcile] can rebind a replaced track or hide a
 * vanished one.
 */
internal class LocalVideoOverlay(
    private val webViewProvider: () -> WebView?,
) {

    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var renderer: PassThroughVideoRenderer? = null

    /** Null while DETACHED: the geometry survives, the sink does not. */
    @Volatile private var attachedTrack: VideoTrack? = null

    @Volatile private var selectedSpec: OverlaySpec? = null

    @Volatile private var generation = 0L

    /** True while a picture-in-picture takeover owns the window: the self-view
     * is stacked above the remote tile and would sit on top of it there. */
    @Volatile private var hidden = false

    /**
     * Attaches the local camera track to the overlay. The same track only
     * re-lays the view; a replaced track moves the sink over. An unpublished
     * camera records the geometry, detaches/hides any current tile, and reports
     * [OverlayAttachResult.TrackUnavailable]; a later publish rebinds it via
     * [reconcile].
     */
    fun attach(
        room: Room,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        devicePixelRatio: Double,
    ): OverlayAttachResult {
        val spec = OverlaySpec(x, y, width, height, devicePixelRatio)
        val track = resolveCameraTrack(room)
        if (track == null) {
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
                        }
                        applyMirror(view, track)
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
     * Re-resolves the local camera after a track lifecycle event: rebinds the
     * sink to a replaced track, or detaches and hides the tile once the camera
     * is unpublished. No-op while nothing has been attached.
     */
    fun reconcile(room: Room?) {
        val spec = selectedSpec ?: return
        val resolved = room?.let { resolveCameraTrack(it) }
        val view = renderer
        if (view == null) {
            // Nothing to detach; reattach from scratch once the track exists.
            if (room != null && resolved != null) {
                attach(room, spec.x, spec.y, spec.width, spec.height, spec.devicePixelRatio)
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
                        // The view may have changed while queued.
                        if (renderer !== view) return@onMainThread true
                        if (attachedTrack !== resolved) {
                            attachedTrack?.removeRenderer(view)
                            resolved.addRenderer(view)
                            attachedTrack = resolved
                        }
                        applyMirror(view, resolved)
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
     * Explicit clear / disconnect / dispose: forget the geometry and release
     * everything; never throws. The fields reset first on the caller thread,
     * so a wedged main thread still drops the sink/EGL eagerly while the
     * dying hierarchy discards the view.
     */
    fun clear() {
        generation++
        val view = renderer
        val track = attachedTrack
        renderer = null
        attachedTrack = null
        selectedSpec = null
        hidden = false
        if (view == null) return
        runCatching {
                onMainThread {
                    if (track != null) runCatching { track.removeRenderer(view) }
                    (view.parent as? ViewGroup)?.removeView(view)
                    // May share the view with a timed-out attach rollback.
                    runCatching { view.release() }
                }
            }
            .onFailure {
                if (track != null) runCatching { track.removeRenderer(view) }
                runCatching { view.release() }
            }
    }

    /**
     * Sizes and positions the tile on the main thread. The view is appended
     * last so the self-view stacks above the remote overlay, which inserts
     * itself directly after the WebView.
     */
    private fun place(
        view: PassThroughVideoRenderer,
        webView: WebView,
        parent: ViewGroup,
        rect: OverlayRect,
    ) {
        applyOverlaySize(view, rect.width, rect.height)
        if (view.parent !== parent) {
            (view.parent as? ViewGroup)?.removeView(view)
            parent.addView(view)
        }
        // The clipped rect is WebView viewport-relative; the view sits in the
        // WebView's parent, so translate by the parent-relative origin.
        // Translations survive parent re-layouts.
        translateOverlay(view, webView, parent, rect)
        view.visibility = if (hidden) View.GONE else View.VISIBLE
    }

    /**
     * Hides or restores the self-view for a picture-in-picture takeover. The
     * sink stays bound so the camera keeps rendering when the tile comes back.
     * Returns false when the main-thread step failed and the caller should
     * [clear] instead.
     */
    fun setHidden(hidden: Boolean): Boolean {
        if (this.hidden == hidden) return true
        this.hidden = hidden
        val view = renderer ?: return true
        return runCatching {
                onMainThread {
                    if (renderer !== view) return@onMainThread
                    // A detached tile is already GONE and must stay that way.
                    if (attachedTrack == null) return@onMainThread
                    view.visibility = if (hidden) View.GONE else View.VISIBLE
                }
            }
            .isSuccess
    }

    /**
     * Temporary detach: drop the sink and hide the tile but keep the view,
     * renderer, and geometry so [reconcile] can rebind. The `attachedTrack`
     * reference is retained until the main-thread removal actually succeeds,
     * since clearing it earlier would let a marshal timeout/failure orphan the
     * renderer as a sink on the old track, which the follow-up [clear] must
     * then still be able to reach. Returns false when the main-thread step
     * failed and callers should [clear] instead.
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
        selectedSpec = null
    }

    fun refreshMirror() {
        val view = renderer ?: return
        runCatching {
            onMainThread {
                val track = attachedTrack
                if (renderer === view && track != null) applyMirror(view, track)
            }
        }
    }

    private fun applyMirror(view: PassThroughVideoRenderer, track: VideoTrack) {
        view.setMirror((track as? LocalVideoTrack)?.options?.position == CameraPosition.FRONT)
    }

    /** Resolves the local participant's published camera track, if any. */
    private fun resolveCameraTrack(room: Room): VideoTrack? =
        room.localParticipant.getTrackPublication(Track.Source.CAMERA)?.track as? VideoTrack

    private fun <T> onMainThread(block: () -> T): T =
        onOverlayMainThread(mainHandler, block)

}

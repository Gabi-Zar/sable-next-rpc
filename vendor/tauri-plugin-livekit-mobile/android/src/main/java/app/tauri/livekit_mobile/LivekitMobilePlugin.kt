package app.tauri.livekit_mobile

import android.app.Activity
import android.content.Context
import android.content.pm.PackageManager
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.view.View
import android.webkit.WebView
import androidx.activity.result.ActivityResult
import androidx.core.content.ContextCompat
import app.tauri.annotation.ActivityCallback
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.Permission
import app.tauri.annotation.PermissionCallback
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import io.livekit.android.room.track.LocalAudioTrackOptions

/** Matches both platform SDKs' own ceiling for a remote playout gain. */
private const val MAX_PARTICIPANT_VOLUME = 10.0

private fun audioProcessingOf(args: NativeCallAudioProcessingArgs?): LocalAudioTrackOptions =
    LocalAudioTrackOptions(
        noiseSuppression = args?.noiseSuppression ?: true,
        echoCancellation = args?.echoCancellation ?: true,
        autoGainControl = args?.autoGainControl ?: true,
    )

@InvokeArg
internal class NativeCallEncryptionKeyEntry {
    var identity: String = ""
    var keyIndex: Int = 0
    var key: String = ""
}

@InvokeArg
internal class NativeCallAudioProcessingArgs {
    var echoCancellation: Boolean = true
    var noiseSuppression: Boolean = true
    var autoGainControl: Boolean = true
}

@InvokeArg
internal class ConnectNativeCallArgs {
    var callId: String = ""
    var url: String = ""
    var token: String = ""
    var microphoneEnabled: Boolean = false
    var encryptionKeys: List<NativeCallEncryptionKeyEntry>? = null
    var audioProcessing: NativeCallAudioProcessingArgs? = null
    lateinit var channel: Channel
}

@InvokeArg
internal class SetNativeCallAudioProcessingArgs {
    var callId: String = ""
    var echoCancellation: Boolean = true
    var noiseSuppression: Boolean = true
    var autoGainControl: Boolean = true
}

@InvokeArg
internal class SetNativeCallParticipantVolumeArgs {
    var callId: String = ""
    var identity: String = ""
    var volume: Double = 1.0
    var screenShare: Boolean = false
}

@InvokeArg
internal class CallIdArgs {
    var callId: String = ""
}

@InvokeArg
internal class SetNativeCallMicrophoneEnabledArgs {
    var callId: String = ""
    var enabled: Boolean = false
}

@InvokeArg
internal class SetNativeCallCameraEnabledArgs {
    var callId: String = ""
    var enabled: Boolean = false
}

@InvokeArg
internal class SetNativeCallScreenShareEnabledArgs {
    var callId: String = ""
    var enabled: Boolean = false
}

@InvokeArg
internal class SetNativeCallEncryptionKeyArgs {
    var callId: String = ""
    var identity: String = ""
    var keyIndex: Int = 0
    var key: String = ""
}

@InvokeArg
internal class SetNativeCallPiPEnabledArgs {
    var callId: String = ""
    var enabled: Boolean = false
}

@InvokeArg
internal class SetNativeCallRemoteVideoOverlayArgs {
    var callId: String = ""
    var participantIdentity: String = ""
    var trackId: String = ""
    var x: Double = 0.0
    var y: Double = 0.0
    var width: Double = 0.0
    var height: Double = 0.0
    var devicePixelRatio: Double = 0.0
}

@InvokeArg
internal class ClearNativeCallRemoteVideoOverlayArgs {
    var callId: String = ""
    var trackId: String? = null
}

@InvokeArg
internal class SetNativeCallLocalVideoOverlayArgs {
    var callId: String = ""
    var x: Double = 0.0
    var y: Double = 0.0
    var width: Double = 0.0
    var height: Double = 0.0
    var devicePixelRatio: Double = 0.0
}

// ── System-call (Telecom/CallKit) command argument classes ──

@InvokeArg
internal class StartSystemCallArgs {
    var callId: String = ""
    var uuid: String = ""
    var callerName: String = ""
}

@InvokeArg
internal class ReportIncomingCallArgs {
    var callId: String = ""
    var uuid: String = ""
    var callerName: String = ""
    var hasVideo: Boolean = false
    var roomId: String? = null
}

@InvokeArg
internal class EndSystemCallArgs {
    var callId: String = ""
    var remoteEnded: Boolean = false
}

@InvokeArg
internal class SetSystemCallMutedArgs {
    var callId: String = ""
    var muted: Boolean = false
}

@InvokeArg
internal class FulfillCallArgs {
    var uuid: String = ""
}

@InvokeArg
internal class UpdateCallDisplayArgs {
    var callId: String = ""
    var callerName: String = ""
    var hasVideo: Boolean? = null
}

@InvokeArg
internal class SetAudioRouteArgs {
    var callId: String = ""
    var routeId: String = ""
}

@InvokeArg
internal class SetAudioInputArgs {
    var callId: String = ""
    var inputId: String = ""
}

@TauriPlugin(
    permissions = [
        Permission(
            strings = ["android.permission.RECORD_AUDIO"],
            alias = "microphone",
        ),
        Permission(
            strings = ["android.permission.CAMERA"],
            alias = "camera",
        ),
        Permission(
            strings = ["android.permission.BLUETOOTH_CONNECT"],
            alias = "bluetooth",
        ),
        Permission(
            strings = ["android.permission.POST_NOTIFICATIONS"],
            alias = "notifications",
        ),
    ],
)
class LivekitMobilePlugin(private val activity: Activity) : Plugin(activity) {
    /** Host WebView retained at load() so the video overlay can anchor above
     * it. Written on the main thread, read on the controller's bridge thread. */
    @Volatile
    private var hostWebView: WebView? = null

    private val videoOverlay = RemoteVideoOverlays(webViewProvider = { hostWebView })

    private val localVideoOverlay = LocalVideoOverlay(webViewProvider = { hostWebView })

    /** The consent dialog carries no arguments of its own. */
    private var pendingScreenShareCallId: String? = null

    private val pictureInPicture =
        NativeCallPictureInPicture(activity) { active -> applyPictureInPictureMode(active) }

    private val controller =
        NativeCallController(
            appContext = activity.applicationContext,
            hasMicrophonePermission = { hasRecordAudioPermission() },
            hasCameraPermission = { hasCameraPermission() },
            videoOverlay = videoOverlay,
            localVideoOverlay = localVideoOverlay,
            // A room can also end from the far side or from Telecom, so the
            // arm has to be dropped at the single teardown funnel, not only in
            // the disconnect command.
            onCallEnded = { activity.runOnUiThread { pictureInPicture.reset() } },
        )

    private val callController = AndroidCallController(
        appContext = activity.applicationContext,
        plugin = this,
        // Telecom allows 5s for a system-initiated hangup (lock screen, headset
        // button, watch, Android Auto) and JS may be suspended, so the room and
        // the foreground service have to go down here, not when JS drains.
        onSystemDisconnect = { callId ->
            controller.disconnectActiveCall()
            controller.dismissCallPresentation(callId)
        },
        onSystemSetInactive = { controller.muteForSystemInactive() },
    )

    /**
     * Notification buttons and foreground-service failures arrive here through
     * the process-wide router, not through a receiver this plugin registered:
     * the notification outlives any one plugin instance.
     */
    private val callActionHandler: (NativeCallAction) -> Unit = { action ->
        when (action.kind) {
            NativeCallActionKind.ANSWER ->
                callController.answerCallFromNotification(action.callId) { answered ->
                    // A refused answer already ended the Telecom call; the ring
                    // notification has to go with it.
                    if (!answered) controller.dismissCallPresentation(action.callId)
                }
            NativeCallActionKind.END -> {
                callController.endCallFromNotification(action.callId)
                controller.disconnectActiveCall()
                // Declining a call that never became a room leaves the ring
                // notification behind; nothing else takes it down.
                controller.dismissCallPresentation(action.callId)
            }
            NativeCallActionKind.FOREGROUND_SERVICE_FAILED ->
                controller.reportForegroundServiceFailed()
        }
    }

    override fun load(webView: WebView) {
        hostWebView = webView
        NativeCallActionRouter.shared.attach(callActionHandler)
    }

    private val pendingPermission = SinglePermissionRequest<PendingPermission>()

    /** Bluetooth and notifications are asked for once per process: a denial
     * must not put a permission round-trip in front of every call. */
    private var ancillaryPermissionsPrompted = false

    private sealed class PendingPermission {
        abstract val invoke: Invoke

        data class Connect(
            override val invoke: Invoke,
            val args: ConnectNativeCallArgs,
        ) : PendingPermission()

        data class Microphone(
            override val invoke: Invoke,
            val args: SetNativeCallMicrophoneEnabledArgs,
        ) : PendingPermission()

        data class Camera(
            override val invoke: Invoke,
            val args: SetNativeCallCameraEnabledArgs,
        ) : PendingPermission()
    }

    // ── Core call commands ─────────────────────────────────────────────────

    @Command
    fun getNativeCallCapabilities(invoke: Invoke) {
        invoke.resolve(
            JSObject()
                .put("platform", "android")
                .put("microphone", true)
                .put("audioPlayback", true)
                .put("foregroundService", true)
                .put("backgroundJavascript", false)
                .put("camera", true)
                .put("nativeVideoOverlay", true)
                .put("screenShare", true)
                .put("pictureInPicture", pictureInPicture.supported)
                .put("systemCalls", true)
                .put("audioRoutes", true)
                .put("devicePicker", false),
        )
    }

    @Command
    fun connectNativeCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(ConnectNativeCallArgs::class.java) }.getOrNull()
        if (args == null ||
            args.callId.isBlank() ||
            args.url.isBlank() ||
            args.token.isBlank() ||
            !hasChannel(args)
        ) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // Decode key material at the boundary; malformed entries fail the call.
        val encryptionKeys = decodeEncryptionKeys(args.encryptionKeys)
        if (encryptionKeys == null) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (controller.isBusy(args.callId)) {
            reject(invoke, NativeCallWire.ERR_BUSY)
            return
        }
        if (controller.isActiveCall(args.callId)) {
            invoke.resolve(controller.snapshotJson())
            return
        }
        val missing = missingCallPermissionAliases(args.microphoneEnabled)
        if (missing.isNotEmpty()) {
            if (!pendingPermission.begin(invoke.id, PendingPermission.Connect(invoke, args))) {
                reject(invoke, NativeCallWire.ERR_BUSY)
                return
            }
            ancillaryPermissionsPrompted = true
            try {
                requestPermissionForAliases(missing, invoke, "permissionResult")
            } catch (_: Exception) {
                pendingPermission.complete(invoke.id)
                reject(invoke, NativeCallWire.ERR_PERMISSION_DENIED)
            }
            return
        }
        controller.connect(
            args.callId,
            args.url,
            args.token,
            args.microphoneEnabled,
            encryptionKeys,
            audioProcessingOf(args.audioProcessing),
            args.channel,
            invoke,
        )
    }

    @Command
    fun disconnectNativeCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CallIdArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // End the system call alongside the LiveKit room.
        callController.endCall(args.callId)
        controller.disconnect(args.callId, invoke)
    }

    @Command
    fun cancelNativeCallConnect(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CallIdArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        callController.endCall(args.callId)
        controller.cancelConnect(args.callId, invoke)
    }

    @Command
    fun setNativeCallMicrophoneEnabled(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallMicrophoneEnabledArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (args.enabled &&
            controller.isActiveCall(args.callId) &&
            !hasRecordAudioPermission()
        ) {
            if (!pendingPermission.begin(invoke.id, PendingPermission.Microphone(invoke, args))) {
                reject(invoke, NativeCallWire.ERR_BUSY)
                return
            }
            try {
                requestPermissionForAliases(arrayOf("microphone"), invoke, "permissionResult")
            } catch (_: Exception) {
                pendingPermission.complete(invoke.id)
                reject(invoke, NativeCallWire.ERR_PERMISSION_DENIED)
            }
            return
        }
        controller.setMicrophoneEnabled(args.callId, args.enabled, invoke)
    }

    @Command
    fun setNativeCallAudioProcessing(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallAudioProcessingArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.setAudioProcessing(
            args.callId,
            LocalAudioTrackOptions(
                noiseSuppression = args.noiseSuppression,
                echoCancellation = args.echoCancellation,
                autoGainControl = args.autoGainControl,
            ),
            invoke,
        )
    }

    @Command
    fun setNativeCallParticipantVolume(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallParticipantVolumeArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank() || args.identity.isBlank() ||
            !args.volume.isFinite()
        ) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.setParticipantVolume(
            args.callId,
            args.identity,
            args.volume.coerceIn(0.0, MAX_PARTICIPANT_VOLUME),
            args.screenShare,
            invoke,
        )
    }

    @Command
    fun setNativeCallCameraEnabled(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallCameraEnabledArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (args.enabled &&
            controller.isActiveCall(args.callId) &&
            !hasCameraPermission()
        ) {
            if (!pendingPermission.begin(invoke.id, PendingPermission.Camera(invoke, args))) {
                reject(invoke, NativeCallWire.ERR_BUSY)
                return
            }
            try {
                requestPermissionForAliases(arrayOf("camera"), invoke, "permissionResult")
            } catch (_: Exception) {
                pendingPermission.complete(invoke.id)
                reject(invoke, NativeCallWire.ERR_PERMISSION_DENIED)
            }
            return
        }
        controller.setCameraEnabled(args.callId, args.enabled, invoke)
    }

    @Command
    fun switchNativeCallCamera(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CallIdArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.switchCamera(args.callId, invoke)
    }

    /** Enabling settles in [handleScreenCaptureConsent]; disabling settles here. */
    @Command
    fun setNativeCallScreenShareEnabled(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallScreenShareEnabledArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (!controller.isActiveCall(args.callId)) {
            invoke.resolve(controller.snapshotJson())
            return
        }
        if (!args.enabled) {
            controller.setScreenShareEnabled(args.callId, false, null, invoke)
            return
        }
        val manager =
            activity.getSystemService(Context.MEDIA_PROJECTION_SERVICE) as? MediaProjectionManager
        if (manager == null) {
            reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
            return
        }
        pendingScreenShareCallId = args.callId
        runCatching {
                startActivityForResult(
                    invoke,
                    manager.createScreenCaptureIntent(),
                    "handleScreenCaptureConsent",
                )
            }
            .onFailure {
                pendingScreenShareCallId = null
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
            }
    }

    @ActivityCallback
    fun handleScreenCaptureConsent(invoke: Invoke, result: ActivityResult) {
        val callId = pendingScreenShareCallId
        pendingScreenShareCallId = null
        val data = result.data
        if (callId == null) {
            reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
            return
        }
        if (result.resultCode != Activity.RESULT_OK || data == null) {
            invoke.resolve(controller.snapshotJson())
            return
        }
        controller.setScreenShareEnabled(callId, true, data, invoke)
    }

    /**
     * Arms or disarms picture-in-picture for the call, matching iOS: enabling
     * does not enter PiP, it lets the system enter it when the user leaves the
     * app. A stale call id resolves the current snapshot unchanged, as every
     * other per-call command does.
     */
    @Command
    fun setNativeCallPiPEnabled(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallPiPEnabledArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (!controller.isActiveCall(args.callId)) {
            invoke.resolve(controller.snapshotJson())
            return
        }
        if (!pictureInPicture.setArmed(args.enabled)) {
            rejectUnavailable(invoke)
            return
        }
        invoke.resolve(controller.snapshotJson())
    }

    /**
     * Dresses the window for picture-in-picture. Remote video is drawn into a
     * view stacked on the WebView rather than into a system PiP surface, so the
     * PiP window would otherwise show the whole app UI shrunk down. Hiding the
     * WebView and the self-view and letting the remote tile cover the viewport
     * keeps the PiP content to the video, and asks nothing of the JS lane: the
     * transition would only reach it asynchronously and the PiP window would
     * show stale chrome until it repainted.
     *
     * INVISIBLE, not GONE: the tile is sized against the WebView's bounds, and
     * a GONE WebView is never measured, so its bounds would freeze at the
     * pre-transition size.
     */
    private fun applyPictureInPictureMode(active: Boolean) {
        hostWebView?.visibility = if (active) View.INVISIBLE else View.VISIBLE
        if (!localVideoOverlay.setHidden(active)) {
            localVideoOverlay.clear()
        }
        if (!videoOverlay.setFullWindow(active)) {
            videoOverlay.clear()
        }
    }

    @Command
    fun setNativeCallRemoteVideoOverlay(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallRemoteVideoOverlayArgs::class.java) }
                .getOrNull()
        if (args == null ||
            args.callId.isBlank() ||
            args.participantIdentity.isBlank() ||
            args.trackId.isBlank()
        ) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.setRemoteVideoOverlay(
            args.callId,
            args.participantIdentity,
            args.trackId,
            args.x,
            args.y,
            args.width,
            args.height,
            args.devicePixelRatio,
            invoke,
        )
    }

    @Command
    fun clearNativeCallRemoteVideoOverlay(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(ClearNativeCallRemoteVideoOverlayArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank() || args.trackId?.isBlank() == true) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.clearRemoteVideoOverlay(args.callId, args.trackId, invoke)
    }

    @Command
    fun setNativeCallLocalVideoOverlay(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallLocalVideoOverlayArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.setLocalVideoOverlay(
            args.callId,
            args.x,
            args.y,
            args.width,
            args.height,
            args.devicePixelRatio,
            invoke,
        )
    }

    @Command
    fun clearNativeCallLocalVideoOverlay(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CallIdArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.clearLocalVideoOverlay(args.callId, invoke)
    }

    @Command
    fun setNativeCallEncryptionKey(invoke: Invoke) {
        val args =
            runCatching { invoke.parseArgs(SetNativeCallEncryptionKeyArgs::class.java) }
                .getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // Decode key material at the boundary; the controller decides whether
        // the current call accepts it.
        val material =
            NativeCallEncryption.decodeEntry(args.identity, args.keyIndex, args.key)
        if (material == null) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        controller.setEncryptionKey(args.callId, material, invoke)
    }

    @Command
    fun getNativeCallState(invoke: Invoke) {
        invoke.resolve(controller.snapshotJson())
    }

    // ── System-call (Telecom/CallKit) commands ─────────────────────────────

    /**
     * Registers the call with Telecom and names the ongoing-call notification.
     *
     * Telecom fixes a call's attributes at addCall time and offers nothing like
     * `CXProvider.reportCall(with:updated:)`, so this is the only point where a
     * human-readable name can reach the system call: connectNativeCall
     * deliberately does not add the call, since the only name it has is the
     * call id.
     */
    @Command
    fun startSystemCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(StartSystemCallArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // Presented before the call is added: the same five-second window
        // applies, and core-telecom asks outgoing calls to post their
        // notification immediately or delay adding the call altogether.
        controller.presentCall(
            args.callId,
            LivekitMobileForegroundService.DIRECTION_OUTGOING,
            args.callerName,
        )
        callController.startOutgoingCall(
            args.callId,
            args.callerName.ifBlank { args.callId },
        ) { added ->
            if (!added) controller.dismissCallPresentation(args.callId)
            settle(invoke, added)
        }
    }

    @Command
    fun reportIncomingCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(ReportIncomingCallArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        val callerName = args.callerName.ifBlank { args.callId }
        if (!controller.presentIncomingCall(args.callId, callerName)) {
            rejectUnavailable(invoke)
            return
        }
        callController.reportIncomingCall(args.callId, callerName) { added ->
            if (!added) controller.dismissCallPresentation(args.callId)
            settle(invoke, added)
        }
    }

    @Command
    fun endSystemCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(EndSystemCallArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        callController.endCall(args.callId) { ended ->
            controller.dismissCallPresentation(args.callId)
            settle(invoke, ended)
        }
    }

    @Command
    fun setSystemCallMuted(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(SetSystemCallMutedArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // androidx.core.telecom exposes mute as a read-only flow: there is no
        // app to system push equivalent to CXSetMutedCallAction.
        reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
    }

    @Command
    fun getAudioRoutes(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(CallIdArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        val routes = controller.audioRoutes(args.callId)
        val inputs = controller.audioInputs(args.callId)
        invoke.resolve(
            JSObject()
                .put("routes", JSArray().apply { routes.forEach { put(it.toJSObject()) } })
                .put("inputs", JSArray().apply { inputs.forEach { put(it.toJSObject()) } })
                .put("receiver", controller.snapshotJson()),
        )
    }

    @Command
    fun setAudioRoute(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(SetAudioRouteArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank() || args.routeId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (controller.setAudioRoute(args.callId, args.routeId)) {
            invoke.resolve(JSObject().put("receiver", controller.snapshotJson()))
        } else {
            rejectUnavailable(invoke)
        }
    }

    @Command
    fun setAudioInput(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(SetAudioInputArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank() || args.inputId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        if (controller.setAudioInput(args.callId, args.inputId)) {
            invoke.resolve(JSObject().put("receiver", controller.snapshotJson()))
        } else {
            rejectUnavailable(invoke)
        }
    }

    @Command
    fun drainPendingSystemCallActions(invoke: Invoke) {
        invoke.resolveObject(callController.drainPendingActions().map { it.toMap() })
    }

    @Command
    fun fulfillAnswerCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(FulfillCallArgs::class.java) }.getOrNull()
        if (args == null) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // On iOS this fulfills a deferred CXAnswerCallAction.
        // On Android, the Telecom callback already fires immediately;
        // this is a no-op kept for API parity with iOS.
        invoke.resolve(JSObject())
    }

    @Command
    fun fulfillEndCall(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(FulfillCallArgs::class.java) }.getOrNull()
        if (args == null) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // On iOS this fulfills a deferred CXEndCallAction.
        // On Android, the Telecom callback already fires immediately;
        // this is a no-op kept for API parity with iOS.
        invoke.resolve(JSObject())
    }

    @Command
    fun reportSystemCallConnected(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(FulfillCallArgs::class.java) }.getOrNull()
        if (args == null) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // Android has no equivalent of reportOutgoingCall(connectedAt:); no-op.
        invoke.resolve(JSObject())
    }

    @Command
    fun updateCallDisplay(invoke: Invoke) {
        val args = runCatching { invoke.parseArgs(UpdateCallDisplayArgs::class.java) }.getOrNull()
        if (args == null || args.callId.isBlank()) {
            reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
            return
        }
        // Telecom fixes a call's attributes when it is added; there is no
        // equivalent of CXProvider.reportCall(with:updated:).
        reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
    }

    // ── Permission callback ────────────────────────────────────────────────

    @PermissionCallback
    private fun permissionResult(invoke: Invoke) {
        when (val pending = pendingPermission.complete(invoke.id)) {
            // The invoke this callback belongs to was already settled (teardown
            // cancelled it); settling it twice would be the bug, not the fix.
            null -> Unit
            is PendingPermission.Connect -> {
                // Already validated in connectNativeCall; re-decoded defensively.
                val encryptionKeys = decodeEncryptionKeys(pending.args.encryptionKeys)
                if (encryptionKeys == null) {
                    reject(pending.invoke, NativeCallWire.ERR_INVALID_REQUEST)
                    return
                }
                // Bluetooth routing and the notification are requested alongside
                // the microphone but never required: only RECORD_AUDIO can fail
                // a call.
                if (!pending.args.microphoneEnabled || hasRecordAudioPermission()) {
                    controller.connect(
                        pending.args.callId,
                        pending.args.url,
                        pending.args.token,
                        pending.args.microphoneEnabled,
                        encryptionKeys,
                        audioProcessingOf(pending.args.audioProcessing),
                        pending.args.channel,
                        pending.invoke,
                    )
                } else {
                    reject(pending.invoke, NativeCallWire.ERR_PERMISSION_DENIED)
                }
            }
            is PendingPermission.Microphone ->
                if (hasRecordAudioPermission()) {
                    controller.setMicrophoneEnabled(
                        pending.args.callId,
                        pending.args.enabled,
                        pending.invoke,
                    )
                } else {
                    reject(pending.invoke, NativeCallWire.ERR_PERMISSION_DENIED)
                }
            is PendingPermission.Camera ->
                if (hasCameraPermission()) {
                    controller.setCameraEnabled(
                        pending.args.callId,
                        pending.args.enabled,
                        pending.invoke,
                    )
                } else {
                    reject(pending.invoke, NativeCallWire.ERR_PERMISSION_DENIED)
                }
        }
    }

    override fun onDestroy(activity: androidx.appcompat.app.AppCompatActivity) {
        NativeCallActionRouter.shared.detach(callActionHandler)
        // A pending permission invoke must settle before the room is torn down.
        pendingPermission.cancel()?.let { reject(it.invoke, NativeCallWire.ERR_CANCELLED) }
        pictureInPicture.dispose()
        // Release the overlay on the main thread before dispose() parks it:
        // teardown must never wait on a blocked looper to drop EGL resources.
        videoOverlay.clear()
        localVideoOverlay.clear()
        callController.reset()
        controller.dispose()
        super.onDestroy(activity)
    }

    private fun reject(invoke: Invoke, code: String) {
        val safeCode = NativeCallWire.sanitize(code)
        invoke.reject(NativeCallWire.messageFor(safeCode), safeCode)
    }

    private fun rejectUnavailable(invoke: Invoke) {
        reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
    }

    /** A refused Telecom transaction (unregistered app, call limit, add
     * timeout) must not read as success on the JS side. */
    private fun settle(invoke: Invoke, accepted: Boolean) {
        if (accepted) invoke.resolve(JSObject()) else rejectUnavailable(invoke)
    }

    /**
     * Validates and decodes the optional initial key list: null means at least
     * one entry was malformed; an absent or empty list means a generic
     * (non-E2EE) call.
     */
    private fun decodeEncryptionKeys(
        entries: List<NativeCallEncryptionKeyEntry>?,
    ): List<NativeCallKeyMaterial>? {
        if (entries.isNullOrEmpty()) return emptyList()
        return entries.map { entry ->
            NativeCallEncryption.decodeEntry(entry.identity, entry.keyIndex, entry.key)
                ?: return null
        }
    }

    private fun hasPermission(permission: String): Boolean =
        ContextCompat.checkSelfPermission(activity, permission) ==
            PackageManager.PERMISSION_GRANTED

    private fun hasRecordAudioPermission(): Boolean =
        hasPermission(android.Manifest.permission.RECORD_AUDIO)

    private fun hasCameraPermission(): Boolean =
        hasPermission(android.Manifest.permission.CAMERA)

    /**
     * Aliases worth prompting for before a call starts: RECORD_AUDIO when the
     * call wants the microphone, plus the two grants that degrade a call
     * silently when missing. Without BLUETOOTH_CONNECT audioswitch disables
     * Bluetooth outright on API 31+; without POST_NOTIFICATIONS the ongoing-call
     * notification and its hangup action never appear on API 33+.
     */
    private fun missingCallPermissionAliases(microphoneEnabled: Boolean): Array<String> {
        val aliases = mutableListOf<String>()
        if (microphoneEnabled && !hasRecordAudioPermission()) aliases.add("microphone")
        if (!ancillaryPermissionsPrompted) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                !hasPermission(android.Manifest.permission.BLUETOOTH_CONNECT)
            ) {
                aliases.add("bluetooth")
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                !hasPermission(android.Manifest.permission.POST_NOTIFICATIONS)
            ) {
                aliases.add("notifications")
            }
        }
        return aliases.toTypedArray()
    }

    private fun hasChannel(args: ConnectNativeCallArgs): Boolean =
        runCatching { args.channel }.isSuccess
}

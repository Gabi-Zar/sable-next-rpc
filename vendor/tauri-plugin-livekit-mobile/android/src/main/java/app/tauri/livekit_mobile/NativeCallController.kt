package app.tauri.livekit_mobile

import android.annotation.SuppressLint
import android.content.Context
import android.content.Intent
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import androidx.annotation.RequiresApi
import androidx.core.content.ContextCompat
import app.tauri.plugin.Channel
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSArray
import app.tauri.plugin.JSObject
import io.livekit.android.LiveKit
import io.livekit.android.AudioOptions
import io.livekit.android.LiveKitOverrides
import io.livekit.android.RoomOptions
import io.livekit.android.audio.AudioSwitchHandler
import io.livekit.android.audio.ScreenAudioCapturer
import com.twilio.audioswitch.AudioDevice
import io.livekit.android.e2ee.E2EEOptions
import io.livekit.android.events.RoomEvent
import io.livekit.android.events.collect
import io.livekit.android.room.Room
import io.livekit.android.room.participant.ConnectionQuality
import io.livekit.android.room.participant.Participant
import io.livekit.android.room.participant.RemoteParticipant
import io.livekit.android.room.track.LocalAudioTrack
import io.livekit.android.room.track.LocalAudioTrackOptions
import io.livekit.android.room.track.LocalVideoTrack
import io.livekit.android.room.track.RemoteAudioTrack
import io.livekit.android.room.track.Track
import io.livekit.android.room.track.screencapture.ScreenCaptureParams
import io.livekit.android.util.flow
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.cancel
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import livekit.org.webrtc.audio.JavaAudioDeviceModule
import org.json.JSONObject

/**
 * Serialized owner of the LiveKit room and the native-call wire contract.
 *
 * All room access and snapshot mutation happen on a single daemon-thread
 * dispatcher, and every command settles its invoke exactly once. The snapshot
 * (with its native-owned revision) is authoritative; LiveKit events only feed
 * it. A monotonic attempt counter plus the connect job make an in-flight
 * connect cancellable and guard against callbacks from superseded attempts.
 * Room tokens and raw native errors never cross the bridge.
 */
internal class NativeCallController(
    private val appContext: Context,
    private val hasMicrophonePermission: () -> Boolean,
    private val hasCameraPermission: () -> Boolean = { false },
    private val videoOverlay: RemoteVideoOverlays = RemoteVideoOverlays { null },
    private val localVideoOverlay: LocalVideoOverlay = LocalVideoOverlay { null },
    private val onCallEnded: () -> Unit = {},
) {
    private val dispatcher =
        Executors.newSingleThreadExecutor { runnable ->
            Thread(runnable, "native-call-bridge").apply { isDaemon = true }
        }.asCoroutineDispatcher()
    private val scope = CoroutineScope(SupervisorJob() + dispatcher)

    /** Authoritative snapshot; only mutated on the bridge thread. */
    @Volatile
    private var snapshot = NativeCallSnapshot()

    private var channel: Channel? = null
    private var room: Room? = null

    /** Per-call E2EE state; set before room.connect, destroyed with the room. */
    private var e2ee: NativeCallE2EEKeys? = null
    private var eventJob: Job? = null
    private var connectJob: Job? = null
    private var attempt = 0L
    private var intentionalDisconnect = false

    /** Capture processing for this call's microphone; the room is built with it
     * and a later change is applied to the live track. */
    private var audioProcessing = LocalAudioTrackOptions()

    // Reapply volumes when LiveKit replaces tracks.
    private val participantVolumes = mutableMapOf<Pair<String, Boolean>, Double>()

    /** What the foreground-service notification currently shows. */
    private var presentation = NativeCallPresentation.NONE
    private var incomingCallId: String? = null

    /** LiveKit owns the output route for the whole call. */
    @Volatile
    private var audioHandler: AudioSwitchHandler? = null
    private var screenAudio: ScreenAudioCapturer? = null

    fun audioRoutes(callId: String): List<SystemAudioRoute> {
        if (!isActiveCall(callId)) return emptyList()
        val handler = audioHandler ?: return emptyList()
        val selected = handler.selectedAudioDevice
        return handler.availableAudioDevices.mapNotNull { device ->
            val type = audioRouteType(device) ?: return@mapNotNull null
            SystemAudioRoute(
                id = audioRouteId(device),
                name = audioRouteName(device),
                type = type,
                current = device == selected,
            )
        }
    }

    fun setAudioRoute(callId: String, routeId: String): Boolean {
        if (!isActiveCall(callId)) return false
        val handler = audioHandler ?: return false
        val device =
            handler.availableAudioDevices.firstOrNull { audioRouteId(it) == routeId }
                ?: return false
        handler.selectDevice(device)
        return true
    }

    @Volatile
    private var preferredInputId: Int? = null

    fun audioInputs(callId: String): List<SystemAudioInput> {
        if (!isActiveCall(callId) || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return emptyList()
        return inputDevices().mapNotNull { device ->
            val type = audioInputType(device) ?: return@mapNotNull null
            SystemAudioInput(
                id = device.id.toString(),
                name = device.productName?.toString().orEmpty().ifBlank { audioInputName(type) },
                type = type,
                current = device.id == preferredInputId,
            )
        }
    }

    fun setAudioInput(callId: String, inputId: String): Boolean {
        if (!isActiveCall(callId) || Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        val currentRoom = room ?: return false
        val module = audioDeviceModule(currentRoom) ?: return false
        val device = inputDevices().firstOrNull { it.id.toString() == inputId } ?: return false
        module.setPreferredInputDevice(device)
        preferredInputId = device.id
        return true
    }

    @RequiresApi(Build.VERSION_CODES.M)
    private fun inputDevices(): List<AudioDeviceInfo> =
        (appContext.getSystemService(Context.AUDIO_SERVICE) as AudioManager)
            .getDevices(AudioManager.GET_DEVICES_INPUTS)
            .toList()

    private fun audioInputType(device: AudioDeviceInfo): String? =
        when (device.type) {
            AudioDeviceInfo.TYPE_BUILTIN_MIC -> NativeCallWire.INPUT_BUILTIN_MIC
            AudioDeviceInfo.TYPE_WIRED_HEADSET -> NativeCallWire.ROUTE_WIRED_HEADSET
            AudioDeviceInfo.TYPE_USB_DEVICE,
            AudioDeviceInfo.TYPE_USB_HEADSET -> NativeCallWire.INPUT_USB
            AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> NativeCallWire.ROUTE_BLUETOOTH
            else -> null
        }

    private fun audioInputName(type: String): String =
        when (type) {
            NativeCallWire.INPUT_BUILTIN_MIC -> "Phone microphone"
            NativeCallWire.ROUTE_WIRED_HEADSET -> "Headset microphone"
            NativeCallWire.INPUT_USB -> "USB microphone"
            else -> "Bluetooth microphone"
        }

    private fun audioRouteType(device: AudioDevice): String? =
        when (device) {
            is AudioDevice.Earpiece -> NativeCallWire.ROUTE_EARPIECE
            is AudioDevice.Speakerphone -> NativeCallWire.ROUTE_SPEAKER
            is AudioDevice.WiredHeadset -> NativeCallWire.ROUTE_WIRED_HEADSET
            is AudioDevice.BluetoothHeadset -> NativeCallWire.ROUTE_BLUETOOTH
            else -> null
        }

    private fun audioRouteName(device: AudioDevice): String =
        when (device) {
            is AudioDevice.Earpiece -> "Phone"
            is AudioDevice.Speakerphone -> "Speaker"
            is AudioDevice.WiredHeadset -> "Headphones"
            else -> device.name.ifBlank { "Bluetooth" }
        }

    /** The name is what separates two paired headsets. */
    private fun audioRouteId(device: AudioDevice): String =
        "${audioRouteType(device) ?: "unknown"}:${device.name}"

    fun snapshotJson(): JSObject {
        val current = snapshot
        return JSObject().apply {
            put("revision", current.revision)
            val id = current.callId
            if (id != null) put("callId", id) else put("callId", JSONObject.NULL)
            put("connectionState", current.connectionState)
            put("microphoneEnabled", current.microphoneEnabled)
            put("cameraEnabled", current.cameraEnabled)
            put("screenShareEnabled", current.screenShareEnabled)
            put("participantCount", current.participantCount)
            put(
                "remoteParticipants",
                JSArray().apply {
                    current.remoteParticipants.forEach { participant ->
                        put(
                            JSObject().apply {
                                put("identity", participant.identity)
                                participant.camera?.let { camera ->
                                    put(
                                        "camera",
                                        JSObject()
                                            .put("sid", camera.sid)
                                            .put("muted", camera.muted)
                                            .put("subscribed", camera.subscribed),
                                    )
                                }
                                participant.screenShare?.let { screenShare ->
                                    put(
                                        "screenShare",
                                        JSObject()
                                            .put("sid", screenShare.sid)
                                            .put("muted", screenShare.muted)
                                            .put("subscribed", screenShare.subscribed),
                                    )
                                }
                                participant.microphone?.let { microphone ->
                                    put(
                                        "microphone",
                                        JSObject()
                                            .put("sid", microphone.sid)
                                            .put("muted", microphone.muted)
                                            .put("subscribed", microphone.subscribed),
                                    )
                                }
                                participant.screenShareAudio?.let { audio ->
                                    put(
                                        "screenShareAudio",
                                        JSObject()
                                            .put("sid", audio.sid)
                                            .put("muted", audio.muted)
                                            .put("subscribed", audio.subscribed),
                                    )
                                }
                                participant.connectionQuality?.let { quality ->
                                    put("connectionQuality", quality)
                                }
                            },
                        )
                    }
                },
            )
            current.lastErrorCode?.let { code ->
                put(
                    "lastError",
                    JSObject()
                        .put("code", code)
                        .put("message", NativeCallWire.messageFor(code)),
                )
            }
            current.localConnectionQuality?.let { quality ->
                put("localConnectionQuality", quality)
            }
        }
    }

    fun isBusy(requestedCallId: String): Boolean =
        snapshot.isActive && snapshot.callId != requestedCallId

    fun isActiveCall(callId: String): Boolean =
        snapshot.isActive && snapshot.callId == callId

    fun connect(
        callId: String,
        url: String,
        token: String,
        microphoneEnabled: Boolean,
        encryptionKeys: List<NativeCallKeyMaterial>,
        processing: LocalAudioTrackOptions,
        callChannel: Channel,
        invoke: Invoke,
    ) {
        connectJob =
            scope.launch {
                val currentAttempt = ++attempt
                intentionalDisconnect = false
                audioProcessing = processing
                participantVolumes.clear()
                channel = callChannel
                presentation = presentation.forCall(callId)
                transition {
                    copy(
                        callId = callId,
                        connectionState = NativeCallWire.STATE_CONNECTING,
                        microphoneEnabled = false,
                        cameraEnabled = false,
                        participantCount = 0,
                        remoteParticipants = emptyList(),
                        lastErrorCode = null,
                    )
                }
                startCallForegroundService(preferMicrophone = microphoneEnabled)
                emitSnapshotChanged()

                val newRoom =
                    try {
                        // Both default to false in the SDK; iOS enables both, and
                        // Android is the platform that can least afford to send
                        // and decode layers nobody is displaying.
                        LiveKit.create(
                            appContext,
                            RoomOptions(
                                adaptiveStream = true,
                                dynacast = true,
                                audioTrackCaptureDefaults = audioProcessing,
                            ),
                            // Owning the handler is what makes the route picker
                            // work; a Telecom endpoint change is overridden
                            // before it can be confirmed.
                            LiveKitOverrides(
                                audioOptions = AudioOptions(
                                    audioHandler = AudioSwitchHandler(appContext).also {
                                        audioHandler = it
                                    },
                                ),
                            ),
                        )
                    } catch (_: Exception) {
                        failConnect(currentAttempt, null, invoke, NativeCallWire.ERR_CONNECT_FAILED)
                        return@launch
                    }
                room = newRoom
                eventJob =
                    launch {
                        newRoom.events.collect { event ->
                            if (currentAttempt == attempt && room === newRoom) {
                                handleRoomEvent(event)
                            }
                        }
                    }
                if (encryptionKeys.isNotEmpty()) {
                    // E2EE calls only: create a fresh per-call provider, install
                    // the full key ring, and wire it before connect. Any JNI/SDK
                    // failure settles this invoke through the bounded connect
                    // error path, which releases the room and destroys the
                    // provider via teardownRoom instead of leaking either.
                    try {
                        val keys = NativeCallE2EEKeys()
                        e2ee = keys
                        encryptionKeys.forEach(keys::install)
                        newRoom.e2eeOptions = E2EEOptions(keyProvider = keys)
                        newRoom.audioTrackPublishDefaults =
                            newRoom.audioTrackPublishDefaults.copy(red = false)
                    } catch (_: Exception) {
                        failConnect(
                            currentAttempt,
                            null,
                            invoke,
                            NativeCallWire.ERR_CONNECT_FAILED,
                        )
                        return@launch
                    }
                }
                try {
                    newRoom.connect(url, token)
                } catch (cancelled: CancellationException) {
                    // A cancel/disconnect raced this attempt; it already owns
                    // the snapshot. Settle this invoke and drop the orphan room.
                    runCatching { newRoom.disconnect() }
                    runCatching { newRoom.release() }
                    reject(invoke, NativeCallWire.ERR_CANCELLED)
                    return@launch
                } catch (_: Exception) {
                    failConnect(currentAttempt, newRoom, invoke, NativeCallWire.ERR_CONNECT_FAILED)
                    return@launch
                }
                if (currentAttempt != attempt || room !== newRoom) {
                    // Superseded while connecting; the superseder owns the state.
                    runCatching { newRoom.disconnect() }
                    runCatching { newRoom.release() }
                    reject(invoke, NativeCallWire.ERR_CANCELLED)
                    return@launch
                }

                var microphoneActive = false
                var microphoneError: String? = null
                if (microphoneEnabled && hasMicrophonePermission()) {
                    microphoneActive =
                        try {
                            newRoom.localParticipant.setMicrophoneEnabled(true)
                            true
                        } catch (_: CancellationException) {
                            reject(invoke, NativeCallWire.ERR_CANCELLED)
                            return@launch
                        } catch (_: Exception) {
                            microphoneError = NativeCallWire.ERR_MEDIA_FAILED
                            false
                        }
                } else if (microphoneEnabled) {
                    microphoneError = NativeCallWire.ERR_PERMISSION_DENIED
                }
                if (currentAttempt != attempt || room !== newRoom) {
                    reject(invoke, NativeCallWire.ERR_CANCELLED)
                    return@launch
                }

                transition {
                    copy(
                        connectionState = NativeCallWire.STATE_CONNECTED,
                        microphoneEnabled = microphoneActive,
                        lastErrorCode = microphoneError?.let(NativeCallWire::sanitize),
                        participantCount = newRoom.remoteParticipants.size,
                        remoteParticipants = remoteParticipantsProjection(newRoom),
                    )
                }
                presentOngoing()
                emitSnapshotChanged()
                invoke.resolve(snapshotJson())
            }
    }

    fun disconnect(callId: String, invoke: Invoke) = endCall(callId, invoke)

    fun cancelConnect(callId: String, invoke: Invoke) = endCall(callId, invoke)

    /** Ends whatever call is live; the notification hangup button is not a
     * command, so there is no invoke to settle. */
    fun disconnectActiveCall() {
        val callId = snapshot.callId ?: return
        endCall(callId, null)
    }

    /** Cancels any in-flight connect and tears the matching room down; safe to
     * run while a connect is suspended. Settles with an idle snapshot. */
    private fun endCall(callId: String, invoke: Invoke?) {
        scope.launch {
            ++attempt
            if (snapshot.callId != callId) {
                // A stale request must never tear down a replacement call.
                invoke?.resolve(snapshotJson())
                return@launch
            }
            intentionalDisconnect = true
            connectJob?.cancel()
            teardownRoom()
            stopCallForegroundService()
            transition { toIdle() }
            emitSnapshotChanged()
            channel = null
            invoke?.resolve(snapshotJson())
        }
    }

    fun setMicrophoneEnabled(callId: String, enabled: Boolean, invoke: Invoke) =
        applyMicrophone(callId, enabled, invoke)

    /** Records the processing for later captures and applies it to a live
     * microphone track. `applyOptions` fails on a disposed track, which is the
     * only case that reports a media failure. */
    fun setAudioProcessing(callId: String, processing: LocalAudioTrackOptions, invoke: Invoke) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            audioProcessing = processing
            val track =
                room?.localParticipant
                    ?.getTrackPublication(Track.Source.MICROPHONE)
                    ?.track as? LocalAudioTrack
            if (track != null && track.applyOptions(processing).isFailure) {
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            invoke.resolve(snapshotJson())
        }
    }

    fun setParticipantVolume(
        callId: String,
        identity: String,
        volume: Double,
        screenShare: Boolean,
        invoke: Invoke,
    ) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            participantVolumes[identity to screenShare] = volume
            applyParticipantVolumes()
            invoke.resolve(snapshotJson())
        }
    }

    private fun applyParticipantVolumes() {
        val participants = room?.remoteParticipants ?: return
        participants.forEach { (identity, participant) ->
            participant.trackPublications.values
                .filter {
                    it.source == Track.Source.MICROPHONE || it.source == Track.Source.SCREEN_SHARE_AUDIO
                }
                .forEach {
                    val screen = it.source == Track.Source.SCREEN_SHARE_AUDIO
                    val volume =
                        participantVolumes[identity.value to screen] ?: if (screen) 0.0 else 1.0
                    (it.track as? RemoteAudioTrack)?.setVolume(volume)
                }
        }
    }

    /** Telecom deactivated the call (another call took priority): stop
     * publishing audio. There is no hold capability to restore from, so the
     * mute lands in the snapshot and the user decides when to undo it. */
    fun muteForSystemInactive() {
        val callId = snapshot.callId ?: return
        applyMicrophone(callId, false, null)
    }

    /**
     * Announces a call in the foreground-service notification with its direction
     * and name, whether or not a room is behind it yet.
     *
     * core-telecom gives an app five seconds from addCall to post a CallStyle
     * notification, after which the call loses the foreground execution priority
     * Telecom granted it, so an incoming call has to be presented before it is
     * ever answered. Telecom fixes its own display name at addCall time, so this
     * only reaches the notification.
     */
    fun presentCall(callId: String, direction: String, callerName: String) {
        scope.launch {
            // The plugin hosts one room at a time, so a second call must not
            // relabel the running one's notification or steal its hangup button.
            if (snapshot.isActive && snapshot.callId != callId) return@launch
            presentation =
                NativeCallPresentation.announcing(
                    callId,
                    direction,
                    callerName,
                    connected =
                        snapshot.callId == callId &&
                            snapshot.connectionState == NativeCallWire.STATE_CONNECTED,
                )
            startCallForegroundService(
                preferMicrophone = snapshot.callId == callId && snapshot.microphoneEnabled,
                preferCamera = snapshot.callId == callId && snapshot.cameraEnabled,
            )
        }
    }

    fun presentIncomingCall(callId: String, callerName: String): Boolean {
        if (snapshot.isActive) return false
        if (!LivekitMobileForegroundService.postIncomingCall(appContext, callId, callerName)) {
            return false
        }
        scope.launch {
            if (snapshot.isActive) return@launch
            incomingCallId?.takeIf { it != callId }?.let {
                LivekitMobileForegroundService.closeIncomingCallScreen(appContext, it)
            }
            incomingCallId = callId
            presentation =
                NativeCallPresentation.announcing(
                    callId,
                    LivekitMobileForegroundService.DIRECTION_INCOMING,
                    callerName,
                    connected = false,
                )
        }
        return true
    }

    /** Drops the notification of a presented call that never became a room
     * (declined, missed, answered on another device). A live room keeps its own
     * notification: only its own teardown may take that down. */
    fun dismissCallPresentation(callId: String) {
        scope.launch {
            LivekitMobileForegroundService.closeIncomingCallScreen(appContext, callId)
            if (presentation.callId != callId || snapshot.isActive) return@launch
            stopCallForegroundService()
        }
    }

    /** Moves the notification off ringing or dialling once the room is up. */
    private fun presentOngoing() {
        val ongoing = presentation.ongoing()
        if (ongoing == presentation) return
        presentation = ongoing
        startCallForegroundService(
            preferMicrophone = snapshot.microphoneEnabled,
            preferCamera = snapshot.cameraEnabled,
        )
    }

    /** The service could not enter the foreground (a while-in-use type cannot
     * start from the background): record it so JS sees a call running without
     * one instead of nothing at all. A presented call with no room yet still
     * counts, since that is exactly the incoming-call window. */
    fun reportForegroundServiceFailed() {
        scope.launch {
            if (!snapshot.isActive && !presentation.isPresenting) return@launch
            transition { copy(lastErrorCode = NativeCallWire.ERR_UNAVAILABLE) }
            emitSnapshotChanged()
        }
    }

    private fun applyMicrophone(callId: String, enabled: Boolean, invoke: Invoke?) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke?.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                invoke?.let { reject(it, NativeCallWire.ERR_UNAVAILABLE) }
                return@launch
            }
            if (snapshot.microphoneEnabled == enabled) {
                invoke?.resolve(snapshotJson())
                return@launch
            }
            if (enabled && !hasMicrophonePermission()) {
                invoke?.let { reject(it, NativeCallWire.ERR_PERMISSION_DENIED) }
                return@launch
            }
            try {
                if (screenAudio != null) {
                    audioDeviceModule(currentRoom)?.setAudioRecordEnabled(enabled)
                } else {
                    currentRoom.localParticipant.setMicrophoneEnabled(enabled)
                }
            } catch (_: Exception) {
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                invoke?.let { reject(it, NativeCallWire.ERR_MEDIA_FAILED) }
                return@launch
            }
            transition { copy(microphoneEnabled = enabled) }
            // The microphone service type follows the publication both ways: a
            // muted call must not keep claiming a microphone it is not using.
            startCallForegroundService(
                preferMicrophone = enabled || screenAudio != null,
                preferCamera = snapshot.cameraEnabled,
            )
            emitSnapshotChanged()
            invoke?.resolve(snapshotJson())
        }
    }

    fun setCameraEnabled(callId: String, enabled: Boolean, invoke: Invoke) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                return@launch
            }
            if (snapshot.cameraEnabled == enabled) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            if (enabled && !hasCameraPermission()) {
                reject(invoke, NativeCallWire.ERR_PERMISSION_DENIED)
                return@launch
            }
            try {
                currentRoom.localParticipant.setCameraEnabled(enabled)
            } catch (_: Exception) {
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            transition { copy(cameraEnabled = enabled) }
            // The camera service type has to follow the publication: without it
            // the capture stops as soon as the app leaves the foreground.
            startCallForegroundService(
                preferMicrophone = snapshot.microphoneEnabled,
                preferCamera = enabled,
            )
            emitSnapshotChanged()
            invoke.resolve(snapshotJson())
        }
    }

    /** [projectionData] is the consent Intent; required to enable, ignored to disable. */
    fun setScreenShareEnabled(
        callId: String,
        enabled: Boolean,
        projectionData: Intent?,
        invoke: Invoke,
    ) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                return@launch
            }
            if (snapshot.screenShareEnabled == enabled) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val consent = if (enabled) projectionData else null
            if (enabled && consent == null) {
                reject(invoke, NativeCallWire.ERR_PERMISSION_DENIED)
                return@launch
            }
            // The service type must be foreground before capture starts, so
            // unlike the camera this restart cannot wait until after.
            if (enabled) {
                startCallForegroundService(
                    preferMicrophone = snapshot.microphoneEnabled,
                    preferCamera = snapshot.cameraEnabled,
                    preferScreenShare = true,
                )
            }
            val applied = try {
                if (consent != null) {
                    currentRoom.localParticipant.setScreenShareEnabled(
                        true,
                        ScreenCaptureParams(
                            mediaProjectionPermissionResultData = consent,
                            // The system's own "Stop sharing" bypasses us.
                            onStop = { handleScreenShareStopped(callId) },
                        ),
                    )
                } else {
                    currentRoom.localParticipant.setScreenShareEnabled(false)
                }
            } catch (_: Exception) {
                if (enabled) {
                    startCallForegroundService(
                        preferMicrophone = snapshot.microphoneEnabled,
                        preferCamera = snapshot.cameraEnabled,
                        preferScreenShare = false,
                    )
                }
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            // The SDK reports a refusal by returning false, not by throwing.
            if (!applied) {
                if (enabled) {
                    startCallForegroundService(
                        preferMicrophone = snapshot.microphoneEnabled,
                        preferCamera = snapshot.cameraEnabled,
                        preferScreenShare = false,
                    )
                }
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            transition { copy(screenShareEnabled = enabled) }
            if (enabled) {
                startScreenAudio(currentRoom)
            } else {
                stopScreenAudio(currentRoom)
            }
            startCallForegroundService(
                preferMicrophone = snapshot.microphoneEnabled || screenAudio != null,
                preferCamera = snapshot.cameraEnabled,
                preferScreenShare = enabled,
            )
            emitSnapshotChanged()
            invoke.resolve(snapshotJson())
        }
    }

    /** Stopped from the system UI; the track is already gone. */
    private fun handleScreenShareStopped(callId: String) {
        scope.launch {
            if (snapshot.callId != callId || !snapshot.screenShareEnabled) return@launch
            transition { copy(screenShareEnabled = false) }
            room?.let { stopScreenAudio(it) }
            startCallForegroundService(
                preferMicrophone = snapshot.microphoneEnabled,
                preferCamera = snapshot.cameraEnabled,
                preferScreenShare = false,
            )
            emitSnapshotChanged()
        }
    }

    @SuppressLint("MissingPermission")
    private suspend fun startScreenAudio(currentRoom: Room) {
        if (screenAudio != null) return
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q || !hasMicrophonePermission()) return
        val screen =
            currentRoom.localParticipant.getTrackPublication(Track.Source.SCREEN_SHARE)?.track
                ?: return
        val capturer =
            runCatching { ScreenAudioCapturer.createFromScreenShareTrack(screen) }.getOrNull()
                ?: return
        try {
            if (!snapshot.microphoneEnabled) {
                audioDeviceModule(currentRoom)?.setAudioRecordEnabled(false)
                currentRoom.localParticipant.setMicrophoneEnabled(true)
            }
            val microphone =
                currentRoom.localParticipant.getTrackPublication(Track.Source.MICROPHONE)
                    ?.track as? LocalAudioTrack
                    ?: throw IllegalStateException("no microphone track")
            microphone.setAudioBufferCallback(capturer)
            screenAudio = capturer
        } catch (_: Exception) {
            capturer.releaseAudioResources()
            restoreMicrophone(currentRoom)
        }
    }

    private suspend fun stopScreenAudio(currentRoom: Room) {
        val capturer = screenAudio ?: return
        screenAudio = null
        (currentRoom.localParticipant.getTrackPublication(Track.Source.MICROPHONE)?.track
            as? LocalAudioTrack)
            ?.setAudioBufferCallback(null)
        capturer.releaseAudioResources()
        restoreMicrophone(currentRoom)
    }

    private suspend fun restoreMicrophone(currentRoom: Room) {
        audioDeviceModule(currentRoom)?.setAudioRecordEnabled(true)
        if (!snapshot.microphoneEnabled) {
            runCatching { currentRoom.localParticipant.setMicrophoneEnabled(false) }
        }
    }

    private fun audioDeviceModule(currentRoom: Room): JavaAudioDeviceModule? =
        currentRoom.lkObjects.audioDeviceModule as? JavaAudioDeviceModule

    fun switchCamera(callId: String, invoke: Invoke) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                return@launch
            }
            val cameraTrack =
                currentRoom.localParticipant
                    .getTrackPublication(Track.Source.CAMERA)
                    ?.track as? LocalVideoTrack
            if (cameraTrack == null) {
                // No published camera track yet; enabling must happen first.
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            val previousOptions = cameraTrack.options
            try {
                cameraTrack.switchCamera()
            } catch (_: Exception) {
                transition { copy(lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED) }
                emitSnapshotChanged()
                reject(invoke, NativeCallWire.ERR_MEDIA_FAILED)
                return@launch
            }
            invoke.resolve(snapshotJson())
            withTimeoutOrNull(CAMERA_SWITCH_TIMEOUT_MS) {
                cameraTrack::options.flow.first { it != previousOptions }
            }
            localVideoOverlay.refreshMirror()
        }
    }

    fun setRemoteVideoOverlay(
        callId: String,
        participantIdentity: String,
        trackSid: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        devicePixelRatio: Double,
        invoke: Invoke,
    ) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                return@launch
            }
            when (
                videoOverlay.attach(
                    currentRoom,
                    participantIdentity,
                    trackSid,
                    x,
                    y,
                    width,
                    height,
                    devicePixelRatio,
                )
            ) {
                is OverlayAttachResult.Attached -> invoke.resolve(snapshotJson())
                is OverlayAttachResult.InvalidGeometry ->
                    reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
                is OverlayAttachResult.TrackUnavailable ->
                    reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                is OverlayAttachResult.HostUnavailable ->
                    reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                is OverlayAttachResult.Failed ->
                    reject(invoke, NativeCallWire.ERR_UNEXPECTED)
            }
        }
    }

    fun clearRemoteVideoOverlay(callId: String, trackSid: String?, invoke: Invoke) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            if (trackSid == null) videoOverlay.clear() else videoOverlay.clear(trackSid)
            invoke.resolve(snapshotJson())
        }
    }

    fun setLocalVideoOverlay(
        callId: String,
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        devicePixelRatio: Double,
        invoke: Invoke,
    ) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            val currentRoom = room
            if (currentRoom == null) {
                reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                return@launch
            }
            when (
                localVideoOverlay.attach(currentRoom, x, y, width, height, devicePixelRatio)
            ) {
                is OverlayAttachResult.Attached -> invoke.resolve(snapshotJson())
                // The app reports geometry optimistically, possibly before the
                // camera publishes; the publish event rebinds the tile.
                is OverlayAttachResult.TrackUnavailable ->
                    invoke.resolve(snapshotJson())
                is OverlayAttachResult.InvalidGeometry ->
                    reject(invoke, NativeCallWire.ERR_INVALID_REQUEST)
                is OverlayAttachResult.HostUnavailable ->
                    reject(invoke, NativeCallWire.ERR_UNAVAILABLE)
                is OverlayAttachResult.Failed ->
                    reject(invoke, NativeCallWire.ERR_UNEXPECTED)
            }
        }
    }

    fun clearLocalVideoOverlay(callId: String, invoke: Invoke) {
        scope.launch {
            if (snapshot.callId != callId) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            localVideoOverlay.clear()
            invoke.resolve(snapshotJson())
        }
    }

    /**
     * Installs a rotated encryption key into the current call's provider.
     * Works while connecting or connected; installs are serialized on the
     * bridge thread so racing rotations stay ordered. A stale call id or a
     * non-E2EE call resolves the current snapshot unchanged.
     */
    fun setEncryptionKey(
        callId: String,
        material: NativeCallKeyMaterial,
        invoke: Invoke,
    ) {
        scope.launch {
            val keys = e2ee
            if (snapshot.callId != callId || keys == null) {
                invoke.resolve(snapshotJson())
                return@launch
            }
            try {
                keys.install(material)
            } catch (_: Exception) {
                // A failed install must still settle the invoke, bounded.
                reject(invoke, NativeCallWire.ERR_UNEXPECTED)
                return@launch
            }
            invoke.resolve(snapshotJson())
        }
    }

    /** Queues teardown on the bridge thread and blocks the caller briefly so
     * onDestroy guarantees the room is released before the scope is cancelled. */
    fun dispose() {
        val done = CountDownLatch(1)
        scope.launch {
            ++attempt
            intentionalDisconnect = true
            connectJob?.cancel()
            channel = null
            teardownRoom()
            stopCallForegroundService()
            transition { toIdle() }
            done.countDown()
        }
        done.await(DISPOSE_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        scope.cancel()
    }

    private fun failConnect(
        currentAttempt: Long,
        failedRoom: Room?,
        invoke: Invoke,
        code: String,
    ) {
        if (currentAttempt != attempt) {
            if (failedRoom != null) {
                runCatching { failedRoom.disconnect() }
                runCatching { failedRoom.release() }
            }
            reject(invoke, NativeCallWire.ERR_CANCELLED)
            return
        }
        transition {
            copy(
                connectionState = NativeCallWire.STATE_FAILED,
                lastErrorCode = NativeCallWire.sanitize(code),
            )
        }
        teardownRoom()
        stopCallForegroundService()
        emitSnapshotChanged()
        reject(invoke, code)
    }

    private fun handleRoomEvent(event: RoomEvent) {
        when (event) {
            is RoomEvent.Connected -> {
                transition {
                    copy(
                        connectionState = NativeCallWire.STATE_CONNECTED,
                        participantCount = room?.remoteParticipants?.size ?: 0,
                        remoteParticipants = remoteParticipantsProjection(room),
                    )
                }
                presentOngoing()
                emitSnapshotChanged()
            }
            is RoomEvent.Reconnecting -> {
                if (snapshot.connectionState != NativeCallWire.STATE_CONNECTED) return
                transition { copy(connectionState = NativeCallWire.STATE_RECONNECTING) }
                emitSnapshotChanged()
            }
            is RoomEvent.Reconnected -> {
                transition {
                    copy(
                        connectionState = NativeCallWire.STATE_CONNECTED,
                        participantCount = room?.remoteParticipants?.size ?: 0,
                        remoteParticipants = remoteParticipantsProjection(room),
                    )
                }
                emitSnapshotChanged()
            }
            is RoomEvent.Disconnected -> {
                if (intentionalDisconnect) return
                transition {
                    copy(
                        connectionState = NativeCallWire.STATE_FAILED,
                        lastErrorCode = NativeCallWire.ERR_DISCONNECTED,
                    )
                }
                teardownRoom()
                stopCallForegroundService()
                emitSnapshotChanged()
            }
            is RoomEvent.ParticipantConnected -> {
                transition {
                    copy(
                        participantCount = room?.remoteParticipants?.size ?: 0,
                        remoteParticipants = remoteParticipantsProjection(room),
                    )
                }
                videoOverlay.reconcile(room)
                emitSnapshotChanged()
            }
            is RoomEvent.ParticipantDisconnected -> {
                participantVolumes.keys.removeAll { it.first == event.participant.identity?.value }
                transition {
                    copy(
                        participantCount = room?.remoteParticipants?.size ?: 0,
                        remoteParticipants = remoteParticipantsProjection(room),
                    )
                }
                videoOverlay.reconcile(room)
                emitSnapshotChanged()
            }
            // Remote publication lifecycle only affects the remote projection;
            // local publishes/mutes must not churn the snapshot. The overlay
            // reconciles on every remote track lifecycle event so it never
            // retains an unpublished/unsubscribed/replaced track.
            is RoomEvent.TrackPublished -> {
                applyRemoteProjectionIfChanged(event.participant)
                videoOverlay.reconcile(room)
                localVideoOverlay.reconcile(room)
            }
            is RoomEvent.TrackUnpublished -> {
                if (event.publication.source == Track.Source.SCREEN_SHARE ||
                    event.publication.source == Track.Source.SCREEN_SHARE_AUDIO
                ) {
                    participantVolumes.remove(event.participant.identity?.value to true)
                    applyParticipantVolumes()
                }
                applyRemoteProjectionIfChanged(event.participant)
                videoOverlay.reconcile(room)
                localVideoOverlay.reconcile(room)
            }
            is RoomEvent.TrackMuted ->
                applyRemoteProjectionIfChanged(event.participant)
            is RoomEvent.TrackUnmuted ->
                applyRemoteProjectionIfChanged(event.participant)
            is RoomEvent.TrackSubscribed -> {
                applyParticipantVolumes()
                applyRemoteProjectionIfChanged()
                videoOverlay.reconcile(room)
            }
            is RoomEvent.TrackUnsubscribed -> {
                applyRemoteProjectionIfChanged()
                videoOverlay.reconcile(room)
            }
            is RoomEvent.ConnectionQualityChanged ->
                if (event.participant is RemoteParticipant) {
                    applyRemoteProjectionIfChanged(event.participant)
                } else {
                    applyLocalConnectionQualityIfChanged(event.quality)
                }
            else -> Unit
        }
    }

    private fun remoteParticipantsProjection(
        currentRoom: Room?,
    ): List<NativeRemoteParticipant> {
        val participants = currentRoom?.remoteParticipants ?: return emptyList()
        return participants.entries
            .map { (identity, participant) ->
                // sid is non-null in 2.27.0; sort so several publications of the
                // same source project deterministically (matches iOS).
                val publicationFor = { source: Track.Source ->
                    participant.trackPublications.values
                        .filter { it.source == source }
                        .sortedBy { it.sid }
                        .firstOrNull()
                }
                val camera =
                    publicationFor(Track.Source.CAMERA)?.let { publication ->
                        NativeRemoteParticipant.Camera(
                            sid = publication.sid,
                            muted = publication.muted,
                            subscribed = publication.subscribed,
                        )
                    }
                val screenShare =
                    publicationFor(Track.Source.SCREEN_SHARE)?.let { publication ->
                        NativeRemoteParticipant.ScreenShare(
                            sid = publication.sid,
                            muted = publication.muted,
                            subscribed = publication.subscribed,
                        )
                    }
                val microphone =
                    publicationFor(Track.Source.MICROPHONE)?.let { publication ->
                        NativeRemoteParticipant.Microphone(
                            sid = publication.sid,
                            muted = publication.muted,
                            subscribed = publication.subscribed,
                        )
                    }
                val screenShareAudio =
                    publicationFor(Track.Source.SCREEN_SHARE_AUDIO)?.let { publication ->
                        NativeRemoteParticipant.Microphone(
                            sid = publication.sid,
                            muted = publication.muted,
                            subscribed = publication.subscribed,
                        )
                    }
                NativeRemoteParticipant(
                    identity = identity.value,
                    camera = camera,
                    screenShare = screenShare,
                    screenShareAudio = screenShareAudio,
                    microphone = microphone,
                    connectionQuality = connectionQualityWire(participant.connectionQuality),
                )
            }
            .sortedBy { it.identity }
    }

    private fun connectionQualityWire(quality: ConnectionQuality): String? =
        when (quality) {
            ConnectionQuality.LOST -> NativeCallWire.QUALITY_LOST
            ConnectionQuality.POOR -> NativeCallWire.QUALITY_POOR
            ConnectionQuality.GOOD -> NativeCallWire.QUALITY_GOOD
            ConnectionQuality.EXCELLENT -> NativeCallWire.QUALITY_EXCELLENT
            ConnectionQuality.UNKNOWN -> null
        }

    /** Recomputes the remote-only projection after a publication event, skipping
     * local participants and no-op changes (no revision bump, no emit). */
    private fun applyRemoteProjectionIfChanged(participant: Participant? = null) {
        if (participant != null && participant !is RemoteParticipant) return
        val projection = remoteParticipantsProjection(room)
        if (snapshot.remoteParticipants == projection) return
        transition { copy(remoteParticipants = projection) }
        emitSnapshotChanged()
    }

    private fun applyLocalConnectionQualityIfChanged(quality: ConnectionQuality) {
        val wire = connectionQualityWire(quality)
        if (snapshot.localConnectionQuality == wire) return
        transition { copy(localConnectionQuality = wire) }
        emitSnapshotChanged()
    }

    private fun transition(transform: NativeCallSnapshot.() -> NativeCallSnapshot) {
        val current = snapshot
        val next = current.transform()
        snapshot =
            next.copy(revision = if (current.revision == Long.MAX_VALUE) 1L else current.revision + 1L)
    }

    private fun teardownRoom() {
        audioHandler = null
        preferredInputId = null
        screenAudio?.releaseAudioResources()
        screenAudio = null
        // The renderer's EGL context belongs to the room: drop it first.
        videoOverlay.clear()
        localVideoOverlay.clear()
        eventJob?.cancel()
        eventJob = null
        val endingRoom = room
        room = null
        if (endingRoom != null) {
            runCatching { endingRoom.disconnect() }
            runCatching { endingRoom.release() }
        }
        // Destroy key material and the native provider after the room (and its
        // frame cryptors) are fully released.
        val endingKeys = e2ee
        e2ee = null
        endingKeys?.destroy()
        onCallEnded()
    }

    private fun emitSnapshotChanged() {
        val activeChannel = channel ?: return
        activeChannel.send(
            JSObject().apply {
                put("event", NativeCallWire.EVENT_SNAPSHOT_CHANGED)
                put("snapshot", snapshotJson())
            },
        )
    }

    private fun reject(invoke: Invoke, code: String) {
        val safeCode = NativeCallWire.sanitize(code)
        invoke.reject(NativeCallWire.messageFor(safeCode), safeCode)
    }

    /** The microphone and camera service types are only requested once their
     * runtime permission has already been granted, or startForeground throws on
     * Android 14+; every other type the call needs is unconditional. */
    private fun startCallForegroundService(
        preferMicrophone: Boolean,
        preferCamera: Boolean = false,
        preferScreenShare: Boolean = snapshot.screenShareEnabled,
    ) {
        val intent =
            Intent(appContext, LivekitMobileForegroundService::class.java)
                .putExtra(
                    LivekitMobileForegroundService.EXTRA_MICROPHONE,
                    preferMicrophone && hasMicrophonePermission(),
                )
                .putExtra(
                    LivekitMobileForegroundService.EXTRA_CAMERA,
                    preferCamera && hasCameraPermission(),
                )
                .putExtra(LivekitMobileForegroundService.EXTRA_CALL_ID, presentation.callId)
                .putExtra(LivekitMobileForegroundService.EXTRA_INCOMING_CALL_ID, incomingCallId)
                .putExtra(
                    LivekitMobileForegroundService.EXTRA_CALL_DIRECTION,
                    presentation.direction,
                )
                .putExtra(
                    LivekitMobileForegroundService.EXTRA_CALLER_NAME,
                    presentation.callerName,
                )
                .putExtra(LivekitMobileForegroundService.EXTRA_PLAYBACK, true)
                .putExtra(
                    LivekitMobileForegroundService.EXTRA_SCREEN_SHARE,
                    preferScreenShare,
                )
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                ContextCompat.startForegroundService(appContext, intent)
            } else {
                @Suppress("DEPRECATION")
                appContext.startService(intent)
            }
        } catch (_: RuntimeException) {
            // startForegroundService rejects a background start with
            // ForegroundServiceStartNotAllowedException (an IllegalStateException)
            // and a missing grant with SecurityException; both are
            // RuntimeExceptions. The snapshot has to carry it out: a call running
            // without a foreground service is not a call JS can trust.
            transition { copy(lastErrorCode = NativeCallWire.ERR_UNAVAILABLE) }
            emitSnapshotChanged()
        }
    }

    private fun stopCallForegroundService() {
        incomingCallId?.let { LivekitMobileForegroundService.cancelIncomingCall(appContext, it) }
        incomingCallId = null
        presentation = NativeCallPresentation.NONE
        runCatching {
            appContext.stopService(Intent(appContext, LivekitMobileForegroundService::class.java))
        }
    }

    private companion object {
        const val DISPOSE_TIMEOUT_MS = 3_000L
        const val CAMERA_SWITCH_TIMEOUT_MS = 5_000L
    }
}

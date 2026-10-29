package app.tauri.livekit_mobile

import android.content.Context
import android.net.Uri
import android.os.Build
import android.telecom.DisconnectCause
import android.telecom.PhoneAccount
import androidx.annotation.RequiresApi
import androidx.core.telecom.CallAttributesCompat
import androidx.core.telecom.CallControlResult
import androidx.core.telecom.CallControlScope
import androidx.core.telecom.CallsManager
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.util.concurrent.ConcurrentHashMap
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

/**
 * Android system-call integration on androidx.core.telecom.
 *
 * Mirrors ios/CallKitController.swift where the platform allows: register the
 * app with Telecom, report incoming/outgoing calls, answer and end them, and
 * queue system-initiated actions so JS can drain them once it is awake again.
 *
 * {@code CallsManager.addCall} suspends for the whole lifetime of a call, so
 * each call owns a coroutine plus the {@link CallControlScope} handed to its
 * block; that scope is the only way to answer or disconnect afterwards.
 *
 * Two CallKit capabilities have no core-telecom equivalent and are absent:
 * pushing mute into the system ({@code isMuted} is a read-only Flow, so mute
 * only travels system to app) and changing the call display once the call has
 * been added.
 *
 * CallsManager requires API 26; below that every entry point is a no-op.
 */
internal class AndroidCallController(
    private val appContext: Context,
    private val plugin: Plugin,
    private val onSystemDisconnect: (String) -> Unit = {},
    private val onSystemSetInactive: () -> Unit = {},
) {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)

    private class ActiveCall {
        @Volatile
        var job: Job? = null

        @Volatile
        var control: CallControlScope? = null

        /** Completes once addCall either handed back a control scope or gave up,
         * so callers can wait instead of racing the scope into existence. */
        val settled = CompletableDeferred<Unit>()
    }

    /** callId → the coroutine and control scope owning that Telecom call. */
    private val activeCalls = ConcurrentHashMap<String, ActiveCall>()

    /** Pending system-initiated actions (answer, end, mute) for JS to drain. */
    private val pendingActions = mutableListOf<SystemCallAction>()

    private var callsManager: CallsManager? = null

    // ── Registration ──────────────────────────────────────────────────────

    /** Idempotent; also called lazily before the first call is added. */
    fun registerWithTelecom() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        if (callsManager != null) return
        try {
            val manager = CallsManager(appContext)
            manager.registerAppWithTelecom(
                CallsManager.CAPABILITY_BASELINE or
                    CallsManager.CAPABILITY_SUPPORTS_VIDEO_CALLING,
            )
            callsManager = manager
            triggerEvent("provider_ready", JSObject())
        } catch (_: Exception) {
            // Telecom may be unavailable on this device; callsManager stays null
            // so every surface reports the failure to its caller.
        }
    }

    private fun telecomManager(): CallsManager? {
        registerWithTelecom()
        return callsManager
    }

    // ── Surfaces (called by plugin commands) ──────────────────────────────

    /**
     * Shows an incoming call on the system UI (lock screen, notification).
     * The caller MUST post a foreground notification within 5s.
     */
    fun reportIncomingCall(callId: String, callerName: String, onResult: (Boolean) -> Unit = {}) {
        val manager = telecomManager()
        if (manager == null) {
            onResult(false)
            return
        }
        addCall(manager, callId, callerName, CallAttributesCompat.DIRECTION_INCOMING, onResult)
    }

    /** Starts an outgoing call in the system UI. */
    fun startOutgoingCall(callId: String, callerName: String, onResult: (Boolean) -> Unit = {}) {
        val manager = telecomManager()
        if (manager == null) {
            onResult(false)
            return
        }
        addCall(manager, callId, callerName, CallAttributesCompat.DIRECTION_OUTGOING, onResult)
    }

    /** Answers a pending incoming call from the app side (JS initiated). */
    fun answerCall(callId: String, onResult: (Boolean) -> Unit) {
        scope.launch {
            val control = awaitControl(callId)
            if (control == null) {
                onResult(false)
                return@launch
            }
            onResult(
                transact { control.answer(CallAttributesCompat.CALL_TYPE_AUDIO_CALL) },
            )
        }
    }

    /**
     * Answers from the notification's Answer button and queues the action JS
     * drains: Telecom only invokes onAnswer for system-initiated answers, so an
     * app-side answer has to report itself.
     *
     * A refused transaction ends the call instead of leaving a notification that
     * looks answered, and [onResult] tells the caller which happened.
     */
    fun answerCallFromNotification(callId: String, onResult: (Boolean) -> Unit) {
        answerCall(callId) { answered ->
            if (answered) {
                enqueue(SystemCallAction.answer(callId))
            } else {
                endCall(callId)
                enqueue(SystemCallAction.end(callId))
            }
            onResult(answered)
        }
    }

    /** Ends the call a notification button dismissed and queues the end action.
     * Telecom only calls onDisconnect for system-initiated disconnects, so an
     * app-side hangup has to queue the action JS drains itself. A blank id ends
     * every registered call rather than stranding one. */
    fun endCallFromNotification(callId: String) {
        val targets = if (callId.isBlank()) activeCalls.keys.toList() else listOf(callId)
        for (id in targets) {
            endCall(id)
            enqueue(SystemCallAction.end(id))
        }
    }

    /** Ends a call: both local hangup and remote-end path. */
    fun endCall(callId: String, onResult: (Boolean) -> Unit = {}) {
        val active = activeCalls.remove(callId)
        if (active == null) {
            // Nothing registered under this id; ending it is already true.
            onResult(true)
            return
        }
        val control = active.control
        if (control == null) {
            // Still waiting on Telecom to hand us a control scope: cancelling
            // the addCall coroutine is the only way to withdraw the call.
            active.job?.cancel()
            onResult(true)
            return
        }
        scope.launch {
            onResult(transact { control.disconnect(DisconnectCause(DisconnectCause.LOCAL)) })
        }
    }

    @RequiresApi(Build.VERSION_CODES.O)
    private fun addCall(
        manager: CallsManager,
        callId: String,
        callerName: String,
        direction: Int,
        onResult: (Boolean) -> Unit,
    ) {
        if (activeCalls.containsKey(callId)) {
            onResult(true)
            return
        }
        val active = ActiveCall()
        activeCalls[callId] = active
        val attributes = CallAttributesCompat(
            displayName = callerName,
            // API 26/27 require a sip: address; callId keeps the caller's
            // identity out of the system call log.
            address = Uri.fromParts(PhoneAccount.SCHEME_SIP, callId, null),
            direction = direction,
            callType = CallAttributesCompat.CALL_TYPE_AUDIO_CALL,
            // No hold/stream/transfer, matching the iOS call configuration.
            callCapabilities = 0,
        )
        // Reports the outcome outside active.job: cancelling that job is how an
        // app-side hangup withdraws a call that Telecom has not answered yet,
        // and the caller still has to be told.
        scope.launch {
            awaitSettled(active)
            onResult(active.control != null)
        }
        active.job = scope.launch {
            try {
                manager.addCall(
                    attributes,
                    onAnswer = { enqueue(SystemCallAction.answer(callId)) },
                    onDisconnect = {
                        // Telecom gives the app 5s to act on this, and JS may be
                        // suspended, so tear the call down here and queue the
                        // action for whenever JS wakes up.
                        enqueue(SystemCallAction.end(callId))
                        onSystemDisconnect(callId)
                    },
                    // Nothing to restore: onSetInactive mutes into the snapshot,
                    // so the unmute is the user's, not Telecom's.
                    onSetActive = {},
                    onSetInactive = { onSystemSetInactive() },
                ) {
                    active.control = this
                    active.settled.complete(Unit)
                    launch {
                        // The only mute signal core-telecom offers. Calls start
                        // unmuted, so the flow's initial value is not an event.
                        var reported = false
                        isMuted.collect { muted ->
                            if (muted != reported) {
                                reported = muted
                                enqueue(SystemCallAction.mute(callId, muted))
                            }
                        }
                    }
                }
            } catch (_: Exception) {
                // Telecom refused or dropped the call (permission, call limit,
                // registration timeout); the null control scope reports it.
            } finally {
                active.settled.complete(Unit)
                activeCalls.remove(callId, active)
            }
        }
    }

    /** Waits for the control scope addCall hands back; Telecom may take up to
     * its own add timeout to get there, and answering/routing before then
     * would silently do nothing. */
    private suspend fun awaitControl(
        callId: String,
        settleTimeoutMs: Long = ADD_CALL_TIMEOUT_MS,
    ): CallControlScope? {
        val active = activeCalls[callId] ?: return null
        awaitSettled(active, settleTimeoutMs)
        return active.control
    }

    private suspend fun awaitSettled(
        active: ActiveCall,
        timeoutMs: Long = ADD_CALL_TIMEOUT_MS,
    ) {
        withTimeoutOrNull(timeoutMs) { active.settled.await() }
    }

    /** Runs a Telecom transaction, reporting whether it was accepted. */
    private suspend fun transact(block: suspend () -> CallControlResult): Boolean =
        try {
            block() is CallControlResult.Success
        } catch (_: Exception) {
            false
        }

    // ── Pending action queue (JS-suspended path) ──────────────────────────

    private fun enqueue(action: SystemCallAction) {
        if (action.action == "answer") {
            LivekitMobileForegroundService.markIncomingCallAnswered(appContext, action.uuid)
        }
        synchronized(pendingActions) { pendingActions.add(action) }
        triggerEvent("callkit_event", action.toJSObject())
    }

    /** Returns all queued actions and clears the queue so JS can drain them. */
    fun drainPendingActions(): List<SystemCallAction> =
        synchronized(pendingActions) {
            val actions = pendingActions.toList()
            pendingActions.clear()
            actions
        }

    // ── Cleanup ───────────────────────────────────────────────────────────

    fun reset() {
        for (callId in activeCalls.keys.toList()) {
            endCall(callId)
        }
        synchronized(pendingActions) { pendingActions.clear() }
    }

    // ── Event helper ──────────────────────────────────────────────────────

    private fun triggerEvent(event: String, data: JSObject) {
        plugin.trigger(event, data)
    }

    private companion object {
        /** CallsManager.ADD_CALL_TIMEOUT is internal to core-telecom; 5s is the
         * documented bound addCall waits for Telecom to hand back a scope. */
        const val ADD_CALL_TIMEOUT_MS = 5_000L

        /** The picker contract spells this type "wired"; NativeCallWire still
         * carries the older "wired_headset" spelling. */
    }
}

// ── SystemAudioRoute (getAudioRoutes payload, mirrors Swift side) ─────────

internal data class SystemAudioRoute(
    val id: String,
    val name: String,
    val type: String,
    val current: Boolean,
) {
    fun toJSObject(): JSObject =
        JSObject()
            .put("id", id)
            .put("name", name)
            .put("type", type)
            .put("current", current)
}

internal data class SystemAudioInput(
    val id: String,
    val name: String,
    val type: String,
    val current: Boolean,
) {
    fun toJSObject(): JSObject =
        JSObject()
            .put("id", id)
            .put("name", name)
            .put("type", type)
            .put("current", current)
}

// ── SystemCallAction (trigger payload, mirrors Swift side) ────────────────

internal data class SystemCallAction(
    val action: String,
    val uuid: String,
    val muted: Boolean? = null,
) {
    fun toJSObject(): JSObject =
        JSObject().apply {
            put("action", action)
            put("uuid", uuid)
            muted?.let { put("muted", it) }
        }

    fun toMap(): Map<String, Any> =
        buildMap {
            put("action", action)
            put("uuid", uuid)
            muted?.let { put("muted", it) }
        }

    companion object {
        fun answer(uuid: String) = SystemCallAction("answer", uuid)
        fun end(uuid: String) = SystemCallAction("end", uuid)
        fun mute(uuid: String, muted: Boolean) = SystemCallAction("mute", uuid, muted)
    }
}

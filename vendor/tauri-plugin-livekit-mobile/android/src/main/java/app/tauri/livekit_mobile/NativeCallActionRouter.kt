package app.tauri.livekit_mobile

/** What a call action raised outside the JS lane asks the plugin to do. */
internal enum class NativeCallActionKind {
    ANSWER,
    END,
    FOREGROUND_SERVICE_FAILED,
}

/** A call action and the call it belongs to. */
internal data class NativeCallAction(
    val kind: NativeCallActionKind,
    val callId: String,
) {
    companion object {
        /**
         * Reads a notification button back into an action. An unrecognised value
         * maps to null rather than to a default: an action this plugin never sent
         * must not be guessed into a hangup.
         */
        fun fromIntentExtras(action: String?, callId: String?): NativeCallAction? {
            val kind =
                when (action) {
                    LivekitMobileForegroundService.ACTION_ANSWER ->
                        NativeCallActionKind.ANSWER
                    // Declining a ringing call and hanging up a running one are the
                    // same teardown; only the notification they came from differs.
                    LivekitMobileForegroundService.ACTION_DECLINE,
                    LivekitMobileForegroundService.ACTION_HANGUP,
                    -> NativeCallActionKind.END
                    LivekitMobileForegroundService.ACTION_SERVICE_FAILED ->
                        NativeCallActionKind.FOREGROUND_SERVICE_FAILED
                    else -> return null
                }
            return NativeCallAction(kind, callId.orEmpty())
        }
    }
}

/**
 * Process-wide funnel from the notification receiver and the foreground service
 * to whichever plugin instance is currently loaded.
 *
 * The call notification outlives the plugin: the foreground service keeps it up
 * while the activity, and with it the plugin, is destroyed and recreated, and a
 * manifest-declared receiver is started by the system even when the app process
 * is gone. A receiver registered on the activity receives nothing in either
 * case. Actions that arrive before a plugin has attached are held rather than
 * dropped, so an Answer that beat the plugin back into existence still lands.
 */
internal class NativeCallActionRouter {
    private val lock = Any()
    private var handler: ((NativeCallAction) -> Unit)? = null
    private val pending = mutableListOf<NativeCallAction>()

    fun attach(handler: (NativeCallAction) -> Unit) {
        val buffered =
            synchronized(lock) {
                this.handler = handler
                val actions = pending.toList()
                pending.clear()
                actions
            }
        buffered.forEach(handler)
    }

    /** Ignores a handler that is no longer the current one, so a late teardown
     * from a replaced plugin cannot unhook its replacement. */
    fun detach(handler: (NativeCallAction) -> Unit) {
        synchronized(lock) {
            if (this.handler === handler) this.handler = null
        }
    }

    fun dispatch(action: NativeCallAction) {
        val target =
            synchronized(lock) {
                handler.also { if (it == null) pending.add(action) }
            }
        target?.invoke(action)
    }

    companion object {
        val shared = NativeCallActionRouter()
    }
}

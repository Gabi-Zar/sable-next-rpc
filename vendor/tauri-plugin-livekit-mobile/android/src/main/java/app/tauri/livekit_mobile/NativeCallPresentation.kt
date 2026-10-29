package app.tauri.livekit_mobile

/**
 * What the foreground-service notification currently shows.
 *
 * Kept apart from the snapshot because an incoming call is announced before any
 * room exists: Telecom rings first and the room only comes up once the user has
 * answered. Pure data; the controller owns it on its bridge thread.
 */
internal data class NativeCallPresentation(
    val callId: String = "",
    val direction: String = LivekitMobileForegroundService.DIRECTION_ONGOING,
    val callerName: String = "",
) {
    /** True while a notification is up, with or without a room behind it. */
    val isPresenting: Boolean
        get() = callId.isNotEmpty()

    /** A connected room is neither ringing nor dialling any more. */
    fun ongoing(): NativeCallPresentation =
        copy(direction = LivekitMobileForegroundService.DIRECTION_ONGOING)

    /** Keeps an announcement that already names this call, so an incoming ring
     * survives into the connect that answers it, and starts clean for any other
     * call: a new call inherits neither ring nor dialling name. */
    fun forCall(callId: String): NativeCallPresentation =
        if (this.callId == callId) this else NativeCallPresentation(callId = callId)

    companion object {
        val NONE = NativeCallPresentation()

        /**
         * Announces a call with its direction and name. A room that is already
         * up is ongoing whatever the caller says, since the app may register the
         * system call only after connecting.
         */
        fun announcing(
            callId: String,
            direction: String,
            callerName: String,
            connected: Boolean,
        ): NativeCallPresentation =
            NativeCallPresentation(
                callId = callId,
                direction =
                    if (connected) LivekitMobileForegroundService.DIRECTION_ONGOING else direction,
                callerName = callerName,
            )
    }
}

package app.tauri.livekit_mobile

/**
 * Bounded wire contract for the native LiveKit audio-room bridge.
 *
 * Only values defined here may cross the bridge: raw native exceptions, device
 * names and room tokens must never be logged or sent to the guest.
 */
internal object NativeCallWire {
    const val STATE_IDLE = "idle"
    const val STATE_CONNECTING = "connecting"
    const val STATE_CONNECTED = "connected"
    const val STATE_RECONNECTING = "reconnecting"
    const val STATE_FAILED = "failed"

    /** Bounded connection-quality vocabulary mirrored from LiveKit's
     * ConnectionQuality; UNKNOWN has no wire value and omits the field. */
    const val QUALITY_LOST = "lost"
    const val QUALITY_POOR = "poor"
    const val QUALITY_GOOD = "good"
    const val QUALITY_EXCELLENT = "excellent"

    /** Bounded audio-route vocabulary mirrored from Telecom's endpoint types;
     * streaming and unknown endpoints have no wire value. */
    const val ROUTE_EARPIECE = "earpiece"
    const val ROUTE_SPEAKER = "speaker"
    const val ROUTE_WIRED_HEADSET = "wired_headset"
    const val ROUTE_BLUETOOTH = "bluetooth"
    const val INPUT_BUILTIN_MIC = "builtin_mic"
    const val INPUT_USB = "usb"

    /** Single channel event protocol: full authoritative snapshot per emit. */
    const val EVENT_SNAPSHOT_CHANGED = "snapshot_changed"

    const val ERR_INVALID_REQUEST = "invalid_request"
    const val ERR_BUSY = "busy"
    const val ERR_PERMISSION_DENIED = "permission_denied"
    const val ERR_CONNECT_FAILED = "connect_failed"
    const val ERR_MEDIA_FAILED = "media_failed"
    const val ERR_DISCONNECTED = "disconnected"
    const val ERR_CANCELLED = "cancelled"
    const val ERR_UNAVAILABLE = "unavailable"
    const val ERR_UNEXPECTED = "unexpected"

    private val MESSAGES: Map<String, String> =
        mapOf(
            ERR_INVALID_REQUEST to "The call request was invalid",
            ERR_BUSY to "Another call is already active",
            ERR_PERMISSION_DENIED to "The required permission was denied",
            ERR_CONNECT_FAILED to "Could not connect to the call",
            ERR_MEDIA_FAILED to "Could not update call media",
            ERR_DISCONNECTED to "The call connection ended unexpectedly",
            ERR_CANCELLED to "The operation was cancelled",
            ERR_UNAVAILABLE to "The call is unavailable",
            ERR_UNEXPECTED to "An unexpected error occurred",
        )

    /** Drops any code that is not part of the bounded set. */
    fun sanitize(code: String?): String =
        if (code != null && MESSAGES.containsKey(code)) code else ERR_UNEXPECTED

    /** Human-readable message for a bounded code; safe to send to the guest. */
    fun messageFor(code: String): String = MESSAGES.getValue(sanitize(code))
}

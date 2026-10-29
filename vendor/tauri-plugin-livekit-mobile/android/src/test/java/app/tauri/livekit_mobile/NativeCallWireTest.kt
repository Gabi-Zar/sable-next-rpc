package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCallWireTest {
    @Test
    fun `public error vocabulary is exactly the bounded contract set`() {
        assertEquals(
            setOf(
                "invalid_request",
                "busy",
                "permission_denied",
                "connect_failed",
                "media_failed",
                "disconnected",
                "cancelled",
                "unavailable",
                "unexpected",
            ),
            boundedCodes().toSet(),
        )
    }

    @Test
    fun `sanitize keeps bounded codes`() {
        for (code in boundedCodes()) {
            assertEquals(code, NativeCallWire.sanitize(code))
        }
    }

    @Test
    fun `sanitize drops unknown or raw codes`() {
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize(null))
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize(""))
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("Connection refused"))
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("connect_failed\u0000"))
        // A raw string that happens to contain a token must never survive.
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("eyJhbGciOi123"))
        // Legacy platform-specific codes must not leak either.
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("microphone_failed"))
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("camera_failed"))
        assertEquals(NativeCallWire.ERR_UNEXPECTED, NativeCallWire.sanitize("service_start_failed"))
    }

    @Test
    fun `messageFor returns a bounded message for any input`() {
        assertEquals(
            "Could not connect to the call",
            NativeCallWire.messageFor(NativeCallWire.ERR_CONNECT_FAILED),
        )
        val fallback = NativeCallWire.messageFor("webrtc exploded with details")
        assertEquals(NativeCallWire.messageFor(NativeCallWire.ERR_UNEXPECTED), fallback)
    }

    @Test
    fun `messages never leak request details`() {
        for (code in boundedCodes()) {
            val message = NativeCallWire.messageFor(code)
            assertTrue(message.isNotBlank())
            assertNotEquals(message, code)
        }
    }

    private fun boundedCodes(): List<String> =
        listOf(
            NativeCallWire.ERR_INVALID_REQUEST,
            NativeCallWire.ERR_BUSY,
            NativeCallWire.ERR_PERMISSION_DENIED,
            NativeCallWire.ERR_CONNECT_FAILED,
            NativeCallWire.ERR_MEDIA_FAILED,
            NativeCallWire.ERR_DISCONNECTED,
            NativeCallWire.ERR_CANCELLED,
            NativeCallWire.ERR_UNAVAILABLE,
            NativeCallWire.ERR_UNEXPECTED,
        )
}

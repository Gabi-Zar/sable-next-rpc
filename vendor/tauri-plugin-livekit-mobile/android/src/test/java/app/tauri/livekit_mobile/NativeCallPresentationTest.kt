package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCallPresentationTest {
    @Test
    fun `nothing is presented by default`() {
        assertFalse(NativeCallPresentation.NONE.isPresenting)
        assertEquals("", NativeCallPresentation.NONE.callId)
        assertEquals("", NativeCallPresentation.NONE.callerName)
        assertEquals(
            LivekitMobileForegroundService.DIRECTION_ONGOING,
            NativeCallPresentation.NONE.direction,
        )
    }

    @Test
    fun `an incoming call carries its direction and caller name`() {
        val presentation =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_INCOMING,
                "Ada",
                connected = false,
            )
        assertTrue(presentation.isPresenting)
        assertEquals("call-1", presentation.callId)
        assertEquals(LivekitMobileForegroundService.DIRECTION_INCOMING, presentation.direction)
        assertEquals("Ada", presentation.callerName)
    }

    @Test
    fun `an outgoing call carries its direction and caller name`() {
        val presentation =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_OUTGOING,
                "Ada",
                connected = false,
            )
        assertEquals(LivekitMobileForegroundService.DIRECTION_OUTGOING, presentation.direction)
        assertEquals("Ada", presentation.callerName)
    }

    @Test
    fun `a call announced once its room is up is already ongoing`() {
        val presentation =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_OUTGOING,
                "Ada",
                connected = true,
            )
        assertEquals(LivekitMobileForegroundService.DIRECTION_ONGOING, presentation.direction)
        assertEquals("Ada", presentation.callerName)
    }

    @Test
    fun `connecting drops the ring but keeps the caller name`() {
        val ringing =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_INCOMING,
                "Ada",
                connected = false,
            )
        val ongoing = ringing.ongoing()
        assertEquals(LivekitMobileForegroundService.DIRECTION_ONGOING, ongoing.direction)
        assertEquals("Ada", ongoing.callerName)
        assertEquals("call-1", ongoing.callId)
    }

    @Test
    fun `an already ongoing call is unchanged by connecting again`() {
        val ongoing =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_ONGOING,
                "Ada",
                connected = false,
            )
        assertEquals(ongoing, ongoing.ongoing())
    }

    @Test
    fun `a ring survives into the connect that answers it`() {
        val ringing =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_INCOMING,
                "Ada",
                connected = false,
            )
        assertEquals(ringing, ringing.forCall("call-1"))
    }

    @Test
    fun `another call inherits neither ring nor caller name`() {
        val ringing =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_INCOMING,
                "Ada",
                connected = false,
            )
        val other = ringing.forCall("call-2")
        assertEquals("call-2", other.callId)
        assertEquals("", other.callerName)
        assertEquals(LivekitMobileForegroundService.DIRECTION_ONGOING, other.direction)
    }

    @Test
    fun `a foreground service failure is worth reporting while a call is presented`() {
        // The controller reports a failure when a room is active or a call is
        // merely presented; an incoming call is presented before any room exists.
        val ringing =
            NativeCallPresentation.announcing(
                "call-1",
                LivekitMobileForegroundService.DIRECTION_INCOMING,
                "Ada",
                connected = false,
            )
        val idle = NativeCallSnapshot()
        assertFalse(idle.isActive)
        assertTrue(idle.isActive || ringing.isPresenting)
        assertFalse(idle.isActive || NativeCallPresentation.NONE.isPresenting)
    }
}

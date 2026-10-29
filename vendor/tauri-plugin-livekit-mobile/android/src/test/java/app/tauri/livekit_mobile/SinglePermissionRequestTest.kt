package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SinglePermissionRequestTest {
    @Test
    fun `the first request starts and settles`() {
        val requests = SinglePermissionRequest<String>()
        assertTrue(requests.begin(1L, "connect"))
        assertEquals("connect", requests.complete(1L))
    }

    @Test
    fun `an overlapping request is refused and does not overwrite the first`() {
        val requests = SinglePermissionRequest<String>()
        requests.begin(1L, "connect")

        assertFalse(requests.begin(2L, "camera"))

        assertNull(requests.complete(2L))
        assertEquals("connect", requests.complete(1L))
    }

    @Test
    fun `a callback for another invoke leaves the request in flight`() {
        val requests = SinglePermissionRequest<String>()
        requests.begin(1L, "connect")

        assertNull(requests.complete(9L))
        assertEquals("connect", requests.complete(1L))
    }

    @Test
    fun `completing frees the slot for the next request`() {
        val requests = SinglePermissionRequest<String>()
        requests.begin(1L, "connect")
        requests.complete(1L)

        assertTrue(requests.begin(2L, "camera"))
        assertEquals("camera", requests.complete(2L))
    }

    @Test
    fun `a completed request is not handed back twice`() {
        val requests = SinglePermissionRequest<String>()
        requests.begin(1L, "connect")
        requests.complete(1L)

        assertNull(requests.complete(1L))
    }

    @Test
    fun `cancel hands back the request in flight and frees the slot`() {
        val requests = SinglePermissionRequest<String>()
        requests.begin(1L, "connect")

        assertEquals("connect", requests.cancel())
        assertNull(requests.complete(1L))
        assertTrue(requests.begin(2L, "microphone"))
    }

    @Test
    fun `cancel with nothing in flight hands back nothing`() {
        assertNull(SinglePermissionRequest<String>().cancel())
    }
}

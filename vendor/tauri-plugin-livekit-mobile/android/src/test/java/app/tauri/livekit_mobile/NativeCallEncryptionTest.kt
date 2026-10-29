package app.tauri.livekit_mobile

import java.util.Base64
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCallEncryptionTest {
    private fun base64Of(bytes: ByteArray): String = Base64.getEncoder().encodeToString(bytes)

    @Test
    fun `decodeEntry accepts a valid entry and preserves raw bytes`() {
        val raw = byteArrayOf(0, 1, 2, 127, -128, -1, 42, 96, 13, 37)
        val material = NativeCallEncryption.decodeEntry("@alice:example.org", 3, base64Of(raw))
        requireNotNull(material)
        assertEquals("@alice:example.org", material.identity)
        assertEquals(3, material.keyIndex)
        assertTrue(material.key.contentEquals(raw))
    }

    @Test
    fun `decodeEntry rejects malformed wire entries`() {
        // Invalid base64 payloads.
        assertNull(NativeCallEncryption.decodeEntry("@a:b.c", 0, "not-a-base64-key!"))
        assertNull(NativeCallEncryption.decodeEntry("@a:b.c", 0, "AAAAA")) // truncated
        assertNull(NativeCallEncryption.decodeEntry("@a:b.c", 0, "QUJD RA==")) // whitespace
        // Empty or missing key material.
        assertNull(NativeCallEncryption.decodeEntry("@a:b.c", 0, ""))
        // Blank identity and negative indexes never reach the provider.
        assertNull(NativeCallEncryption.decodeEntry("", 0, base64Of(byteArrayOf(1))))
        assertNull(NativeCallEncryption.decodeEntry("   ", 0, base64Of(byteArrayOf(1))))
        assertNull(NativeCallEncryption.decodeEntry("@a:b.c", -1, base64Of(byteArrayOf(1))))
    }

    @Test
    fun `decodeEntry holds a defensive copy of the decoded bytes`() {
        val raw = byteArrayOf(7, 7, 7, 7)
        val material = NativeCallEncryption.decodeEntry("@a:b.c", 0, base64Of(raw))
        requireNotNull(material)
        raw.fill(0)
        assertTrue(material.key.contentEquals(byteArrayOf(7, 7, 7, 7)))
    }

    @Test
    fun `latest key index starts empty and records the first key per identity`() {
        val latest = LatestKeyIndexes()
        assertEquals(null, latest.latestFor("@a:b.c"))
        latest.record("@a:b.c", 0)
        assertEquals(0, latest.latestFor("@a:b.c"))
    }

    @Test
    fun `latest key index follows the last key installed, including downwards`() {
        // A peer that rejoins restarts its outbound session at a low index, so
        // the most recent install wins even when the index decreases. Treating
        // a lower index as stale strands every frame that peer sends after it.
        val latest = LatestKeyIndexes()
        latest.record("@a:b.c", 4)
        latest.record("@a:b.c", 5)
        assertEquals(5, latest.latestFor("@a:b.c"))
        latest.record("@a:b.c", 0)
        assertEquals(0, latest.latestFor("@a:b.c"))
    }

    @Test
    fun `latest key index tracks identities independently`() {
        val latest = LatestKeyIndexes()
        latest.record("@a:b.c", 7)
        latest.record("@b:b.c", 0)
        assertEquals(7, latest.latestFor("@a:b.c"))
        assertEquals(0, latest.latestFor("@b:b.c"))
    }

    @Test
    fun `latest key index tolerates concurrent reads while recording`() {
        val latest = LatestKeyIndexes()
        latest.record("@a:b.c", 1)
        val readers =
            (1..4).map {
                Thread { repeat(500) { latest.latestFor("@a:b.c") } }
            }
        readers.forEach(Thread::start)
        repeat(500) { latest.record("@a:b.c", it + 2) }
        readers.forEach(Thread::join)
        assertEquals(501, latest.latestFor("@a:b.c"))
    }
}

package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NativeCallSnapshotTest {
    @Test
    fun `default snapshot is the idle snapshot`() {
        val snapshot = NativeCallSnapshot()
        assertEquals(0L, snapshot.revision)
        assertNull(snapshot.callId)
        assertEquals(NativeCallWire.STATE_IDLE, snapshot.connectionState)
        assertFalse(snapshot.microphoneEnabled)
        assertFalse(snapshot.cameraEnabled)
        assertEquals(0, snapshot.participantCount)
        assertNull(snapshot.lastErrorCode)
        assertFalse(snapshot.isActive)
    }

    @Test
    fun `isActive needs a callId and an active connection state`() {
        for (state in listOf("connecting", "connected", "reconnecting")) {
            assertTrue(NativeCallSnapshot(callId = "a", connectionState = state).isActive)
        }
        for (state in listOf("idle", "failed")) {
            assertFalse(NativeCallSnapshot(callId = "a", connectionState = state).isActive)
        }
        assertFalse(NativeCallSnapshot(connectionState = "connected").isActive)
    }

    @Test
    fun `toIdle clears call facts but keeps the revision`() {
        val active =
            NativeCallSnapshot(
                revision = 7L,
                callId = "a",
                connectionState = NativeCallWire.STATE_CONNECTED,
                microphoneEnabled = true,
                cameraEnabled = true,
                participantCount = 5,
                lastErrorCode = NativeCallWire.ERR_MEDIA_FAILED,
            )
        val idle = active.toIdle()
        assertEquals(7L, idle.revision)
        assertNull(idle.callId)
        assertEquals(NativeCallWire.STATE_IDLE, idle.connectionState)
        assertFalse(idle.microphoneEnabled)
        assertFalse(idle.cameraEnabled)
        assertEquals(0, idle.participantCount)
        assertNull(idle.lastErrorCode)
        assertFalse(idle.isActive)
    }

    @Test
    fun `default snapshot has no remote participants`() {
        assertTrue(NativeCallSnapshot().remoteParticipants.isEmpty())
    }

    @Test
    fun `toIdle clears remote participants`() {
        val active =
            NativeCallSnapshot(
                revision = 3L,
                callId = "a",
                connectionState = NativeCallWire.STATE_CONNECTED,
                remoteParticipants =
                    listOf(
                        NativeRemoteParticipant(
                            identity = "alice",
                            camera =
                                NativeRemoteParticipant.Camera(
                                    sid = "TR_CAM1",
                                    muted = false,
                                    subscribed = true,
                                ),
                        ),
                        // No remote camera publication: the camera entry is omitted.
                        NativeRemoteParticipant(identity = "bob"),
                    ),
            )
        val idle = active.toIdle()
        assertEquals(3L, idle.revision)
        assertTrue(idle.remoteParticipants.isEmpty())
    }

    @Test
    fun `remote participant camera defaults to omitted`() {
        assertNull(NativeRemoteParticipant(identity = "alice").camera)
    }

    @Test
    fun `remote participant screen share defaults to omitted`() {
        assertNull(NativeRemoteParticipant(identity = "alice").screenShare)
    }

    @Test
    fun `remote participant microphone defaults to omitted`() {
        assertNull(NativeRemoteParticipant(identity = "alice").microphone)
    }

    @Test
    fun `projection tracks a remote mute flip`() {
        val unmuted =
            NativeRemoteParticipant(
                identity = "alice",
                microphone =
                    NativeRemoteParticipant.Microphone(
                        sid = "TR_MIC1",
                        muted = false,
                        subscribed = true,
                    ),
            )
        val muted =
            unmuted.copy(microphone = unmuted.microphone?.copy(muted = true))
        assertNotEquals(unmuted, muted)
    }

    @Test
    fun `toIdle clears screen share and local connection quality`() {
        val active =
            NativeCallSnapshot(
                callId = "a",
                connectionState = NativeCallWire.STATE_CONNECTED,
                screenShareEnabled = true,
                localConnectionQuality = NativeCallWire.QUALITY_POOR,
            )
        val idle = active.toIdle()
        assertFalse(idle.screenShareEnabled)
        assertNull(idle.localConnectionQuality)
    }

    @Test
    fun `projection distinguishes a screen share from a camera`() {
        val cameraOnly =
            NativeRemoteParticipant(
                identity = "alice",
                camera =
                    NativeRemoteParticipant.Camera(
                        sid = "TR_CAM1",
                        muted = false,
                        subscribed = true,
                    ),
            )
        val sharing =
            cameraOnly.copy(
                screenShare =
                    NativeRemoteParticipant.ScreenShare(
                        sid = "TR_SCREEN1",
                        muted = false,
                        subscribed = true,
                    ),
            )
        assertNotEquals(cameraOnly, sharing)
        assertEquals("TR_CAM1", sharing.camera?.sid)
        assertEquals("TR_SCREEN1", sharing.screenShare?.sid)
    }

    @Test
    fun `projection equality dedupes no-op camera changes`() {
        val base =
            NativeCallSnapshot(
                revision = 1L,
                callId = "a",
                connectionState = NativeCallWire.STATE_CONNECTED,
                remoteParticipants =
                    listOf(
                        NativeRemoteParticipant(
                            identity = "alice",
                            camera =
                                NativeRemoteParticipant.Camera(
                                    sid = "TR_CAM1",
                                    muted = false,
                                    subscribed = true,
                                ),
                        ),
                    ),
            )
        assertEquals(base, base.copy())

        // A remote mute/unmute/subscribe flip changes the projection.
        val muted =
            base.copy(
                remoteParticipants =
                    listOf(
                        NativeRemoteParticipant(
                            identity = "alice",
                            camera =
                                NativeRemoteParticipant.Camera(
                                    sid = "TR_CAM1",
                                    muted = true,
                                    subscribed = true,
                                ),
                        ),
                    ),
            )
        assertNotEquals(base, muted)

        // Dropping the camera publication is a projection change too.
        val audioOnly =
            base.copy(remoteParticipants = listOf(NativeRemoteParticipant(identity = "alice")))
        assertNotEquals(base, audioOnly)
        assertNotEquals(muted, audioOnly)
    }
}

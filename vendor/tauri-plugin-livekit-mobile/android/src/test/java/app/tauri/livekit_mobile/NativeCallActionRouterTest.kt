package app.tauri.livekit_mobile

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NativeCallActionRouterTest {
    @Test
    fun `answer decline and hangup map to their routing kinds`() {
        assertEquals(
            NativeCallAction(NativeCallActionKind.ANSWER, "call-1"),
            NativeCallAction.fromIntentExtras(
                LivekitMobileForegroundService.ACTION_ANSWER,
                "call-1",
            ),
        )
        assertEquals(
            NativeCallAction(NativeCallActionKind.END, "call-1"),
            NativeCallAction.fromIntentExtras(
                LivekitMobileForegroundService.ACTION_DECLINE,
                "call-1",
            ),
        )
        assertEquals(
            NativeCallAction(NativeCallActionKind.END, "call-1"),
            NativeCallAction.fromIntentExtras(
                LivekitMobileForegroundService.ACTION_HANGUP,
                "call-1",
            ),
        )
        assertEquals(
            NativeCallAction(NativeCallActionKind.FOREGROUND_SERVICE_FAILED, "call-1"),
            NativeCallAction.fromIntentExtras(
                LivekitMobileForegroundService.ACTION_SERVICE_FAILED,
                "call-1",
            ),
        )
    }

    @Test
    fun `an unknown or missing action is not guessed into a hangup`() {
        assertNull(NativeCallAction.fromIntentExtras("something_else", "call-1"))
        assertNull(NativeCallAction.fromIntentExtras(null, "call-1"))
    }

    @Test
    fun `a missing call id reads as blank rather than failing the action`() {
        assertEquals(
            NativeCallAction(NativeCallActionKind.END, ""),
            NativeCallAction.fromIntentExtras(LivekitMobileForegroundService.ACTION_HANGUP, null),
        )
    }

    @Test
    fun `an attached handler receives dispatched actions`() {
        val router = NativeCallActionRouter()
        val received = mutableListOf<NativeCallAction>()
        router.attach { received.add(it) }

        router.dispatch(NativeCallAction(NativeCallActionKind.ANSWER, "call-1"))

        assertEquals(listOf(NativeCallAction(NativeCallActionKind.ANSWER, "call-1")), received)
    }

    @Test
    fun `actions dispatched without a handler are held until one attaches`() {
        val router = NativeCallActionRouter()
        router.dispatch(NativeCallAction(NativeCallActionKind.ANSWER, "call-1"))
        router.dispatch(NativeCallAction(NativeCallActionKind.END, "call-2"))

        val received = mutableListOf<NativeCallAction>()
        router.attach { received.add(it) }

        assertEquals(
            listOf(
                NativeCallAction(NativeCallActionKind.ANSWER, "call-1"),
                NativeCallAction(NativeCallActionKind.END, "call-2"),
            ),
            received,
        )
    }

    @Test
    fun `a foreground service failure survives until a plugin attaches`() {
        val router = NativeCallActionRouter()
        router.dispatch(
            NativeCallAction(NativeCallActionKind.FOREGROUND_SERVICE_FAILED, "call-1"),
        )

        val received = mutableListOf<NativeCallAction>()
        router.attach { received.add(it) }

        assertEquals(
            listOf(NativeCallAction(NativeCallActionKind.FOREGROUND_SERVICE_FAILED, "call-1")),
            received,
        )
    }

    @Test
    fun `a held action is drained once, not replayed to the next handler`() {
        val router = NativeCallActionRouter()
        router.dispatch(NativeCallAction(NativeCallActionKind.END, "call-1"))
        router.attach { }

        val second = mutableListOf<NativeCallAction>()
        router.attach { second.add(it) }

        assertEquals(emptyList<NativeCallAction>(), second)
    }

    @Test
    fun `detaching a replaced handler leaves its replacement attached`() {
        val router = NativeCallActionRouter()
        val replaced: (NativeCallAction) -> Unit = { }
        router.attach(replaced)
        val received = mutableListOf<NativeCallAction>()
        val current: (NativeCallAction) -> Unit = { received.add(it) }
        router.attach(current)

        router.detach(replaced)
        router.dispatch(NativeCallAction(NativeCallActionKind.END, "call-1"))

        assertEquals(listOf(NativeCallAction(NativeCallActionKind.END, "call-1")), received)
    }

    @Test
    fun `detaching the current handler holds later actions again`() {
        val router = NativeCallActionRouter()
        val received = mutableListOf<NativeCallAction>()
        val handler: (NativeCallAction) -> Unit = { received.add(it) }
        router.attach(handler)
        router.detach(handler)

        router.dispatch(NativeCallAction(NativeCallActionKind.ANSWER, "call-1"))
        assertEquals(emptyList<NativeCallAction>(), received)

        router.attach(handler)
        assertEquals(listOf(NativeCallAction(NativeCallActionKind.ANSWER, "call-1")), received)
    }
}

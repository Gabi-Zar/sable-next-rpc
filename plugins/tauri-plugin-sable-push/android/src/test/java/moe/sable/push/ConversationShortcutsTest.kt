package moe.sable.push

import android.content.Context
import android.content.Intent
import androidx.core.app.Person
import androidx.core.content.pm.ShortcutInfoCompat
import androidx.core.content.pm.ShortcutManagerCompat
import io.mockk.every
import io.mockk.just
import io.mockk.mockkStatic
import io.mockk.runs
import io.mockk.slot
import io.mockk.unmockkStatic
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class ConversationShortcutsTest {
    private lateinit var context: Context

    private val removed = slot<List<String>>()

    @Before
    fun setup() {
        context = RuntimeEnvironment.getApplication()
        ShortcutManagerCompat.removeAllDynamicShortcuts(context)
        mockkStatic(ShortcutManagerCompat::class)
        every { ShortcutManagerCompat.removeLongLivedShortcuts(any(), capture(removed)) } just runs
    }

    @After
    fun teardown() {
        unmockkStatic(ShortcutManagerCompat::class)
    }

    private fun publish(userId: String, roomId: String) {
        ConversationShortcuts.publish(
            context, userId, roomId, roomId, null, Person.Builder().setName("Bob").build(),
            Intent(Intent.ACTION_MAIN).setPackage(context.packageName), direct = false,
        )
    }

    @Test
    fun leftRoomsLoseOnlyTheirOwnConversations() {
        publish("@alice:example.org", "!left:example.org")
        publish("@alice:example.org", "!kept:example.org")
        publish("@bob:example.org", "!left:example.org")

        ConversationShortcuts.forgetRooms(context, "@alice:example.org", setOf("!left:example.org"))

        assertEquals(listOf(ConversationShortcuts.id("@alice:example.org", "!left:example.org")), removed.captured)
    }

    @Test
    fun removedAccountsAndOlderBuildsLoseTheirConversations() {
        publish("@alice:example.org", "!room:example.org")
        publish("@gone:example.org", "!room:example.org")
        ShortcutManagerCompat.pushDynamicShortcut(
            context,
            ShortcutInfoCompat.Builder(context, "conversation-1234")
                .setShortLabel("legacy")
                .setIntent(Intent(Intent.ACTION_MAIN).setPackage(context.packageName))
                .build(),
        )

        ConversationShortcuts.retainAccounts(context, setOf("@alice:example.org"))

        assertEquals(
            setOf(ConversationShortcuts.id("@gone:example.org", "!room:example.org"), "conversation-1234"),
            removed.captured.toSet(),
        )
    }
}

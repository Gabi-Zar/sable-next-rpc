package moe.sable.push

import android.app.NotificationManager
import android.content.Context
import androidx.core.app.NotificationCompat

internal object ConversationHistory {
    const val EVENT_KEY = "sable.push.event"
    const val ENCRYPTED_KEY = "sable.push.encrypted"
    const val ACCOUNT_KEY = "sable.push.account"
    const val FAILED_KEY = "sable.push.failed"
    const val LIMIT = 8

    private fun shown(context: Context, id: Int): List<NotificationCompat.MessagingStyle.Message> {
        val active = context.getSystemService(NotificationManager::class.java)
            .activeNotifications.firstOrNull { it.id == id && it.tag == null } ?: return emptyList()
        return NotificationCompat.MessagingStyle.extractMessagingStyleFromNotification(active.notification)
            ?.messages.orEmpty()
    }

    fun shows(context: Context, id: Int, eventId: String?, text: String): Boolean =
        eventId != null && shown(context, id).any {
            it.extras.getString(EVENT_KEY) == eventId && it.text.toString() == text
        }

    fun hides(state: PushPolicy, encrypted: Boolean): Boolean =
        !state.showContent || (!state.showEncryptedContent && encrypted)

    fun read(context: Context, id: Int): List<NotificationCompat.MessagingStyle.Message> {
        val state = PushPolicy(context)
        return shown(context, id).filterNot { it.extras.getBoolean(FAILED_KEY) }.map { message ->
            NotificationCompat.MessagingStyle.Message(
                if (hides(state, message.extras.getBoolean(ENCRYPTED_KEY, true))) "New message" else message.text,
                message.timestamp,
                message.person
            ).also { it.extras.putAll(message.extras) }
        }
    }
}

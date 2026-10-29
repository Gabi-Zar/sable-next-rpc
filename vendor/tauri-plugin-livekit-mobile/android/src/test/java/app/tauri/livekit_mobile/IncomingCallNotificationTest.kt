package app.tauri.livekit_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.net.Uri
import android.provider.Settings
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class IncomingCallNotificationTest {
    private val context: Context get() = RuntimeEnvironment.getApplication()
    private val manager get() = context.getSystemService(NotificationManager::class.java)

    @Test
    fun incomingCallRepeatsOnTheRingtoneStreamWithANativeTimeout() {
        LivekitMobileForegroundService.createNotificationChannels(context)
        val notification =
            LivekitMobileForegroundService.buildIncomingCallNotification(context, "Ada", "call")
        val channel = manager.getNotificationChannel(notification.channelId)
        assertEquals(AudioAttributes.USAGE_NOTIFICATION_RINGTONE, channel.audioAttributes.usage)
        assertEquals(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), channel.sound)
        assertTrue(channel.shouldVibrate())
        assertTrue(notification.flags and Notification.FLAG_INSISTENT != 0)
        assertEquals(30_000L, notification.timeoutAfter)
    }

    @Test
    fun answeringStopsOnlyTheMatchingRing() {
        assertTrue(LivekitMobileForegroundService.postIncomingCall(context, "call", "Ada"))
        LivekitMobileForegroundService.markIncomingCallAnswered(context, "other")
        assertEquals(1, manager.activeNotifications.size)
        LivekitMobileForegroundService.markIncomingCallAnswered(context, "call")
        assertTrue(manager.activeNotifications.isEmpty())
    }

    @Test
    fun migrationReplacesTheOldDefaultNotificationSound() {
        manager.createNotificationChannel(
            NotificationChannel("livekit_mobile_incoming", "Incoming call", NotificationManager.IMPORTANCE_HIGH),
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        val channel = manager.getNotificationChannel("livekit_mobile_incoming.v2")
        assertEquals(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE), channel.sound)
        assertEquals(AudioAttributes.USAGE_NOTIFICATION_RINGTONE, channel.audioAttributes.usage)
    }

    @Test
    fun migrationPreservesASilentChannelAndItsImportance() {
        manager.createNotificationChannel(
            NotificationChannel("livekit_mobile_incoming", "Incoming call", NotificationManager.IMPORTANCE_LOW).apply {
                setSound(null, AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_NOTIFICATION).build())
                enableVibration(false)
            },
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        val channel = manager.getNotificationChannel("livekit_mobile_incoming.v2")
        assertNull(channel.sound)
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
        assertFalse(channel.shouldVibrate())
    }

    @Test
    fun migrationPreservesACustomSound() {
        val sound = Uri.parse("content://media/internal/audio/media/42")
        manager.createNotificationChannel(
            NotificationChannel("livekit_mobile_incoming", "Incoming call", NotificationManager.IMPORTANCE_HIGH).apply {
                setSound(sound, null)
            },
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        assertEquals(sound, manager.getNotificationChannel("livekit_mobile_incoming.v2").sound)
    }

    @Test
    @Config(sdk = [28])
    fun olderAndroidPreservesTheSoundWhenUserChoiceCannotBeDetected() {
        manager.createNotificationChannel(
            NotificationChannel("livekit_mobile_incoming", "Incoming call", NotificationManager.IMPORTANCE_HIGH),
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        assertEquals(
            Settings.System.DEFAULT_NOTIFICATION_URI,
            manager.getNotificationChannel("livekit_mobile_incoming.v2").sound,
        )
    }

    @Test
    fun existingRingtoneChannelSettingsAreKept() {
        manager.createNotificationChannel(
            NotificationChannel("livekit_mobile_incoming.v2", "Incoming call", NotificationManager.IMPORTANCE_NONE).apply {
                setSound(null, null)
            },
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        val channel = manager.getNotificationChannel("livekit_mobile_incoming.v2")
        assertNull(channel.sound)
        assertEquals(NotificationManager.IMPORTANCE_NONE, channel.importance)
    }
}

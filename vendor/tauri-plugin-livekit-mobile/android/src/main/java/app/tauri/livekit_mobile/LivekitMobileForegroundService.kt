package app.tauri.livekit_mobile

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.AudioAttributes
import android.media.RingtoneManager
import android.os.Build
import android.os.Bundle
import android.os.IBinder
import android.provider.Settings
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.Person

/**
 * Foreground-service notification shown while a native room exists.
 *
 * Uses {@link NotificationCompat.CallStyle} on Android 12+ for the system
 * call UI (incoming call chip, ongoing call notification). On older
 * platforms falls back to the simpler ongoing-call style.
 *
 * Audio focus and routing are owned by the LiveKit SDK, not by this plugin.
 */
class LivekitMobileForegroundService : Service() {
    override fun onCreate() {
        super.onCreate()
        createNotificationChannels(this)
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val callId = intent?.getStringExtra(EXTRA_CALL_ID) ?: ""
        val callDirection = intent?.getStringExtra(EXTRA_CALL_DIRECTION) ?: DIRECTION_ONGOING
        val callerName = intent?.getStringExtra(EXTRA_CALLER_NAME) ?: ""
        val wantsMicrophone = intent?.getBooleanExtra(EXTRA_MICROPHONE, false) ?: false
        val wantsCamera = intent?.getBooleanExtra(EXTRA_CAMERA, false) ?: false
        val wantsPlayback = intent?.getBooleanExtra(EXTRA_PLAYBACK, true) ?: true
        val wantsScreenShare = intent?.getBooleanExtra(EXTRA_SCREEN_SHARE, false) ?: false

        val notification = when (callDirection) {
            DIRECTION_INCOMING -> buildIncomingCallNotification(this, callerName, callId)
            DIRECTION_OUTGOING -> buildOutgoingCallNotification(callerName, callId)
            else -> buildOngoingCallNotification(callerName, callId)
        }
        if (callDirection == DIRECTION_ONGOING) {
            intent?.getStringExtra(EXTRA_INCOMING_CALL_ID)?.let {
                notification.extras.putString(EXTRA_CALL_ID, it)
                notification.extras.putBoolean(EXTRA_CONNECTED, true)
            }
        }

        val started = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                var types = 0
                if (wantsMicrophone) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
                // Without this a backgrounded video call loses its capture; the
                // caller only sets the extra once CAMERA has been granted,
                // since an unmet precondition throws instead.
                if (wantsCamera) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
                if (wantsPlayback) types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
                // Android 14+ refuses createVirtualDisplay unless this type is
                // already foreground.
                if (wantsScreenShare) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
                }
                // FOREGROUND_SERVICE_TYPE_PHONE_CALL for targetSdk 34+ system-call usage.
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
                    types = types or ServiceInfo.FOREGROUND_SERVICE_TYPE_PHONE_CALL
                }
                startForeground(NOTIFICATION_ID, notification, types)
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
            true
        } catch (_: SecurityException) {
            false
        } catch (_: IllegalArgumentException) {
            false
        } catch (_: IllegalStateException) {
            false
        }
        if (started && callDirection == DIRECTION_ONGOING) {
            intent?.getStringExtra(EXTRA_INCOMING_CALL_ID)?.let { markIncomingCallConnected(this, it) }
        }
        if (!started) {
            // A while-in-use type cannot start from the background and an
            // ongoing self-managed Telecom call is not an exemption, so this
            // has to reach the plugin rather than die here. The router is
            // in-process, which this failure always is.
            NativeCallActionRouter.shared.dispatch(
                NativeCallAction(NativeCallActionKind.FOREGROUND_SERVICE_FAILED, callId),
            )
            stopSelfResult(startId)
        }
        return START_NOT_STICKY
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
        super.onDestroy()
    }

    // ── Outgoing call notification ─────────────────────────────────────────

    private fun buildOutgoingCallNotification(callerName: String, callId: String): Notification {
        val appInfo = applicationInfo
        val appLabel = appInfo.loadLabel(packageManager).toString()
        // Same blank handling as the ongoing notification: an empty Person is a
        // blank row and "Calling …" reads as a truncated string.
        val displayName = callerName.ifBlank { appLabel }
        val contentText = if (callerName.isBlank()) "Calling…" else "Calling $callerName…"

        val hangupIntent = buildActionIntent(ACTION_HANGUP, callId)
        val hangupPending = PendingIntent.getBroadcast(
            this, 2, hangupIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val person = Person.Builder()
                .setName(displayName)
                .build()
            NotificationCompat.Builder(this, CHANNEL_ID_ONGOING)
                .setSmallIcon(appInfo.icon)
                .setContentTitle(appLabel)
                .setContentText(contentText)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setStyle(
                    NotificationCompat.CallStyle.forOngoingCall(
                        person,
                        hangupPending,
                    ),
                )
        } else {
            NotificationCompat.Builder(this, CHANNEL_ID_ONGOING)
                .setSmallIcon(appInfo.icon)
                .setContentTitle(appLabel)
                .setContentText(contentText)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
        }
        buildContentIntent()?.let(builder::setContentIntent)
        return builder.build()
    }

    // ── Ongoing call notification ──────────────────────────────────────────

    private fun buildOngoingCallNotification(callerName: String, callId: String): Notification {
        val appInfo = applicationInfo
        val appLabel = appInfo.loadLabel(packageManager).toString()
        // CallStyle renders an empty Person as a blank row, and "Call with "
        // reads as a truncated string, so an unnamed call says so instead.
        val displayName = callerName.ifBlank { appLabel }
        val contentText = if (callerName.isBlank()) "Call in progress" else "Call with $callerName"

        val hangupIntent = buildActionIntent(ACTION_HANGUP, callId)
        val hangupPending = PendingIntent.getBroadcast(
            this, 3, hangupIntent,
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
        )

        val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val person = Person.Builder()
                .setName(displayName)
                .build()
            NotificationCompat.Builder(this, CHANNEL_ID_ONGOING)
                .setSmallIcon(appInfo.icon)
                .setContentTitle(appLabel)
                .setContentText(contentText)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setStyle(
                    NotificationCompat.CallStyle.forOngoingCall(
                        person,
                        hangupPending,
                    ),
                )
        } else {
            NotificationCompat.Builder(this, CHANNEL_ID_ONGOING)
                .setSmallIcon(appInfo.icon)
                .setContentTitle(appLabel)
                .setContentText(contentText)
                .setCategory(Notification.CATEGORY_CALL)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
        }
        buildContentIntent()?.let(builder::setContentIntent)
        return builder.build()
    }

    // ── Helpers ────────────────────────────────────────────────────────────

    /**
     * Builds the broadcast a notification button sends.
     *
     * Explicit (it names the receiver class) so it is not an implicit broadcast,
     * and it carries the call it belongs to: the plugin instance that handles it
     * may not be the one that started this service.
     */
    private fun buildActionIntent(action: String, callId: String): Intent =
        buildActionIntent(this, action, callId)

    /**
     * Body tap on a call notification. CallStyle only wires the buttons it was
     * given, so without a content intent the rest of the notification is inert;
     * a full-screen intent does not stand in for it, since the system drops
     * that to a heads-up whenever the device is already unlocked and in use.
     *
     * Where the full-screen intent exists to raise the ring UI, this one only
     * has to return to a call that is already running, which is what the
     * launcher intent gives us: it resolves to the same front-door activity the
     * launcher icon opens, and it already carries FLAG_ACTIVITY_NEW_TASK, which
     * an activity content intent is required to have and which brings an
     * existing task to the front in the state it was last in instead of
     * starting a second one. SINGLE_TOP goes on top of that so a host whose
     * activity is not already single-task keeps its running instance rather
     * than stacking a second copy of it.
     *
     * Null when the host app exposes no launcher activity, so the notification
     * keeps its working buttons instead of carrying an intent that resolves to
     * nothing.
     */
    private fun buildContentIntent(): PendingIntent? = buildContentIntent(this)

    companion object {
        // Extras from the plugin to the service.
        const val EXTRA_MICROPHONE = "app.tauri.livekit_mobile.extra.MICROPHONE"
        const val EXTRA_CAMERA = "app.tauri.livekit_mobile.extra.CAMERA"
        const val EXTRA_PLAYBACK = "app.tauri.livekit_mobile.extra.PLAYBACK"
        const val EXTRA_SCREEN_SHARE = "app.tauri.livekit_mobile.extra.SCREEN_SHARE"
        const val EXTRA_CALL_DIRECTION = "app.tauri.livekit_mobile.extra.CALL_DIRECTION"
        const val EXTRA_CALLER_NAME = "app.tauri.livekit_mobile.extra.CALLER_NAME"
        const val EXTRA_CALL_ID = "app.tauri.livekit_mobile.extra.CALL_ID"
        internal const val EXTRA_INCOMING_CALL_ID = "incomingCallId"
        internal const val EXTRA_CONNECTED = "connected"

        // Action values carried by the notification broadcasts.
        const val EXTRA_ACTION = "app.tauri.livekit_mobile.extra.CALL_ACTION"
        const val ACTION_ANSWER = "answer"
        const val ACTION_DECLINE = "decline"
        const val ACTION_HANGUP = "hangup"
        const val ACTION_SERVICE_FAILED = "service_failed"

        // Call direction values for EXTRA_CALL_DIRECTION.
        const val DIRECTION_INCOMING = "incoming"
        const val DIRECTION_OUTGOING = "outgoing"
        const val DIRECTION_ONGOING = "ongoing"

        private const val CHANNEL_ID_ONGOING = "livekit_mobile_ongoing"
        private const val CHANNEL_ID_INCOMING = "livekit_mobile_incoming.v2"
        private const val NOTIFICATION_ID = 1396

        internal fun createNotificationChannels(context: Context) {
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID_ONGOING,
                    "Call in progress",
                    NotificationManager.IMPORTANCE_LOW,
                ),
            )
            if (manager.getNotificationChannel(CHANNEL_ID_INCOMING) != null) return
            // Channel audio attributes are immutable; migrate existing sound settings.
            val previous = manager.getNotificationChannel("livekit_mobile_incoming")
            val ringtone = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE)
            val sound = when {
                previous == null -> ringtone
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R && previous.hasUserSetSound() -> previous.sound
                Build.VERSION.SDK_INT >= Build.VERSION_CODES.R &&
                    previous.sound == Settings.System.DEFAULT_NOTIFICATION_URI -> ringtone
                else -> previous.sound
            }
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_ID_INCOMING,
                    "Incoming call",
                    previous?.importance ?: NotificationManager.IMPORTANCE_HIGH,
                ).apply {
                    setSound(
                        sound,
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_NOTIFICATION_RINGTONE)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    )
                    previous?.let {
                        vibrationPattern = it.vibrationPattern
                        lockscreenVisibility = it.lockscreenVisibility
                        setShowBadge(it.canShowBadge())
                        enableLights(it.shouldShowLights())
                        lightColor = it.lightColor
                        setBypassDnd(it.canBypassDnd())
                    }
                    enableVibration(previous?.shouldVibrate() ?: true)
                },
            )
        }

        internal fun postIncomingCall(context: Context, callId: String, callerName: String): Boolean {
            createNotificationChannels(context)
            val manager = NotificationManagerCompat.from(context)
            if (!manager.areNotificationsEnabled()) return false
            return try {
                manager.notify(NOTIFICATION_ID, buildIncomingCallNotification(context, callerName, callId))
                true
            } catch (_: SecurityException) {
                false
            } catch (_: IllegalArgumentException) {
                false
            }
        }

        internal fun cancelIncomingCall(context: Context, callId: String) {
            NotificationManagerCompat.from(context).cancel(NOTIFICATION_ID)
            closeIncomingCallScreen(context, callId)
        }

        internal fun closeIncomingCallScreen(context: Context, callId: String) {
            context.sendBroadcast(
                Intent(IncomingCallActivity.ACTION_ENDED)
                    .setPackage(context.packageName)
                    .putExtra(EXTRA_CALL_ID, callId),
            )
        }

        internal fun markIncomingCallAnswered(context: Context, callId: String) {
            val manager = context.getSystemService(NotificationManager::class.java)
            manager.activeNotifications.firstOrNull {
                it.id == NOTIFICATION_ID &&
                    it.notification.extras.getString(EXTRA_CALL_ID) == callId &&
                    it.notification.flags and Notification.FLAG_INSISTENT != 0
            }?.let { manager.cancel(it.id) }
            context.sendBroadcast(
                Intent(IncomingCallActivity.ACTION_ANSWERED)
                    .setPackage(context.packageName)
                    .putExtra(EXTRA_CALL_ID, callId),
            )
        }

        internal fun markIncomingCallConnected(context: Context, callId: String) {
            context.sendBroadcast(
                Intent(IncomingCallActivity.ACTION_CONNECTED)
                    .setPackage(context.packageName)
                    .putExtra(EXTRA_CALL_ID, callId),
            )
        }

        private fun buildActionIntent(context: Context, action: String, callId: String): Intent =
            Intent(context, LivekitMobileCallActionReceiver::class.java)
                .putExtra(EXTRA_ACTION, action)
                .putExtra(EXTRA_CALL_ID, callId)

        private fun buildFullScreenIntent(
            context: Context,
            callId: String,
            callerName: String,
        ): PendingIntent {
            val intent = Intent(context, IncomingCallActivity::class.java)
                .putExtra(EXTRA_CALL_ID, callId)
                .putExtra(EXTRA_CALLER_NAME, callerName)
            return PendingIntent.getActivity(
                context, 0, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        private fun buildContentIntent(context: Context): PendingIntent? {
            val intent = context.packageManager.getLaunchIntentForPackage(context.packageName)
                ?: return null
            intent.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            // Its own request code: PendingIntent matching ignores Intent flags, so
            // sharing the full-screen intent's would hand back that PendingIntent
            // and silently drop SINGLE_TOP.
            return PendingIntent.getActivity(
                context, 4, intent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        }

        // ── Incoming call notification (Android 12+ CallStyle) ─────────────────

        internal fun buildIncomingCallNotification(
            context: Context,
            callerName: String,
            callId: String,
        ): Notification {
            val appInfo = context.applicationInfo
            val appLabel = appInfo.loadLabel(context.packageManager).toString()

            val declineIntent = buildActionIntent(context, ACTION_DECLINE, callId)
            val answerIntent = buildActionIntent(context, ACTION_ANSWER, callId)
            val declinePending = PendingIntent.getBroadcast(
                context, 0, declineIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
            val answerPending = PendingIntent.getBroadcast(
                context, 1, answerIntent,
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )

            val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                val person = Person.Builder()
                    .setName(callerName)
                    .build()
                NotificationCompat.Builder(context, CHANNEL_ID_INCOMING)
                    .setSmallIcon(appInfo.icon)
                    .setContentTitle(appLabel)
                    .setContentText("Incoming call from $callerName")
                    .setCategory(Notification.CATEGORY_CALL)
                    .setOngoing(true)
                    .setOnlyAlertOnce(false)
                    .setStyle(
                        NotificationCompat.CallStyle.forIncomingCall(
                            person,
                            declinePending,
                            answerPending,
                        ),
                    )
                    .setFullScreenIntent(buildFullScreenIntent(context, callId, callerName), true)
            } else {
                // Pre-Android 12: simple ongoing notification.
                NotificationCompat.Builder(context, CHANNEL_ID_INCOMING)
                    .setSmallIcon(appInfo.icon)
                    .setContentTitle(appLabel)
                    .setContentText("Incoming call from $callerName")
                    .setCategory(Notification.CATEGORY_CALL)
                    .setOngoing(true)
                    .setOnlyAlertOnce(false)
                    .setFullScreenIntent(buildFullScreenIntent(context, callId, callerName), true)
            }
            // JS timers may be suspended while the app is in the background.
            builder.setTimeoutAfter(30_000L)
            builder.addExtras(Bundle().apply { putString(EXTRA_CALL_ID, callId) })
            buildContentIntent(context)?.let(builder::setContentIntent)
            return builder.build().apply {
                flags = flags or Notification.FLAG_INSISTENT
            }
        }
    }
}

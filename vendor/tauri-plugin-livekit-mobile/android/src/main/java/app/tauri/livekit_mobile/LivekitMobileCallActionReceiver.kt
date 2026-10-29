package app.tauri.livekit_mobile

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent

/**
 * Manifest-declared receiver for the call notification's buttons.
 *
 * Declared rather than registered on the activity: a context-registered
 * receiver only receives broadcasts while its registering context is valid, so
 * Answer and Hangup would reach nothing once the activity that registered them
 * was destroyed while the notification was still up. The system starts a
 * manifest-declared receiver even when the app is not already running.
 *
 * The intents are explicit (they name this class), so the Android 8 ban on
 * manifest-declared receivers for implicit broadcasts does not apply.
 */
class LivekitMobileCallActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action =
            NativeCallAction.fromIntentExtras(
                intent.getStringExtra(LivekitMobileForegroundService.EXTRA_ACTION),
                intent.getStringExtra(LivekitMobileForegroundService.EXTRA_CALL_ID),
            ) ?: return
        NativeCallActionRouter.shared.dispatch(action)
    }
}

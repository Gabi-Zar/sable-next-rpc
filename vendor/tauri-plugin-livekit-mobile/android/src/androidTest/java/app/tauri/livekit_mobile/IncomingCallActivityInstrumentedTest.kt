package app.tauri.livekit_mobile

import android.app.KeyguardManager
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Intent
import android.os.PowerManager
import android.os.SystemClock
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Button
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class IncomingCallActivityInstrumentedTest {
    @Test
    fun lockedCallWakesScreenAndDeclines() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val monitor = instrumentation.addMonitor(IncomingCallActivity::class.java.name, null, false)
        var action: NativeCallAction? = null
        val handler: (NativeCallAction) -> Unit = { action = it }
        NativeCallActionRouter.shared.attach(handler)
        try {
            instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
            SystemClock.sleep(1000)
            assertTrue(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
            assertTrue(LivekitMobileForegroundService.postIncomingCall(context, "fixture", "Sable call test"))
            val activity = monitor.waitForActivityWithTimeout(5000) as? IncomingCallActivity
            assertNotNull("incoming call screen", activity)
            assertTrue(context.getSystemService(PowerManager::class.java).isInteractive)
            assertTrue(context.getSystemService(KeyguardManager::class.java).isKeyguardLocked)
            instrumentation.runOnMainSync {
                val root = activity!!.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
                val decline = (0 until root.childCount).map { root.getChildAt(it) }
                    .filterIsInstance<Button>().single { it.text == context.getString(R.string.livekit_decline) }
                decline.performClick()
            }
            assertEquals(NativeCallAction(NativeCallActionKind.END, "fixture"), action)
        } finally {
            LivekitMobileForegroundService.cancelIncomingCall(context, "fixture")
            NativeCallActionRouter.shared.detach(handler)
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test
    fun remoteEndClosesOnlyTheMatchingCallScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val notification = LivekitMobileForegroundService.buildIncomingCallNotification(context, "Sable call test", "fixture")
        notification.fullScreenIntent = PendingIntent.getActivity(
            context, 20, Intent(context, IncomingCallActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        context.getSystemService(NotificationManager::class.java).notify(1, notification)
        val activity = instrumentation.startActivitySync(
            Intent(context, IncomingCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(LivekitMobileForegroundService.EXTRA_CALL_ID, "fixture")
                .putExtra(LivekitMobileForegroundService.EXTRA_CALLER_NAME, "Sable call test")
        )
        try {
            LivekitMobileForegroundService.cancelIncomingCall(context, "other")
            instrumentation.waitForIdleSync()
            assertFalse(activity.isFinishing)
            LivekitMobileForegroundService.cancelIncomingCall(context, "fixture")
            val deadline = SystemClock.uptimeMillis() + 2000
            while (!activity.isFinishing && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20)
            assertTrue(activity.isFinishing)
        } finally {
            context.getSystemService(NotificationManager::class.java).cancel(1)
            instrumentation.runOnMainSync { activity.finish() }
        }
    }

    @Test
    fun answeredCallSurvivesRecreation() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val notification = LivekitMobileForegroundService.buildIncomingCallNotification(context, "Sable call test", "fixture")
        notification.fullScreenIntent = PendingIntent.getActivity(
            context, 20, Intent(context, IncomingCallActivity::class.java), PendingIntent.FLAG_IMMUTABLE,
        )
        LivekitMobileForegroundService.createNotificationChannels(context)
        context.getSystemService(NotificationManager::class.java).notify(1, notification)
        val monitor = instrumentation.addMonitor(IncomingCallActivity::class.java.name, null, false)
        val activity = instrumentation.startActivitySync(
            Intent(context, IncomingCallActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                .putExtra(LivekitMobileForegroundService.EXTRA_CALL_ID, "fixture")
        )
        try {
            monitor.waitForActivityWithTimeout(5000)
            LivekitMobileForegroundService.markIncomingCallAnswered(context, "fixture")
            var answerDisabled = false
            val deadline = SystemClock.uptimeMillis() + 2000
            while (!answerDisabled && SystemClock.uptimeMillis() < deadline) {
                instrumentation.runOnMainSync {
                    val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
                    answerDisabled = (0 until root.childCount).map { root.getChildAt(it) }
                        .filterIsInstance<Button>().any { !it.isEnabled }
                }
                if (!answerDisabled) SystemClock.sleep(20)
            }
            assertTrue(answerDisabled)
            LivekitMobileForegroundService.markIncomingCallConnected(context, "fixture")
            var connected = false
            val connectedDeadline = SystemClock.uptimeMillis() + 2000
            while (!connected && SystemClock.uptimeMillis() < connectedDeadline) {
                instrumentation.runOnMainSync {
                    val root = activity.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
                    connected = (0 until root.childCount).map { root.getChildAt(it) }
                        .filterIsInstance<TextView>().any { it.text == context.getString(R.string.livekit_call_in_progress) }
                }
                if (!connected) SystemClock.sleep(20)
            }
            assertTrue(connected)
            assertFalse(activity.isFinishing)
            instrumentation.runOnMainSync { activity.recreate() }
            val recreated = monitor.waitForActivityWithTimeout(5000)!!
            instrumentation.runOnMainSync {
                val root = recreated.findViewById<ViewGroup>(android.R.id.content).getChildAt(0) as ViewGroup
                val buttons = (0 until root.childCount).map { root.getChildAt(it) }.filterIsInstance<Button>()
                assertFalse(buttons.single { it.text == context.getString(R.string.livekit_answer) }.isEnabled)
                assertNotNull(buttons.singleOrNull { it.text == context.getString(R.string.livekit_end_call) })
                assertTrue((0 until root.childCount).map { root.getChildAt(it) }
                    .filterIsInstance<TextView>().any { it.text == context.getString(R.string.livekit_call_in_progress) })
                assertEquals(0, recreated.window.attributes.flags and WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                recreated.finish()
            }
        } finally {
            context.getSystemService(NotificationManager::class.java).cancel(1)
            instrumentation.runOnMainSync { activity.finish() }
            instrumentation.removeMonitor(monitor)
        }
    }

    @Test
    fun aSecondIncomingCallClosesThePreviousScreen() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val context = instrumentation.targetContext
        val controller = NativeCallController(context, hasMicrophonePermission = { false })
        val monitor = instrumentation.addMonitor(IncomingCallActivity::class.java.name, null, false)
        try {
            instrumentation.uiAutomation.executeShellCommand("input keyevent 223").close()
            SystemClock.sleep(1000)
            assertTrue(controller.presentIncomingCall("first", "First call"))
            val activity = monitor.waitForActivityWithTimeout(5000)!!
            assertTrue(controller.presentIncomingCall("second", "Second call"))
            val deadline = SystemClock.uptimeMillis() + 2000
            while (!activity.isFinishing && SystemClock.uptimeMillis() < deadline) SystemClock.sleep(20)
            assertTrue(activity.isFinishing)
            assertTrue(context.getSystemService(NotificationManager::class.java).activeNotifications.any {
                it.notification.extras.getString(LivekitMobileForegroundService.EXTRA_CALL_ID) == "second"
            })
        } finally {
            controller.dispose()
            instrumentation.removeMonitor(monitor)
        }
    }
}

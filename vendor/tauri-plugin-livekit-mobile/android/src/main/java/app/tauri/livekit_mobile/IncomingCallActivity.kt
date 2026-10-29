package app.tauri.livekit_mobile

import android.app.Activity
import android.app.KeyguardManager
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.view.Gravity
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

class IncomingCallActivity : Activity() {
    private lateinit var callId: String
    private var answered = false
    private var connected = false
    private var openAppRequested = false
    private lateinit var answer: Button
    private lateinit var decline: Button
    private lateinit var status: TextView
    private val ended = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
            if (isFinishing) return
            if (intent.getStringExtra(LivekitMobileForegroundService.EXTRA_CALL_ID) != callId) return
            when (intent.action) {
                ACTION_ANSWERED -> showAnswered()
                ACTION_CONNECTED -> {
                    connected = true
                    showAnswered()
                    if (!(getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager).isKeyguardLocked) {
                        if (openAppRequested) openApp() else finish()
                    }
                }
                else -> finish()
            }
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        callId = intent.getStringExtra(LivekitMobileForegroundService.EXTRA_CALL_ID).orEmpty()
        if (callId.isBlank()) {
            finish()
            return
        }
        ContextCompat.registerReceiver(
            this, ended, IntentFilter(ACTION_ENDED).apply {
                addAction(ACTION_ANSWERED)
                addAction(ACTION_CONNECTED)
            },
            ContextCompat.RECEIVER_NOT_EXPORTED,
        )
        val notification = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            getSystemService(NotificationManager::class.java).activeNotifications.firstOrNull {
                it.notification.extras.getString(LivekitMobileForegroundService.EXTRA_CALL_ID) == callId
            }?.notification
        } else null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M && notification == null) {
            finish()
            return
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true)
            setTurnScreenOn(true)
        } else {
            window.addFlags(
                WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
                    WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
            )
        }
        window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        val padding = (24 * resources.displayMetrics.density).toInt()
        status = TextView(this).apply {
            text = getString(R.string.livekit_incoming_call)
            gravity = Gravity.CENTER
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            gravity = Gravity.CENTER
            setPadding(padding, padding, padding, padding)
            addView(TextView(context).apply {
                text = intent.getStringExtra(LivekitMobileForegroundService.EXTRA_CALLER_NAME)
                textSize = 28f
                gravity = Gravity.CENTER
            })
            addView(status)
            answer = Button(context).apply {
                text = getString(R.string.livekit_answer)
                setOnClickListener {
                    openAppRequested = true
                    showAnswered()
                    NativeCallActionRouter.shared.dispatch(NativeCallAction(NativeCallActionKind.ANSWER, callId))
                    requestOpenApp()
                }
            }
            addView(answer)
            decline = Button(context).apply {
                text = getString(R.string.livekit_decline)
                setOnClickListener {
                    NativeCallActionRouter.shared.dispatch(NativeCallAction(NativeCallActionKind.END, callId))
                    finish()
                }
            }
            addView(decline)
        }
        setContentView(layout)
        connected = savedInstanceState?.getBoolean("connected") == true ||
            notification?.extras?.getBoolean(LivekitMobileForegroundService.EXTRA_CONNECTED) == true
        openAppRequested = savedInstanceState?.getBoolean("openAppRequested") == true
        if (connected || savedInstanceState?.getBoolean("answered") == true) {
            showAnswered()
            if (openAppRequested) requestOpenApp()
        }
    }

    private fun showAnswered() {
        answered = true
        answer.isEnabled = false
        status.text = getString(if (connected) R.string.livekit_call_in_progress else R.string.livekit_answering)
        decline.text = getString(R.string.livekit_end_call)
        window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
    }

    override fun onSaveInstanceState(outState: Bundle) {
        outState.putBoolean("answered", answered)
        outState.putBoolean("connected", connected)
        outState.putBoolean("openAppRequested", openAppRequested)
        super.onSaveInstanceState(outState)
    }

    private fun requestOpenApp() {
        val keyguard = getSystemService(Context.KEYGUARD_SERVICE) as KeyguardManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && keyguard.isKeyguardLocked) {
            keyguard.requestDismissKeyguard(this,
                object : KeyguardManager.KeyguardDismissCallback() {
                    override fun onDismissSucceeded() = openApp()
                    override fun onDismissCancelled() {
                        openAppRequested = false
                    }
                    override fun onDismissError() {
                        openAppRequested = false
                    }
                },
            )
        } else {
            openApp()
        }
    }

    private fun openApp() {
        if (isFinishing) return
        packageManager.getLaunchIntentForPackage(packageName)?.let { startActivity(it) }
        finish()
    }

    override fun onDestroy() {
        if (callId.isNotBlank()) unregisterReceiver(ended)
        super.onDestroy()
    }

    companion object {
        internal const val ACTION_ENDED = "app.tauri.livekit_mobile.CALL_ENDED"
        internal const val ACTION_ANSWERED = "app.tauri.livekit_mobile.CALL_ANSWERED"
        internal const val ACTION_CONNECTED = "app.tauri.livekit_mobile.CALL_CONNECTED"
    }
}

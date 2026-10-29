package moe.sable.client

import android.app.Activity
import android.app.Service
import android.content.ComponentName
import android.content.Intent
import android.net.Uri
import android.os.Binder
import android.os.Bundle
import android.os.Handler
import android.os.IBinder
import android.os.Looper
import androidx.browser.customtabs.CustomTabsCallback
import androidx.browser.customtabs.CustomTabsClient
import androidx.browser.customtabs.CustomTabsIntent
import androidx.browser.customtabs.CustomTabsServiceConnection
import androidx.browser.customtabs.CustomTabsSession

class AuthBrowser(private val activity: Activity) {
  private val handler = Handler(Looper.getMainLooper())
  private var connection: CustomTabsServiceConnection? = null
  private var pending: ((Result<Unit>) -> Unit)? = null
  private var timeout: Runnable? = null

  fun open(uri: Uri, complete: (Result<Unit>) -> Unit) {
    close()
    if (uri.scheme !in listOf("https", "http") || uri.host.isNullOrEmpty()) {
      complete(Result.failure(IllegalArgumentException("Invalid authentication URL")))
      return
    }
    pending = complete
    val packageName = CustomTabsClient.getPackageName(activity, null)
    if (packageName == null) {
      launch(uri, null, null)
      return
    }

    val service = object : CustomTabsServiceConnection() {
      override fun onCustomTabsServiceConnected(name: ComponentName, client: CustomTabsClient) {
        if (connection !== this || pending == null) return
        val connected = this
        client.warmup(0)
        val session = client.newSession(object : CustomTabsCallback() {
          override fun onNavigationEvent(event: Int, extras: Bundle?) {
            if (event == TAB_HIDDEN && connection === connected) close()
          }
        })
        if (session == null) disconnect()
        launch(uri, packageName, session)
      }

      override fun onServiceDisconnected(name: ComponentName) {
        if (connection === this) close()
      }
    }
    connection = service
    val bound = runCatching {
      CustomTabsClient.bindCustomTabsService(activity, packageName, service)
    }.getOrDefault(false)
    if (!bound) {
      connection = null
      launch(uri, packageName, null)
      return
    }
    timeout = Runnable {
      if (pending != null && connection === service) {
        disconnect()
        launch(uri, packageName, null)
      }
    }.also { handler.postDelayed(it, 2000) }
  }

  private fun launch(uri: Uri, packageName: String?, session: CustomTabsSession?) {
    val complete = pending ?: return
    pending = null
    timeout?.let(handler::removeCallbacks)
    timeout = null
    val result = runCatching {
      val tab = CustomTabsIntent.Builder(session).setShowTitle(true).build()
      packageName?.let(tab.intent::setPackage)
      if (session != null) {
        // Chrome binds this service for the lifetime of the approval tab.
        tab.intent.putExtra(
          "android.support.customtabs.extra.KEEP_ALIVE",
          Intent(activity, AuthBrowserKeepAliveService::class.java),
        )
      }
      tab.launchUrl(activity, uri)
    }
    if (result.isFailure) close()
    complete(result)
  }

  fun close() {
    timeout?.let(handler::removeCallbacks)
    timeout = null
    disconnect()
    val complete = pending
    pending = null
    complete?.invoke(Result.failure(IllegalStateException("Authentication browser closed")))
  }

  private fun disconnect() {
    val previous = connection
    connection = null
    if (previous != null) runCatching { activity.unbindService(previous) }
  }
}

class AuthBrowserKeepAliveService : Service() {
  private val binder = Binder()
  override fun onBind(intent: Intent): IBinder = binder
}

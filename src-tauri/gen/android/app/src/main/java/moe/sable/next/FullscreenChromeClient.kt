package moe.sable.next

import android.graphics.Bitmap
import android.net.Uri
import android.view.View
import android.view.ViewGroup
import android.webkit.ConsoleMessage
import android.webkit.GeolocationPermissions
import android.webkit.JsPromptResult
import android.webkit.JsResult
import android.webkit.PermissionRequest
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebView
import android.widget.FrameLayout

class FullscreenChromeClient(
  private val inner: WebChromeClient,
  private val onFullscreenChanged: (Boolean) -> Unit,
) : WebChromeClient() {
  private var customView: View? = null
  private var customViewCallback: CustomViewCallback? = null

  val isFullscreen: Boolean
    get() = customView != null

  fun exitFullscreen() {
    onHideCustomView()
  }

  override fun onShowCustomView(view: View, callback: CustomViewCallback) {
    if (customView != null) {
      callback.onCustomViewHidden()
      return
    }
    val parent = (view.context as? android.app.Activity)?.window?.decorView as? ViewGroup
    if (parent == null) {
      callback.onCustomViewHidden()
      return
    }
    customView = view
    customViewCallback = callback
    parent.addView(
      view,
      FrameLayout.LayoutParams(
        ViewGroup.LayoutParams.MATCH_PARENT,
        ViewGroup.LayoutParams.MATCH_PARENT,
      ),
    )
    onFullscreenChanged(true)
  }

  override fun onHideCustomView() {
    val view = customView ?: return
    (view.parent as? ViewGroup)?.removeView(view)
    customView = null
    customViewCallback?.onCustomViewHidden()
    customViewCallback = null
    onFullscreenChanged(false)
  }

  override fun onPermissionRequest(request: PermissionRequest) = inner.onPermissionRequest(request)

  override fun getDefaultVideoPoster(): Bitmap? = inner.defaultVideoPoster

  override fun onJsAlert(view: WebView, url: String, message: String, result: JsResult): Boolean =
    inner.onJsAlert(view, url, message, result)

  override fun onJsConfirm(view: WebView, url: String, message: String, result: JsResult): Boolean =
    inner.onJsConfirm(view, url, message, result)

  override fun onJsPrompt(
    view: WebView,
    url: String,
    message: String,
    defaultValue: String,
    result: JsPromptResult,
  ): Boolean = inner.onJsPrompt(view, url, message, defaultValue, result)

  override fun onGeolocationPermissionsShowPrompt(
    origin: String,
    callback: GeolocationPermissions.Callback,
  ) = inner.onGeolocationPermissionsShowPrompt(origin, callback)

  override fun onShowFileChooser(
    webView: WebView,
    filePathCallback: ValueCallback<Array<Uri?>?>,
    fileChooserParams: FileChooserParams,
  ): Boolean = inner.onShowFileChooser(webView, filePathCallback, fileChooserParams)

  override fun onConsoleMessage(consoleMessage: ConsoleMessage): Boolean =
    inner.onConsoleMessage(consoleMessage)

  override fun onReceivedTitle(view: WebView, title: String) = inner.onReceivedTitle(view, title)
}

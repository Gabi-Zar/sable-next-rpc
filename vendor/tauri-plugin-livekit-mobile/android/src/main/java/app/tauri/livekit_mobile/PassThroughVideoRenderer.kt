package app.tauri.livekit_mobile

import android.content.Context
import android.view.MotionEvent
import android.view.View
import io.livekit.android.renderer.TextureViewRenderer

/**
 * Non-interactive remote-video overlay renderer.
 *
 * The overlay is placed above the host WebView and must never intercept its
 * touches. Click/focus flags alone only influence [View.onTouchEvent]; this
 * class guarantees pass-through at dispatch level: [dispatchTouchEvent]
 * returns false for every event, so the parent always falls through to the
 * sibling below (the WebView) regardless of future flag changes.
 *
 * Verified on-device by PassThroughVideoRendererInstrumentedTest.
 */
internal class PassThroughVideoRenderer(context: Context) : TextureViewRenderer(context) {
    init {
        isClickable = false
        isFocusable = false
        isLongClickable = false
        importantForAccessibility = View.IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    override fun dispatchTouchEvent(ev: MotionEvent?): Boolean = false

    override fun onTouchEvent(event: MotionEvent?): Boolean = false
}

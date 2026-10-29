package app.tauri.livekit_mobile

import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.FrameLayout
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import java.util.concurrent.atomic.AtomicBoolean
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

/**
 * On-device verification that the overlay renderer can never intercept
 * WebView touches. These assertions require real Android view dispatch, so
 * under instrumentation (`gradle -p android connectedDebugAndroidTest` on a
 * device/emulator); the JVM unit-test lane cannot instantiate views.
 */
@RunWith(AndroidJUnit4::class)
class PassThroughVideoRendererInstrumentedTest {
    @Test
    fun rendererConsumesNoTouchEventAtDispatchLevel() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val renderer = PassThroughVideoRenderer(instrumentation.targetContext)
            val down = MotionEvent.obtain(0L, 0L, MotionEvent.ACTION_DOWN, 1f, 1f, 0)
            try {
                assertFalse(renderer.dispatchTouchEvent(down))
                assertFalse(renderer.onTouchEvent(down))
            } finally {
                down.recycle()
            }
        }
    }

    @Test
    fun touchFallsThroughOverlayToTheSiblingBelow() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.runOnMainSync {
            val size = 200
            val parent = FrameLayout(instrumentation.targetContext)
            val siblingTouched = AtomicBoolean(false)
            // Stands in for the WebView: the sibling below the overlay.
            val sibling =
                View(instrumentation.targetContext).apply {
                    setOnTouchListener { _, _ ->
                        siblingTouched.set(true)
                        true
                    }
                }
            val overlay = PassThroughVideoRenderer(instrumentation.targetContext)
            parent.addView(sibling, ViewGroup.LayoutParams(size, size))
            parent.addView(overlay, ViewGroup.LayoutParams(size, size))
            parent.layout(0, 0, size, size)

            val down = MotionEvent.obtain(0L, 0L, MotionEvent.ACTION_DOWN, 50f, 50f, 0)
            try {
                assertTrue(parent.dispatchTouchEvent(down))
            } finally {
                down.recycle()
            }
            assertTrue(
                "the sibling below the overlay must receive the touch",
                siblingTouched.get(),
            )
        }
    }
}

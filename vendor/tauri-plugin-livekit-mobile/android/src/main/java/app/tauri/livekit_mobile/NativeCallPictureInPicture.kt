package app.tauri.livekit_mobile

import android.app.Activity
import android.app.PictureInPictureParams
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.ComponentActivity
import androidx.core.app.PictureInPictureModeChangedInfo
import androidx.core.util.Consumer

/**
 * Arms Android picture-in-picture for the active call.
 *
 * The contract mirrors the iOS lane: arming does not enter PiP, it declares
 * that the call keeps showing once the user leaves the app. Android 12 says
 * exactly that with `PictureInPictureParams.setAutoEnterEnabled`, which the
 * system honours on the user-leave hint. Older releases can only enter PiP from
 * `Activity.onUserLeaveHint`, which a Tauri plugin cannot override, so they
 * report the feature unavailable rather than entering PiP off a lifecycle
 * callback that also fires for permission dialogs and screen-off.
 *
 * `Plugin` exposes no PiP lifecycle hook, so the mode transition is read from
 * androidx's [androidx.core.app.OnPictureInPictureModeChangedProvider], which
 * every `ComponentActivity` implements. The host activity must still declare
 * `android:supportsPictureInPicture`, and the `screenSize|smallestScreenSize|
 * screenLayout|orientation` config changes so the PiP resize does not recreate
 * it; without the declaration `setPictureInPictureParams` throws and arming
 * reports failure instead of silently doing nothing.
 */
internal class NativeCallPictureInPicture(
    private val activity: Activity,
    private val onModeChanged: (Boolean) -> Unit,
) {
    private val modeListener =
        Consumer<PictureInPictureModeChangedInfo> { info ->
            handleModeChanged(info.isInPictureInPictureMode)
        }

    private var listening = false

    private var armed = false

    private var inPictureInPicture = false

    /** True while this platform and this activity can auto-enter PiP. */
    val supported: Boolean
        get() =
            Build.VERSION.SDK_INT >= Build.VERSION_CODES.S &&
                activity is ComponentActivity &&
                activity.packageManager.hasSystemFeature(
                    PackageManager.FEATURE_PICTURE_IN_PICTURE,
                )

    /**
     * Arms or disarms auto-enter for the current call. Main thread only.
     * Returns false when the platform cannot do it or the host activity refused
     * the params, so the caller reports a bounded failure rather than letting
     * the JS lane believe PiP is live.
     */
    fun setArmed(enabled: Boolean): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S || !supported) return false
        if (armed == enabled) return true
        val applied =
            runCatching {
                    activity.setPictureInPictureParams(
                        PictureInPictureParams.Builder().setAutoEnterEnabled(enabled).build(),
                    )
                }
                .isSuccess
        if (!applied) return false
        armed = enabled
        if (enabled) startListening()
        return true
    }

    /**
     * Disarms at the end of a call. The listener stays registered while a PiP
     * window is still up, so the exit transition still restores the chrome.
     */
    fun reset() {
        setArmed(false)
    }

    /** Drops the listener for good; the plugin is going away. */
    fun dispose() {
        setArmed(false)
        if (!listening) return
        (activity as? ComponentActivity)?.removeOnPictureInPictureModeChangedListener(modeListener)
        listening = false
    }

    private fun startListening() {
        if (listening) return
        val host = activity as? ComponentActivity ?: return
        host.addOnPictureInPictureModeChangedListener(modeListener)
        listening = true
    }

    private fun handleModeChanged(active: Boolean) {
        if (active == inPictureInPicture) return
        // A PiP session this plugin did not arm is not the call's to dress up.
        if (active && !armed) return
        inPictureInPicture = active
        onModeChanged(active)
    }
}

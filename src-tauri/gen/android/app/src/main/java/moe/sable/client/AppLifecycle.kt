package moe.sable.client

import androidx.annotation.Keep
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner

@Keep
object AppLifecycle : DefaultLifecycleObserver {
  private var observing = false
  private external fun nativeActivityChanged(active: Boolean)

  fun start() {
    if (observing) return
    observing = true
    val lifecycle = ProcessLifecycleOwner.get().lifecycle
    lifecycle.addObserver(this)
    nativeActivityChanged(lifecycle.currentState.isAtLeast(Lifecycle.State.STARTED))
  }

  override fun onStart(owner: LifecycleOwner) = nativeActivityChanged(true)
  override fun onStop(owner: LifecycleOwner) = nativeActivityChanged(false)
}

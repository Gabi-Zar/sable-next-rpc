package app.tauri.livekit_mobile

/**
 * The single permission round trip the plugin is allowed to have in flight.
 *
 * PluginManager keeps one requestPermissionsCallback and one launcher for the
 * whole activity (.tauri/tauri-api PluginManager.requestPermissions), so a
 * second request started while one is pending overwrites the first callback and
 * its invoke never settles. Overlapping requests are refused instead of being
 * silently dropped.
 *
 * Commands and the permission callback both run on the main thread, so this
 * holder is deliberately unsynchronized.
 */
internal class SinglePermissionRequest<T> {
    private var pendingId: Long? = null
    private var pending: T? = null

    /** False when a request is already in flight; the caller has to reject. */
    fun begin(id: Long, request: T): Boolean {
        if (pendingId != null) return false
        pendingId = id
        pending = request
        return true
    }

    /** Hands back and clears the in-flight request when [id] is the one that
     * started it; a callback for anything else is not ours to settle. */
    fun complete(id: Long): T? {
        if (pendingId != id) return null
        return clear()
    }

    /** Drops whatever is in flight, for teardown. */
    fun cancel(): T? = clear()

    private fun clear(): T? {
        val request = pending
        pendingId = null
        pending = null
        return request
    }
}

package app.tauri.livekit_mobile

import io.livekit.android.e2ee.KeyProvider
import java.util.Base64
import java.util.concurrent.ConcurrentHashMap
import livekit.org.webrtc.FrameCryptorFactory
import livekit.org.webrtc.FrameCryptorKeyDerivationAlgorithm
import livekit.org.webrtc.FrameCryptorKeyProvider

/**
 * One decoded key-install request. `key` is raw binary key material; it must
 * never be logged or cross the bridge in a snapshot.
 */
internal class NativeCallKeyMaterial(
    val identity: String,
    val keyIndex: Int,
    key: ByteArray,
) {
    /** Defensive copy so the caller cannot mutate (or zero) our key bytes. */
    val key: ByteArray = key.copyOf()
}

/** Wire-side decoding and the MatrixRTC-interop E2EE constants. */
internal object NativeCallEncryption {
    // MatrixRTC interoperability values (match the JS SDK frame-cryptor options).
    const val RATCHET_SALT = "LKFrameEncryptionKey"
    const val MAGIC_BYTES = "LK-ROCKS"
    const val RATCHET_WINDOW_SIZE = 10
    const val KEY_RING_SIZE = 256

    /** Validates and decodes one wire entry; null when the entry is invalid. */
    fun decodeEntry(
        identity: String,
        keyIndex: Int,
        encodedKey: String,
    ): NativeCallKeyMaterial? {
        if (identity.isBlank() || keyIndex < 0) return null
        val bytes =
            try {
                Base64.getDecoder().decode(encodedKey)
            } catch (_: IllegalArgumentException) {
                return null
            }
        if (bytes.isEmpty()) return null
        return NativeCallKeyMaterial(identity, keyIndex, bytes)
    }
}

/**
 * The key index most recently installed for each identity. Thread-safe because
 * LiveKit reads it via getLatestKeyIndex off the bridge thread while installs
 * happen on it.
 */
internal class LatestKeyIndexes {
    private val latest = ConcurrentHashMap<String, Int>()

    fun record(identity: String, keyIndex: Int) {
        latest[identity] = keyIndex
    }

    fun latestFor(identity: String): Int? = latest[identity]
}

/**
 * Per-call, non-shared E2EE key provider with MatrixRTC interoperability
 * parameters (HKDF derivation, salt `LKFrameEncryptionKey`, magic bytes
 * `LK-ROCKS`, ratchet window 10, key ring 256).
 *
 * Keys are raw binary and are installed exclusively through the public
 * underlying [FrameCryptorKeyProvider] ByteArray setter; the String-based
 * mutators of the interface stay unused because String conversion corrupts
 * binary key material. A fresh instance is created per call; [destroy] zeroes
 * every stored JVM copy of key bytes and disposes the native provider.
 */
internal class NativeCallE2EEKeys : KeyProvider {
    private val latestIndexes = LatestKeyIndexes()
    private val keyCopies = ArrayList<ByteArray>()

    override val rtcKeyProvider: FrameCryptorKeyProvider =
        FrameCryptorFactory.createFrameCryptorKeyProvider(
            /* enableSharedKey = */ false,
            NativeCallEncryption.RATCHET_SALT.toByteArray(Charsets.UTF_8),
            NativeCallEncryption.RATCHET_WINDOW_SIZE,
            NativeCallEncryption.MAGIC_BYTES.toByteArray(Charsets.UTF_8),
            /* failureTolerance = */ -1,
            NativeCallEncryption.KEY_RING_SIZE,
            /* discardFrameWhenCryptorNotReady = */ false,
            FrameCryptorKeyDerivationAlgorithm.HKDF,
        )

    /** This provider is per-call and never shared. */
    override var enableSharedKey: Boolean = false

    /**
     * Installs a key into the sender's ring slot. Every key is installed, never
     * filtered: an index selects a slot in that identity's key ring and the
     * sender writes it into each frame, so we must hold whatever the sender
     * last put there. Indexes are not monotonic - they are reused modulo the
     * ring size, and a peer that rejoins restarts its outbound session at 0 -
     * so rejecting a lower index strands every frame that peer sends after it.
     *
     * May throw when the underlying JNI layer is unavailable.
     */
    fun install(material: NativeCallKeyMaterial) {
        rtcKeyProvider.setKey(material.identity, material.keyIndex, material.key)
        latestIndexes.record(material.identity, material.keyIndex)
        keyCopies.add(material.key)
    }

    /**
     * The index LiveKit stamps onto outgoing frames for this identity, and 0
     * when nothing was installed yet, mirroring BaseKeyProvider.
     */
    override fun getLatestKeyIndex(participantId: String): Int =
        latestIndexes.latestFor(participantId) ?: 0

    /** Zeroes every JVM copy of decoded key bytes and releases the native provider. */
    fun destroy() {
        keyCopies.forEach { it.fill(0) }
        keyCopies.clear()
        runCatching { rtcKeyProvider.dispose() }
    }

    // Raw binary keys only: the String-based setters are never wired to the
    // bridge, and String conversion would corrupt binary key material.
    override fun setKey(key: String, participantId: String?, index: Int?) = Unit

    override fun setSharedKey(key: String, index: Int?): Boolean = false

    override fun ratchetSharedKey(index: Int?): ByteArray =
        rtcKeyProvider.ratchetSharedKey(index ?: 0)

    override fun exportSharedKey(index: Int?): ByteArray =
        rtcKeyProvider.exportSharedKey(index ?: 0)

    override fun ratchetKey(participantId: String, index: Int?): ByteArray =
        rtcKeyProvider.ratchetKey(participantId, index ?: 0)

    override fun exportKey(participantId: String, index: Int?): ByteArray =
        rtcKeyProvider.exportKey(participantId, index ?: 0)

    override fun setSifTrailer(trailer: ByteArray) = rtcKeyProvider.setSifTrailer(trailer)
}

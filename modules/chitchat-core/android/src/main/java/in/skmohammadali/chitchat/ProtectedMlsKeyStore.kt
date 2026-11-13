package in.skmohammadali.chitchat

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.io.File
import java.io.FileOutputStream
import java.security.KeyStore
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Wraps a random 256-bit MLS database key with a non-exportable Android
 * Keystore AES-GCM key. The raw database key is returned only to the Kotlin
 * module for immediate injection into Rust, never to JavaScript.
 */
internal class ProtectedMlsKeyStore(private val context: Context) {
  private val alias = "in.skmohammadali.chitchat.mls.wrap.v1"
  private val blobFile = File(context.noBackupFilesDir, "chitchat/mls-storage-key.v1")
  private val random = SecureRandom()

  @Synchronized
  fun loadOrCreate(): ByteArray {
    blobFile.parentFile?.mkdirs()
    val wrappingKey = getOrCreateWrappingKey()
    if (blobFile.exists()) {
      val blob = blobFile.readBytes()
      require(blob.size in 29..128) { "Protected MLS key record is malformed." }
      val iv = blob.copyOfRange(0, 12)
      val ciphertext = blob.copyOfRange(12, blob.size)
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, wrappingKey, GCMParameterSpec(128, iv))
      return cipher.doFinal(ciphertext).also {
        require(it.size == 32) { "Protected MLS storage key has an invalid length." }
      }
    }

    val storageKey = ByteArray(32).also(random::nextBytes)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, wrappingKey)
    val iv = cipher.iv
    require(iv.size == 12) { "Android Keystore returned an unexpected GCM nonce." }
    val ciphertext = cipher.doFinal(storageKey)
    val temp = File(blobFile.parentFile, blobFile.name + ".tmp")
    FileOutputStream(temp).use { stream ->
      stream.write(iv)
      stream.write(ciphertext)
      stream.fd.sync()
    }
    if (!temp.renameTo(blobFile)) {
      temp.delete()
      storageKey.fill(0)
      throw IllegalStateException("Could not persist the protected MLS key record.")
    }
    blobFile.setReadable(false, false)
    blobFile.setReadable(true, true)
    return storageKey
  }

  @Synchronized
  fun deleteWrappedKey() {
    blobFile.delete()
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    if (store.containsAlias(alias)) store.deleteEntry(alias)
  }

  private fun getOrCreateWrappingKey(): SecretKey {
    val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = store.getKey(alias, null) as? SecretKey
    if (existing != null) return existing

    val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
    generator.init(
      KeyGenParameterSpec.Builder(
        alias,
        KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT,
      )
        .setKeySize(256)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
        .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
        .setRandomizedEncryptionRequired(true)
        .setUserAuthenticationRequired(false)
        .build(),
    )
    return generator.generateKey()
  }
}

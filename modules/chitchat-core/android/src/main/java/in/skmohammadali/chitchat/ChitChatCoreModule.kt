package in.skmohammadali.chitchat

import android.net.Uri
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import uniffi.chitchat_core.ChitChatMlsBridge
import uniffi.chitchat_core.validateEnvelopeJson
import uniffi.chitchat_core.validateProfileJson
import java.io.File
import java.util.UUID

class ChitChatCoreModule : Module() {
  private var bridge: ChitChatMlsBridge? = null

  override fun definition() = ModuleDefinition {
    Name("ChitChatCore")

    AsyncFunction("openProtectedStorage") { ->
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android application context is unavailable.")
      if (bridge?.isReady() == true) return@AsyncFunction true

      val databaseDirectory = File(context.noBackupFilesDir, "chitchat")
      if (!databaseDirectory.exists() && !databaseDirectory.mkdirs()) {
        throw IllegalStateException("Could not create the protected MLS database directory.")
      }
      val storageKey = ProtectedMlsKeyStore(context).loadOrCreate()
      try {
        bridge = ChitChatMlsBridge.open(
          File(databaseDirectory, "openmls.sqlite").absolutePath,
          storageKey.map { it.toUByte() },
        )
      } finally {
        storageKey.fill(0)
      }
      bridge?.isReady() == true
    }

    Function("isProtectedStorageReady") { ->
      bridge?.isReady() == true
    }

    AsyncFunction("closeProtectedStorage") { ->
      bridge?.lock()
      bridge = null
      true
    }

    AsyncFunction("validateProfile") { payload: String ->
      validateProfileJson(payload)
      true
    }

    AsyncFunction("validateEnvelope") { payload: String ->
      validateEnvelopeJson(payload)
      true
    }

    AsyncFunction("generateKeyPackage") { identity: String ->
      requireBridge().generateKeyPackage(identity)
    }

    AsyncFunction("createGroup") { identity: String ->
      requireBridge().createGroup(identity)
    }

    AsyncFunction("addMember") { groupId: String, keyPackageBase64: String ->
      requireBridge().addMember(groupId, keyPackageBase64)
    }

    AsyncFunction("joinGroup") { welcomeBase64: String ->
      requireBridge().joinGroup(welcomeBase64)
    }

    AsyncFunction("encryptContent") { groupId: String, contentJson: String ->
      requireBridge().encryptContent(groupId, contentJson)
    }

    AsyncFunction("processMessage") { groupId: String, wireBase64: String, allowControlMessages: Boolean ->
      requireBridge().processMessage(groupId, wireBase64, allowControlMessages)
    }

    AsyncFunction("currentEpoch") { groupId: String ->
      requireBridge().currentEpoch(groupId).toString()
    }

    AsyncFunction("rotateOwnLeaf") { groupId: String ->
      requireBridge().rotateOwnLeaf(groupId)
    }

    AsyncFunction("removeMember") { groupId: String, leafIndex: Int ->
      requireBridge().removeMember(groupId, leafIndex.toUInt())
    }

    AsyncFunction("encryptMediaFile") { uri: String, groupId: String, mediaKind: String, concealed: Boolean ->
      require(uri.startsWith("content://") || uri.startsWith("file://")) { "A local Android file URI is required." }
      require(mediaKind in listOf("image", "video", "audio", "file")) { "Unsupported media kind." }
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android application context is unavailable.")
      val bytes = context.contentResolver.openInputStream(Uri.parse(uri))?.use { input ->
        input.readBytes()
      } ?: throw IllegalArgumentException("The selected media file could not be opened.")
      require(bytes.isNotEmpty() && bytes.size <= 50 * 1024 * 1024) { "Media must be between 1 byte and 50 MB." }
      val objectId = UUID.randomUUID().toString()
      requireBridge().encryptMediaAndWrap(
        groupId,
        objectId,
        bytes.map { it.toUByte() },
        mediaKind,
        concealed,
      )
    }

    AsyncFunction("decryptMediaFile") {
      contentJson: String,
      objectId: String,
      ciphertextBase64: String,
      expectedSha256: String,
      cryptoVersion: Int,
      mediaKind: String ->
      val plaintextBase64 = requireBridge().decryptMediaFromContent(
        contentJson,
        objectId,
        ciphertextBase64,
        expectedSha256,
        cryptoVersion.toUInt(),
        mediaKind,
      )
      val plaintext = Base64.decode(
        plaintextBase64,
        Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP,
      )
      val context = appContext.reactContext
        ?: throw IllegalStateException("Android application context is unavailable.")
      val output = File(context.cacheDir, "chitchat-" + UUID.randomUUID().toString() + ".private")
      output.writeBytes(plaintext)
      output.setReadable(false, false)
      output.setReadable(true, true)
      Uri.fromFile(output).toString()
    }
  }

  private fun requireBridge(): ChitChatMlsBridge {
    val current = bridge ?: throw IllegalStateException("Protected MLS storage is closed.")
    check(current.isReady()) { "Protected MLS storage is locked." }
    return current
  }
}

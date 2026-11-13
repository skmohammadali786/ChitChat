import ExpoModulesCore
import Foundation
import Security

public final class ChitChatCoreModule: Module {
  private var bridge: ChitChatMlsBridge?

  public func definition() -> ModuleDefinition {
    Name("ChitChatCore")

    AsyncFunction("openProtectedStorage") { () throws -> Bool in
      if self.bridge?.isReady() == true { return true }

      let fileManager = FileManager.default
      let appSupport = try fileManager.url(
        for: .applicationSupportDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let databaseDirectory = appSupport.appendingPathComponent("ChitChat", isDirectory: true)
      try fileManager.createDirectory(
        at: databaseDirectory,
        withIntermediateDirectories: true,
        attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication]
      )
      let databaseURL = databaseDirectory.appendingPathComponent("openmls.sqlite")
      let storageKey = try ProtectedMlsKeyStore().loadOrCreate()
      self.bridge = try ChitChatMlsBridge.open(
        databasePath: databaseURL.path,
        storageKey: Array(storageKey)
      )
      return self.bridge?.isReady() == true
    }

    Function("isProtectedStorageReady") {
      self.bridge?.isReady() ?? false
    }

    AsyncFunction("closeProtectedStorage") { () throws -> Bool in
      try self.bridge?.lock()
      self.bridge = nil
      return true
    }

    AsyncFunction("validateProfile") { (payload: String) throws -> Bool in
      try validateProfileJson(payload: payload)
      return true
    }

    AsyncFunction("validateEnvelope") { (payload: String) throws -> Bool in
      try validateEnvelopeJson(payload: payload)
      return true
    }

    AsyncFunction("generateKeyPackage") { (identity: String) throws -> String in
      try self.requireBridge().generateKeyPackage(identity: identity)
    }

    AsyncFunction("createGroup") { (identity: String) throws -> String in
      try self.requireBridge().createGroup(identity: identity)
    }

    AsyncFunction("addMember") { (groupId: String, keyPackageBase64: String) throws -> String in
      try self.requireBridge().addMember(groupId: groupId, keyPackageBase64: keyPackageBase64)
    }

    AsyncFunction("joinGroup") { (welcomeBase64: String) throws -> String in
      try self.requireBridge().joinGroup(welcomeBase64: welcomeBase64)
    }

    AsyncFunction("encryptContent") { (groupId: String, contentJson: String) throws -> String in
      try self.requireBridge().encryptContent(groupId: groupId, contentJson: contentJson)
    }

    AsyncFunction("processMessage") { (groupId: String, wireBase64: String, allowControlMessages: Bool) throws -> String in
      try self.requireBridge().processMessage(
        groupId: groupId,
        wireBase64: wireBase64,
        allowControlMessages: allowControlMessages
      )
    }

    AsyncFunction("currentEpoch") { (groupId: String) throws -> String in
      String(try self.requireBridge().currentEpoch(groupId: groupId))
    }

    AsyncFunction("rotateOwnLeaf") { (groupId: String) throws -> String in
      try self.requireBridge().rotateOwnLeaf(groupId: groupId)
    }

    AsyncFunction("removeMember") { (groupId: String, leafIndex: UInt32) throws -> String in
      try self.requireBridge().removeMember(groupId: groupId, leafIndex: leafIndex)
    }

    AsyncFunction("encryptMediaFile") {
      (uri: String, groupId: String, mediaKind: String, concealed: Bool) throws -> String in
      guard let fileURL = URL(string: uri), fileURL.isFileURL else {
        throw NSError(domain: "ChitChatMedia", code: 2, userInfo: [
          NSLocalizedDescriptionKey: "A local iOS file URI is required.",
        ])
      }
      guard ["image", "video", "audio", "file"].contains(mediaKind) else {
        throw NSError(domain: "ChitChatMedia", code: 3, userInfo: [
          NSLocalizedDescriptionKey: "Unsupported media kind.",
        ])
      }
      let accessed = fileURL.startAccessingSecurityScopedResource()
      defer { if accessed { fileURL.stopAccessingSecurityScopedResource() } }
      let plaintext = try Data(contentsOf: fileURL, options: [.mappedIfSafe])
      guard !plaintext.isEmpty && plaintext.count <= 50 * 1024 * 1024 else {
        throw NSError(domain: "ChitChatMedia", code: 4, userInfo: [
          NSLocalizedDescriptionKey: "Media must be between 1 byte and 50 MB.",
        ])
      }
      try self.requireBridge().encryptMediaAndWrap(
        groupId: groupId,
        objectId: UUID().uuidString.lowercased(),
        plaintext: Array(plaintext),
        mediaKind: mediaKind,
        concealed: concealed
      )
    }

    AsyncFunction("decryptMediaFile") {
      (contentJson: String,
       objectId: String,
       ciphertextBase64: String,
       expectedSha256: String,
       cryptoVersion: UInt32,
       mediaKind: String) throws -> String in
      let plaintextBase64 = try self.requireBridge().decryptMediaFromContent(
        contentJson: contentJson,
        objectId: objectId,
        ciphertextBase64: ciphertextBase64,
        expectedSha256: expectedSha256,
        cryptoVersion: cryptoVersion,
        mediaKind: mediaKind
      )
      guard let plaintext = Self.decodeBase64URL(plaintextBase64) else {
        throw NSError(domain: "ChitChatMedia", code: 5, userInfo: [
          NSLocalizedDescriptionKey: "Rust returned invalid decrypted media bytes.",
        ])
      }
      let cacheDirectory = try FileManager.default.url(
        for: .cachesDirectory,
        in: .userDomainMask,
        appropriateFor: nil,
        create: true
      )
      let output = cacheDirectory.appendingPathComponent("chitchat-\(UUID().uuidString).private")
      try plaintext.write(to: output, options: [.atomic, .completeFileProtection])
      return output.absoluteString
    }
  }

  private func requireBridge() throws -> ChitChatMlsBridge {
    guard let bridge = bridge, bridge.isReady() else {
      throw NSError(domain: "ChitChatProtectedStorage", code: 6, userInfo: [
        NSLocalizedDescriptionKey: "Protected MLS storage is closed or locked.",
      ])
    }
    return bridge
  }

  private static func decodeBase64URL(_ value: String) -> Data? {
    var standard = value.replacingOccurrences(of: "-", with: "+")
      .replacingOccurrences(of: "_", with: "/")
    let remainder = standard.count % 4
    if remainder != 0 { standard += String(repeating: "=", count: 4 - remainder) }
    return Data(base64Encoded: standard)
  }
}

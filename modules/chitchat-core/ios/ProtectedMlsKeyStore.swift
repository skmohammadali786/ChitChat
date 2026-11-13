import Foundation
import Security

/// Stores the random MLS database key as a device-only Keychain item.
/// The key is never written to files, preferences, logs, or JavaScript.
final class ProtectedMlsKeyStore {
  private let service = "in.skmohammadali.chitchat"
  private let account = "mls-storage-key-v1"

  func loadOrCreate() throws -> Data {
    var query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
      kSecReturnData as String: true,
      kSecMatchLimit as String: kSecMatchLimitOne,
    ]
    var result: CFTypeRef?
    let status = SecItemCopyMatching(query as CFDictionary, &result)
    if status == errSecSuccess, let data = result as? Data {
      guard data.count == 32 else {
        throw NSError(domain: "ChitChatProtectedStorage", code: 1, userInfo: [
          NSLocalizedDescriptionKey: "The Keychain MLS key has an invalid length.",
        ])
      }
      return data
    }
    guard status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }

    var bytes = Data(count: 32)
    let randomStatus = bytes.withUnsafeMutableBytes { buffer in
      SecRandomCopyBytes(kSecRandomDefault, 32, buffer.baseAddress!)
    }
    guard randomStatus == errSecSuccess else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(randomStatus))
    }

    query.removeValue(forKey: kSecReturnData as String)
    query.removeValue(forKey: kSecMatchLimit as String)
    query[kSecValueData as String] = bytes
    query[kSecAttrAccessible as String] = kSecAttrAccessibleWhenUnlockedThisDeviceOnly
    let addStatus = SecItemAdd(query as CFDictionary, nil)
    guard addStatus == errSecSuccess else {
      bytes.resetBytes(in: 0..<bytes.count)
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(addStatus))
    }
    return bytes
  }

  func delete() throws {
    let query: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: service,
      kSecAttrAccount as String: account,
    ]
    let status = SecItemDelete(query as CFDictionary)
    guard status == errSecSuccess || status == errSecItemNotFound else {
      throw NSError(domain: NSOSStatusErrorDomain, code: Int(status))
    }
  }
}

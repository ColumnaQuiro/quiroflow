import Foundation
import Security

// The home-screen widget's snapshot (utils/homeWidget.ts), handed from the
// app to the widget extension through one keychain item in a group both
// targets share (keychain-access-groups in each .entitlements). A keychain
// group, not an App Group, because a team's keychain groups need nothing
// registered in the developer portal. Compiled into both targets.
enum SharedSnapshot {
    static let accessGroup = "N5TP24Q7MW.com.quiroflow.shared"
    private static let service = "com.quiroflow.widget"
    private static let account = "snapshot"

    private static var query: [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    @discardableResult
    static func write(_ data: Data) -> Bool {
        SecItemDelete(query as CFDictionary)
        var item = query
        item[kSecValueData as String] = data
        // Readable while the phone is locked, once it has been unlocked since
        // boot: a widget redraws on the lock screen and the home screen.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    static func read() -> Data? {
        var q = query
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    static func clear() {
        SecItemDelete(query as CFDictionary)
    }
}

import Foundation
import Security

// The home-screen widget's snapshot (utils/homeWidget.ts), handed from the
// app to the widget extension through one keychain item in a group both
// targets share (keychain-access-groups in each .entitlements). A keychain
// group, not an App Group, because a team's keychain groups need nothing
// registered in the developer portal. Compiled into both targets.
//
// A second item, "refresh", holds what the widget needs to fetch the
// snapshot itself while the app is closed (QuiroFlowWidgets.swift): the
// endpoint, the clinic, the person's language and privacy mode, and a widget
// token. The extension writes the snapshot too, once it has fetched one.
enum SharedSnapshot {
    static let accessGroup = "N5TP24Q7MW.com.quiroflow.shared"
    private static let service = "com.quiroflow.widget"

    private static func query(_ account: String) -> [String: Any] {
        [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecAttrAccessGroup as String: accessGroup,
        ]
    }

    @discardableResult
    private static func write(_ data: Data, account: String) -> Bool {
        SecItemDelete(query(account) as CFDictionary)
        var item = query(account)
        item[kSecValueData as String] = data
        // Readable while the phone is locked, once it has been unlocked since
        // boot: a widget redraws on the lock screen and the home screen.
        item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        return SecItemAdd(item as CFDictionary, nil) == errSecSuccess
    }

    private static func read(account: String) -> Data? {
        var q = query(account)
        q[kSecReturnData as String] = true
        q[kSecMatchLimit as String] = kSecMatchLimitOne
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess else { return nil }
        return out as? Data
    }

    @discardableResult
    static func write(_ data: Data) -> Bool { write(data, account: "snapshot") }
    static func read() -> Data? { read(account: "snapshot") }
    static func clear() { SecItemDelete(query("snapshot") as CFDictionary) }

    @discardableResult
    static func writeRefresh(_ data: Data) -> Bool { write(data, account: "refresh") }
    static func readRefresh() -> Data? { read(account: "refresh") }
    static func clearRefresh() { SecItemDelete(query("refresh") as CFDictionary) }
}

/// What the widget needs to fetch its own snapshot (useHomeWidget.ts's
/// WidgetRefresh). No token: the app has not been given one yet, and the
/// widget waits for the app as it always did.
struct WidgetRefreshConfig: Codable {
    let url: String
    let accountId: String
    let timeZone: String
    let lang: String
    let privacy: Bool
    let token: String?

    static func load() -> WidgetRefreshConfig? {
        SharedSnapshot.readRefresh().flatMap { try? JSONDecoder().decode(WidgetRefreshConfig.self, from: $0) }
    }

    func save() {
        if let data = try? JSONEncoder().encode(self) { SharedSnapshot.writeRefresh(data) }
    }
}

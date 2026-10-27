import Capacitor
import WidgetKit

// "HomeWidget" for the web app (mobile/composables/useHomeWidget.ts): keeps
// the widget's snapshot, and what the widget needs to fetch it itself, and
// asks WidgetKit to redraw. Registered in
// MainViewController -- a plugin in the app's own target, not a package.
@objc(HomeWidgetPlugin)
public class HomeWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeWidgetPlugin"
    public let jsName = "HomeWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "setRefresh", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    // A keychain item outlives the app: deleted and reinstalled, it would
    // still hand the widget the last person's snapshot and widget token,
    // before anyone has signed in. UserDefaults does not survive the delete,
    // so a first launch without its flag starts the widget from nothing. (An
    // update to this build lacks the flag too and wipes once; the app writes
    // a fresh snapshot as soon as it opens.)
    override public func load() {
        let key = "homeWidgetKeychainOwned"
        if !UserDefaults.standard.bool(forKey: key) {
            SharedSnapshot.clear()
            SharedSnapshot.clearRefresh()
            UserDefaults.standard.set(true, forKey: key)
        }
    }

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("json is required")
            return
        }
        SharedSnapshot.write(data)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    /// Where and how the widget fetches its own snapshot. A call without a
    /// token keeps the one already there (the settings change more often
    /// than the session does) and reports whether there is one.
    @objc func setRefresh(_ call: CAPPluginCall) {
        guard let url = call.getString("url"), let accountId = call.getString("accountId") else {
            call.reject("url and accountId are required")
            return
        }
        let config = WidgetRefreshConfig(
            url: url,
            accountId: accountId,
            timeZone: call.getString("timeZone") ?? "Europe/Madrid",
            lang: call.getString("lang") ?? "es",
            privacy: call.getBool("privacy") ?? false,
            token: call.getString("token") ?? WidgetRefreshConfig.load()?.token
        )
        config.save()
        call.resolve(["hasToken": config.token != nil])
    }

    @objc func clear(_ call: CAPPluginCall) {
        SharedSnapshot.clear()
        SharedSnapshot.clearRefresh()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

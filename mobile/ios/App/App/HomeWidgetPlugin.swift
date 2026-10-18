import Capacitor
import WidgetKit

// "HomeWidget" for the web app (mobile/composables/useHomeWidget.ts): keeps
// the widget's snapshot and asks WidgetKit to redraw. Registered in
// MainViewController -- a plugin in the app's own target, not a package.
@objc(HomeWidgetPlugin)
public class HomeWidgetPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HomeWidgetPlugin"
    public let jsName = "HomeWidget"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "setSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "clear", returnType: CAPPluginReturnPromise),
    ]

    @objc func setSnapshot(_ call: CAPPluginCall) {
        guard let json = call.getString("json"), let data = json.data(using: .utf8) else {
            call.reject("json is required")
            return
        }
        SharedSnapshot.write(data)
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }

    @objc func clear(_ call: CAPPluginCall) {
        SharedSnapshot.clear()
        WidgetCenter.shared.reloadAllTimelines()
        call.resolve()
    }
}

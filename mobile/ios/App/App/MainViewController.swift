import Capacitor

// The app's web view (Main.storyboard), with the app's own native plugins
// registered: Capacitor finds packaged plugins by itself, but one that lives
// in the app target has to be handed over here.
class MainViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(HomeWidgetPlugin())
    }
}

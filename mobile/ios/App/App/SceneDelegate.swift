import UIKit

// iOS 27's SDK requires apps to adopt the UIScene life cycle -- without this
// (and the matching UIApplicationSceneManifest in Info.plist), a build made
// with the iOS 27 SDK fails to launch at all with "Application failed to
// launch: UIScene life cycle is required for apps built with this SDK."
// Xcode Cloud's default toolchain moved to Xcode 27 once Apple shipped it
// (14 Sep 2026), so every push to main since then archived against the
// iOS 27 SDK and produced a build that crashes for every user on launch.
//
// Info.plist's UISceneConfigurations entry points UISceneStoryboardFile at
// Main.storyboard, so UIKit instantiates that storyboard's root view
// controller (CAPBridgeViewController) into `window` before
// scene(_:willConnectTo:options:) runs -- nothing else needs to happen here.
class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    }

    func sceneDidDisconnect(_ scene: UIScene) {
    }

    func sceneWillEnterForeground(_ scene: UIScene) {
    }

    func sceneDidBecomeActive(_ scene: UIScene) {
    }

    func sceneWillResignActive(_ scene: UIScene) {
    }

    func sceneDidEnterBackground(_ scene: UIScene) {
    }

}

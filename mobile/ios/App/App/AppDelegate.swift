import UIKit
import Capacitor
import FirebaseCore
import WidgetKit

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        FirebaseApp.configure()
        #if DEBUG
        // Debug builds only: `-WidgetDemo staff|patient` fills the home-screen
        // widget with an invented snapshot, to look at it in the simulator
        // without signing in. Compiled out of every App Store build.
        if let i = CommandLine.arguments.firstIndex(of: "-WidgetDemo") {
            let kind = i + 1 < CommandLine.arguments.count ? CommandLine.arguments[i + 1] : "staff"
            let now = Date()
            let iso = ISO8601DateFormatter()
            let at = { (m: Double) in iso.string(from: now.addingTimeInterval(m * 60)) }
            let json = kind == "patient"
                ? #"{"kind":"patient","updatedAt":"\#(iso.string(from: now))","clinic":"Clínica Demo","next":{"at":"\#(at(2880))","label":"jue, 23 oct · 10:30","what":"Ajuste","who":"Dra. Marta Ruiz"},"bono":{"name":"Bono 10","left":6,"total":10}}"#
                : #"{"kind":"staff","updatedAt":"\#(iso.string(from: now))","who":"Dra. Marta Ruiz","remaining":4,"done":5,"arrived":1,"next":[{"at":"\#(at(-5))","time":"12:00","name":"Andrés Vidal","what":"Ajuste","arrived":true},{"at":"\#(at(25))","time":"12:30","name":"Carmen Ortiz","what":"Ajuste","arrived":false},{"at":"\#(at(55))","time":"13:00","name":"Lucía Navarro","what":"Revisión","arrived":false},{"at":"\#(at(85))","time":"13:30","name":"Javi Moreno","what":"Primera visita","arrived":false}]}"#
            SharedSnapshot.write(Data(json.utf8))
            WidgetCenter.shared.reloadAllTimelines()
        }
        #endif
        return true
    }

    // Forwards native push-registration events to @capacitor-firebase/messaging,
    // which does the APNs<->FCM token exchange via the Firebase SDK internally.
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        NotificationCenter.default.post(name: .capacitorDidRegisterForRemoteNotifications, object: deviceToken)
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        NotificationCenter.default.post(name: .capacitorDidFailToRegisterForRemoteNotifications, object: error)
    }

    func application(_ application: UIApplication, didReceiveRemoteNotification userInfo: [AnyHashable: Any], fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void) {
        NotificationCenter.default.post(name: Notification.Name.init("didReceiveRemoteNotification"), object: completionHandler, userInfo: userInfo)
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

    // MARK: UISceneSession Lifecycle

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        return UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
    }

    func application(_ application: UIApplication, didDiscardSceneSessions sceneSessions: Set<UISceneSession>) {
    }

}

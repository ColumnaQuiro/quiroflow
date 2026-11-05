import Capacitor
import CoreLocation
import UserNotifications

// "HabitReminders" for the web app (mobile/composables/useHabitReminders.ts):
// "Mis hábitos" as local notifications. Registered in MainViewController -- a
// plugin in the app's own target, not a package. The scheduling itself is
// HabitScheduler below, which AppDelegate also starts at launch: a region
// event can relaunch the app in the background with no web view at all, and
// it still has to schedule or cancel that place's reminders.
@objc(HabitRemindersPlugin)
public class HabitRemindersPlugin: CAPPlugin, CAPBridgedPlugin, NotificationHandlerProtocol {
    public let identifier = "HabitRemindersPlugin"
    public let jsName = "HabitReminders"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "schedule", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "checkPermissions", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestNotifications", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestLocationAlways", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "currentPosition", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "takePendingCheckins", returnType: CAPPluginReturnPromise),
    ]

    override public func load() {
        // Push notifications (Firebase) keep Capacitor's push slot; local
        // ones -- only ours, in this app -- come here.
        bridge?.notificationRouter.localNotificationHandler = self
        HabitScheduler.shared.start()
    }

    @objc func schedule(_ call: CAPPluginCall) {
        guard let habits = call.getArray("habits") as? [[String: Any]], let places = call.getArray("places") as? [[String: Any]] else {
            call.reject("habits and places are required")
            return
        }
        do {
            let data = try JSONSerialization.data(withJSONObject: ["habits": habits, "places": places])
            let config = try JSONDecoder().decode(HabitConfig.self, from: data)
            HabitScheduler.shared.apply(config) { call.resolve() }
        } catch {
            call.reject("Could not read the habits: \(error.localizedDescription)")
        }
    }

    @objc override public func checkPermissions(_ call: CAPPluginCall) {
        HabitScheduler.shared.permissions { notifications, location in
            call.resolve(["notifications": notifications, "location": location])
        }
    }

    @objc func requestNotifications(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge]) { _, _ in
            HabitScheduler.shared.permissions { notifications, _ in call.resolve(["notifications": notifications]) }
        }
    }

    @objc func requestLocationAlways(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            HabitScheduler.shared.requestAlways { location in call.resolve(["location": location]) }
        }
    }

    @objc func currentPosition(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            HabitScheduler.shared.currentPosition { result in
                switch result {
                case .success(let loc): call.resolve(["lat": loc.coordinate.latitude, "lng": loc.coordinate.longitude])
                case .failure(let error): call.reject(error.localizedDescription)
                }
            }
        }
    }

    @objc func takePendingCheckins(_ call: CAPPluginCall) {
        call.resolve(["checkins": HabitScheduler.shared.takePendingCheckins()])
    }

    // MARK: NotificationHandlerProtocol

    public func willPresent(notification: UNNotification) -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    public func didReceive(response: UNNotificationResponse) {
        let info = response.notification.request.content.userInfo
        switch response.actionIdentifier {
        case HabitScheduler.doneAction:
            HabitScheduler.shared.recordDone(info)
        case HabitScheduler.snoozeAction:
            HabitScheduler.shared.snooze(response.notification.request.content)
        default:
            // Opened from the notification: Cuidarme (useHabitReminders).
            notifyListeners("habitOpened", data: ["habitId": info["habitId"] as? String ?? ""], retainUntilConsumed: true)
        }
    }
}

struct HabitConfig: Codable {
    struct Habit: Codable {
        let id: String
        let kind: String
        let title: String
        let body: String
        let times: [String]
        /// ISO weekdays, 1 = Monday ... 7 = Sunday.
        let weekdays: [Int]
        let placeIds: [String]
    }
    struct Place: Codable {
        let id: String
        let lat: Double
        let lng: Double
        let radius: Double
    }
    let habits: [Habit]
    let places: [Place]
}

/// Schedules the reminders. Habits without places repeat on the calendar.
/// Habits with places are scheduled for today and tomorrow while the phone
/// is inside one of them (region monitoring) and removed when it leaves --
/// or, without location "Always", fall back to repeating by time.
final class HabitScheduler: NSObject, CLLocationManagerDelegate {
    static let shared = HabitScheduler()
    static let category = "HABIT"
    static let doneAction = "HABIT_DONE"
    static let snoozeAction = "HABIT_SNOOZE"
    private static let prefix = "habit."
    private static let regionPrefix = "place."
    private let configKey = "habitReminders.config"
    private let insideKey = "habitReminders.inside"
    private let pendingKey = "habitReminders.pending"

    private let manager = CLLocationManager()
    private let center = UNUserNotificationCenter.current()
    private var started = false
    private var positionCallbacks: [(Result<CLLocation, Error>) -> Void] = []
    private var authCallbacks: [(String) -> Void] = []

    func start() {
        guard !started else { return }
        started = true
        manager.delegate = self
        let done = UNNotificationAction(identifier: Self.doneAction, title: "Hecho", options: [])
        let snooze = UNNotificationAction(identifier: Self.snoozeAction, title: "En 15 min", options: [])
        center.setNotificationCategories([UNNotificationCategory(identifier: Self.category, actions: [done, snooze], intentIdentifiers: [], options: [])])
    }

    // MARK: Config

    private var config: HabitConfig? {
        get {
            guard let data = UserDefaults.standard.data(forKey: configKey) else { return nil }
            return try? JSONDecoder().decode(HabitConfig.self, from: data)
        }
        set { UserDefaults.standard.set(try? JSONEncoder().encode(newValue), forKey: configKey) }
    }

    private var inside: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: insideKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue), forKey: insideKey) }
    }

    private var always: Bool { manager.authorizationStatus == .authorizedAlways }

    func apply(_ config: HabitConfig, completion: @escaping () -> Void) {
        start()
        self.config = config
        DispatchQueue.main.async {
            self.syncRegions()
            self.rescheduleAll(completion: completion)
        }
    }

    // MARK: Scheduling

    private func rescheduleAll(completion: (() -> Void)? = nil) {
        center.getPendingNotificationRequests { pending in
            let ours = pending.map(\.identifier).filter { $0.hasPrefix(Self.prefix) && !$0.contains(".s.") }
            self.center.removePendingNotificationRequests(withIdentifiers: ours)
            guard let config = self.config else { completion?(); return }
            for habit in config.habits where habit.placeIds.isEmpty || !self.always {
                self.scheduleRepeating(habit)
            }
            self.scheduleAtPlaces(config)
            completion?()
        }
    }

    private func content(for habit: HabitConfig.Habit) -> UNMutableNotificationContent {
        let content = UNMutableNotificationContent()
        content.title = habit.title
        content.body = habit.body
        content.sound = .default
        content.categoryIdentifier = Self.category
        content.threadIdentifier = "habit.\(habit.id)"
        content.userInfo = ["habitId": habit.id, "kind": habit.kind]
        return content
    }

    private func hourMinute(_ time: String) -> (Int, Int)? {
        let parts = time.split(separator: ":").compactMap { Int($0) }
        return parts.count == 2 ? (parts[0], parts[1]) : nil
    }

    /// Apple counts weekdays from Sunday = 1.
    private func appleWeekday(_ iso: Int) -> Int { iso == 7 ? 1 : iso + 1 }

    private func scheduleRepeating(_ habit: HabitConfig.Habit) {
        let everyDay = Set(habit.weekdays) == Set(1...7)
        for time in habit.times {
            guard let (h, m) = hourMinute(time) else { continue }
            for wd in everyDay ? [0] : habit.weekdays {
                var when = DateComponents()
                when.hour = h
                when.minute = m
                if wd != 0 { when.weekday = appleWeekday(wd) }
                let id = "\(Self.prefix)\(habit.id).t.\(wd).\(time)"
                center.add(UNNotificationRequest(identifier: id, content: content(for: habit), trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: true)))
            }
        }
    }

    /// Today's remaining and tomorrow's reminders for every place-bound habit
    /// the phone is at one of the places of. Tomorrow too, so a night at home
    /// with no new arrival still reminds in the morning.
    private func scheduleAtPlaces(_ config: HabitConfig) {
        guard always else { return }
        let here = inside
        let cal = Calendar.current
        let now = Date()
        for habit in config.habits where !habit.placeIds.isEmpty && !here.isDisjoint(with: habit.placeIds) {
            for offset in 0...1 {
                guard let day = cal.date(byAdding: .day, value: offset, to: now) else { continue }
                let isoWd = ((cal.component(.weekday, from: day) + 5) % 7) + 1
                guard habit.weekdays.contains(isoWd) else { continue }
                for time in habit.times {
                    guard let (h, m) = hourMinute(time), let at = cal.date(bySettingHour: h, minute: m, second: 0, of: day), at > now else { continue }
                    let when = cal.dateComponents([.year, .month, .day, .hour, .minute], from: at)
                    let stamp = String(format: "%04d%02d%02d%02d%02d", when.year!, when.month!, when.day!, h, m)
                    let id = "\(Self.prefix)\(habit.id).p.\(stamp)"
                    center.add(UNNotificationRequest(identifier: id, content: content(for: habit), trigger: UNCalendarNotificationTrigger(dateMatching: when, repeats: false)))
                }
            }
        }
    }

    // MARK: Regions

    private func syncRegions() {
        guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        let config = self.config
        let wanted = Set((config?.habits ?? []).flatMap(\.placeIds))
        let places = (config?.places ?? []).filter { wanted.contains($0.id) }
        for region in manager.monitoredRegions where region.identifier.hasPrefix(Self.regionPrefix) {
            if !places.contains(where: { Self.regionPrefix + $0.id == region.identifier }) { manager.stopMonitoring(for: region) }
        }
        inside = inside.intersection(Set(places.map(\.id)))
        guard always else { return }
        for place in places {
            let radius = min(max(place.radius, 100), manager.maximumRegionMonitoringDistance)
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: place.lat, longitude: place.lng), radius: radius, identifier: Self.regionPrefix + place.id)
            region.notifyOnEntry = true
            region.notifyOnExit = true
            manager.startMonitoring(for: region)
            manager.requestState(for: region)
        }
    }

    private func placeId(_ region: CLRegion) -> String? {
        region.identifier.hasPrefix(Self.regionPrefix) ? String(region.identifier.dropFirst(Self.regionPrefix.count)) : nil
    }

    func locationManager(_ manager: CLLocationManager, didDetermineState state: CLRegionState, for region: CLRegion) {
        guard let id = placeId(region) else { return }
        var now = inside
        switch state {
        case .inside: now.insert(id)
        case .outside: now.remove(id)
        default: return
        }
        guard now != inside else { return }
        inside = now
        rescheduleAll()
    }

    func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        self.locationManager(manager, didDetermineState: .inside, for: region)
    }

    func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
        self.locationManager(manager, didDetermineState: .outside, for: region)
    }

    // MARK: Permissions and position

    func permissions(_ done: @escaping (String, String) -> Void) {
        let location: String
        switch manager.authorizationStatus {
        case .authorizedAlways: location = "always"
        case .authorizedWhenInUse: location = "whenInUse"
        case .denied, .restricted: location = "denied"
        default: location = "prompt"
        }
        center.getNotificationSettings { settings in
            let n: String
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral: n = "granted"
            case .denied: n = "denied"
            default: n = "prompt"
            }
            DispatchQueue.main.async { done(n, location) }
        }
    }

    /// iOS asks for "While using" first and offers "Always" on its own later
    /// unless asked again once that is granted; so ask for both, in order.
    func requestAlways(_ done: @escaping (String) -> Void) {
        start()
        authCallbacks.append(done)
        switch manager.authorizationStatus {
        case .notDetermined: manager.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager.requestAlwaysAuthorization()
        default: finishAuth()
        }
    }

    private func finishAuth() {
        permissions { _, location in
            let callbacks = self.authCallbacks
            self.authCallbacks = []
            callbacks.forEach { $0(location) }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .authorizedWhenInUse, !authCallbacks.isEmpty {
            manager.requestAlwaysAuthorization()
            // If the "Always" prompt does not show (iOS decides), answer anyway.
            DispatchQueue.main.asyncAfter(deadline: .now() + 2) { if !self.authCallbacks.isEmpty { self.finishAuth() } }
            return
        }
        if !authCallbacks.isEmpty { finishAuth() }
        if config != nil {
            syncRegions()
            rescheduleAll()
        }
    }

    func currentPosition(_ done: @escaping (Result<CLLocation, Error>) -> Void) {
        start()
        positionCallbacks.append(done)
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        let callbacks = positionCallbacks
        positionCallbacks = []
        callbacks.forEach { $0(.success(loc)) }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let callbacks = positionCallbacks
        positionCallbacks = []
        callbacks.forEach { $0(.failure(error)) }
    }

    // MARK: Actions

    func recordDone(_ info: [AnyHashable: Any]) {
        guard let habitId = info["habitId"] as? String else { return }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        var pending = UserDefaults.standard.array(forKey: pendingKey) as? [[String: String]] ?? []
        pending.append(["habitId": habitId, "kind": info["kind"] as? String ?? "otro", "doneAt": iso.string(from: Date()), "clientId": UUID().uuidString.lowercased()])
        UserDefaults.standard.set(pending, forKey: pendingKey)
    }

    func snooze(_ original: UNNotificationContent) {
        guard let content = original.mutableCopy() as? UNMutableNotificationContent, let habitId = original.userInfo["habitId"] as? String else { return }
        let id = "\(Self.prefix)\(habitId).s.\(Int(Date().timeIntervalSince1970))"
        center.add(UNNotificationRequest(identifier: id, content: content, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 15 * 60, repeats: false)))
    }

    func takePendingCheckins() -> [[String: String]] {
        let pending = UserDefaults.standard.array(forKey: pendingKey) as? [[String: String]] ?? []
        UserDefaults.standard.removeObject(forKey: pendingKey)
        return pending
    }
}

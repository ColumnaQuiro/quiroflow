import SwiftUI
import WidgetKit

// QuiroFlow's home-screen widget. It shows a snapshot (utils/homeWidget.ts,
// SharedSnapshot), with how long ago it was taken. The app writes one
// whenever it has fresh data; for staff, the widget also fetches one itself
// each time WidgetKit asks for a timeline (SelfRefresh), so an owner's
// figures move on while the app stays closed. What the snapshot holds
// depends on who is signed in, as get_home_widget decided it:
//   patient -- the next visit and the bono;
//   clinic  -- an owner: money taken this month, visits done of booked today,
//              bonos sold this month (and their own day on the large size);
//   staff   -- a practitioner's own day, or the front desk's clinic day.
// Words come in the snapshot, in the person's language; the Spanish here is
// only a fallback. A staff timeline carries an entry per visit still to come,
// so the list moves on by itself as the day does.

struct Visit: Decodable {
    let at: String
    let time: String
    let name: String
    let what: String?
    let arrived: Bool
    let with: String?
    let link: String?
}

/** A day of visits: the staff snapshot itself, or an owner's "list". */
struct DayPart: Decodable {
    let scope: String?
    let who: String?
    let title: String?
    let remaining: Int?
    let done: Int?
    let arrived: Int?
    let link: String?
    let next: [Visit]?
}

struct Money: Decodable { let label: String; let smallLabel: String; let value: String; let range: String; let link: String? }
struct Patients: Decodable { let label: String; let done: Int; let total: Int; let note: String; let link: String? }
struct Bonos: Decodable { let label: String; let smallLabel: String; let count: Int; let value: String; let link: String? }

struct Snapshot: Decodable {
    struct Next: Decodable { let at: String; let label: String; let what: String?; let who: String? }
    struct Bono: Decodable { let name: String; let left: Int; let total: Int }
    let kind: String
    let updatedAt: String
    let updatedTime: String?
    let date: String?
    let dateLabel: String?
    let timeZone: String?
    let labels: [String: String]?
    // patient
    let clinic: String?
    let next: Next?
    let bono: Bono?
    // staff
    let day: DayPart?
    // clinic
    let title: String?
    let link: String?
    let money: Money?
    let patients: Patients?
    let bonos: Bonos?
    let list: DayPart?

    enum CodingKeys: String, CodingKey { case kind, updatedAt, updatedTime, date, dateLabel, timeZone, labels, clinic, next, bono, title, link, money, patients, bonos, list }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
        updatedTime = try c.decodeIfPresent(String.self, forKey: .updatedTime)
        date = try c.decodeIfPresent(String.self, forKey: .date)
        dateLabel = try c.decodeIfPresent(String.self, forKey: .dateLabel)
        timeZone = try c.decodeIfPresent(String.self, forKey: .timeZone)
        labels = try c.decodeIfPresent([String: String].self, forKey: .labels)
        clinic = try c.decodeIfPresent(String.self, forKey: .clinic)
        bono = try c.decodeIfPresent(Bono.self, forKey: .bono)
        title = try c.decodeIfPresent(String.self, forKey: .title)
        link = try c.decodeIfPresent(String.self, forKey: .link)
        money = try c.decodeIfPresent(Money.self, forKey: .money)
        patients = try c.decodeIfPresent(Patients.self, forKey: .patients)
        bonos = try c.decodeIfPresent(Bonos.self, forKey: .bonos)
        list = try c.decodeIfPresent(DayPart.self, forKey: .list)
        // "next" is one visit for a patient and a list for the team, whose
        // other fields sit beside it at the top level.
        if kind == "staff" {
            day = try DayPart(from: decoder)
            next = nil
        } else {
            next = try c.decodeIfPresent(Next.self, forKey: .next)
            day = nil
        }
    }

    static func load() -> Snapshot? {
        guard let data = SharedSnapshot.read() else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }

    /** One of the snapshot's words, with its %d / %@ filled. */
    func t(_ key: String, _ fallback: String, _ arg: String? = nil) -> String {
        let s = labels?[key] ?? fallback
        guard let arg else { return s }
        return s.replacingOccurrences(of: "%d", with: arg).replacingOccurrences(of: "%@", with: arg)
    }
}

private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private func date(_ s: String) -> Date? { iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) }
private func url(_ s: String?) -> URL? { s.flatMap { URL(string: $0) } }

/// How old a snapshot is at this entry, measured in the clinic's own days:
/// a figure for "today" is only today's on the day it was taken.
struct Freshness {
    let minutes: Int
    let sameDay: Bool
    let sameMonth: Bool
    let yesterday: Bool

    init(_ s: Snapshot, at now: Date) {
        let updated = date(s.updatedAt) ?? now
        minutes = max(0, Int(now.timeIntervalSince(updated) / 60))
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = s.timeZone.flatMap { TimeZone(identifier: $0) } ?? .current
        let f = DateFormatter()
        f.calendar = cal
        f.timeZone = cal.timeZone
        f.locale = Locale(identifier: "en_US_POSIX")
        f.dateFormat = "yyyy-MM-dd"
        let today = f.string(from: now)
        let snapDay = s.date ?? f.string(from: updated)
        sameDay = snapDay == today
        sameMonth = snapDay.prefix(7) == today.prefix(7)
        yesterday = snapDay == f.string(from: cal.date(byAdding: .day, value: -1, to: now) ?? now)
    }

    /** More than a week old: not worth showing at all. */
    var expired: Bool { minutes > 7 * 24 * 60 }
    /** Still today, but over two hours old: the age is shown in amber. */
    var stale: Bool { sameDay && minutes > 120 }

    func ageLabel(_ s: Snapshot) -> String {
        if !sameDay {
            if yesterday, let time = s.updatedTime { return s.t("updatedYesterday", "Actualizado ayer, %@", time) }
            return s.t("daysAgo", "hace %d días", String(max(1, minutes / 1440)))
        }
        if minutes < 1 { return s.t("now", "ahora") }
        if minutes < 60 { return s.t("minAgo", "hace %d min", String(minutes)) }
        return s.t("hoursAgo", "hace %d h", String(minutes / 60))
    }
}

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

/// The widget fetching its own snapshot (server/api/widget/home.get.ts) with
/// the widget token the app gave it -- never the app's session, whose
/// refresh token the app must keep. The answer is exactly what the app would
/// have written, mapped on the server by the same widgetSnapshotFromRpc, so
/// nothing here interprets it. Whatever happens, the timeline then draws
/// whatever snapshot is stored: a failed fetch (offline, a slow server) keeps
/// the last one, with its age.
enum SelfRefresh {
    static func run(_ done: @escaping () -> Void) {
        guard let c = WidgetRefreshConfig.load(), let token = c.token, var parts = URLComponents(string: c.url) else { return done() }
        parts.queryItems = [
            URLQueryItem(name: "account", value: c.accountId),
            URLQueryItem(name: "tz", value: c.timeZone),
            URLQueryItem(name: "lang", value: c.lang),
            URLQueryItem(name: "privacy", value: c.privacy ? "1" : "0"),
        ]
        guard let u = parts.url else { return done() }
        var req = URLRequest(url: u, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15)
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        URLSession.shared.dataTask(with: req) { data, response, _ in
            switch (response as? HTTPURLResponse)?.statusCode {
            case 200:
                if let data, (try? JSONDecoder().decode(Snapshot.self, from: data)) != nil { SharedSnapshot.write(data) }
            case 204:
                // Nobody's day to show any more.
                SharedSnapshot.clear()
            case 401:
                // The session that issued the token has ended: signed out, or
                // revoked. Nothing on the phone is theirs to show now.
                SharedSnapshot.clear()
                SharedSnapshot.clearRefresh()
            case 403:
                // A second factor is now required, or they left the team: the
                // figures wait for the app, which asks for the code.
                SharedSnapshot.clear()
            default:
                break
            }
            done()
        }.resume()
    }

    /// Every quarter of an hour while the clinic is open (WidgetKit spaces it
    /// out to its own budget); hourly overnight. Without a token, every half
    /// hour only to move the age on, as before.
    static func nextAsk(_ snap: Snapshot?) -> Date {
        guard WidgetRefreshConfig.load()?.token != nil else { return Date.now.addingTimeInterval(30 * 60) }
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = snap?.timeZone.flatMap { TimeZone(identifier: $0) } ?? .current
        let hour = cal.component(.hour, from: .now)
        return Date.now.addingTimeInterval((hour >= 7 && hour < 22 ? 15 : 60) * 60)
    }
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, snapshot: Snapshot.load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        SelfRefresh.run { completion(timeline()) }
    }

    private func timeline() -> Timeline<Entry> {
        let snap = Snapshot.load()
        var dates: [Date] = [.now]
        // A list drops each visit a quarter of an hour after it starts.
        for v in (snap?.day ?? snap?.list)?.next ?? [] {
            if let d = date(v.at)?.addingTimeInterval(15 * 60), d > .now { dates.append(d) }
        }
        // The clinic's midnight, when "today" stops describing the snapshot.
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = snap?.timeZone.flatMap { TimeZone(identifier: $0) } ?? .current
        if let midnight = cal.nextDate(after: .now, matching: DateComponents(hour: 0, minute: 0), matchingPolicy: .nextTime) { dates.append(midnight) }
        let entries = dates.sorted().prefix(12).map { Entry(date: $0, snapshot: snap) }
        return Timeline(entries: Array(entries), policy: .after(SelfRefresh.nextAsk(snap)))
    }
}

private let brand = Color(red: 79 / 255, green: 70 / 255, blue: 229 / 255)
private let done = Color(red: 29 / 255, green: 138 / 255, blue: 91 / 255)

struct AgeText: View {
    let s: Snapshot
    let fresh: Freshness
    var body: some View {
        Text(fresh.ageLabel(s)).font(.system(size: 10, weight: fresh.stale ? .semibold : .regular)).foregroundStyle(fresh.stale ? AnyShapeStyle(Color.orange) : AnyShapeStyle(.secondary)).lineLimit(1)
    }
}

struct Eyebrow: View {
    let text: String
    var body: some View { Text(text.uppercased()).font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1) }
}

// MARK: - Patient

struct PatientView: View {
    let s: Snapshot
    let at: Date
    @Environment(\.widgetFamily) var family
    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text("PRÓXIMA VISITA").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                if let n = s.next {
                    Text(n.label).font(.system(size: family == .systemSmall ? 17 : 19, weight: .bold)).minimumScaleFactor(0.7).lineLimit(2)
                    Text([n.what, n.who].compactMap { $0 }.joined(separator: " · ")).font(.system(size: 12)).foregroundStyle(.secondary).lineLimit(2)
                } else {
                    Text("Sin cita reservada").font(.system(size: 16, weight: .semibold))
                }
                Spacer(minLength: 0)
                Text(s.clinic ?? "QuiroFlow").font(.system(size: 11, weight: .medium)).foregroundStyle(brand).lineLimit(1)
                AgeText(s: s, fresh: Freshness(s, at: at))
            }
            if family != .systemSmall, let b = s.bono {
                Divider()
                VStack(alignment: .leading, spacing: 2) {
                    Text("BONO").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary)
                    Text("\(b.left)").font(.system(size: 30, weight: .semibold, design: .monospaced))
                    Text("sesiones de \(b.total)").font(.system(size: 11)).foregroundStyle(.secondary)
                }.frame(width: 92, alignment: .leading)
            }
        }
    }
}

// MARK: - A day of visits (practitioner, front desk, and an owner's large size)

struct VisitRow: View {
    let s: Snapshot
    let v: Visit
    let clinicList: Bool
    var body: some View {
        HStack(spacing: 8) {
            Circle().fill(v.arrived ? done : Color.gray.opacity(0.4)).frame(width: 7, height: 7)
            Text(v.time).font(.system(size: 12, design: .monospaced))
            Text(v.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
            Spacer(minLength: 4)
            Text(trailing).font(.system(size: 11, weight: v.arrived ? .semibold : .regular)).foregroundStyle(v.arrived ? AnyShapeStyle(done) : AnyShapeStyle(.secondary)).lineLimit(1)
        }
    }
    private var trailing: String {
        let room = s.t("inRoom", "En sala")
        if clinicList {
            let who = v.with ?? ""
            return v.arrived ? (who.isEmpty ? room : "\(room) · \(who)") : who
        }
        return v.arrived ? room : (v.what ?? "")
    }
}

struct DayView: View {
    let s: Snapshot
    let d: DayPart
    let at: Date
    /** Rows to list; on an owner's large widget, below the figures. */
    let rows: Int
    let showHeader: Bool
    @Environment(\.widgetFamily) var family

    private var desk: Bool { d.scope == "clinic" }
    private var fresh: Freshness { Freshness(s, at: at) }
    private var coming: [Visit] { fresh.sameDay ? (d.next ?? []).filter { (date($0.at)?.addingTimeInterval(15 * 60) ?? .distantFuture) > at } : [] }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            if family == .systemSmall {
                small
            } else {
                if showHeader {
                    HStack {
                        Eyebrow(text: d.title ?? "")
                        Spacer()
                        AgeText(s: s, fresh: fresh)
                    }
                    if fresh.sameDay {
                        HStack(spacing: 16) {
                            if desk {
                                stat("\(max(0, (d.remaining ?? 0) - (d.arrived ?? 0)))", s.t("toArrive", "por llegar"))
                                stat("\(d.arrived ?? 0)", s.t("waiting", "en sala"))
                                stat("\(d.done ?? 0)", s.t("done", "hechas"))
                            } else {
                                stat("\(coming.count)", s.t("left", "quedan"))
                                stat("\(d.done ?? 0)", s.t("done", "hechas"))
                                stat("\(d.arrived ?? 0)", s.t("waiting", "en sala"))
                            }
                        }
                    }
                } else {
                    Eyebrow(text: d.title ?? "")
                }
                if !fresh.sameDay {
                    Text(s.t("noToday", "sin datos de hoy")).font(.system(size: 13)).foregroundStyle(.secondary)
                } else if coming.isEmpty {
                    Text(s.t("nothingMore", "Nada más hoy")).font(.system(size: 13, weight: .medium)).foregroundStyle(.secondary)
                }
                ForEach(Array(coming.prefix(rows).enumerated()), id: \.offset) { _, v in
                    if let u = url(v.link) { Link(destination: u) { VisitRow(s: s, v: v, clinicList: desk) } } else { VisitRow(s: s, v: v, clinicList: desk) }
                }
                Spacer(minLength: 0)
            }
        }
    }

    @ViewBuilder private var small: some View {
        HStack {
            Eyebrow(text: desk ? s.t("nextArrival", "Siguiente llegada") : s.t("next", "Siguiente"))
            Spacer()
            AgeText(s: s, fresh: fresh)
        }
        if let v = coming.first {
            Text(v.time).font(.system(size: 24, weight: .semibold, design: .monospaced))
            Text(v.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
            if desk, let who = v.with { Text(who).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
        } else {
            Text(fresh.sameDay ? s.t("nothingMore", "Nada más hoy") : s.t("noToday", "sin datos de hoy")).font(.system(size: 15, weight: .semibold))
        }
        Spacer(minLength: 0)
        if fresh.sameDay {
            Text(desk ? s.t("toArriveCount", "%d por llegar", String(max(0, coming.count - (d.arrived ?? 0)))) : s.t("ahead", "%d por delante", String(coming.count)))
                .font(.system(size: 11)).foregroundStyle(.secondary)
        }
    }

    private func stat(_ n: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(n).font(.system(size: 22, weight: .semibold, design: .monospaced))
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }
}

// MARK: - An owner's clinic figures

struct ClinicView: View {
    let s: Snapshot
    let at: Date
    @Environment(\.widgetFamily) var family

    private var fresh: Freshness { Freshness(s, at: at) }

    var body: some View {
        if family == .systemSmall { small } else if family == .systemLarge { large } else { figures }
    }

    // Money first; today's visits and the month's bonos underneath.
    private var small: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Eyebrow(text: s.clinic ?? "QuiroFlow")
                Spacer()
                AgeText(s: s, fresh: fresh)
            }
            Spacer(minLength: 0)
            Text(s.money?.smallLabel ?? "").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
            moneyText(size: 26)
            Spacer(minLength: 0)
            Divider()
            row(s.patients?.label ?? "", fresh.sameDay ? "\(s.patients?.done ?? 0)/\(s.patients?.total ?? 0)" : "—")
            row(s.bonos?.smallLabel ?? "", fresh.sameMonth ? "\(s.bonos?.count ?? 0)" : "—")
        }
        .widgetURL(url(s.link))
    }

    private var header: some View {
        HStack {
            Eyebrow(text: s.title ?? s.clinic ?? "QuiroFlow")
            Spacer()
            AgeText(s: s, fresh: fresh)
        }
    }

    // Each figure in its own column, each its own tap target.
    private var figures: some View {
        VStack(alignment: .leading, spacing: 8) {
            header
            HStack(alignment: .top, spacing: 10) {
                column(link: s.money?.link) {
                    label(s.money?.label)
                    Spacer(minLength: 0)
                    moneyText(size: 21)
                    note(moneyRange)
                }
                Divider()
                column(link: s.patients?.link) {
                    label(s.patients?.label)
                    Spacer(minLength: 0)
                    if fresh.sameDay, let p = s.patients {
                        (Text("\(p.done)").font(.system(size: 21, weight: .semibold)) + Text("/\(p.total)").font(.system(size: 14)).foregroundColor(.secondary))
                            .monospacedDigit().lineLimit(1)
                        ProgressView(value: Double(p.done), total: Double(max(p.total, 1))).tint(done)
                        note(p.note)
                    } else {
                        Text("—").font(.system(size: 21, weight: .semibold)).foregroundStyle(.secondary)
                        note(s.t("noToday", "sin datos de hoy"))
                    }
                }
                Divider()
                column(link: s.bonos?.link) {
                    label(s.bonos?.label)
                    Spacer(minLength: 0)
                    Text(fresh.sameMonth ? "\(s.bonos?.count ?? 0)" : "—").font(.system(size: 21, weight: .semibold)).monospacedDigit()
                    note(fresh.sameMonth ? (s.bonos?.value ?? "") : "").privacySensitive()
                }
            }
        }
    }

    // The figures, then the owner's own day (or the clinic's, for an owner who does not treat).
    private var large: some View {
        VStack(alignment: .leading, spacing: 10) {
            figures.frame(height: 128)
            Divider()
            if let d = s.list { DayView(s: s, d: d, at: at, rows: 5, showHeader: false) }
            Spacer(minLength: 0)
        }
    }

    private var moneyRange: String {
        if fresh.sameDay { return s.money?.range ?? "" }
        if !fresh.sameMonth { return "" }
        return fresh.yesterday ? s.t("untilYesterday", "hasta ayer") : s.t("untilDate", "hasta el %@", s.dateLabel ?? "")
    }

    private func moneyText(size: CGFloat) -> some View {
        Text(fresh.sameMonth ? (s.money?.value ?? "—") : "—")
            .font(.system(size: size, weight: .semibold)).monospacedDigit()
            .minimumScaleFactor(0.6).lineLimit(1)
            .privacySensitive()
    }

    private func column<Content: View>(link: String?, @ViewBuilder _ content: () -> Content) -> some View {
        let body = VStack(alignment: .leading, spacing: 3) { content() }.frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        return Group {
            if let u = url(link) { Link(destination: u) { body } } else { body }
        }
    }

    private func label(_ text: String?) -> some View { Text(text ?? "").font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1) }
    private func note(_ text: String) -> some View { Text(text).font(.system(size: 10.5)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8) }
    private func row(_ label: String, _ value: String) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label).font(.system(size: 11.5)).foregroundStyle(.secondary).lineLimit(1)
            Spacer(minLength: 4)
            Text(value).font(.system(size: 14, weight: .semibold)).monospacedDigit()
        }
    }
}

struct QuiroFlowWidgetView: View {
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snapshot, !Freshness(s, at: entry.date).expired {
                switch s.kind {
                case "clinic": ClinicView(s: s, at: entry.date)
                case "staff":
                    if let d = s.day {
                        DayView(s: s, d: d, at: entry.date, rows: 6, showHeader: true)
                            .widgetURL(url(d.link))
                    }
                default: PatientView(s: s, at: entry.date)
                }
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("QuiroFlow").font(.system(size: 15, weight: .bold)).foregroundStyle(brand)
                    Text(entry.snapshot?.t("openToUpdate", "Abre QuiroFlow para actualizar") ?? "Abre la app para ver aquí tu próxima visita o tu día.")
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        }
        .containerBackground(.background, for: .widget)
    }
}

struct QuiroFlowWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "QuiroFlowWidget", provider: Provider()) { entry in
            QuiroFlowWidgetView(entry: entry)
        }
        .configurationDisplayName("QuiroFlow")
        .description("Tu próxima visita, tu día o las cifras de tu clínica.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct QuiroFlowWidgets: WidgetBundle {
    var body: some Widget { QuiroFlowWidget() }
}

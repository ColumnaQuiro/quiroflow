import SwiftUI
import WidgetKit

// QuiroFlow's home-screen widget. It never talks to the server: it shows the
// snapshot the app last wrote (utils/homeWidget.ts, SharedSnapshot), with
// how long ago -- for a patient, the next visit and the bono; for the team,
// today. A staff timeline carries an entry per visit still to come, so the
// list moves on by itself as the day does.

struct Snapshot: Decodable {
    struct Next: Decodable { let at: String; let label: String; let what: String?; let who: String? }
    struct Bono: Decodable { let name: String; let left: Int; let total: Int }
    struct Visit: Decodable { let at: String; let time: String; let name: String; let what: String?; let arrived: Bool }
    let kind: String
    let updatedAt: String
    // patient
    let clinic: String?
    let next: Next?
    let bono: Bono?
    // staff
    let who: String?
    let remaining: Int?
    let done: Int?
    let arrived: Int?
    let visits: [Visit]?

    enum CodingKeys: String, CodingKey { case kind, updatedAt, clinic, next, bono, who, remaining, done, arrived }
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        kind = try c.decode(String.self, forKey: .kind)
        updatedAt = try c.decode(String.self, forKey: .updatedAt)
        clinic = try c.decodeIfPresent(String.self, forKey: .clinic)
        who = try c.decodeIfPresent(String.self, forKey: .who)
        remaining = try c.decodeIfPresent(Int.self, forKey: .remaining)
        done = try c.decodeIfPresent(Int.self, forKey: .done)
        arrived = try c.decodeIfPresent(Int.self, forKey: .arrived)
        bono = try c.decodeIfPresent(Bono.self, forKey: .bono)
        // "next" is one visit for a patient and a list for the team.
        if kind == "staff" {
            visits = try c.decodeIfPresent([Visit].self, forKey: .next)
            next = nil
        } else {
            next = try c.decodeIfPresent(Next.self, forKey: .next)
            visits = nil
        }
    }

    static func load() -> Snapshot? {
        guard let data = SharedSnapshot.read() else { return nil }
        return try? JSONDecoder().decode(Snapshot.self, from: data)
    }
}

private let iso: ISO8601DateFormatter = {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return f
}()
private func date(_ s: String) -> Date? { iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) }

struct Entry: TimelineEntry {
    let date: Date
    let snapshot: Snapshot?
}

struct Provider: TimelineProvider {
    func placeholder(in context: Context) -> Entry { Entry(date: .now, snapshot: nil) }
    func getSnapshot(in context: Context, completion: @escaping (Entry) -> Void) { completion(Entry(date: .now, snapshot: Snapshot.load())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<Entry>) -> Void) {
        let snap = Snapshot.load()
        var dates: [Date] = [.now]
        // The team's list drops each visit a quarter of an hour after it starts.
        for v in snap?.visits ?? [] {
            if let d = date(v.at)?.addingTimeInterval(15 * 60), d > .now { dates.append(d) }
        }
        let entries = dates.sorted().prefix(12).map { Entry(date: $0, snapshot: snap) }
        completion(Timeline(entries: Array(entries), policy: .after(Date.now.addingTimeInterval(30 * 60))))
    }
}

private let brand = Color(red: 79 / 255, green: 70 / 255, blue: 229 / 255)

// "hace 5 min", "hace 2 h": how old the snapshot is at this entry. Plain
// text rather than a live relative date, which counts seconds and does not fit.
struct UpdatedLine: View {
    let snapshot: Snapshot
    let at: Date
    var body: some View {
        if let d = date(snapshot.updatedAt) {
            let minutes = max(0, Int(at.timeIntervalSince(d) / 60))
            let label = minutes < 1 ? "ahora" : minutes < 60 ? "hace \(minutes) min" : minutes < 48 * 60 ? "hace \(minutes / 60) h" : "hace \(minutes / 1440) días"
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1)
        }
    }
}

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
                UpdatedLine(snapshot: s, at: at)
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

struct StaffView: View {
    let s: Snapshot
    let at: Date
    @Environment(\.widgetFamily) var family
    var body: some View {
        let coming = (s.visits ?? []).filter { (date($0.at)?.addingTimeInterval(15 * 60) ?? .distantFuture) > at }
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text(family == .systemSmall ? "SIGUIENTE" : "HOY · \(s.who ?? "")").font(.system(size: 10, weight: .semibold)).foregroundStyle(.secondary).lineLimit(1)
                Spacer()
                UpdatedLine(snapshot: s, at: at)
            }
            if family == .systemSmall {
                if let v = coming.first {
                    Text(v.time).font(.system(size: 24, weight: .semibold, design: .monospaced))
                    Text(v.name).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                } else {
                    Text("Nada más hoy").font(.system(size: 15, weight: .semibold))
                }
                Spacer(minLength: 0)
                Text("\(coming.count) por delante").font(.system(size: 11)).foregroundStyle(.secondary)
            } else {
                HStack(spacing: 16) {
                    stat("\(coming.count)", "quedan")
                    stat("\(s.done ?? 0)", "hechas")
                    stat("\(s.arrived ?? 0)", "en sala")
                }
                ForEach(Array(coming.prefix(family == .systemLarge ? 6 : 2).enumerated()), id: \.offset) { _, v in
                    HStack(spacing: 8) {
                        Circle().fill(v.arrived ? Color.green : Color.gray.opacity(0.4)).frame(width: 7, height: 7)
                        Text(v.time).font(.system(size: 12, design: .monospaced))
                        Text(v.name).font(.system(size: 13, weight: .medium)).lineLimit(1)
                        Spacer()
                        Text(v.arrived ? "En sala" : (v.what ?? "")).font(.system(size: 11)).foregroundStyle(v.arrived ? .green : .secondary).lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
    private func stat(_ n: String, _ label: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(n).font(.system(size: 22, weight: .semibold, design: .monospaced))
            Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
        }
    }
}

struct QuiroFlowWidgetView: View {
    let entry: Entry
    var body: some View {
        Group {
            if let s = entry.snapshot {
                if s.kind == "staff" { StaffView(s: s, at: entry.date) } else { PatientView(s: s, at: entry.date) }
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("QuiroFlow").font(.system(size: 15, weight: .bold)).foregroundStyle(brand)
                    Text("Abre la app para ver aquí tu próxima visita o tu día.").font(.system(size: 12)).foregroundStyle(.secondary)
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
        .description("Tu próxima visita y tu bono, o tu día en la clínica.")
        .supportedFamilies([.systemSmall, .systemMedium, .systemLarge])
    }
}

@main
struct QuiroFlowWidgets: WidgetBundle {
    var body: some Widget { QuiroFlowWidget() }
}

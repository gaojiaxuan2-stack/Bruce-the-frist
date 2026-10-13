import SwiftUI
import SwiftData

// MARK: - HorizonView

/// “The river of time”: a single luminous line running from the first memory,
/// through a glowing *Now*, down toward every letter still travelling.
/// Opened letters sit upstream; sealed ones drift downstream, spaced by how far
/// apart their days are, with quiet year markers where the calendar turns.
struct HorizonView: View {
    @Query(sort: \TimeCapsule.unlockDate) private var capsules: [TimeCapsule]

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            HorizonRiver(capsules: capsules, now: context.date)
        }
    }
}

// MARK: - River

private struct HorizonRiver: View {
    @Environment(AppRouter.self) private var router

    let capsules: [TimeCapsule]
    let now: Date

    var body: some View {
        let model = HorizonModel(capsules: capsules, now: now)
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    HorizonHeader(
                        now: now,
                        travellingCount: model.travellingCount,
                        readyCount: model.readyCount,
                        next: model.next,
                        isEmpty: model.isEmpty
                    )
                    if model.isEmpty {
                        HorizonEmptyState(onWrite: startWriting)
                    } else {
                        river(model)
                    }
                }
                .padding(.horizontal, 20)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .onAppear {
                guard model.hasPast else { return }
                proxy.scrollTo(HorizonModel.nowID, anchor: UnitPoint(x: 0.5, y: 0.4))
            }
        }
    }

    /// Lazy, so a long river only builds the stretch that is on screen.
    private func river(_ model: HorizonModel) -> some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(model.rows) { row in
                HorizonRowView(row: row, now: now, onOpen: presentCapsule, onWrite: startWriting)
                    .id(row.id)
            }
        }
        .padding(.top, 8)
        .animation(.smooth(duration: 0.6), value: model.rows.map(\.id))
    }

    private func presentCapsule(_ capsule: TimeCapsule) {
        Haptics.tap()
        router.presentedCapsuleID = capsule.id
    }

    private func startWriting() {
        Haptics.soft()
        router.isComposing = true
    }
}

// MARK: - Model

private enum HorizonMetrics {
    /// Width of the column the river runs through; the line sits at its centre.
    static let railWidth: CGFloat = 56
    static let nodeSize: CGFloat = 36
}

private enum HorizonEra {
    /// Opened — a memory upstream.
    case memory
    /// Its day has come, waiting to be opened.
    case arrived
    /// Sealed and still travelling downstream.
    case travelling
}

private struct HorizonStop {
    let capsule: TimeCapsule
    let era: HorizonEra
    let date: Date
}

private enum HorizonMark {
    case stop(HorizonStop)
    case present(Date)

    var date: Date {
        switch self {
        case .stop(let stop): return stop.date
        case .present(let date): return date
        }
    }
}

private enum HorizonRowKind {
    case source
    case year(Int)
    case stop(HorizonStop)
    case present
    case mouth
}

private struct HorizonRow: Identifiable {
    let id: String
    let kind: HorizonRowKind
    /// Vertical stretch of river drawn above the row, scaled to the time since the previous row.
    let gap: CGFloat
    /// Whether the stretch above (and the row itself) lies in the future.
    let isFuture: Bool
}

private struct HorizonModel {
    static let nowID = "horizon.now"

    let rows: [HorizonRow]
    let travellingCount: Int
    let readyCount: Int
    let next: TimeCapsule?
    let hasPast: Bool
    let isEmpty: Bool

    init(capsules: [TimeCapsule], now: Date) {
        var past: [HorizonStop] = []
        var future: [HorizonStop] = []
        for capsule in capsules {
            switch capsule.state(at: now) {
            case .opened:
                past.append(HorizonStop(capsule: capsule, era: .memory, date: min(capsule.unlockDate, now)))
            case .ready:
                past.append(HorizonStop(capsule: capsule, era: .arrived, date: min(capsule.unlockDate, now)))
            case .sealed:
                future.append(HorizonStop(capsule: capsule, era: .travelling, date: capsule.unlockDate))
            case .draft:
                break
            }
        }
        past.sort { $0.date < $1.date }
        future.sort { $0.date < $1.date }

        travellingCount = future.count
        readyCount = past.filter { $0.era == .arrived }.count
        next = future.first?.capsule
        hasPast = !past.isEmpty
        isEmpty = past.isEmpty && future.isEmpty
        rows = HorizonModel.makeRows(past: past, future: future, now: now)
    }

    private static func makeRows(past: [HorizonStop], future: [HorizonStop], now: Date) -> [HorizonRow] {
        var marks = past.map { HorizonMark.stop($0) }
        marks.append(HorizonMark.present(now))
        marks += future.map { HorizonMark.stop($0) }

        let calendar = Calendar.current
        var rows = [HorizonRow(id: "horizon.source", kind: .source, gap: 0, isFuture: false)]
        var previousDate: Date?
        var previousYear: Int?
        var isDownstream = false

        for mark in marks {
            let date = mark.date
            let year = calendar.component(.year, from: date)
            var gap = gapHeight(from: previousDate, to: date)
            if year != previousYear {
                rows.append(HorizonRow(id: "horizon.year.\(year)", kind: .year(year), gap: gap, isFuture: isDownstream))
                gap = 6
            }
            switch mark {
            case .stop(let stop):
                rows.append(HorizonRow(
                    id: stop.capsule.id.uuidString,
                    kind: .stop(stop),
                    gap: gap,
                    isFuture: stop.era == .travelling
                ))
            case .present:
                rows.append(HorizonRow(id: nowID, kind: .present, gap: gap, isFuture: false))
                isDownstream = true
            }
            previousDate = date
            previousYear = year
        }

        rows.append(HorizonRow(id: "horizon.mouth", kind: .mouth, gap: 28, isFuture: true))
        return rows
    }

    /// Gently logarithmic: a day apart reads close, a decade apart reads far — but never absurdly so.
    private static func gapHeight(from previous: Date?, to date: Date) -> CGFloat {
        guard let previous else { return 4 }
        let days = max(0, date.timeIntervalSince(previous) / 86_400)
        let height = 14 + 26 * log10(1 + days)
        return CGFloat(min(height, 120))
    }
}

private func horizonTitle(_ capsule: TimeCapsule) -> String {
    let trimmed = capsule.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? String(localized: "Untitled letter") : trimmed
}

// MARK: - Rows

private struct HorizonRowView: View {
    let row: HorizonRow
    let now: Date
    let onOpen: (TimeCapsule) -> Void
    let onWrite: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if row.gap > 0 {
                HorizonRail(style: row.isFuture ? .dotted : .solid)
                    .frame(height: row.gap)
            }
            rowBody
        }
    }

    @ViewBuilder
    private var rowBody: some View {
        switch row.kind {
        case .source:
            HorizonRail(style: .emerging)
                .frame(height: 40)
        case .year(let year):
            HorizonYearMark(year: year, isFuture: row.isFuture)
        case .stop(let stop):
            HorizonStopRow(stop: stop, now: now, onOpen: onOpen)
        case .present:
            HorizonPresentMark(now: now)
        case .mouth:
            HorizonMouth(onWrite: onWrite)
        }
    }
}

private struct HorizonStopRow: View {
    @Environment(\.theme) private var theme

    let stop: HorizonStop
    let now: Date
    let onOpen: (TimeCapsule) -> Void

    var body: some View {
        Button {
            onOpen(stop.capsule)
        } label: {
            HStack(alignment: .center, spacing: 12) {
                HorizonNode(stop: stop)
                    .frame(width: HorizonMetrics.railWidth)
                    .accessibilityHidden(true)
                details
                Spacer(minLength: 0)
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(HorizonPressStyle())
        .scrollTransition { effect, phase in
            effect.opacity(phase.isIdentity ? 1 : 0.35)
        }
        .background(alignment: .leading) {
            HorizonRail(style: stop.era == .travelling ? .dotted : .solid)
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            caption
                .font(theme.label(10.5, weight: .semibold))
                .tracking(1.2)
                .textCase(.uppercase)
                .foregroundStyle(stop.era == .arrived ? theme.accent : detailInk)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(horizonTitle(stop.capsule))
                .font(theme.display(20))
                .foregroundStyle(theme.ink.opacity(stop.era == .memory ? 0.78 : 1))
                .lineLimit(2)
                .multilineTextAlignment(.leading)
            Text("\(TimePhrase.longDate(stop.capsule.unlockDate)) · \(addressee)")
                .font(theme.label(12))
                .foregroundStyle(detailInk)
                .lineLimit(1)
                .minimumScaleFactor(0.85)
        }
    }

    /// Rows sit straight on the backdrop, with no card behind them. On light paper
    /// (Ink Wash's mountains in particular) the small lines take a deeper ink so
    /// they stay legible over the darker washes.
    private var detailInk: Color {
        theme.colorScheme == .light ? theme.ink.opacity(0.72) : theme.inkSecondary
    }

    private var caption: Text {
        let capsule = stop.capsule
        switch stop.era {
        case .memory:
            return Text("Opened \(TimePhrase.relative(capsule.openedAt ?? capsule.unlockDate, now: now))")
        case .arrived:
            return Text("Arrived · waiting for you")
        case .travelling:
            return Text("Arrives \(TimePhrase.relative(capsule.unlockDate, now: now))")
        }
    }

    private var addressee: String {
        let capsule = stop.capsule
        if capsule.isIncoming {
            return String(localized: "from \(capsule.displaySender)")
        }
        return String(localized: "for \(capsule.displayRecipient)")
    }
}

/// The capsule's own seal floating on the river; memories fade, arrivals pulse.
private struct HorizonNode: View {
    let stop: HorizonStop

    var body: some View {
        ZStack {
            if stop.era == .arrived {
                HorizonPulse()
            }
            SealView(monogram: stop.capsule.monogram)
                .theme(stop.capsule.theme.theme)
                .frame(width: HorizonMetrics.nodeSize, height: HorizonMetrics.nodeSize)
                .saturation(stop.era == .memory ? 0.3 : 1)
                .opacity(stop.era == .memory ? 0.72 : 1)
                .shadow(color: Color.black.opacity(0.2), radius: 4, x: 0, y: 2)
        }
        .frame(height: HorizonMetrics.nodeSize + 8)
    }
}

private struct HorizonPulse: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .fill(theme.glow.opacity(0.45))
                .frame(width: 50, height: 50)
                .blur(radius: 10)
            if !reduceMotion {
                Circle()
                    .strokeBorder(theme.glow, lineWidth: 1.5)
                    .frame(width: 40, height: 40)
                    .phaseAnimator([0, 1, 2]) { content, phase in
                        content
                            .scaleEffect(phase == 2 ? 1.7 : 1.0)
                            .opacity(phase == 1 ? 0.95 : 0)
                    } animation: { phase in
                        HorizonPulse.animation(for: phase)
                    }
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    private static func animation(for phase: Int) -> Animation {
        switch phase {
        case 1: return .easeIn(duration: 0.3)
        case 2: return .easeOut(duration: 1.8)
        default: return .linear(duration: 0.7)
        }
    }
}

private struct HorizonYearMark: View {
    @Environment(\.theme) private var theme

    let year: Int
    let isFuture: Bool

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            Capsule()
                .fill(theme.accent.opacity(0.75))
                .frame(width: 14, height: 1.5)
                .frame(width: HorizonMetrics.railWidth)
            // Quiet, but still the river's landmarks: at least 3:1 in every style.
            Text(verbatim: String(year))
                .font(theme.display(46, weight: .light))
                .monospacedDigit()
                .foregroundStyle(theme.inkSecondary.opacity(0.75))
            Rectangle()
                .fill(theme.ink.opacity(0.08))
                .frame(height: 0.5)
        }
        .padding(.vertical, 2)
        .background(alignment: .leading) {
            HorizonRail(style: isFuture ? .dotted : .solid)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: String(year)))
        .accessibilityAddTraits(.isHeader)
    }
}

private struct HorizonPresentMark: View {
    @Environment(\.theme) private var theme

    let now: Date

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            HorizonBeacon()
                .frame(width: HorizonMetrics.railWidth, height: 56)
            VStack(alignment: .leading, spacing: 2) {
                Text("Now")
                    .font(theme.display(30))
                    .foregroundStyle(theme.ink)
                Text(TimePhrase.longDate(now))
                    .font(theme.label(12))
                    .foregroundStyle(theme.inkSecondary)
            }
            .layoutPriority(1)
            horizonLine
        }
        .padding(.vertical, 10)
        .background(alignment: .leading) {
            HorizonRail(style: .present)
        }
        .accessibilityElement(children: .combine)
    }

    /// The horizon itself: a luminous hairline reaching toward the edge of the page.
    private var horizonLine: some View {
        LinearGradient(
            colors: [theme.accent.opacity(0.75), theme.accent.opacity(0)],
            startPoint: .leading,
            endPoint: .trailing
        )
        .frame(height: 1)
        .shadow(color: theme.glow.opacity(0.9), radius: 4)
        .frame(maxWidth: .infinity)
        .accessibilityHidden(true)
    }
}

private struct HorizonBeacon: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Circle()
                .fill(theme.glow.opacity(0.4))
                .frame(width: 32, height: 32)
                .blur(radius: 8)
            if !reduceMotion {
                ripple
            }
            Circle()
                .fill(theme.accent)
                .frame(width: 12, height: 12)
                .overlay {
                    Circle().strokeBorder(Color.white.opacity(0.65), lineWidth: 1)
                }
                .shadow(color: theme.glow, radius: 6)
        }
        .accessibilityHidden(true)
    }

    private var ripple: some View {
        Circle()
            .strokeBorder(theme.accent.opacity(0.85), lineWidth: 1)
            .frame(width: 14, height: 14)
            .phaseAnimator([0, 1, 2]) { content, phase in
                content
                    .scaleEffect(phase == 2 ? 3.2 : 1.0)
                    .opacity(phase == 1 ? 0.9 : 0)
            } animation: { phase in
                HorizonBeacon.animation(for: phase)
            }
    }

    private static func animation(for phase: Int) -> Animation {
        switch phase {
        case 1: return .easeIn(duration: 0.25)
        case 2: return .easeOut(duration: 2.2)
        default: return .linear(duration: 0.8)
        }
    }
}

/// Where the river runs past the last letter, into what has not been written yet.
private struct HorizonMouth: View {
    @Environment(\.theme) private var theme

    let onWrite: () -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Color.clear
                .frame(width: HorizonMetrics.railWidth, height: 1)
            VStack(alignment: .leading, spacing: 8) {
                Text("Beyond here, the river is unwritten.")
                    .font(theme.body(16).italic())
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button(action: onWrite) {
                    Label("Send a letter further", systemImage: "arrow.down")
                }
                .buttonStyle(.themedGhost)
                .fixedSize()
            }
            Spacer(minLength: 0)
        }
        .padding(.top, 10)
        .padding(.bottom, 56)
        .background(alignment: .leading) {
            HorizonRail(style: .fading)
        }
    }
}

// MARK: - The line

private enum HorizonRailStyle {
    /// The past: a steady, softly glowing line.
    case solid
    /// The future: a dotted trail not yet travelled.
    case dotted
    /// Fades in from nothing at the very top.
    case emerging
    /// Dissolves into the unwritten at the bottom.
    case fading
    /// Solid above the Now beacon, dotted below it.
    case present
}

private struct HorizonRail: View {
    @Environment(\.theme) private var theme

    let style: HorizonRailStyle

    var body: some View {
        line
            .frame(width: HorizonMetrics.railWidth)
            .frame(maxHeight: .infinity)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var line: some View {
        switch style {
        case .solid:
            solidLine
        case .dotted:
            dottedLine
        case .emerging:
            solidLine
                .mask {
                    LinearGradient(colors: [Color.clear, Color.black], startPoint: .top, endPoint: .bottom)
                }
        case .fading:
            dottedLine
                .mask {
                    LinearGradient(colors: [Color.black, Color.clear], startPoint: .top, endPoint: .bottom)
                }
        case .present:
            VStack(spacing: 0) {
                solidLine
                dottedLine
            }
        }
    }

    private var solidLine: some View {
        HorizonLineShape()
            .stroke(theme.accent.opacity(0.6), style: StrokeStyle(lineWidth: 1.5, lineCap: .butt))
            .shadow(color: theme.glow.opacity(0.7), radius: 3)
    }

    private var dottedLine: some View {
        HorizonLineShape()
            .stroke(
                theme.accent.opacity(0.5),
                style: StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [0.1, 6])
            )
    }
}

private struct HorizonLineShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        return path
    }
}

// MARK: - Header & empty state

private struct HorizonHeader: View {
    @Environment(\.theme) private var theme

    let now: Date
    let travellingCount: Int
    let readyCount: Int
    let next: TimeCapsule?
    let isEmpty: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("The river of time")
                .font(theme.label(12, weight: .semibold))
                .tracking(1.6)
                .textCase(.uppercase)
                .foregroundStyle(theme.accent)
            Text("Horizon")
                .font(theme.display(40))
                .foregroundStyle(theme.ink)
            summary
                .font(theme.body(16))
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
            readyLine
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 28)
        .padding(.bottom, 8)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var summary: Text {
        guard let next else {
            if isEmpty {
                return Text("Nothing is travelling yet.")
            }
            return Text("Nothing is travelling right now — the river is calm.")
        }
        let phrase = TimePhrase.relative(next.unlockDate, now: now)
        if travellingCount == 1 {
            return Text("One letter travelling · arrives \(phrase)")
        }
        return Text("\(travellingCount) letters travelling · next arrives \(phrase)")
    }

    @ViewBuilder
    private var readyLine: some View {
        if readyCount > 0 {
            HStack(spacing: 8) {
                Circle()
                    .fill(theme.glow)
                    .frame(width: 6, height: 6)
                    .shadow(color: theme.glow, radius: 4)
                readyText
                    .font(theme.label(13, weight: .medium))
                    .foregroundStyle(theme.accent)
            }
            .padding(.top, 2)
        }
    }

    private var readyText: Text {
        if readyCount == 1 {
            return Text("A letter is waiting to be opened")
        }
        return Text("\(readyCount) letters are waiting to be opened")
    }
}

private struct HorizonEmptyState: View {
    let onWrite: () -> Void

    var body: some View {
        VStack(spacing: 28) {
            EmptyStateView(
                symbol: "hourglass",
                title: "The river is still.",
                message: "Seal a letter and watch it drift toward the day it may be opened."
            )
            Button(action: onWrite) {
                Label("Write a letter", systemImage: "pencil.line")
            }
            .buttonStyle(.themedPrimary)
        }
        .padding(.top, 40)
        .frame(maxWidth: .infinity)
    }
}

private struct HorizonPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: 0.18), value: configuration.isPressed)
    }
}

// MARK: - Previews

#Preview("Horizon · Celestial") {
    ZStack {
        ThemeBackground()
        HorizonView()
    }
    .modelContainer(PreviewData.container)
    .environment(AppRouter())
    .environment(AppLock())
    .theme(.celestial)
}

#Preview("Horizon · Parchment") {
    ZStack {
        ThemeBackground()
        HorizonView()
    }
    .modelContainer(PreviewData.container)
    .environment(AppRouter())
    .environment(AppLock())
    .theme(.parchment)
}

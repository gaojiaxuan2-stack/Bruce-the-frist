import SwiftUI

/// A self-updating countdown to a capsule's unlock date.
/// - `.hero`: large numerals with tiny unit labels, ticking every second.
/// - `.compact`: a single quiet line such as "in 2y 3d".
struct CountdownView: View {
    enum Style {
        case hero
        case compact
    }

    private let target: Date
    private let style: Style

    init(to target: Date, style: Style = .compact) {
        self.target = target
        self.style = style
    }

    var body: some View {
        switch style {
        case .hero:
            TimelineView(.periodic(from: .now, by: 1)) { context in
                CountdownHeroFace(target: target, now: context.date)
            }
        case .compact:
            TimelineView(.periodic(from: .now, by: 15)) { context in
                CountdownCompactFace(target: target, now: context.date)
            }
        }
    }
}

// MARK: - Units

private struct CountdownUnit: Identifiable {
    /// Position in the row (0, 1, 2) – stable so digits can roll in place.
    let id: Int
    let value: Int
    let component: Calendar.Component

    var formattedValue: String {
        switch component {
        case .hour, .minute, .second:
            return value < 10 ? "0\(value)" : "\(value)"
        default:
            return "\(value)"
        }
    }

    var label: LocalizedStringKey {
        let single = value == 1
        switch component {
        case .year: return single ? "Year" : "Years"
        case .day: return single ? "Day" : "Days"
        case .hour: return single ? "Hour" : "Hours"
        case .minute: return single ? "Minute" : "Minutes"
        default: return single ? "Second" : "Seconds"
        }
    }
}

private enum CountdownMath {
    /// ≥ 1 year: Y·D·H, ≥ 1 day: D·H·M, otherwise H·M·S.
    static func units(from now: Date, to target: Date) -> [CountdownUnit] {
        let calendar = Calendar.current
        let start = Date(timeIntervalSinceReferenceDate: now.timeIntervalSinceReferenceDate.rounded(.down))
        let end = Date(timeIntervalSinceReferenceDate: target.timeIntervalSinceReferenceDate.rounded(.down))
        let years = calendar.dateComponents([.year], from: start, to: end).year ?? 0

        let components: [Calendar.Component]
        if years >= 1 {
            components = [.year, .day, .hour]
        } else if end.timeIntervalSince(start) >= 86_400 {
            components = [.day, .hour, .minute]
        } else {
            components = [.hour, .minute, .second]
        }

        let parts = calendar.dateComponents(Set(components), from: start, to: end)
        return components.enumerated().map { index, component in
            CountdownUnit(id: index, value: max(parts.value(for: component) ?? 0, 0), component: component)
        }
    }

    /// "2y 3d", "5d 4h", "12m" – locale aware.
    static func shortPhrase(from now: Date, to target: Date) -> String {
        let formatter = DateComponentsFormatter()
        formatter.calendar = Calendar.current
        formatter.unitsStyle = .abbreviated
        formatter.allowedUnits = [.year, .day, .hour, .minute]
        formatter.maximumUnitCount = 2
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: now, to: target) ?? TimePhrase.duration(from: now, to: target)
    }
}

private enum CountdownNumeralCenterID: AlignmentID {
    static func defaultValue(in context: ViewDimensions) -> CGFloat {
        context[VerticalAlignment.center]
    }
}

private enum CountdownLayout {
    /// Aligns the hairline dots with the optical centre of the numerals, not the whole column.
    static let numeralCenter = VerticalAlignment(CountdownNumeralCenterID.self)
}

// MARK: - Hero

private struct CountdownHeroFace: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let target: Date
    let now: Date

    private var isReady: Bool { now >= target }

    private var accessibilityText: Text {
        if isReady {
            return Text("It's time. Ready to open.")
        }
        return Text("Opens in \(TimePhrase.duration(from: now, to: target))")
    }

    var body: some View {
        ZStack {
            if isReady {
                CountdownReadyFace()
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            } else {
                CountdownNumerals(units: CountdownMath.units(from: now, to: target))
                    .transition(.opacity)
            }
        }
        .animation(reduceMotion ? nil : .smooth(duration: 0.8), value: isReady)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

private struct CountdownNumerals: View {
    let units: [CountdownUnit]

    var body: some View {
        ViewThatFits(in: .horizontal) {
            CountdownNumeralRow(units: units, numeralSize: 58, spacing: 18)
            CountdownNumeralRow(units: units, numeralSize: 44, spacing: 13)
            CountdownNumeralRow(units: units, numeralSize: 34, spacing: 9)
        }
    }
}

private struct CountdownNumeralRow: View {
    let units: [CountdownUnit]
    let numeralSize: CGFloat
    let spacing: CGFloat

    var body: some View {
        HStack(alignment: CountdownLayout.numeralCenter, spacing: spacing) {
            ForEach(units) { unit in
                if unit.id > 0 {
                    CountdownSeparator()
                }
                CountdownUnitColumn(unit: unit, numeralSize: numeralSize)
            }
        }
        .fixedSize()
    }
}

private struct CountdownUnitColumn: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let unit: CountdownUnit
    let numeralSize: CGFloat

    var body: some View {
        VStack(spacing: 7) {
            numeral
            Text(unit.label)
                .font(theme.label(10, weight: .semibold))
                .tracking(1.8)
                .textCase(.uppercase)
                .foregroundStyle(theme.inkSecondary)
        }
        .frame(minWidth: numeralSize * 0.9)
    }

    private var numeral: some View {
        Text(verbatim: unit.formattedValue)
            .font(theme.display(numeralSize, weight: .light))
            .monospacedDigit()
            .foregroundStyle(theme.ink)
            .contentTransition(.numericText(countsDown: true))
            .animation(reduceMotion ? nil : .snappy(duration: 0.45), value: unit.value)
            .alignmentGuide(CountdownLayout.numeralCenter) { dimensions in
                dimensions[VerticalAlignment.center]
            }
    }
}

private struct CountdownSeparator: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Circle()
            .fill(theme.inkSecondary.opacity(0.55))
            .frame(width: 3, height: 3)
            .accessibilityHidden(true)
    }
}

private struct CountdownReadyFace: View {
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "sparkles")
                .font(.system(size: 20, weight: .light))
                .foregroundStyle(theme.accent)
            Text("It's time")
                .font(theme.display(48, weight: .light))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
            Text("Ready to open")
                .font(theme.label(11, weight: .semibold))
                .tracking(2.4)
                .textCase(.uppercase)
                .foregroundStyle(theme.accent)
        }
    }
}

// MARK: - Compact

private struct CountdownCompactFace: View {
    @Environment(\.theme) private var theme

    let target: Date
    let now: Date

    private var remaining: TimeInterval { target.timeIntervalSince(now) }
    private var isReady: Bool { remaining <= 0 }

    private var phrase: Text {
        if isReady {
            return Text("Ready")
        }
        if remaining < 60 {
            return Text("in a moment")
        }
        return Text("in \(CountdownMath.shortPhrase(from: now, to: target))")
    }

    private var accessibilityText: Text {
        if isReady {
            return Text("Ready to open")
        }
        return Text("Opens in \(TimePhrase.duration(from: now, to: target))")
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: isReady ? "sparkles" : "hourglass")
                .font(.system(size: 11, weight: .medium))
            phrase
                .font(theme.label(13, weight: isReady ? .semibold : .medium))
                .monospacedDigit()
        }
        .foregroundStyle(isReady ? theme.accent : theme.inkSecondary)
        .lineLimit(1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

// MARK: - Previews

#Preview("Countdown") {
    VStack(spacing: 44) {
        CountdownView(to: Date.now.adding(.year, 2).adding(.day, 40), style: .hero)
        CountdownView(to: Date.now.adding(.day, 12).adding(.hour, 5), style: .hero)
        CountdownView(to: Date.now.adding(.second, 8), style: .hero)
        CountdownView(to: Date.now.adding(.day, 12))
        CountdownView(to: Date.now.adding(.day, -1))
    }
    .padding(24)
    .frame(maxWidth: .infinity, maxHeight: .infinity)
    .background { ThemeBackground() }
    .theme(.celestial)
}

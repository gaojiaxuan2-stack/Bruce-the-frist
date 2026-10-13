import SwiftUI

// MARK: - SectionHeader

/// An editorial section title: display type followed by a hairline that fades into the margin.
struct SectionHeader: View {
    @Environment(\.theme) private var theme

    private let title: LocalizedStringKey
    private let subtitle: LocalizedStringKey?

    init(_ title: LocalizedStringKey, subtitle: LocalizedStringKey? = nil) {
        self.title = title
        self.subtitle = subtitle
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(alignment: .center, spacing: 12) {
                Text(title)
                    .font(theme.display(22))
                    .foregroundStyle(theme.ink)
                    .layoutPriority(1)
                hairline
            }
            if let subtitle {
                Text(subtitle)
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var hairline: some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [theme.inkSecondary.opacity(0.3), theme.inkSecondary.opacity(0)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
            )
            .frame(height: 0.5)
            .frame(minWidth: 16)
            .accessibilityHidden(true)
    }
}

// MARK: - EmptyStateView

/// A quiet, centred invitation: a symbol held inside slow ripples of time.
struct EmptyStateView: View {
    @Environment(\.theme) private var theme

    private let symbol: String
    private let title: LocalizedStringKey
    private let message: LocalizedStringKey

    init(symbol: String, title: LocalizedStringKey, message: LocalizedStringKey) {
        self.symbol = symbol
        self.title = title
        self.message = message
    }

    var body: some View {
        VStack(spacing: 24) {
            CommonEmptyEmblem(symbol: symbol)
            VStack(spacing: 10) {
                Text(title)
                    .font(theme.display(26))
                    .foregroundStyle(theme.ink)
                Text(message)
                    .font(theme.body(16))
                    .foregroundStyle(theme.inkSecondary)
                    .lineSpacing(3)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: 300)
        }
        .padding(.vertical, 32)
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}

private struct CommonEmptyEmblem: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let symbol: String

    var body: some View {
        ZStack {
            ripples
            Circle()
                .fill(theme.surface)
                .overlay {
                    Circle().strokeBorder(theme.surfaceStroke, lineWidth: 0.75)
                }
                .frame(width: 78, height: 78)
            Image(systemName: symbol)
                .font(.system(size: 28, weight: .light))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(theme.accent)
        }
        .frame(width: 172, height: 172)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var ripples: some View {
        if reduceMotion {
            CommonEmptyRipples()
        } else {
            CommonEmptyRipples()
                .phaseAnimator([false, true]) { rings, expanded in
                    rings
                        .scaleEffect(expanded ? 1.05 : 0.97)
                        .opacity(expanded ? 0.6 : 1)
                } animation: { _ in
                    .easeInOut(duration: 3.6)
                }
        }
    }
}

private struct CommonEmptyRipples: View {
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .strokeBorder(theme.surfaceStroke, lineWidth: 0.75)
                    .frame(width: 108 + CGFloat(index) * 32, height: 108 + CGFloat(index) * 32)
                    .opacity(1 - Double(index) * 0.3)
            }
            // A single point of light travelling the middle orbit – a moment in time.
            Circle()
                .fill(theme.accent)
                .frame(width: 5, height: 5)
                .offset(y: -70)
                .rotationEffect(.degrees(38))
        }
    }
}

// MARK: - StateBadge

/// "Sealed" / "Ready" / "Opened" pill.
struct StateBadge: View {
    @Environment(\.theme) private var theme

    private let state: CapsuleState

    init(state: CapsuleState) {
        self.state = state
    }

    var body: some View {
        HStack(spacing: 5) {
            Image(systemName: symbol)
                .font(.system(size: 9, weight: .bold))
            Text(title)
                .font(theme.label(11, weight: .semibold))
                .tracking(1)
                .textCase(.uppercase)
        }
        .foregroundStyle(foreground)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(fill, in: Capsule(style: .continuous))
        .overlay {
            Capsule(style: .continuous).strokeBorder(stroke, lineWidth: 0.5)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(title))
    }

    private var title: LocalizedStringKey {
        switch state {
        case .draft: return "Draft"
        case .sealed: return "Sealed"
        case .ready: return "Ready"
        case .opened: return "Opened"
        }
    }

    private var symbol: String {
        switch state {
        case .draft: return "pencil"
        case .sealed: return "lock.fill"
        case .ready: return "sparkles"
        case .opened: return "envelope.open"
        }
    }

    private var foreground: Color {
        switch state {
        case .draft, .sealed: return theme.inkSecondary
        case .ready: return theme.accentInk
        case .opened: return theme.ink
        }
    }

    private var fill: Color {
        switch state {
        case .draft: return Color.clear
        case .sealed, .opened: return theme.surface
        case .ready: return theme.accent
        }
    }

    private var stroke: Color {
        state == .ready ? Color.clear : theme.surfaceStroke
    }
}

// MARK: - ProgressRing

/// A slim ring tracing how far a capsule has travelled towards its date.
struct ProgressRing: View {
    @Environment(\.theme) private var theme

    private let progress: Double
    private let lineWidth: CGFloat

    init(progress: Double, lineWidth: CGFloat = 4) {
        self.progress = progress
        self.lineWidth = lineWidth
    }

    private var clamped: Double { min(max(progress, 0), 1) }

    private var arcGradient: AngularGradient {
        AngularGradient(
            colors: [theme.accent.opacity(0.35), theme.accent],
            center: .center,
            startAngle: .degrees(0),
            endAngle: .degrees(max(360 * clamped, 1))
        )
    }

    private var glowOpacity: Double {
        theme.colorScheme == .dark ? 0.45 : 0.18
    }

    var body: some View {
        ZStack {
            Circle()
                .stroke(theme.inkSecondary.opacity(0.18), lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(clamped))
                .stroke(arcGradient, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: theme.accent.opacity(glowOpacity), radius: lineWidth, x: 0, y: 0)
        }
        .padding(lineWidth / 2)
        .animation(.smooth(duration: 0.9), value: clamped)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Journey"))
        .accessibilityValue(Text(clamped, format: .percent.precision(.fractionLength(0))))
    }
}

// MARK: - Previews

#Preview("Common views") {
    ScrollView {
        VStack(alignment: .leading, spacing: 28) {
            SectionHeader("Travelling", subtitle: "Letters still on their way")
            HStack(spacing: 10) {
                StateBadge(state: .sealed)
                StateBadge(state: .ready)
                StateBadge(state: .opened)
            }
            HStack(spacing: 24) {
                ProgressRing(progress: 0.18)
                    .frame(width: 44, height: 44)
                ProgressRing(progress: 0.64, lineWidth: 6)
                    .frame(width: 64, height: 64)
                ProgressRing(progress: 1, lineWidth: 2.5)
                    .frame(width: 30, height: 30)
            }
            EmptyStateView(
                symbol: "envelope",
                title: "Nothing sealed yet",
                message: "Write to the person you will be. Choose a day, seal it, and let time carry it there."
            )
        }
        .padding(20)
    }
    .background { ThemeBackground() }
    .theme(.parchment)
}

import SwiftUI
import SwiftData

/// A letter in the vault: its seal (in the capsule's own style), title and addressees,
/// a perforated rule, and a quiet line about where it is in time.
/// Never reveals any content of a sealed capsule.
struct CapsuleCard: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private let capsule: TimeCapsule
    private let now: Date

    init(capsule: TimeCapsule, now: Date) {
        self.capsule = capsule
        self.now = now
    }

    private var state: CapsuleState { capsule.state(at: now) }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            CapsuleCardPerforation()
                .stroke(theme.surfaceStroke, style: StrokeStyle(lineWidth: 1.2, lineCap: .round, dash: [0.1, 4.5]))
                .frame(height: 1.2)
                .accessibilityHidden(true)
            footer
        }
        .themedCard(padding: 18)
        .themedGlow(state == .ready)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: accessibilitySummary))
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            seal
            titleBlock
            emblem
        }
    }

    private var seal: some View {
        SealView(monogram: capsule.monogram)
            .theme(capsule.theme.theme)
            .frame(width: 46, height: 46)
            .saturation(state == .opened ? 0.7 : 1)
            .opacity(state == .opened ? 0.78 : 1)
    }

    private var titleText: Text {
        capsule.title.isEmpty ? Text("Untitled letter") : Text(capsule.title)
    }

    private var titleBlock: some View {
        VStack(alignment: .leading, spacing: 5) {
            if capsule.isIncoming {
                receivedTag
            }
            titleText
                .font(theme.display(20))
                .foregroundStyle(theme.ink)
                .lineLimit(2)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
            Text("To \(capsule.displayRecipient) · from \(capsule.displaySender)")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var receivedTag: some View {
        HStack(spacing: 4) {
            Image(systemName: "arrow.down.left")
                .font(.system(size: 8, weight: .bold))
            Text("Received")
                .font(theme.label(10, weight: .semibold))
                .tracking(1.2)
                .textCase(.uppercase)
        }
        .foregroundStyle(theme.accent)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(theme.accent.opacity(0.12), in: Capsule(style: .continuous))
    }

    @ViewBuilder
    private var emblem: some View {
        switch state {
        case .sealed:
            CapsuleCardRingEmblem(
                progress: capsule.progress(at: now),
                symbol: "lock.fill",
                symbolColor: theme.inkSecondary
            )
        case .ready:
            CapsuleCardRingEmblem(progress: 1, symbol: "sparkle", symbolColor: theme.accent)
        case .opened:
            moodEmblem
        case .draft:
            EmptyView()
        }
    }

    @ViewBuilder
    private var moodEmblem: some View {
        if capsule.mood.isEmpty {
            Image(systemName: "envelope.open")
                .font(.system(size: 15, weight: .light))
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 36, height: 36)
        } else {
            Text(verbatim: capsule.mood)
                .font(.system(size: 19))
                .frame(width: 36, height: 36)
                .background(theme.surface, in: Circle())
                .overlay {
                    Circle().strokeBorder(theme.surfaceStroke, lineWidth: 0.5)
                }
        }
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        switch state {
        case .sealed:
            HStack(spacing: 12) {
                CountdownView(to: capsule.unlockDate, style: .compact)
                Spacer(minLength: 8)
                unlockDateText
            }
        case .ready:
            HStack(spacing: 12) {
                readyLabel
                Spacer(minLength: 8)
                unlockDateText
            }
        case .opened:
            HStack(spacing: 12) {
                openedLabel
                Spacer(minLength: 8)
            }
        case .draft:
            HStack(spacing: 6) {
                Image(systemName: "pencil")
                    .font(.system(size: 11, weight: .medium))
                Text("Draft")
                    .font(theme.label(13))
            }
            .foregroundStyle(theme.inkSecondary)
        }
    }

    private var unlockDateText: some View {
        Text(capsule.unlockDate, format: .dateTime.day().month(.abbreviated).year())
            .font(theme.label(12))
            .monospacedDigit()
            .foregroundStyle(theme.inkSecondary)
            .lineLimit(1)
    }

    private var readyLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkles")
                .font(.system(size: 12, weight: .semibold))
                .symbolEffect(.pulse, isActive: !reduceMotion)
            Text("Ready to open")
                .font(theme.label(13, weight: .semibold))
        }
        .foregroundStyle(theme.accent)
    }

    private var openedDateString: String {
        (capsule.openedAt ?? capsule.unlockDate).formatted(.dateTime.day().month(.abbreviated).year())
    }

    private var openedLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "envelope.open")
                .font(.system(size: 11, weight: .medium))
            Text("Opened \(openedDateString)")
                .font(theme.label(13))
        }
        .foregroundStyle(theme.inkSecondary)
        .lineLimit(1)
    }

    // MARK: Accessibility

    private var accessibilitySummary: String {
        var sentences: [String] = []
        if capsule.isIncoming {
            sentences.append(String(localized: "Received"))
        }
        sentences.append(capsule.title.isEmpty ? String(localized: "Untitled letter") : capsule.title)
        sentences.append(String(localized: "To \(capsule.displayRecipient), from \(capsule.displaySender)"))
        switch state {
        case .sealed:
            let when = TimePhrase.relative(capsule.unlockDate, now: now)
            sentences.append(String(localized: "Sealed. Opens \(when)"))
        case .ready:
            sentences.append(String(localized: "Ready to open"))
        case .opened:
            let when = TimePhrase.longDate(capsule.openedAt ?? capsule.unlockDate)
            sentences.append(String(localized: "Opened on \(when)"))
        case .draft:
            sentences.append(String(localized: "Draft"))
        }
        // One phrase per line: VoiceOver pauses at each break, and no language-specific
        // punctuation is glued between localized phrases.
        return sentences.joined(separator: "\n")
    }
}

// MARK: - Pieces

/// A small progress ring with a glyph at its heart.
private struct CapsuleCardRingEmblem: View {
    let progress: Double
    let symbol: String
    let symbolColor: Color

    var body: some View {
        ZStack {
            ProgressRing(progress: progress, lineWidth: 2.5)
            Image(systemName: symbol)
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(symbolColor)
        }
        .frame(width: 36, height: 36)
    }
}

/// A horizontal line through the middle of its frame – stroked dotted, like a perforation.
private struct CapsuleCardPerforation: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// MARK: - Previews

#Preview("Capsule cards") {
    CapsuleCardPreviewList()
        .modelContainer(PreviewData.container)
}

private struct CapsuleCardPreviewList: View {
    @Query(sort: \TimeCapsule.unlockDate) private var capsules: [TimeCapsule]
    @State private var themeID: ThemeID = .aurora

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                Picker("Style", selection: $themeID) {
                    ForEach(ThemeID.allCases) { id in
                        Text(id.theme.name).tag(id)
                    }
                }
                .pickerStyle(.segmented)
                ForEach(capsules) { capsule in
                    CapsuleCard(capsule: capsule, now: .now)
                }
            }
            .padding(20)
        }
        .background { ThemeBackground() }
        .theme(themeID.theme)
    }
}

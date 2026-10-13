import SwiftUI
import SwiftData

// MARK: - ComposeSealCeremonyView

/// The last page of the compose flow. The letter slides into its envelope, the flap
/// folds down, and the author presses and holds the seal until it stamps shut.
/// Then: “Sealed. See you on …”.
struct ComposeSealCeremonyView: View {
    let draft: ComposeDraft
    let onFinish: (TimeCapsule) -> Void

    @Environment(\.theme) private var theme
    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(SettingsKey.userName) private var storedUserName = ""

    @State private var phase: ComposeCeremonyPhase = .folding
    @State private var letterTucked = false
    @State private var windowCollapsed = false
    @State private var flapProgress: Double = 1
    @State private var holdProgress: Double = 0
    @State private var isPressing = false
    @State private var isStamped = false
    @State private var envelopeDip = false
    @State private var holdTask: Task<Void, Never>?
    @State private var showsShare = false

    /// How long the seal must be held.
    private let holdDuration: Double = 1.6

    init(draft: ComposeDraft, onFinish: @escaping (TimeCapsule) -> Void) {
        self.draft = draft
        self.onFinish = onFinish
    }

    var body: some View {
        GeometryReader { proxy in
            let stageWidth = envelopeWidth(for: proxy.size)
            VStack(spacing: 0) {
                headline
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 90, alignment: .bottom)
                Spacer(minLength: 12)
                stage(width: stageWidth)
                Spacer(minLength: 12)
                footer
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: 130, alignment: .top)
            }
            .padding(.horizontal, 28)
            .padding(.top, 8)
            .padding(.bottom, 16)
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .task {
            await runFolding()
        }
        .onDisappear {
            cancelHold()
        }
        .sheet(isPresented: $showsShare) {
            if let capsule = draft.sealedCapsule {
                ShareCapsuleSheet(capsule: capsule)
            }
        }
    }

    // MARK: Headline

    private var headline: some View {
        ZStack {
            if phase == .sealed {
                VStack(spacing: 10) {
                    Text("Sealed.")
                        .font(theme.display(44))
                        .foregroundStyle(theme.ink)
                    Text(sealedLine)
                        .font(theme.body(18))
                        .foregroundStyle(theme.inkSecondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .transition(.opacity.combined(with: .offset(y: 10)))
            } else {
                VStack(spacing: 10) {
                    Text("To \(draft.displayRecipient)")
                        .font(theme.label(11, weight: .semibold))
                        .tracking(2.4)
                        .textCase(.uppercase)
                        .foregroundStyle(theme.inkSecondary)
                    Text(draft.resolvedTitle)
                        .font(theme.display(28))
                        .foregroundStyle(theme.ink)
                        .multilineTextAlignment(.center)
                        .lineLimit(3)
                }
                .transition(.opacity)
            }
        }
    }

    private var sealedLine: LocalizedStringKey {
        let date = TimePhrase.longDate(draft.unlockDate)
        if draft.recipientKind == .someone {
            let name = draft.displayRecipient
            return "\(name) may open it on \(date)."
        }
        return "See you on \(date)."
    }

    // MARK: Stage

    /// Wide enough to feel generous, narrow enough that the letter, the envelope,
    /// the headline and the footer all fit on the smallest phones.
    private func envelopeWidth(for size: CGSize) -> CGFloat {
        let byWidth: CGFloat = min(size.width - 80, 340)
        let byHeight: CGFloat = (size.height - 270) / 1.15
        return max(min(byWidth, byHeight), 180)
    }

    private func stage(width: CGFloat) -> some View {
        let envelopeHeight = width / 1.45
        let letterHeight = envelopeHeight * 0.92
        let windowHeight = windowCollapsed ? 0 : letterHeight * 0.72
        return VStack(spacing: 0) {
            letterWindow(width: width, letterHeight: letterHeight)
                .frame(height: windowHeight)
                .zIndex(1)
            envelope(width: width, height: envelopeHeight)
                .zIndex(0)
        }
    }

    /// The region above the envelope's mouth. The letter is clipped at its lower edge,
    /// so sliding down looks like slipping into the pocket.
    private func letterWindow(width: CGFloat, letterHeight: CGFloat) -> some View {
        Color.clear
            .frame(width: width)
            .overlay(alignment: .bottom) {
                ComposeCeremonyLetter(title: draft.resolvedTitle, message: draft.trimmedMessage)
                    .frame(width: width * 0.8, height: letterHeight)
                    .offset(y: letterTucked ? letterHeight + 8 : letterHeight * 0.28)
            }
            .clipped()
            .accessibilityHidden(true)
    }

    private func envelope(width: CGFloat, height: CGFloat) -> some View {
        let sealSize = width * 0.27
        let controlDiameter = sealSize * 1.4 + 30
        return EnvelopeView(openProgress: flapProgress, monogram: draft.monogram, showsSeal: false)
            .frame(width: width, height: height)
            .overlay(alignment: .top) {
                sealControl(size: sealSize)
                    .offset(y: height * 0.52 - controlDiameter / 2)
            }
            .scaleEffect(envelopeDip ? 0.975 : 1)
            .shadow(color: Color.black.opacity(0.22), radius: 26, y: 16)
    }

    // MARK: Seal

    private var sealScale: CGFloat {
        if isStamped { return 1 }
        return isPressing ? 1.36 : 1.4
    }

    private var sealOpacity: Double {
        if isStamped { return 1 }
        return 0.28 + 0.5 * holdProgress
    }

    private func sealControl(size: CGFloat) -> some View {
        let diameter = size * 1.4 + 30
        return ZStack {
            holdRing(diameter: diameter)
                .opacity(phase == .awaitingSeal ? 1 : 0)
            if isStamped && !reduceMotion {
                ComposeCeremonyRipple(color: theme.glow)
                    .frame(width: size, height: size)
            }
            SealView(monogram: draft.monogram)
                .frame(width: size, height: size)
                .scaleEffect(sealScale)
                .opacity(sealOpacity)
                .shadow(
                    color: Color.black.opacity(isStamped ? 0.28 : 0.14),
                    radius: isStamped ? 3 : 16,
                    y: isStamped ? 2 : 12
                )
        }
        .frame(width: diameter, height: diameter)
        .opacity(phase == .folding ? 0 : 1)
        .contentShape(Circle())
        .onLongPressGesture(
            minimumDuration: 60,
            maximumDistance: 64,
            perform: {},
            onPressingChanged: handlePressing
        )
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Seal"))
        .accessibilityHint(Text("Press and hold to seal the letter."))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            completeSeal()
        }
    }

    private func holdRing(diameter: CGFloat) -> some View {
        ZStack {
            Circle()
                .stroke(theme.ink.opacity(0.14), lineWidth: 2)
            Circle()
                .trim(from: 0, to: holdProgress)
                .stroke(theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: theme.glow.opacity(0.8), radius: 6)
        }
        .frame(width: diameter, height: diameter)
        .themedGlow(phase == .awaitingSeal && !isPressing)
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        switch phase {
        case .folding:
            Text("Folding your words…")
                .font(theme.body(16))
                .italic()
                .foregroundStyle(theme.inkSecondary)
                .transition(.opacity)
        case .awaitingSeal:
            VStack(spacing: 10) {
                Text("Press and hold to seal")
                    .font(theme.display(22))
                    .foregroundStyle(theme.ink)
                Text(sealWarning)
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .transition(.opacity)
        case .stamping:
            Text("Sealing…")
                .font(theme.body(16))
                .italic()
                .foregroundStyle(theme.inkSecondary)
                .transition(.opacity)
        case .sealed:
            sealedActions
                .transition(.opacity.combined(with: .offset(y: 16)))
        }
    }

    private var sealWarning: LocalizedStringKey {
        let date = TimePhrase.longDate(draft.unlockDate)
        return "Once sealed, no one — not even you — can open it before \(date)."
    }

    private var sealedActions: some View {
        VStack(spacing: 12) {
            Text("It rests in your vault now, travelling quietly toward that day.")
                .font(theme.label(13))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 8)
            if draft.recipientKind == .someone {
                Button {
                    Haptics.tap()
                    showsShare = true
                } label: {
                    Label("Share with \(draft.displayRecipient)", systemImage: "paperplane")
                }
                .buttonStyle(.themedPrimary)
                Button("Done", action: finish)
                    .buttonStyle(.themedSecondary)
            } else {
                Button("Done", action: finish)
                    .buttonStyle(.themedPrimary)
            }
        }
        .disabled(draft.sealedCapsule == nil)
    }

    // MARK: Choreography

    private func runFolding() async {
        if draft.sealedCapsule != nil {
            letterTucked = true
            windowCollapsed = true
            flapProgress = 0
            isStamped = true
            phase = .sealed
            return
        }
        guard phase == .folding else { return }
        let gentle = !reduceMotion

        guard await pause(gentle ? 0.45 : 0.1) else { return }
        withAnimation(.easeInOut(duration: gentle ? 1.15 : 0.2)) {
            letterTucked = true
        }

        guard await pause(gentle ? 1.05 : 0.2) else { return }
        Haptics.soft()
        withAnimation(.easeInOut(duration: gentle ? 0.8 : 0.2)) {
            flapProgress = 0
            windowCollapsed = true
        }

        guard await pause(gentle ? 0.75 : 0.2) else { return }
        withAnimation(.smooth(duration: 0.6)) {
            phase = .awaitingSeal
        }
    }

    /// Sleeps; returns false when the view went away in the meantime.
    private func pause(_ seconds: Double) async -> Bool {
        do {
            try await Task.sleep(for: .seconds(seconds))
            return true
        } catch {
            return false
        }
    }

    private func handlePressing(_ pressing: Bool) {
        guard phase == .awaitingSeal else { return }
        if pressing {
            beginHold()
        } else {
            cancelHold()
        }
    }

    /// The ring fills over `holdDuration` while the haptics grow firmer;
    /// letting go early lets the ring drain away.
    private func beginHold() {
        holdTask?.cancel()
        withAnimation(.easeOut(duration: 0.2)) {
            isPressing = true
        }
        withAnimation(.linear(duration: holdDuration)) {
            holdProgress = 1
        }
        let steps = 16
        let interval = holdDuration / Double(steps)
        holdTask = Task { @MainActor in
            for index in 0..<steps {
                Haptics.intensity(0.15 + 0.85 * Double(index) / Double(steps - 1))
                do {
                    try await Task.sleep(for: .seconds(interval))
                } catch {
                    return
                }
            }
            completeSeal()
        }
    }

    private func cancelHold() {
        holdTask?.cancel()
        holdTask = nil
        guard phase == .awaitingSeal else { return }
        withAnimation(.smooth(duration: 0.35)) {
            holdProgress = 0
            isPressing = false
        }
    }

    private func completeSeal() {
        guard phase == .awaitingSeal, !isStamped else { return }
        holdTask = nil
        draft.isSealing = true
        Haptics.success()
        withAnimation(.smooth(duration: 0.3)) {
            phase = .stamping
        }
        // The seal comes down from its hover (1.4×) and settles with a little bounce.
        withAnimation(.spring(response: 0.34, dampingFraction: 0.5)) {
            isStamped = true
            isPressing = false
            holdProgress = 1
        }
        Task { @MainActor in
            withAnimation(.easeOut(duration: 0.08)) {
                envelopeDip = true
            }
            try? await Task.sleep(for: .milliseconds(90))
            withAnimation(.spring(response: 0.45, dampingFraction: 0.6)) {
                envelopeDip = false
            }
            try? await Task.sleep(for: .milliseconds(650))
            await persist()
            withAnimation(.smooth(duration: 0.9)) {
                phase = .sealed
            }
        }
    }

    private func persist() async {
        let capsule = draft.insertCapsule(into: modelContext)
        rememberSenderName()
        await CapsuleActions.seal(capsule, in: modelContext)
    }

    /// The first name someone signs with becomes their name in Settings.
    private func rememberSenderName() {
        let name = draft.trimmedSenderName
        let stored = storedUserName.trimmingCharacters(in: .whitespacesAndNewlines)
        if stored.isEmpty, !name.isEmpty {
            storedUserName = name
        }
    }

    private func finish() {
        guard let capsule = draft.sealedCapsule else { return }
        Haptics.soft()
        onFinish(capsule)
    }
}

private enum ComposeCeremonyPhase: Equatable {
    case folding
    case awaitingSeal
    case stamping
    case sealed
}

// MARK: - Pieces

/// A miniature of the letter itself — its title and the first lines in tiny type.
private struct ComposeCeremonyLetter: View {
    @Environment(\.theme) private var theme
    let title: String
    let message: String

    var body: some View {
        StationeryView()
            .overlay(alignment: .topLeading) {
                VStack(alignment: .leading, spacing: 8) {
                    Text(title)
                        .font(theme.display(14))
                        .foregroundStyle(theme.ink)
                        .lineLimit(2)
                    Text(message)
                        .font(theme.body(8))
                        .foregroundStyle(theme.ink.opacity(0.7))
                        .lineSpacing(2.5)
                }
                .padding(18)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            }
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            .shadow(color: Color.black.opacity(0.16), radius: 10, y: 4)
    }
}

/// Two rings of light spreading from the freshly stamped seal.
private struct ComposeCeremonyRipple: View {
    let color: Color
    @State private var expanded = false

    var body: some View {
        ZStack {
            Circle()
                .stroke(color, lineWidth: 2)
                .scaleEffect(expanded ? 2.3 : 0.95)
                .opacity(expanded ? 0 : 0.85)
            Circle()
                .stroke(color.opacity(0.6), lineWidth: 1)
                .scaleEffect(expanded ? 3.1 : 0.95)
                .opacity(expanded ? 0 : 0.6)
        }
        .onAppear {
            withAnimation(.easeOut(duration: 1.1)) {
                expanded = true
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Preview

#Preview("Seal") {
    let draft = ComposeDraft(themeID: .parchment, senderName: "Bruce")
    draft.title = "To the one who survived senior year"
    draft.message = "Dear future me,\n\nI hope you still laugh at the same silly things. Tonight the rain sounds like applause."
    return ComposeSealCeremonyView(draft: draft) { _ in }
        .background(ThemeBackground())
        .screenTheme(ThemeID.parchment.theme)
        .modelContainer(PreviewData.container)
}

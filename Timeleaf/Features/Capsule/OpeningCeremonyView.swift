import SwiftUI
import SwiftData

// MARK: - CapsuleCeremonyScreen

/// The moment a letter arrives. The envelope glows; the reader presses and holds
/// the seal while a ring closes around it and the phone's pulse quickens; the seal
/// cracks in two, the style's burst blooms, the flap opens and the letter rises.
///
/// Incoming `.timeleaf` capsules are unpacked first (asking for the secret word
/// when the sender chose one), so the hold only becomes possible once the
/// content has actually been decrypted.
struct CapsuleCeremonyScreen: View {
    let capsule: TimeCapsule
    /// Called the moment the seal breaks (before the capsule is marked opened).
    let onBegin: () -> Void
    /// Called once the letter has risen and the capsule is marked opened.
    let onFinish: () -> Void

    @Environment(\.theme) private var theme
    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    // Package gate (incoming capsules)
    @State private var gate: CapsuleCeremonyGate
    @State private var secret = ""
    @State private var secretError: String?
    @State private var secretShakes = 0
    @State private var isUnlocking = false
    @FocusState private var secretFocused: Bool

    // Hold
    @GestureState private var isPressing = false
    @State private var holdProgress: Double = 0

    // Ceremony
    @State private var isBreaking = false
    @State private var sealBroken = false
    @State private var sealSplit: Double = 0
    @State private var shockCount = 0
    @State private var showsBurst = false
    @State private var openProgress: Double = 0
    @State private var letterRise: Double = 0
    @State private var letterForward = false

    private let holdDuration: Double = 1.8

    init(capsule: TimeCapsule, onBegin: @escaping () -> Void, onFinish: @escaping () -> Void) {
        self.capsule = capsule
        self.onBegin = onBegin
        self.onFinish = onFinish
        _gate = State(initialValue: CapsuleCeremonyGate.initial(for: capsule))
    }

    var body: some View {
        ZStack(alignment: .bottom) {
            if showsBurst {
                CeremonyBurst()
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
            GeometryReader { proxy in
                layout(CapsuleCeremonyMetrics(size: proxy.size))
            }
            .ignoresSafeArea(.keyboard)
            if gate == .needsSecret {
                secretCard
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .task { await unpackIfNeeded() }
        .task(id: isPressing) { await runHold() }
        .onChange(of: isPressing) { _, pressing in
            if pressing { beginHold() } else { endHold() }
        }
    }

    private func layout(_ metrics: CapsuleCeremonyMetrics) -> some View {
        VStack(spacing: 0) {
            Spacer(minLength: 56)
            header
            Spacer(minLength: 16)
            stage(metrics)
            Spacer(minLength: 16)
            footer
                .frame(minHeight: 64)
            Spacer(minLength: 24)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity)
    }

    // MARK: Header

    private var sealedDate: Date {
        capsule.sealedAt ?? capsule.createdAt
    }

    private var header: some View {
        VStack(spacing: 12) {
            CapsuleScreenEyebrow("The day has come · 时候到了")
            Text("It’s time.")
                .font(theme.display(46))
                .foregroundStyle(theme.ink)
            Text("Sealed on \(TimePhrase.longDate(sealedDate)), \(TimePhrase.duration(from: sealedDate, to: .now)) ago.")
                .font(theme.body(15).italic())
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            Text("To \(capsule.displayRecipient) · From \(capsule.displaySender)")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary.opacity(0.85))
        }
        .opacity(letterForward ? 0 : 1)
    }

    // MARK: Stage

    private func stage(_ metrics: CapsuleCeremonyMetrics) -> some View {
        ZStack {
            envelopeLayer(metrics)
            sealLayer(metrics)
            if isBreaking {
                letterLayer(metrics)
            }
        }
        .frame(width: metrics.envelopeWidth, height: metrics.stageHeight)
    }

    private func envelopeLayer(_ metrics: CapsuleCeremonyMetrics) -> some View {
        EnvelopeView(openProgress: openProgress, monogram: capsule.monogram, showsSeal: false)
            .frame(width: metrics.envelopeWidth, height: metrics.envelopeHeight)
            .themedGlow(!letterForward)
            .opacity(letterForward ? 0 : 1)
            .offset(y: letterForward ? 36 : 0)
            .frame(width: metrics.envelopeWidth, height: metrics.stageHeight, alignment: .bottom)
            .accessibilityHidden(true)
    }

    private func sealLayer(_ metrics: CapsuleCeremonyMetrics) -> some View {
        sealControl(size: metrics.sealSize)
            .frame(width: metrics.envelopeWidth, height: metrics.envelopeHeight)
            .frame(width: metrics.envelopeWidth, height: metrics.stageHeight, alignment: .bottom)
    }

    /// The letter emerges from the envelope's mouth (masked below it), then
    /// comes forward as the envelope sinks away.
    private func letterLayer(_ metrics: CapsuleCeremonyMetrics) -> some View {
        let riseOffset = -metrics.envelopeHeight * 0.62 * CGFloat(letterRise)
        let forwardOffset = -metrics.envelopeHeight * 0.4
        let maskHeight = letterForward ? metrics.stageHeight + 160 : metrics.headroom + 1
        return CapsuleCeremonyLetter(recipient: capsule.displayRecipient)
            .frame(width: metrics.envelopeWidth * 0.84, height: metrics.envelopeHeight * 0.9)
            .scaleEffect(letterForward ? 1.08 : 1)
            .offset(y: letterForward ? forwardOffset : riseOffset)
            .frame(width: metrics.envelopeWidth, height: metrics.stageHeight, alignment: .bottom)
            .mask(alignment: .top) {
                Rectangle()
                    .frame(height: maskHeight)
            }
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }

    // MARK: Seal & hold ring

    private var canHold: Bool {
        gate == .open && !isBreaking
    }

    private func sealControl(size: CGFloat) -> some View {
        let ringSize = size + 30
        return ZStack {
            holdGlow(size: ringSize)
            invitation(size: ringSize)
            holdRing(size: ringSize)
            SealView(monogram: capsule.monogram)
                .frame(width: size, height: size)
                .shadow(color: .black.opacity(0.22), radius: 6, y: 3)
                .opacity(sealBroken ? 0 : 1)
            CapsuleScreenSealHalves(monogram: capsule.monogram, split: sealSplit, fades: true)
                .frame(width: size, height: size)
                .opacity(sealBroken ? 1 : 0)
            shockwave(size: size)
        }
        .frame(width: ringSize, height: ringSize)
        .contentShape(Circle())
        .scaleEffect(isPressing && canHold ? 0.94 : 1)
        .animation(.spring(duration: 0.3, bounce: 0.3), value: isPressing)
        .gesture(holdGesture)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Seal"))
        .accessibilityHint(Text("Press and hold to break the seal"))
        .accessibilityAddTraits(.isButton)
        .accessibilityAction {
            if canHold { breakSeal() }
        }
    }

    private func holdGlow(size: CGFloat) -> some View {
        Circle()
            .fill(theme.glow)
            .frame(width: size, height: size)
            .blur(radius: 22)
            .opacity(0.12 + 0.5 * holdProgress)
            .scaleEffect(0.85 + 0.45 * holdProgress)
            .allowsHitTesting(false)
    }

    @ViewBuilder
    private func invitation(size: CGFloat) -> some View {
        if canHold && !isPressing && !reduceMotion {
            Circle()
                .stroke(theme.glow.opacity(0.9), lineWidth: 1.2)
                .frame(width: size, height: size)
                .phaseAnimator([0, 1, 2]) { view, phase in
                    view
                        .scaleEffect(phase == 2 ? 1.5 : 1)
                        .opacity(phase == 1 ? 0.8 : 0)
                } animation: { phase in
                    CapsuleCeremonyPulse.animation(for: phase)
                }
                .allowsHitTesting(false)
                .transition(.opacity)
        }
    }

    private func holdRing(size: CGFloat) -> some View {
        ZStack {
            Circle()
                .stroke(theme.ink.opacity(0.14), lineWidth: 1.5)
            Circle()
                .trim(from: 0, to: holdProgress)
                .stroke(theme.accent, style: StrokeStyle(lineWidth: 3, lineCap: .round))
                .rotationEffect(.degrees(-90))
                .shadow(color: theme.glow.opacity(0.9), radius: 5)
        }
        .frame(width: size, height: size)
        .opacity(canHold ? 1 : 0)
        .allowsHitTesting(false)
    }

    private func shockwave(size: CGFloat) -> some View {
        Circle()
            .stroke(theme.glow, lineWidth: 2)
            .frame(width: size, height: size)
            .keyframeAnimator(initialValue: CapsuleCeremonyShock(), trigger: shockCount) { view, value in
                view
                    .scaleEffect(value.scale)
                    .opacity(value.opacity)
            } keyframes: { _ in
                KeyframeTrack(\.scale) {
                    CubicKeyframe(3.0, duration: 0.9)
                }
                KeyframeTrack(\.opacity) {
                    LinearKeyframe(0.9, duration: 0.05)
                    LinearKeyframe(0, duration: 0.85)
                }
            }
            .allowsHitTesting(false)
    }

    // MARK: Footer

    @ViewBuilder
    private var footer: some View {
        switch gate {
        case .checking, .unpacking:
            HStack(spacing: 10) {
                ProgressView()
                    .tint(theme.accent)
                Text("Unfolding the package…")
                    .font(theme.body(16).italic())
                    .foregroundStyle(theme.inkSecondary)
            }
            .transition(.opacity)
        case .needsSecret:
            Color.clear
                .frame(height: 1)
        case .open:
            holdInstruction
                .transition(.opacity)
        case .stillSealed:
            Text("It is still on its way — this letter cannot be opened yet.")
                .font(theme.body(16).italic())
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .transition(.opacity)
        case .failed(let message):
            failure(message)
                .transition(.opacity)
        }
    }

    private var instructionTitle: LocalizedStringKey {
        isPressing ? "Keep holding…" : "Press and hold the seal"
    }

    private var holdInstruction: some View {
        VStack(spacing: 8) {
            Text(instructionTitle)
                .font(theme.body(19))
                .foregroundStyle(theme.ink)
                .contentTransition(.opacity)
            Text("长按封印")
                .font(theme.label(12, weight: .semibold))
                .tracking(3)
                .foregroundStyle(theme.inkSecondary)
        }
        .animation(.easeInOut(duration: 0.3), value: isPressing)
        .opacity(isBreaking ? 0 : 1)
        .animation(.easeOut(duration: 0.4), value: isBreaking)
    }

    private func failure(_ message: String) -> some View {
        VStack(spacing: 12) {
            Text(message)
                .font(theme.body(15).italic())
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
            Button("Try again") {
                Task { await unpack(passphrase: nil) }
            }
            .buttonStyle(.themedGhost)
        }
    }

    // MARK: Secret word

    private var trimmedSecret: String {
        secret.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var secretCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            secretHeading
            if !capsule.passphraseHint.isEmpty {
                Text("Hint · \(capsule.passphraseHint)")
                    .font(theme.body(15).italic())
                    .foregroundStyle(theme.inkSecondary)
            }
            secretField
            if let secretError {
                Text(secretError)
                    .font(theme.label(12))
                    .foregroundStyle(Color.red.opacity(0.85))
                    .transition(.opacity)
            }
            Button(action: submitSecret) {
                HStack(spacing: 8) {
                    if isUnlocking {
                        ProgressView()
                            .tint(theme.accentInk)
                    }
                    Text("Unlock")
                }
            }
            .buttonStyle(.themedPrimary)
            .disabled(trimmedSecret.isEmpty || isUnlocking)
        }
        .themedCard(padding: 22)
        .padding(.horizontal, 16)
        .padding(.bottom, 12)
    }

    private var secretHeading: some View {
        HStack(spacing: 12) {
            Image(systemName: "key")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(theme.accent)
                .frame(width: 36, height: 36)
                .background(theme.accent.opacity(0.12), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("A secret word guards this letter")
                    .font(theme.display(19))
                    .foregroundStyle(theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text("\(capsule.displaySender) chose it for you.")
                    .font(theme.label(12))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
    }

    private var secretField: some View {
        SecureField("Secret word", text: $secret)
            .font(theme.body(17))
            .foregroundStyle(theme.ink)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.go)
            .focused($secretFocused)
            .onSubmit(submitSecret)
            .themedField()
            .keyframeAnimator(initialValue: CapsuleCeremonyNudge(), trigger: secretShakes) { view, value in
                view.offset(x: value.x)
            } keyframes: { _ in
                KeyframeTrack(\.x) {
                    LinearKeyframe(-10, duration: 0.06)
                    LinearKeyframe(8, duration: 0.08)
                    LinearKeyframe(-5, duration: 0.08)
                    LinearKeyframe(3, duration: 0.07)
                    SpringKeyframe(0, duration: 0.3, spring: .bouncy)
                }
            }
    }

    // MARK: Unpacking

    private func unpackIfNeeded() async {
        guard gate == .checking else { return }
        await unpack(passphrase: nil)
    }

    /// Unpacks an incoming capsule that has no secret word.
    private func unpack(passphrase: String?) async {
        withAnimation(.easeInOut(duration: 0.3)) {
            gate = .unpacking
        }
        // A breath for the "unfolding" state; decryption itself runs off the main thread.
        try? await Task.sleep(for: .milliseconds(250))
        do {
            try await CapsulePackage.unpack(capsule, passphrase: passphrase, in: modelContext)
            Haptics.soft()
            withAnimation(.smooth(duration: 0.6)) {
                gate = .open
            }
        } catch CapsulePackageError.stillSealed {
            withAnimation(.smooth(duration: 0.4)) {
                gate = .stillSealed
            }
        } catch {
            withAnimation(.smooth(duration: 0.4)) {
                gate = .failed(error.localizedDescription)
            }
        }
    }

    private func submitSecret() {
        let word = trimmedSecret
        guard !word.isEmpty, !isUnlocking else { return }
        isUnlocking = true
        withAnimation(.easeOut(duration: 0.2)) {
            secretError = nil
        }
        Task {
            // A breath for the spinner; key derivation is deliberately slow.
            try? await Task.sleep(for: .milliseconds(120))
            do {
                try await CapsulePackage.unpack(capsule, passphrase: word, in: modelContext)
                isUnlocking = false
                secretFocused = false
                Haptics.soft()
                withAnimation(.smooth(duration: 0.6)) {
                    gate = .open
                }
            } catch CapsulePackageError.stillSealed {
                isUnlocking = false
                secretFocused = false
                withAnimation(.smooth(duration: 0.4)) {
                    gate = .stillSealed
                }
            } catch {
                isUnlocking = false
                Haptics.warning()
                secretShakes += 1
                withAnimation(.easeOut(duration: 0.25)) {
                    secretError = error.localizedDescription
                }
            }
        }
    }

    // MARK: Hold

    private var holdGesture: some Gesture {
        DragGesture(minimumDistance: 0)
            .updating($isPressing) { _, pressing, _ in
                pressing = true
            }
    }

    private func beginHold() {
        guard canHold else { return }
        Haptics.soft()
        withAnimation(.linear(duration: holdDuration)) {
            holdProgress = 1
        }
    }

    private func endHold() {
        guard !isBreaking else { return }
        withAnimation(.smooth(duration: 0.45)) {
            holdProgress = 0
        }
    }

    /// While the finger rests on the seal: a quickening, strengthening pulse,
    /// and the seal breaks once the ring has closed.
    private func runHold() async {
        guard isPressing, canHold else { return }
        let start = Date.now
        while !Task.isCancelled {
            let elapsed = Date.now.timeIntervalSince(start)
            if elapsed >= holdDuration {
                breakSeal()
                return
            }
            let progress = elapsed / holdDuration
            Haptics.intensity(0.2 + 0.8 * progress)
            let pause = min(max(0.07, 0.24 - 0.17 * progress), holdDuration - elapsed)
            try? await Task.sleep(for: .seconds(pause))
        }
    }

    // MARK: Ceremony

    private func breakSeal() {
        guard canHold else { return }
        withAnimation(.easeOut(duration: 0.25)) {
            isBreaking = true
        }
        onBegin()
        Task { await playCeremony() }
    }

    /// Seal cracks → burst → flap opens → letter rises → comes forward → reader.
    /// About 2.7 s, followed by the destination's crossfade.
    private func playCeremony() async {
        Haptics.rigid()
        var instant = Transaction()
        instant.disablesAnimations = true
        withTransaction(instant) {
            sealBroken = true
        }
        withAnimation(.easeOut(duration: reduceMotion ? 0.35 : 0.8)) {
            sealSplit = 1
            holdProgress = 0
        }
        if !reduceMotion {
            shockCount += 1
        }

        try? await Task.sleep(for: .milliseconds(160))
        withAnimation(.easeOut(duration: 0.5)) {
            showsBurst = true
        }

        try? await Task.sleep(for: .milliseconds(260))
        Haptics.soft()
        withAnimation(.timingCurve(0.55, 0, 0.25, 1, duration: 1.2)) {
            openProgress = 1
        }

        try? await Task.sleep(for: .milliseconds(820))
        withAnimation(.spring(duration: 0.9, bounce: 0.12)) {
            letterRise = 1
        }

        try? await Task.sleep(for: .milliseconds(760))
        Haptics.success()
        withAnimation(.smooth(duration: 0.7)) {
            letterForward = true
        }

        try? await Task.sleep(for: .milliseconds(620))
        // The cover may have been closed mid-ceremony and the letter deleted since;
        // never touch a model that is gone.
        guard !capsule.isDeleted, capsule.modelContext != nil else { return }
        CapsuleActions.markOpened(capsule, in: modelContext)
        onFinish()
    }
}

// MARK: - Broken seal (shared with the reader)

/// A seal split along a jagged crack. `split` 0 = whole, 1 = burst apart.
/// With `fades`, the halves dissolve as they separate (the ceremony); without,
/// they stay as a keepsake (the reader's header).
struct CapsuleScreenSealHalves: View {
    let monogram: String
    var split: Double
    var fades: Bool = false

    var body: some View {
        GeometryReader { proxy in
            halves(side: min(proxy.size.width, proxy.size.height))
                .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityHidden(true)
    }

    private func halves(side: CGFloat) -> some View {
        ZStack {
            half(leftSide: true, side: side)
            half(leftSide: false, side: side)
        }
        .scaleEffect(1 + 0.12 * split)
    }

    private func half(leftSide: Bool, side: CGFloat) -> some View {
        let direction: CGFloat = leftSide ? -1 : 1
        let amount = CGFloat(split)
        return SealView(monogram: monogram)
            .frame(width: side, height: side)
            .mask {
                CapsuleSealCrack(leftSide: leftSide)
            }
            .rotationEffect(.degrees(Double(direction) * 18 * split))
            .offset(x: direction * side * 0.2 * amount, y: side * 0.12 * amount)
            .opacity(fades ? 1 - split : 1)
    }
}

/// One side of a zig-zag crack running top to bottom through the seal.
/// The outer edges reach past the bounds so seal shadows survive the mask.
private struct CapsuleSealCrack: Shape {
    let leftSide: Bool

    private static let seam: [CGPoint] = [
        CGPoint(x: 0.53, y: -0.25),
        CGPoint(x: 0.53, y: 0.0),
        CGPoint(x: 0.45, y: 0.17),
        CGPoint(x: 0.56, y: 0.33),
        CGPoint(x: 0.44, y: 0.5),
        CGPoint(x: 0.57, y: 0.66),
        CGPoint(x: 0.46, y: 0.83),
        CGPoint(x: 0.52, y: 1.0),
        CGPoint(x: 0.52, y: 1.25),
    ]

    func path(in rect: CGRect) -> Path {
        func point(_ unit: CGPoint) -> CGPoint {
            CGPoint(x: rect.minX + unit.x * rect.width, y: rect.minY + unit.y * rect.height)
        }
        let outerX: CGFloat = leftSide ? -0.35 : 1.35
        var path = Path()
        path.move(to: point(CGPoint(x: outerX, y: -0.25)))
        for unit in Self.seam {
            path.addLine(to: point(unit))
        }
        path.addLine(to: point(CGPoint(x: outerX, y: 1.25)))
        path.closeSubpath()
        return path
    }
}

// MARK: - Private pieces

private enum CapsuleCeremonyGate: Equatable {
    /// Incoming package without a secret word, about to be unpacked.
    case checking
    case unpacking
    case needsSecret
    /// Content is local; the seal may be held.
    case open
    case stillSealed
    case failed(String)

    static func initial(for capsule: TimeCapsule) -> CapsuleCeremonyGate {
        guard capsule.isIncoming, capsule.packageFileName != nil else { return .open }
        return capsule.requiresPassphrase ? .needsSecret : .checking
    }
}

/// Sizes derived from the available space so the whole stage — including the
/// headroom the open flap and rising letter need — fits even on small phones.
private struct CapsuleCeremonyMetrics {
    let envelopeWidth: CGFloat

    init(size: CGSize) {
        let byWidth = size.width - 64
        let byHeight = (size.height - 340) / 1.7 * 1.45
        envelopeWidth = max(180, min(300, byWidth, byHeight))
    }

    var envelopeHeight: CGFloat { envelopeWidth / 1.45 }
    var headroom: CGFloat { envelopeHeight * 0.7 }
    var stageHeight: CGFloat { envelopeHeight + headroom }
    var sealSize: CGFloat { envelopeWidth * 0.24 }
}

private enum CapsuleCeremonyPulse {
    static func animation(for phase: Int) -> Animation {
        switch phase {
        case 1: return .easeIn(duration: 0.5)
        case 2: return .easeOut(duration: 1.6)
        default: return .linear(duration: 0.6)
        }
    }
}

private struct CapsuleCeremonyShock {
    var scale: CGFloat = 0.9
    var opacity: Double = 0
}

private struct CapsuleCeremonyNudge {
    var x: CGFloat = 0
}

/// The letter as it leaves the envelope: stationery, a salutation, and the
/// suggestion of handwriting — the words themselves wait for the reader.
private struct CapsuleCeremonyLetter: View {
    let recipient: String

    @Environment(\.theme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Dear \(recipient),")
                .font(theme.display(20))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            ForEach(0..<4, id: \.self) { line in
                Capsule()
                    .fill(theme.ink.opacity(0.13))
                    .frame(height: 3)
                    .frame(maxWidth: line == 3 ? 110 : .infinity, alignment: .leading)
            }
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background {
            StationeryView()
        }
        .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(theme.surfaceStroke, lineWidth: 0.5)
        }
        .shadow(color: .black.opacity(0.2), radius: 16, y: 8)
    }
}

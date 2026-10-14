import SwiftUI

// MARK: - CapsuleSealedScreen

/// A letter still travelling through time. Only the envelope is shown —
/// never the message, media or mood — with a calm countdown to its arrival.
struct CapsuleSealedScreen: View {
    let capsule: TimeCapsule
    /// Supplied once a second by `CapsuleDestinationView`.
    let now: Date
    let onDelete: () -> Void

    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var knockCount = 0
    @State private var whisperVisible = false
    @State private var whisperToken = 0
    @State private var showsShare = false
    @State private var confirmsDelete = false
    /// Whether the letter's memories fit in one shared file; measured once, on appear
    /// (the screen is rebuilt every second, so never in `body`).
    @State private var fitsInOneFile: Bool?

    private let envelopeWidth: CGFloat = 280

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(maxWidth: .infinity)
                    .frame(minHeight: proxy.size.height)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            actions
        }
        .onAppear(perform: measureShareSize)
        .sheet(isPresented: $showsShare) {
            ShareCapsuleSheet(capsule: capsule)
                .theme(theme)
        }
        .modifier(
            CapsuleScreenDeleteDialog(
                isPresented: $confirmsDelete,
                message: "It will never arrive. Its words and memories will be gone for good.",
                onDelete: onDelete
            )
        )
    }

    private var content: some View {
        VStack(spacing: 0) {
            CapsuleScreenEyebrow("Sealed · 封存中")
                .padding(.top, 60)
            envelope
                .padding(.top, 34)
            whisper
                .padding(.top, 18)
            addresses
                .padding(.top, 14)
            CapsuleScreenOrnament()
                .padding(.vertical, 26)
            CountdownView(to: capsule.unlockDate, style: .hero)
            arrival
                .padding(.top, 12)
            journey
                .padding(.top, 34)
                .padding(.bottom, 24)
        }
        .padding(.horizontal, 24)
    }

    // MARK: Envelope

    private var envelope: some View {
        Button(action: knock) {
            EnvelopeView(openProgress: 0, monogram: capsule.monogram)
                .frame(width: envelopeWidth, height: envelopeWidth / 1.45)
                .keyframeAnimator(initialValue: CapsuleSealedShake(), trigger: knockCount) { view, value in
                    view
                        .rotationEffect(.degrees(value.angle))
                        .offset(x: value.offset)
                } keyframes: { _ in
                    KeyframeTrack(\.offset) {
                        LinearKeyframe(-11, duration: 0.07)
                        LinearKeyframe(9, duration: 0.09)
                        LinearKeyframe(-6, duration: 0.09)
                        LinearKeyframe(3, duration: 0.08)
                        SpringKeyframe(0, duration: 0.32, spring: .bouncy)
                    }
                    KeyframeTrack(\.angle) {
                        LinearKeyframe(-2.4, duration: 0.07)
                        LinearKeyframe(1.8, duration: 0.09)
                        LinearKeyframe(-1.1, duration: 0.09)
                        LinearKeyframe(0.5, duration: 0.08)
                        SpringKeyframe(0, duration: 0.32, spring: .bouncy)
                    }
                }
        }
        .buttonStyle(CapsuleSealedPressStyle())
        .modifier(CapsuleSealedFloat(active: !reduceMotion, lift: 7))
        .background(alignment: .bottom) {
            floorShadow
                .offset(y: 26)
        }
        .accessibilityLabel(Text("Sealed letter to \(capsule.displayRecipient)"))
        .accessibilityHint(Text("Opens \(TimePhrase.relative(capsule.unlockDate, now: now))"))
    }

    /// A soft pool of shadow beneath the floating envelope, breathing with it.
    private var floorShadow: some View {
        Ellipse()
            .fill(Color.black.opacity(theme.colorScheme == .dark ? 0.45 : 0.16))
            .frame(width: envelopeWidth * 0.72, height: 16)
            .blur(radius: 12)
            .modifier(CapsuleSealedShadowBreath(active: !reduceMotion))
            .accessibilityHidden(true)
    }

    private var whisper: some View {
        Text("Not yet — 还未到时候")
            .font(theme.body(15).italic())
            .foregroundStyle(theme.inkSecondary)
            .opacity(whisperVisible ? 1 : 0)
            .blur(radius: whisperVisible ? 0 : 5)
            .offset(y: whisperVisible ? 0 : 5)
            .accessibilityHidden(!whisperVisible)
    }

    // MARK: Addresses & time

    private var addresses: some View {
        VStack(spacing: 8) {
            Text("To \(capsule.displayRecipient)")
                .font(theme.display(34))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
                .minimumScaleFactor(0.7)
            Text("From \(capsule.displaySender)")
                .font(theme.body(16).italic())
                .foregroundStyle(theme.inkSecondary)
            if !capsule.title.isEmpty {
                Text("“\(capsule.title)”")
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary.opacity(0.85))
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .padding(.top, 2)
            }
        }
    }

    private var arrival: some View {
        Text("Opens on \(TimePhrase.longDate(capsule.unlockDate))")
            .font(theme.label(13))
            .foregroundStyle(theme.inkSecondary)
            .multilineTextAlignment(.center)
    }

    private var journey: some View {
        VStack(spacing: 14) {
            CapsuleSealedJourneyLine(progress: capsule.progress(at: now))
            Text("Sealed on \(TimePhrase.longDate(sealedDate)) · travelling for \(TimePhrase.duration(from: sealedDate, to: now))")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: 420)
    }

    private var sealedDate: Date {
        capsule.sealedAt ?? capsule.createdAt
    }

    // MARK: Bottom actions

    /// An outgoing letter to someone dear; only these can travel as a file.
    private var isForSomeone: Bool {
        !capsule.isIncoming && capsule.recipientKind == .someone
    }

    private var canShare: Bool {
        isForSomeone && fitsInOneFile == true
    }

    /// Sealed with more memories than one shared file may carry, so sharing could only fail.
    private var isKeepsake: Bool {
        isForSomeone && fitsInOneFile == false
    }

    private var actions: some View {
        HStack(spacing: 12) {
            if canShare {
                Button {
                    Haptics.tap()
                    showsShare = true
                } label: {
                    Label("Share the letter", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.themedSecondary)
            } else if isKeepsake {
                keepsakeNote
                Spacer(minLength: 0)
            } else if isForSomeone {
                // Not measured yet (only for the moment before the screen appears).
                Spacer(minLength: 0)
            } else {
                Text("Kept safe until it arrives.")
                    .font(theme.label(12))
                    .foregroundStyle(theme.inkSecondary)
                Spacer(minLength: 0)
            }
            moreMenu
        }
        .padding(.horizontal, 24)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .background(alignment: .top) {
            LinearGradient(
                colors: [theme.background.opacity(0), theme.background.opacity(0.75)],
                startPoint: .top,
                endPoint: .bottom
            )
            .ignoresSafeArea()
            .allowsHitTesting(false)
        }
    }

    /// The same gentle note the seal ceremony shows for a letter too large to send.
    private var keepsakeNote: some View {
        Label {
            Text("Too large to send as a file, so it stays with you as a keepsake.")
        } icon: {
            Image(systemName: "shippingbox")
        }
        .font(theme.label(12))
        .foregroundStyle(theme.inkSecondary)
        .multilineTextAlignment(.leading)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func measureShareSize() {
        guard isForSomeone, fitsInOneFile == nil else { return }
        fitsInOneFile = CapsulePackage.canShare(capsule)
    }

    private var moreMenu: some View {
        Menu {
            Button(role: .destructive) {
                confirmsDelete = true
            } label: {
                Label("Delete letter", systemImage: "trash")
            }
        } label: {
            CapsuleScreenChromeIcon(systemName: "ellipsis", diameter: 50)
        }
        .accessibilityLabel(Text("More"))
    }

    // MARK: Knock

    /// Tapping a sealed envelope: it shakes, the phone answers with a warning
    /// tap, and a whisper reminds you that it is not time yet. With Reduce Motion
    /// on, the envelope stays still; the haptic and the whisper carry the answer.
    private func knock() {
        if !reduceMotion {
            knockCount += 1
        }
        Haptics.warning()
        whisperToken += 1
        let token = whisperToken
        withAnimation(.easeOut(duration: 0.35)) {
            whisperVisible = true
        }
        Task {
            try? await Task.sleep(for: .seconds(2.2))
            guard token == whisperToken else { return }
            withAnimation(.easeInOut(duration: 0.9)) {
                whisperVisible = false
            }
        }
    }
}

// MARK: - Private pieces

private struct CapsuleSealedShake {
    var offset: CGFloat = 0
    var angle: Double = 0
}

/// Slow vertical bob; static when Reduce Motion is on.
private struct CapsuleSealedFloat: ViewModifier {
    let active: Bool
    let lift: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([false, true]) { view, raised in
                view.offset(y: raised ? -lift : lift * 0.6)
            } animation: { _ in
                Animation.easeInOut(duration: 3.2)
            }
        } else {
            content
        }
    }
}

/// The floor shadow tightens as the envelope rises, in step with `CapsuleSealedFloat`.
private struct CapsuleSealedShadowBreath: ViewModifier {
    let active: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if active {
            content.phaseAnimator([false, true]) { view, raised in
                view
                    .scaleEffect(x: raised ? 0.82 : 1, y: 1)
                    .opacity(raised ? 0.6 : 1)
            } animation: { _ in
                Animation.easeInOut(duration: 3.2)
            }
        } else {
            content
        }
    }
}

private struct CapsuleSealedPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.985 : 1)
            .animation(.spring(duration: 0.25), value: configuration.isPressed)
    }
}

/// The journey from sealing to arrival: a solid, glowing path behind,
/// a dotted path ahead, and a small light where the letter is now.
private struct CapsuleSealedJourneyLine: View {
    let progress: Double

    @Environment(\.theme) private var theme

    private var clamped: Double {
        min(max(progress, 0), 1)
    }

    private var percent: String {
        clamped.formatted(.percent.precision(.fractionLength(0)))
    }

    var body: some View {
        VStack(spacing: 10) {
            GeometryReader { proxy in
                track(width: proxy.size.width)
            }
            .frame(height: 14)
            legend
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Journey"))
        .accessibilityValue(Text("\(percent) of the way"))
    }

    private func track(width: CGFloat) -> some View {
        let travelled = width * CGFloat(clamped)
        return ZStack(alignment: .leading) {
            CapsuleSealedRule()
                .stroke(
                    theme.inkSecondary.opacity(0.5),
                    style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [1.5, 5])
                )
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [theme.accent.opacity(0.15), theme.accent],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(width: travelled, height: 1.5)
            Circle()
                .fill(theme.accent)
                .frame(width: 9, height: 9)
                .shadow(color: theme.glow.opacity(0.9), radius: 6)
                .offset(x: travelled - 4.5)
        }
        .frame(width: width, height: 14)
    }

    private var legend: some View {
        HStack {
            Text("Sealed")
            Spacer()
            Text(percent)
                .monospacedDigit()
                .foregroundStyle(theme.accent)
            Spacer()
            Text("Arrives")
        }
        .font(theme.label(10, weight: .semibold))
        .tracking(1.6)
        .textCase(.uppercase)
        .foregroundStyle(theme.inkSecondary)
    }
}

private struct CapsuleSealedRule: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

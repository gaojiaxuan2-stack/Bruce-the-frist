import SwiftUI

// MARK: - OnboardingView

/// Four quiet pages that introduce Timeleaf: a salutation that writes itself,
/// what a letter can hold, why it cannot be opened early, and the choice of paper.
/// The whole onboarding re-themes live as the reader tries each style.
struct OnboardingView: View {
    private let onFinish: () -> Void

    @AppStorage(SettingsKey.theme) private var themeRaw = ThemeID.aurora.rawValue
    @AppStorage(SettingsKey.userName) private var userName = ""
    @State private var page: OnboardingPage = .dear
    @State private var hasFinished = false

    init(onFinish: @escaping () -> Void) {
        self.onFinish = onFinish
    }

    private var currentTheme: Theme { (ThemeID(rawValue: themeRaw) ?? .aurora).theme }

    var body: some View {
        OnboardingStage(page: $page) {
            begin()
        }
        .screenTheme(currentTheme)
    }

    private func begin() {
        guard !hasFinished else { return }
        hasFinished = true
        userName = userName.trimmingCharacters(in: .whitespacesAndNewlines)
        Haptics.success()
        Task { _ = await NotificationScheduler.requestAuthorization() }
        onFinish()
    }
}

// MARK: - Pages

private enum OnboardingPage: Int, CaseIterable, Identifiable {
    case dear
    case moment
    case peek
    case paper

    var id: Int { rawValue }

    var next: OnboardingPage? { OnboardingPage(rawValue: rawValue + 1) }
}

// MARK: - Stage

private struct OnboardingStage: View {
    @Environment(\.theme) private var theme
    @Binding var page: OnboardingPage
    let onBegin: () -> Void

    var body: some View {
        ZStack {
            ThemeBackground()
            VStack(spacing: 0) {
                topBar
                pager
                bottomBar
            }
        }
        .onChange(of: page) {
            Haptics.tap()
        }
    }

    private var topBar: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(verbatim: "Timeleaf")
                .font(theme.display(19))
                .foregroundStyle(theme.ink)
            Text(verbatim: "时笺")
                .font(theme.label(13, weight: .regular))
                .foregroundStyle(theme.inkSecondary)
            Spacer()
            skipButton
        }
        .padding(.horizontal, 24)
        .frame(height: 52)
    }

    private var skipButton: some View {
        Button {
            withAnimation(.smooth(duration: 0.7)) { page = .paper }
        } label: {
            Text("Skip")
                .font(theme.label(15, weight: .medium))
                .foregroundStyle(theme.inkSecondary)
                .padding(.vertical, 8)
                .padding(.leading, 20)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .opacity(page == .paper ? 0 : 1)
        .disabled(page == .paper)
        .animation(.smooth(duration: 0.3), value: page)
    }

    private var pager: some View {
        TabView(selection: $page) {
            OnboardingDearPage(isActive: page == .dear)
                .tag(OnboardingPage.dear)
            OnboardingMomentPage(isActive: page == .moment)
                .tag(OnboardingPage.moment)
            OnboardingPeekPage(isActive: page == .peek)
                .tag(OnboardingPage.peek)
            OnboardingPaperPage(isActive: page == .paper)
                .tag(OnboardingPage.paper)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))
    }

    private var bottomBar: some View {
        VStack(spacing: 20) {
            OnboardingPageIndicator(page: $page)
            Button(action: advance) {
                if page == .paper {
                    Text("Begin")
                } else {
                    Text("Continue")
                }
            }
            .buttonStyle(.themedPrimary)
            .animation(.smooth(duration: 0.4), value: page)
        }
        .padding(.horizontal, 24)
        .padding(.top, 8)
        .padding(.bottom, 16)
    }

    private func advance() {
        if let next = page.next {
            withAnimation(.smooth(duration: 0.7)) { page = next }
        } else {
            onBegin()
        }
    }
}

private struct OnboardingPageIndicator: View {
    @Environment(\.theme) private var theme
    @Binding var page: OnboardingPage

    var body: some View {
        HStack(spacing: 8) {
            ForEach(OnboardingPage.allCases) { item in
                Button {
                    withAnimation(.smooth(duration: 0.7)) { page = item }
                } label: {
                    Capsule()
                        .fill(item == page ? theme.accent : theme.ink.opacity(0.22))
                        .frame(width: item == page ? 26 : 7, height: 7)
                        .padding(.vertical, 8)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text("Page \(item.rawValue + 1) of \(OnboardingPage.allCases.count)"))
                .accessibilityAddTraits(item == page ? [.isSelected] : [])
            }
        }
        .animation(.smooth(duration: 0.45), value: page)
    }
}

// MARK: - Page 1 · Dear Future,

private struct OnboardingDearPage: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(SettingsKey.userName) private var userName = ""
    let isActive: Bool

    @State private var ink: CGFloat = 0
    @State private var flourish: CGFloat = 0
    @State private var showsLine = false
    @State private var stamped = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Spacer(minLength: 24)
            salutation
            subtitle
                .padding(.top, 26)
            Spacer(minLength: 24)
            seal
            Spacer(minLength: 16)
        }
        .padding(.horizontal, 32)
        .frame(maxWidth: .infinity, alignment: .leading)
        .onAppear {
            if isActive { write() }
        }
        .onChange(of: isActive) { _, active in
            if active { write() }
        }
    }

    private var salutation: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Dear Future,")
                .font(.custom("SnellRoundhand-Bold", size: 60, relativeTo: .largeTitle))
                .foregroundStyle(theme.ink)
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .padding(.vertical, 12)
                .padding(.horizontal, 8)
                .mask { OnboardingInkMask(progress: ink) }
            OnboardingFlourishShape()
                .trim(from: 0, to: flourish)
                .stroke(theme.accent, style: StrokeStyle(lineWidth: 1.6, lineCap: .round))
                .frame(width: 196, height: 18)
                .padding(.leading, 44)
        }
        .padding(.leading, -8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Dear Future,"))
        .accessibilityAddTraits(.isHeader)
    }

    private var subtitle: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Write to the person you are becoming.")
                .font(theme.body(21))
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(verbatim: "致 · 未来的你")
                .font(theme.label(13, weight: .medium))
                .tracking(3)
                .foregroundStyle(theme.inkSecondary)
        }
        .opacity(showsLine ? 1 : 0)
        .offset(y: showsLine || reduceMotion ? 0 : 10)
    }

    private var seal: some View {
        HStack {
            Spacer()
            SealView(monogram: Monogram.make(from: userName))
                .frame(width: 84, height: 84)
                .rotationEffect(.degrees(-8))
                .scaleEffect(stamped ? 1 : 1.5)
                .opacity(stamped ? 1 : 0)
        }
        .padding(.trailing, 8)
        .accessibilityHidden(true)
    }

    /// The pen moves left to right, the flourish follows, then the seal is pressed.
    private func write() {
        guard ink < 1 else { return }
        if reduceMotion {
            ink = 1
            flourish = 1
            showsLine = true
            stamped = true
            return
        }
        withAnimation(.easeInOut(duration: 2.2).delay(0.35)) { ink = 1 }
        withAnimation(.easeOut(duration: 0.9).delay(2.3)) { flourish = 1 }
        withAnimation(.smooth(duration: 0.9).delay(2.6)) { showsLine = true }
        withAnimation(.spring(duration: 0.5, bounce: 0.35).delay(3.2)) { stamped = true }
    }
}

/// A feathered mask that slides from left to right, like ink being laid down by a pen.
private struct OnboardingInkMask: View {
    var progress: CGFloat

    var body: some View {
        GeometryReader { proxy in
            let feather: CGFloat = 56
            let width = proxy.size.width + feather
            HStack(spacing: 0) {
                Rectangle()
                    .fill(Color.black)
                LinearGradient(
                    colors: [Color.black, Color.black.opacity(0)],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(width: feather)
            }
            .frame(width: width, height: proxy.size.height)
            .offset(x: (progress - 1) * width)
        }
    }
}

/// A single calligraphic underline stroke.
private struct OnboardingFlourishShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY + rect.height * 0.25))
        path.addCurve(
            to: CGPoint(x: rect.maxX, y: rect.midY - rect.height * 0.15),
            control1: CGPoint(x: rect.minX + rect.width * 0.32, y: rect.minY - rect.height * 0.45),
            control2: CGPoint(x: rect.minX + rect.width * 0.62, y: rect.maxY + rect.height * 0.55)
        )
        return path
    }
}

// MARK: - Page 2 · Seal a moment

private struct OnboardingMomentPage: View {
    @Environment(\.theme) private var theme
    @AppStorage(SettingsKey.userName) private var userName = ""
    let isActive: Bool

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 8)
            constellation
            Spacer(minLength: 8)
            OnboardingCopy(
                title: "Seal a moment",
                message: "Words, photos, your voice, a few seconds of video — folded into one letter and sealed.",
                isActive: isActive
            )
            Spacer(minLength: 20)
        }
    }

    private var constellation: some View {
        ZStack {
            Circle()
                .stroke(theme.ink.opacity(0.12), style: StrokeStyle(lineWidth: 0.75, dash: [2, 5]))
                .frame(width: 236, height: 236)
                .onboardingRise(isActive, delay: 0)
            SealView(monogram: Monogram.make(from: userName))
                .frame(width: 74, height: 74)
                .themedGlow(isActive)
                .onboardingRise(isActive, delay: 0.05)
            ForEach(OnboardingGlyph.all) { glyph in
                OnboardingGlyphCard(glyph: glyph)
                    .rotationEffect(.degrees(glyph.tilt))
                    .offset(glyph.offset)
                    .onboardingRise(isActive, delay: 0.15 + Double(glyph.id) * 0.12)
            }
        }
        .frame(height: 300)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Words, photos, voices and videos"))
    }
}

private struct OnboardingGlyph: Identifiable {
    let id: Int
    let symbol: String
    let title: LocalizedStringKey
    let offset: CGSize
    let tilt: Double
    let period: Double

    static var all: [OnboardingGlyph] {
        [
            OnboardingGlyph(
                id: 0, symbol: "pencil.line", title: "Words",
                offset: CGSize(width: -98, height: -88), tilt: -7, period: 3.4
            ),
            OnboardingGlyph(
                id: 1, symbol: MediaKind.photo.symbolName, title: "Photos",
                offset: CGSize(width: 100, height: -70), tilt: 6, period: 4.1
            ),
            OnboardingGlyph(
                id: 2, symbol: MediaKind.audio.symbolName, title: "Voices",
                offset: CGSize(width: -104, height: 80), tilt: 5, period: 3.8
            ),
            OnboardingGlyph(
                id: 3, symbol: MediaKind.video.symbolName, title: "Videos",
                offset: CGSize(width: 98, height: 96), tilt: -4, period: 4.5
            ),
        ]
    }
}

private struct OnboardingGlyphCard: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let glyph: OnboardingGlyph

    var body: some View {
        face
            .phaseAnimator([false, true]) { content, isUp in
                content.offset(y: reduceMotion ? 0 : (isUp ? -6 : 6))
            } animation: { _ in
                .easeInOut(duration: glyph.period)
            }
    }

    private var face: some View {
        VStack(spacing: 10) {
            Image(systemName: glyph.symbol)
                .font(.system(size: 24, weight: .light))
                .foregroundStyle(theme.accent)
            Text(glyph.title)
                .font(theme.label(13, weight: .medium))
                .foregroundStyle(theme.ink)
        }
        .frame(width: 76)
        .themedCard(padding: 16)
    }
}

// MARK: - Page 3 · No peeking

private struct OnboardingPeekPage: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AppStorage(SettingsKey.userName) private var userName = ""
    let isActive: Bool

    @State private var target = Date.now.adding(.year, 1)
    @State private var knocks: CGFloat = 0
    @State private var whispers = false
    @State private var whisperToken = 0

    var body: some View {
        VStack(spacing: 0) {
            Spacer(minLength: 8)
            envelope
                .onboardingRise(isActive, delay: 0)
            whisper
                .padding(.top, 14)
            CountdownView(to: target, style: .hero)
                .padding(.horizontal, 24)
                .padding(.top, 14)
                .onboardingRise(isActive, delay: 0.2)
            Spacer(minLength: 8)
            OnboardingCopy(
                title: "No peeking",
                message: "Not even you can open it before the day arrives.",
                isActive: isActive
            )
            Spacer(minLength: 20)
        }
    }

    private var envelope: some View {
        EnvelopeView(openProgress: 0, monogram: Monogram.make(from: userName), showsSeal: true)
            .frame(maxWidth: 240)
            .padding(.horizontal, 40)
            .modifier(OnboardingShake(animatableData: knocks))
            .contentShape(Rectangle())
            .onTapGesture { knock() }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Text("A sealed letter"))
            .accessibilityHint(Text("Try to open it"))
            .accessibilityAddTraits(.isButton)
    }

    private var whisper: some View {
        ZStack {
            Text("Tap the envelope")
                .font(theme.label(13, weight: .regular))
                .foregroundStyle(theme.inkSecondary.opacity(0.7))
                .opacity(whispers ? 0 : 1)
            Text("Not yet — 还未到时候")
                .font(theme.body(16))
                .italic()
                .foregroundStyle(theme.accent)
                .opacity(whispers ? 1 : 0)
                .offset(y: whispers ? 0 : 4)
        }
        .frame(height: 22)
    }

    private func knock() {
        Haptics.warning()
        // With Reduce Motion on, the envelope stays still; the haptic and the whisper answer.
        if !reduceMotion {
            withAnimation(.linear(duration: 0.5)) { knocks += 1 }
        }
        withAnimation(.smooth(duration: 0.3)) { whispers = true }
        whisperToken += 1
        let token = whisperToken
        Task {
            try? await Task.sleep(for: .seconds(1.8))
            if token == whisperToken {
                withAnimation(.smooth(duration: 0.6)) { whispers = false }
            }
        }
    }
}

/// A decaying horizontal shake; each whole step of `animatableData` is one shake.
private struct OnboardingShake: GeometryEffect {
    var animatableData: CGFloat

    func effectValue(size: CGSize) -> ProjectionTransform {
        let progress = animatableData - animatableData.rounded(.down)
        let dx = sin(progress * .pi * 6) * 9 * (1 - progress)
        return ProjectionTransform(CGAffineTransform(translationX: dx, y: 0))
    }
}

// MARK: - Page 4 · Choose your paper

private struct OnboardingPaperPage: View {
    @Environment(\.theme) private var theme
    @AppStorage(SettingsKey.theme) private var themeRaw = ThemeID.aurora.rawValue
    @AppStorage(SettingsKey.userName) private var userName = ""
    let isActive: Bool

    @FocusState private var isNameFocused: Bool

    private var selectedID: ThemeID { ThemeID(rawValue: themeRaw) ?? .aurora }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                content
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
            }
            .scrollIndicators(.hidden)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .onChange(of: isActive) { _, active in
            if !active { isNameFocused = false }
        }
    }

    private var content: some View {
        VStack(spacing: 26) {
            OnboardingCopy(
                title: "Choose your paper",
                message: "Every letter keeps the paper it was written on. You can change yours any time.",
                isActive: isActive
            )
            VStack(spacing: 12) {
                picker
                tagline
            }
            .onboardingRise(isActive, delay: 0.25)
            nameField
                .onboardingRise(isActive, delay: 0.35)
        }
        .padding(.vertical, 20)
    }

    private var picker: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal) {
                HStack(spacing: 14) {
                    ForEach(ThemeID.allCases, id: \.self) { id in
                        OnboardingStyleChip(
                            id: id,
                            monogram: Monogram.make(from: userName),
                            isSelected: id == selectedID
                        ) {
                            choose(id, reader: reader)
                        }
                        .id(id)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 12)
            }
            .scrollIndicators(.hidden)
            .onAppear {
                reader.scrollTo(selectedID, anchor: .center)
            }
        }
    }

    private var tagline: some View {
        Text(verbatim: theme.tagline)
            .font(theme.body(15))
            .italic()
            .foregroundStyle(theme.inkSecondary)
            .multilineTextAlignment(.center)
            .lineLimit(2)
            .padding(.horizontal, 32)
            .frame(minHeight: 40, alignment: .top)
            .id(theme.id)
            .transition(.opacity)
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("What should we call you?")
                .font(theme.label(14, weight: .medium))
                .foregroundStyle(theme.inkSecondary)
            HStack(spacing: 14) {
                TextField("Your name", text: $userName)
                    .font(theme.body(19))
                    .foregroundStyle(theme.ink)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($isNameFocused)
                    .onSubmit { isNameFocused = false }
                SealView(monogram: Monogram.make(from: userName))
                    .frame(width: 36, height: 36)
                    .animation(.smooth(duration: 0.4), value: userName)
                    .accessibilityHidden(true)
            }
            .themedField()
            Text("Your initials become your seal.")
                .font(theme.label(12, weight: .regular))
                .foregroundStyle(theme.inkSecondary.opacity(0.8))
        }
        .frame(maxWidth: 460)
        .padding(.horizontal, 28)
    }

    private func choose(_ id: ThemeID, reader: ScrollViewProxy) {
        guard id != selectedID else { return }
        Haptics.soft()
        withAnimation(.smooth(duration: 0.6)) {
            themeRaw = id.rawValue
            reader.scrollTo(id, anchor: .center)
        }
    }
}

private struct OnboardingStyleChip: View {
    @Environment(\.theme) private var theme
    let id: ThemeID
    let monogram: String
    let isSelected: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                OnboardingChipTile(monogram: monogram, isSelected: isSelected)
                    .theme(id.theme)
                VStack(spacing: 2) {
                    Text(verbatim: id.theme.name)
                        .font(theme.label(12, weight: isSelected ? .semibold : .regular))
                        .foregroundStyle(isSelected ? theme.ink : theme.inkSecondary)
                    Text(verbatim: id.theme.nativeName)
                        .font(theme.label(11, weight: .regular))
                        .foregroundStyle(theme.inkSecondary.opacity(0.8))
                }
            }
        }
        .buttonStyle(OnboardingPressStyle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(verbatim: "\(id.theme.name), \(id.theme.nativeName)"))
        .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : [.isButton])
    }
}

private struct OnboardingChipTile: View {
    @Environment(\.theme) private var theme
    let monogram: String
    let isSelected: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
    }

    var body: some View {
        ZStack {
            shape.fill(theme.background)
            shape.fill(theme.linearGradient).opacity(0.5)
            SealView(monogram: monogram)
                .frame(width: 36, height: 36)
        }
        .frame(width: 72, height: 96)
        .overlay {
            shape.strokeBorder(
                isSelected ? theme.accent : theme.surfaceStroke,
                lineWidth: isSelected ? 2 : 0.75
            )
        }
        .shadow(
            color: Color.black.opacity(isSelected ? 0.28 : 0.12),
            radius: isSelected ? 12 : 6,
            x: 0,
            y: isSelected ? 8 : 4
        )
        .scaleEffect(isSelected ? 1.06 : 1)
        .offset(y: isSelected ? -3 : 0)
        .animation(.smooth(duration: 0.4), value: isSelected)
    }
}

// MARK: - Shared page pieces

private struct OnboardingCopy: View {
    @Environment(\.theme) private var theme
    let title: LocalizedStringKey
    let message: LocalizedStringKey
    let isActive: Bool

    var body: some View {
        VStack(spacing: 14) {
            Text(title)
                .font(theme.display(38))
                .foregroundStyle(theme.ink)
                .accessibilityAddTraits(.isHeader)
                .onboardingRise(isActive, delay: 0.05)
            Text(message)
                .font(theme.body(18))
                .foregroundStyle(theme.inkSecondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .onboardingRise(isActive, delay: 0.18)
        }
        .multilineTextAlignment(.center)
        .frame(maxWidth: 440)
        .padding(.horizontal, 32)
    }
}

/// Content rises gently into place when its page becomes the current one.
private struct OnboardingRise: ViewModifier {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let isActive: Bool
    let delay: Double

    func body(content: Content) -> some View {
        content
            .opacity(isActive ? 1 : 0)
            .offset(y: isActive || reduceMotion ? 0 : 18)
            .blur(radius: isActive || reduceMotion ? 0 : 4)
            .animation(.smooth(duration: 0.8).delay(isActive ? delay : 0), value: isActive)
    }
}

private struct OnboardingPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.95 : 1)
            .animation(.smooth(duration: 0.2), value: configuration.isPressed)
    }
}

private extension View {
    func onboardingRise(_ isActive: Bool, delay: Double) -> some View {
        modifier(OnboardingRise(isActive: isActive, delay: delay))
    }
}

// MARK: - Preview

#Preview("Onboarding") {
    OnboardingView {}
}

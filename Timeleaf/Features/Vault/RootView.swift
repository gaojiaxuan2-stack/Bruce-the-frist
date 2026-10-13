import SwiftUI
import SwiftData
import UIKit

// MARK: - RootView

/// Home of Timeleaf: the active style's living backdrop, the selected destination
/// (Vault · Horizon · Styles) and a floating bar with a prominent “Write” button.
///
/// RootView also owns the two full-screen journeys of the app:
/// composing a new letter (`router.isComposing`) and visiting one
/// (`router.presentedCapsuleID`, resolved through the model context).
struct RootView: View {
    @Environment(AppRouter.self) private var router
    @Environment(AppLock.self) private var appLock
    @Environment(\.modelContext) private var modelContext
    @Environment(\.theme) private var theme

    @State private var presentation: RootCapsulePresentation?
    @State private var sealedNotice: RootSealedNotice?
    @State private var isKeyboardVisible = false

    var body: some View {
        ZStack {
            ThemeBackground()
            tabContent
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            bottomBar
        }
        .overlay(alignment: .top) {
            noticeOverlay
        }
        .fullScreenCover(isPresented: composingBinding, onDismiss: syncPresentation) {
            composeCover
        }
        .fullScreenCover(item: $presentation, onDismiss: capsuleCoverDidDismiss) { item in
            capsuleCover(for: item)
        }
        .onAppear(perform: syncPresentation)
        .onChange(of: router.presentedCapsuleID) {
            syncPresentation()
        }
        .onChange(of: appLock.isLocked) {
            syncPresentation()
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
            withAnimation(.smooth(duration: 0.25)) { isKeyboardVisible = true }
        }
        .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
            withAnimation(.smooth(duration: 0.3)) { isKeyboardVisible = false }
        }
    }

    // MARK: Content

    /// The selected destination, cross-fading softly when the tab changes.
    private var tabContent: some View {
        ZStack {
            switch router.selectedTab {
            case .vault:
                VaultView()
                    .transition(.opacity)
            case .horizon:
                HorizonView()
                    .transition(.opacity)
            case .styles:
                StylesView()
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    /// Lives in the bottom safe-area inset so every scroll view leaves room for it.
    @ViewBuilder
    private var bottomBar: some View {
        if !isKeyboardVisible {
            RootTabBar(onWrite: startWriting)
                .background(alignment: .bottom) { scrim }
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    /// A soft fade behind the bar so cards gliding beneath it never fight the labels.
    private var scrim: some View {
        LinearGradient(
            colors: [theme.background.opacity(0), theme.background.opacity(0.55)],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(height: 150)
        .ignoresSafeArea(edges: .bottom)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var noticeOverlay: some View {
        if let notice = sealedNotice {
            RootSealedNoticeView(notice: notice)
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .transition(.move(edge: .top).combined(with: .opacity))
                .onTapGesture { dismissNotice() }
                .task(id: notice.id) {
                    await autoDismissNotice(id: notice.id)
                }
        }
    }

    // MARK: Covers

    private var composingBinding: Binding<Bool> {
        @Bindable var bindableRouter = router
        return $bindableRouter.isComposing
    }

    private var composeCover: some View {
        ComposeFlowView { capsule in
            finishComposing(with: capsule)
        }
        .environment(router)
        .environment(appLock)
        .environment(\.theme, theme)
    }

    private func capsuleCover(for item: RootCapsulePresentation) -> some View {
        CapsuleDestinationView(capsule: item.capsule)
            .environment(router)
            .environment(appLock)
    }

    // MARK: Actions

    private func startWriting() {
        Haptics.soft()
        router.isComposing = true
    }

    private func finishComposing(with capsule: TimeCapsule?) {
        router.isComposing = false
        guard let capsule else { return }
        router.selectedTab = .vault
        let notice = RootSealedNotice(capsule: capsule)
        withAnimation(.smooth(duration: 0.6).delay(0.5)) {
            sealedNotice = notice
        }
    }

    /// Mirrors `router.presentedCapsuleID` into the capsule cover. Presentation waits
    /// while the compose cover is up or the app is locked, and resumes afterwards.
    private func syncPresentation() {
        guard let id = router.presentedCapsuleID else {
            if presentation != nil { presentation = nil }
            return
        }
        if presentation?.id == id { return }
        guard !router.isComposing, !appLock.isLocked else { return }

        if let capsule = fetchCapsule(id: id) {
            presentation = RootCapsulePresentation(capsule: capsule)
        } else {
            router.presentedCapsuleID = nil
        }
    }

    private func capsuleCoverDidDismiss() {
        // When one capsule replaced another, `presentation` already holds the new one.
        guard presentation == nil else { return }
        router.presentedCapsuleID = nil
    }

    private func fetchCapsule(id: UUID) -> TimeCapsule? {
        let capsules = (try? modelContext.fetch(FetchDescriptor<TimeCapsule>())) ?? []
        return capsules.first { $0.id == id }
    }

    private func dismissNotice() {
        withAnimation(.smooth(duration: 0.4)) { sealedNotice = nil }
    }

    private func autoDismissNotice(id: UUID) async {
        do {
            try await Task.sleep(for: .seconds(4.5))
        } catch {
            return
        }
        guard sealedNotice?.id == id else { return }
        withAnimation(.smooth(duration: 0.5)) { sealedNotice = nil }
    }
}

// MARK: - Models

private struct RootCapsulePresentation: Identifiable {
    let id: UUID
    let capsule: TimeCapsule

    init(capsule: TimeCapsule) {
        self.id = capsule.id
        self.capsule = capsule
    }
}

/// A light snapshot of a freshly sealed letter, shown as a brief farewell banner.
private struct RootSealedNotice {
    let id: UUID
    let recipient: String
    let monogram: String
    let unlockDate: Date
    let themeID: ThemeID

    init(capsule: TimeCapsule) {
        id = UUID()
        recipient = capsule.displayRecipient
        monogram = capsule.monogram
        unlockDate = capsule.unlockDate
        themeID = capsule.theme
    }
}

private enum RootMetrics {
    static let writeDiameter: CGFloat = 60
    static let barMaxWidth: CGFloat = 440
}

// MARK: - Tab bar

private struct RootTabBar: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.theme) private var theme
    @Namespace private var selectionNamespace

    let onWrite: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            tabs
            RootWriteButton(action: onWrite)
        }
        .frame(maxWidth: RootMetrics.barMaxWidth)
        .padding(.horizontal, 20)
        .padding(.top, 6)
        .padding(.bottom, 8)
    }

    private var tabs: some View {
        HStack(spacing: 2) {
            tabButton(.vault, title: "Vault", symbol: "tray.full")
            tabButton(.horizon, title: "Horizon", symbol: "hourglass")
            tabButton(.styles, title: "Styles", symbol: "paintpalette")
        }
        .padding(5)
        .background { RootGlassCapsule() }
    }

    private func tabButton(_ tab: AppTab, title: LocalizedStringKey, symbol: String) -> some View {
        let isSelected = router.selectedTab == tab
        return Button {
            select(tab)
        } label: {
            RootTabLabel(title: title, symbol: symbol, isSelected: isSelected)
                .background {
                    if isSelected {
                        Capsule(style: .continuous)
                            .fill(theme.accent.opacity(0.16))
                            .matchedGeometryEffect(id: "RootTabSelection", in: selectionNamespace)
                    }
                }
        }
        .buttonStyle(RootPressStyle())
        .accessibilityLabel(Text(title))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private func select(_ tab: AppTab) {
        guard router.selectedTab != tab else { return }
        Haptics.tap()
        withAnimation(.smooth(duration: 0.38)) {
            router.selectedTab = tab
        }
    }
}

private struct RootTabLabel: View {
    @Environment(\.theme) private var theme

    let title: LocalizedStringKey
    let symbol: String
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 3) {
            Image(systemName: symbol)
                .font(.system(size: 17, weight: isSelected ? .semibold : .regular))
                .symbolVariant(isSelected ? .fill : .none)
                .frame(height: 22)
            Text(title)
                .font(theme.label(10, weight: .semibold))
                .tracking(0.4)
                .lineLimit(1)
        }
        .foregroundStyle(isSelected ? theme.ink : theme.inkSecondary)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 7)
        .contentShape(Capsule(style: .continuous))
    }
}

/// Frosted capsule used by the tab bar and the sealed banner.
private struct RootGlassCapsule: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Capsule(style: .continuous)
            .fill(.ultraThinMaterial)
            .overlay {
                Capsule(style: .continuous)
                    .fill(theme.surface.opacity(0.55))
            }
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(theme.surfaceStroke, lineWidth: 0.75)
            }
            .shadow(
                color: Color.black.opacity(theme.colorScheme == .dark ? 0.35 : 0.12),
                radius: 18,
                x: 0,
                y: 8
            )
    }
}

// MARK: - Write button

private struct RootWriteButton: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// At most one letter: enough to know whether the vault is still empty.
    @Query(RootWriteButton.firstLetterDescriptor) private var firstLetter: [TimeCapsule]

    let action: () -> Void

    init(action: @escaping () -> Void) {
        self.action = action
    }

    private static var firstLetterDescriptor: FetchDescriptor<TimeCapsule> {
        var descriptor = FetchDescriptor<TimeCapsule>()
        descriptor.fetchLimit = 1
        return descriptor
    }

    var body: some View {
        Button(action: action) {
            Image(systemName: "pencil.line")
                .font(.system(size: 21, weight: .semibold))
                .foregroundStyle(theme.accentInk)
                .frame(width: RootMetrics.writeDiameter, height: RootMetrics.writeDiameter)
                .background { face }
                .contentShape(Circle())
        }
        .buttonStyle(RootPressStyle())
        .background {
            RootWriteHalo(color: theme.glow, isAnimated: !reduceMotion, keepsInviting: firstLetter.isEmpty)
        }
        .accessibilityLabel(Text("Write a letter"))
        .accessibilityHint(Text("Begins a new letter to the future"))
    }

    private var face: some View {
        Circle()
            .fill(theme.accent)
            .overlay {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.white.opacity(0.32), Color.white.opacity(0)],
                            startPoint: .top,
                            endPoint: .center
                        )
                    )
            }
            .overlay {
                Circle()
                    .strokeBorder(Color.white.opacity(0.25), lineWidth: 0.75)
            }
            .shadow(color: theme.accent.opacity(0.5), radius: 14, x: 0, y: 6)
    }
}

/// A soft glow with a slow ring that drifts outward, like breath on cold glass.
/// It breathes a few times when the app appears, then rests; only an empty vault
/// keeps inviting the first letter. Still under Reduce Motion.
private struct RootWriteHalo: View {
    let color: Color
    let isAnimated: Bool
    let keepsInviting: Bool

    @State private var breath = 0

    private static let settlingBreaths = 3
    /// One full breath (in, out, rest) plus a pause before the next.
    private static let breathPeriod: Double = 4.6

    var body: some View {
        ZStack {
            Circle()
                .fill(color.opacity(0.4))
                .frame(width: RootMetrics.writeDiameter + 6, height: RootMetrics.writeDiameter + 6)
                .blur(radius: 14)
            ring
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var ring: some View {
        let circle = Circle()
            .strokeBorder(color.opacity(0.75), lineWidth: 1)
            .frame(width: RootMetrics.writeDiameter, height: RootMetrics.writeDiameter)
        if isAnimated {
            circle.phaseAnimator([0, 1, 2], trigger: breath) { content, phase in
                content
                    .scaleEffect(phase == 2 ? 1.45 : 1.0)
                    .opacity(phase == 1 ? 0.9 : 0)
            } animation: { phase in
                RootWriteHalo.animation(for: phase)
            }
            .task(id: keepsInviting) {
                await breathe()
            }
        } else {
            circle
                .scaleEffect(1.14)
                .opacity(0.4)
        }
    }

    /// Each change of `breath` plays the ring once through all of its phases.
    private func breathe() async {
        var remaining = keepsInviting ? Int.max : RootWriteHalo.settlingBreaths
        while remaining > 0 {
            breath += 1
            remaining -= 1
            do {
                try await Task.sleep(for: .seconds(RootWriteHalo.breathPeriod))
            } catch {
                return
            }
        }
    }

    private static func animation(for phase: Int) -> Animation {
        switch phase {
        case 1: return .easeIn(duration: 0.35)
        case 2: return .easeOut(duration: 2.4)
        default: return .linear(duration: 1.2)
        }
    }
}

private struct RootPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : 1)
            .animation(.snappy(duration: 0.22), value: configuration.isPressed)
    }
}

// MARK: - Sealed banner

private struct RootSealedNoticeView: View {
    @Environment(\.theme) private var theme

    let notice: RootSealedNotice

    var body: some View {
        HStack(spacing: 12) {
            SealView(monogram: notice.monogram)
                .theme(notice.themeID.theme)
                .frame(width: 36, height: 36)
            VStack(alignment: .leading, spacing: 2) {
                Text("Sealed for \(notice.recipient)")
                    .font(theme.label(14, weight: .semibold))
                    .foregroundStyle(theme.ink)
                Text("It will wait until \(TimePhrase.longDate(notice.unlockDate)).")
                    .font(theme.label(12))
                    .foregroundStyle(theme.inkSecondary)
            }
            .lineLimit(1)
            .minimumScaleFactor(0.8)
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10)
        .padding(.leading, 10)
        .padding(.trailing, 18)
        .frame(maxWidth: RootMetrics.barMaxWidth)
        .background { RootGlassCapsule() }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Previews

#Preview("Root · Celestial") {
    RootView()
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
        .environment(AppLock())
        .theme(.celestial)
}

#Preview("Root · Parchment") {
    RootView()
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
        .environment(AppLock())
        .theme(.parchment)
}

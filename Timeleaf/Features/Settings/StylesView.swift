import SwiftUI
import SwiftData
import UniformTypeIdentifiers
import UserNotifications
import UIKit

// MARK: - StylesView

/// The third tab: a gallery of the six styles, followed by quiet preferences
/// and a small colophon. `RootView` draws `ThemeBackground` behind this view,
/// so it keeps its own background clear.
struct StylesView: View {
    @Environment(\.theme) private var theme
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(AppRouter.self) private var router

    @AppStorage(SettingsKey.theme) private var themeRaw = ThemeID.aurora.rawValue
    @AppStorage(SettingsKey.userName) private var userName = ""
    @AppStorage(SettingsKey.appLock) private var appLockEnabled = false
    @AppStorage(SettingsKey.haptics) private var hapticsEnabled = true

    @State private var focusedStyle: ThemeID?
    @State private var notificationState: StylesNotificationState = .unknown
    @State private var isImporting = false
    @FocusState private var isNameFocused: Bool

    private var selectedID: ThemeID { ThemeID(rawValue: themeRaw) ?? .aurora }
    private var monogram: String { Monogram.make(from: userName) }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 44) {
                header
                gallery
                preferences
                letters
                about
            }
            .padding(.top, 20)
            .padding(.bottom, 120)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .fileImporter(
            isPresented: $isImporting,
            allowedContentTypes: [CapsulePackage.contentType]
        ) { result in
            handleImport(result)
        }
        .task { await refreshNotificationState() }
        .onAppear {
            if focusedStyle == nil { focusedStyle = selectedID }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active {
                Task { await refreshNotificationState() }
            }
        }
        .onChange(of: hapticsEnabled) { _, isOn in
            if isOn { Haptics.soft() }
        }
        .onChange(of: appLockEnabled) { _, isOn in
            if isOn { Haptics.soft() }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Styles")
                .font(theme.display(46))
                .foregroundStyle(theme.ink)
            Text("风格 · Choose the paper your days are written on")
                .font(theme.label(15, weight: .regular))
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    // MARK: Gallery

    private var gallery: some View {
        VStack(spacing: 22) {
            carousel
            StylesSwatchRow(selected: selectedID, focused: focusedStyle) { id in
                withAnimation(.smooth(duration: 0.6)) { focusedStyle = id }
            }
        }
    }

    private var carousel: some View {
        ScrollView(.horizontal) {
            LazyHStack(spacing: 18) {
                ForEach(ThemeID.allCases, id: \.self) { id in
                    StylesCard(id: id, monogram: monogram, isSelected: id == selectedID) {
                        select(id)
                    }
                    .containerRelativeFrame(.horizontal) { length, _ in length * 0.8 }
                    .scrollTransition(.interactive, axis: .horizontal) { content, phase in
                        content
                            .scaleEffect(phase.isIdentity ? 1 : 0.9)
                            .rotation3DEffect(
                                .degrees(phase.value * -14),
                                axis: (x: 0, y: 1, z: 0),
                                perspective: 0.6
                            )
                            .opacity(phase.isIdentity ? 1 : 0.6)
                    }
                }
            }
            .scrollTargetLayout()
        }
        .scrollTargetBehavior(.viewAligned)
        .scrollPosition(id: $focusedStyle)
        .scrollIndicators(.hidden)
        .scrollClipDisabled()
        .contentMargins(.horizontal, 24, for: .scrollContent)
        .frame(height: StylesMetrics.cardHeight)
    }

    private func select(_ id: ThemeID) {
        withAnimation(.smooth(duration: 0.6)) {
            themeRaw = id.rawValue
            focusedStyle = id
        }
        Haptics.soft()
    }

    // MARK: Preferences

    private var preferences: some View {
        VStack(alignment: .leading, spacing: 14) {
            StylesSectionTitle(title: "Preferences", subtitle: "偏好 · Small things, kept quietly")
            VStack(spacing: 0) {
                nameRow
                StylesHairline()
                lockRow
                StylesHairline()
                hapticsRow
            }
            .themedCard(padding: 4)
        }
        .padding(.horizontal, 20)
    }

    private var nameRow: some View {
        HStack(spacing: 14) {
            SealView(monogram: monogram)
                .frame(width: 40, height: 40)
                .animation(.smooth(duration: 0.4), value: monogram)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your name")
                    .font(theme.label(12, weight: .medium))
                    .foregroundStyle(theme.inkSecondary)
                TextField("How your letters are signed", text: $userName)
                    .font(theme.body(18))
                    .foregroundStyle(theme.ink)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($isNameFocused)
                    .onSubmit { isNameFocused = false }
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var lockRow: some View {
        Toggle(isOn: $appLockEnabled) {
            StylesRowLabel(
                symbol: AppLock.biometrySymbol,
                title: Text("Lock with \(AppLock.biometryLabel)"),
                detail: Text("Ask before anyone can see your letters")
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    private var hapticsRow: some View {
        Toggle(isOn: $hapticsEnabled) {
            StylesRowLabel(
                symbol: "hand.tap",
                title: Text("Haptics"),
                detail: Text("A gentle touch when seals press and break")
            )
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    // MARK: Letters

    private var letters: some View {
        VStack(alignment: .leading, spacing: 14) {
            StylesSectionTitle(title: "Letters", subtitle: "信 · Arrivals and reminders")
            VStack(spacing: 0) {
                notificationRow
                StylesHairline()
                importRow
            }
            .themedCard(padding: 4)
        }
        .padding(.horizontal, 20)
    }

    private var notificationRow: some View {
        HStack(spacing: 12) {
            StylesRowLabel(symbol: "bell", title: Text("Notifications"), detail: notificationDetail)
            Spacer(minLength: 8)
            notificationAction
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
    }

    private var notificationDetail: Text {
        switch notificationState {
        case .allowed:
            Text("On — you'll know the moment a letter can be opened")
        case .denied:
            Text("Off — turn them on in Settings")
        case .notDetermined, .unknown:
            Text("Know the moment a letter can be opened")
        }
    }

    @ViewBuilder
    private var notificationAction: some View {
        switch notificationState {
        case .allowed:
            Image(systemName: "checkmark")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(theme.accent)
                .accessibilityLabel(Text("On"))
        case .denied:
            StylesPillButton(title: "Settings") { openSystemSettings() }
        case .notDetermined, .unknown:
            StylesPillButton(title: "Allow") { requestNotifications() }
        }
    }

    private var importRow: some View {
        Button {
            Haptics.tap()
            isImporting = true
        } label: {
            HStack(spacing: 12) {
                StylesRowLabel(
                    symbol: "envelope.open",
                    title: Text("Open a letter file"),
                    detail: Text("Receive a .timeleaf someone sent you")
                )
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.inkSecondary)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .contentShape(Rectangle())
        }
        .buttonStyle(StylesRowButtonStyle(highlight: theme.ink.opacity(0.06)))
    }

    // MARK: About

    private var about: some View {
        VStack(alignment: .leading, spacing: 14) {
            StylesSectionTitle(title: "About Timeleaf · 时笺", subtitle: nil)
            StylesAboutCard(version: versionText)
        }
        .padding(.horizontal, 20)
    }

    private var versionText: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    // MARK: Actions

    private func refreshNotificationState() async {
        let context = modelContext
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        let state: StylesNotificationState
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            state = .allowed
        case .denied:
            state = .denied
        case .notDetermined:
            state = .notDetermined
        @unknown default:
            state = .unknown
        }
        let becameAllowed = state == .allowed && notificationState != .allowed
        withAnimation(.smooth(duration: 0.4)) { notificationState = state }
        if becameAllowed {
            // Letters sealed while notifications were off still deserve their arrival call.
            Task { await CapsuleActions.rescheduleNotifications(in: context) }
        }
    }

    private func requestNotifications() {
        Task {
            let granted = await NotificationScheduler.requestAuthorization()
            if granted { Haptics.success() }
            await refreshNotificationState()
        }
    }

    private func openSystemSettings() {
        guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
        openURL(url)
    }

    private func handleImport(_ result: Result<URL, Error>) {
        let outcome: StylesImportOutcome
        switch result {
        case .success(let url):
            do {
                let capsule = try CapsulePackage.importPackage(from: url, into: modelContext)
                Haptics.success()
                outcome = .open(capsule.id)
            } catch {
                Haptics.warning()
                outcome = .failed(error.localizedDescription)
            }
        case .failure(let error):
            outcome = .failed(error.localizedDescription)
        }
        // Route only once the document picker has finished sliding away: UIKit refuses
        // to present the letter's cover (or an alert) while a dismissal is in flight.
        // The router is captured now, while this view is still installed.
        let router = router
        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(650))
            switch outcome {
            case .open(let id):
                router.selectedTab = .vault
                router.presentedCapsuleID = id
            case .failed(let message):
                router.alertMessage = message
            }
        }
    }
}

// MARK: - Private helpers

private enum StylesMetrics {
    static let cardHeight: CGFloat = 372
}

private enum StylesImportOutcome {
    case open(UUID)
    case failed(String)
}

private enum StylesNotificationState: Equatable {
    case unknown
    case notDetermined
    case allowed
    case denied
}

/// One style, rendered in its own style: a live miniature of the backdrop,
/// a small sealed envelope and the style's names.
private struct StylesCard: View {
    let id: ThemeID
    let monogram: String
    let isSelected: Bool
    let action: () -> Void

    private var number: Int { (ThemeID.allCases.firstIndex(of: id) ?? 0) + 1 }

    var body: some View {
        Button(action: action) {
            StylesCardFace(number: number, monogram: monogram, isSelected: isSelected)
        }
        .buttonStyle(StylesPressStyle())
        .theme(id.theme)
        .accessibilityLabel(Text(verbatim: "\(id.theme.name), \(id.theme.nativeName)"))
        .accessibilityHint(Text(verbatim: id.theme.tagline))
        .accessibilityAddTraits(isSelected ? [.isSelected] : [])
    }
}

private struct StylesCardFace: View {
    @Environment(\.theme) private var theme
    let number: Int
    let monogram: String
    let isSelected: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: min(max(theme.cornerRadius + 6, 12), 30), style: .continuous)
    }

    private var shadowColor: Color {
        Color.black.opacity(theme.colorScheme == .dark ? 0.5 : 0.18)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            topRow
            Spacer(minLength: 10)
            envelope
            Spacer(minLength: 10)
            caption
        }
        .padding(22)
        .frame(maxWidth: .infinity)
        .frame(height: StylesMetrics.cardHeight)
        .background { backdrop }
        .clipShape(shape)
        .overlay { border }
        .shadow(color: shadowColor, radius: isSelected ? 26 : 16, x: 0, y: isSelected ? 16 : 10)
        .animation(.smooth(duration: 0.5), value: isSelected)
    }

    private var topRow: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(verbatim: String(format: "%02d", number))
                .font(theme.label(12, weight: .semibold).monospacedDigit())
                .tracking(2)
                .foregroundStyle(theme.inkSecondary)
            Rectangle()
                .fill(theme.inkSecondary.opacity(0.5))
                .frame(width: 18, height: 0.5)
            Spacer(minLength: 8)
            if isSelected {
                selectedBadge
                    .transition(.scale(scale: 0.7).combined(with: .opacity))
            }
        }
        .frame(height: 26)
    }

    private var selectedBadge: some View {
        HStack(spacing: 5) {
            Image(systemName: "checkmark")
                .font(.system(size: 10, weight: .bold))
            Text("In use")
                .font(theme.label(12, weight: .semibold))
        }
        .foregroundStyle(theme.accentInk)
        .padding(.horizontal, 10)
        .padding(.vertical, 5)
        .background(theme.accent, in: Capsule())
    }

    private var envelope: some View {
        EnvelopeView(openProgress: 0, monogram: monogram, showsSeal: true)
            .frame(width: 172)
            .rotationEffect(.degrees(isSelected ? -2 : -5))
            .offset(y: isSelected ? -4 : 0)
            .shadow(color: Color.black.opacity(0.2), radius: 14, x: 0, y: 10)
            .frame(maxWidth: .infinity)
    }

    private var caption: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(verbatim: theme.name)
                    .font(theme.display(34))
                    .foregroundStyle(theme.ink)
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Text(verbatim: theme.nativeName)
                    .font(theme.label(16, weight: .medium))
                    .foregroundStyle(theme.accent)
            }
            Text(verbatim: theme.tagline)
                .font(theme.body(15))
                .foregroundStyle(theme.inkSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var backdrop: some View {
        ZStack {
            ThemeBackground()
            LinearGradient(
                colors: [theme.background.opacity(0), theme.background.opacity(0.85)],
                startPoint: UnitPoint(x: 0.5, y: 0.45),
                endPoint: .bottom
            )
        }
    }

    private var border: some View {
        shape.strokeBorder(
            isSelected ? theme.accent : theme.surfaceStroke,
            lineWidth: isSelected ? 1.5 : 0.75
        )
    }
}

/// Six small swatches under the carousel: the enlarged one is in view,
/// the ringed one is in use. Tapping scrolls the gallery.
private struct StylesSwatchRow: View {
    @Environment(\.theme) private var theme
    let selected: ThemeID
    let focused: ThemeID?
    let onTap: (ThemeID) -> Void

    var body: some View {
        HStack(spacing: 10) {
            ForEach(ThemeID.allCases, id: \.self) { id in
                Button {
                    onTap(id)
                } label: {
                    swatch(for: id)
                }
                .buttonStyle(.plain)
                .accessibilityLabel(Text(verbatim: id.theme.name))
                .accessibilityAddTraits(id == selected ? [.isSelected] : [])
            }
        }
        .frame(maxWidth: .infinity)
        .animation(.smooth(duration: 0.4), value: focused)
        .animation(.smooth(duration: 0.4), value: selected)
    }

    private func swatch(for id: ThemeID) -> some View {
        let isFocused = (focused ?? selected) == id
        let isSelected = id == selected
        let size: CGFloat = isFocused ? 18 : 10
        return Circle()
            .fill(id.theme.linearGradient)
            .frame(width: size, height: size)
            .overlay {
                Circle()
                    .strokeBorder(theme.ink.opacity(isSelected ? 0.85 : 0.2), lineWidth: isSelected ? 1.25 : 0.5)
            }
            .frame(width: 28, height: 28)
            .contentShape(Rectangle())
    }
}

private struct StylesSectionTitle: View {
    @Environment(\.theme) private var theme
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey?

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title)
                .font(theme.display(24))
                .foregroundStyle(theme.ink)
            if let subtitle {
                Text(subtitle)
                    .font(theme.label(13, weight: .regular))
                    .foregroundStyle(theme.inkSecondary)
            }
        }
        .padding(.horizontal, 4)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct StylesRowLabel: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let title: Text
    let detail: Text

    var body: some View {
        HStack(spacing: 14) {
            Image(systemName: symbol)
                .font(.system(size: 16, weight: .regular))
                .foregroundStyle(theme.accent)
                .frame(width: 36, height: 36)
                .background(theme.accent.opacity(0.12), in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 3) {
                title
                    .font(theme.body(17))
                    .foregroundStyle(theme.ink)
                detail
                    .font(theme.label(13, weight: .regular))
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

private struct StylesHairline: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Rectangle()
            .fill(theme.surfaceStroke)
            .frame(height: 0.5)
            .padding(.leading, 66)
            .padding(.trailing, 16)
    }
}

private struct StylesPillButton: View {
    @Environment(\.theme) private var theme
    let title: LocalizedStringKey
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(title)
                .font(theme.label(14, weight: .semibold))
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 14)
                .padding(.vertical, 7)
                .background(theme.accent.opacity(0.12), in: Capsule())
        }
        .buttonStyle(StylesPressStyle())
    }
}

private struct StylesAboutCard: View {
    @Environment(\.theme) private var theme
    let version: String

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            poem
            ornament
            privacy
            footer
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themedCard(padding: 24)
    }

    private var poem: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(verbatim: "时笺 · shí jiān")
                .font(theme.display(26))
                .foregroundStyle(theme.ink)
            Text("It sounds just like 时间 — time.\n笺 is the fine paper a letter is written on.")
                .font(theme.body(17))
                .foregroundStyle(theme.ink)
            Text("So every letter here is a leaf of time:\nwritten today, sealed with care,\nand opened only when its day arrives.")
                .font(theme.body(17))
                .italic()
                .foregroundStyle(theme.inkSecondary)
        }
        .lineSpacing(5)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var ornament: some View {
        HStack(spacing: 12) {
            Rectangle().fill(theme.surfaceStroke).frame(height: 0.5)
            Image(systemName: "sparkle")
                .font(.system(size: 10, weight: .regular))
                .foregroundStyle(theme.accent)
            Rectangle().fill(theme.surfaceStroke).frame(height: 0.5)
        }
        .accessibilityHidden(true)
    }

    private var privacy: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "lock.shield")
                .font(.system(size: 17, weight: .regular))
                .foregroundStyle(theme.accent)
                .accessibilityHidden(true)
            Text("Everything stays on this device. Shared letters are encrypted; the date is enforced by the app.")
                .font(theme.label(14, weight: .regular))
                .foregroundStyle(theme.inkSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var footer: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("Version \(version)")
                .font(theme.label(12, weight: .medium).monospacedDigit())
            Spacer(minLength: 12)
            Text("For the person you are becoming.")
                .font(theme.label(12, weight: .regular))
                .italic()
        }
        .foregroundStyle(theme.inkSecondary.opacity(0.85))
    }
}

private struct StylesPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.smooth(duration: 0.25), value: configuration.isPressed)
    }
}

private struct StylesRowButtonStyle: ButtonStyle {
    let highlight: Color

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? highlight : Color.clear)
            .animation(.smooth(duration: 0.2), value: configuration.isPressed)
    }
}

// MARK: - Preview

#Preview("Styles") {
    StylesView()
        .background { ThemeBackground() }
        .screenTheme(.aurora)
        .environment(AppRouter())
        .modelContainer(PreviewData.container)
}

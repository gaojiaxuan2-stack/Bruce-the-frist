import SwiftUI
import SwiftData

// MARK: - CapsuleDestinationView

/// The full-screen home of one capsule. It renders in the capsule's own style
/// and picks the right moment of its life: still travelling (sealed), arrived
/// (the opening ceremony), or opened (the reader).
///
/// A one-second `TimelineView` re-evaluates the capsule's state, so a sealed
/// letter turns into the ceremony the very second it arrives.
struct CapsuleDestinationView: View {
    let capsule: TimeCapsule

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var modelContext
    @Environment(AppRouter.self) private var router

    /// The hold completed and the ceremony is playing; keep it on screen even
    /// though the capsule is about to be marked as opened.
    @State private var ceremonyStarted = false
    /// The ceremony has finished; from now on the reader is shown.
    @State private var ceremonyFinished = false
    /// Set right before the capsule is deleted so nothing reads the model again.
    @State private var isDeleting = false

    /// Captured once so the screen never has to touch a deleted model.
    private let theme: Theme

    init(capsule: TimeCapsule) {
        self.capsule = capsule
        self.theme = capsule.theme.theme
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            ThemeBackground()
            screens
            closeButton
        }
        .screenTheme(theme)
        // Only the topmost presentation can show an alert.
        .routerAlert(router)
    }

    // MARK: Routing

    @ViewBuilder
    private var screens: some View {
        if isDeleting {
            Color.clear
        } else {
            TimelineView(.periodic(from: .now, by: 1)) { context in
                routedScreen(route(at: context.date), now: context.date)
            }
        }
    }

    private func routedScreen(_ route: CapsuleDestinationRoute, now: Date) -> some View {
        ZStack {
            switch route {
            case .sealed:
                CapsuleSealedScreen(capsule: capsule, now: now, onDelete: deleteCapsule)
                    .transition(.opacity)
            case .ceremony:
                CapsuleCeremonyScreen(capsule: capsule, onBegin: beginCeremony, onFinish: finishCeremony)
                    .transition(.opacity)
            case .reader:
                CapsuleReaderScreen(capsule: capsule, onDelete: deleteCapsule)
                    .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.9), value: route)
    }

    private func route(at date: Date) -> CapsuleDestinationRoute {
        if ceremonyStarted && !ceremonyFinished { return .ceremony }
        switch capsule.state(at: date) {
        case .draft, .sealed: return .sealed
        case .ready: return .ceremony
        case .opened: return .reader
        }
    }

    // MARK: Chrome

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
            CapsuleScreenChromeIcon(systemName: "xmark")
        }
        .buttonStyle(.plain)
        .padding(.leading, 20)
        .padding(.top, 8)
        .accessibilityLabel(Text("Close"))
    }

    // MARK: Actions

    private func beginCeremony() {
        ceremonyStarted = true
    }

    private func finishCeremony() {
        withAnimation(.smooth(duration: 1.0)) {
            ceremonyFinished = true
        }
    }

    private func deleteCapsule() {
        isDeleting = true
        CapsuleActions.delete(capsule, in: modelContext)
        dismiss()
    }
}

private enum CapsuleDestinationRoute: Equatable {
    case sealed
    case ceremony
    case reader
}

// MARK: - Shared pieces for the capsule screens (Features/Capsule only)

/// A small round, frosted chrome button face (close, more …).
struct CapsuleScreenChromeIcon: View {
    let systemName: String
    var diameter: CGFloat = 38

    @Environment(\.theme) private var theme

    var body: some View {
        Image(systemName: systemName)
            .font(.system(size: diameter * 0.37, weight: .semibold))
            .foregroundStyle(theme.ink)
            .frame(width: diameter, height: diameter)
            .background(.ultraThinMaterial, in: Circle())
            .overlay(Circle().strokeBorder(theme.surfaceStroke, lineWidth: 0.5))
            .contentShape(Circle())
    }
}

/// Small, widely tracked uppercase line used above titles and sections.
struct CapsuleScreenEyebrow: View {
    let text: LocalizedStringKey

    @Environment(\.theme) private var theme

    init(_ text: LocalizedStringKey) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(theme.label(11, weight: .semibold))
            .tracking(2.4)
            .textCase(.uppercase)
            .foregroundStyle(theme.inkSecondary)
    }
}

/// A quiet typographic divider: two hairlines fading outwards around a small diamond.
struct CapsuleScreenOrnament: View {
    @Environment(\.theme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            hairline(leading: true)
            Rectangle()
                .fill(theme.accent.opacity(0.85))
                .frame(width: 5, height: 5)
                .rotationEffect(.degrees(45))
            hairline(leading: false)
        }
        .accessibilityHidden(true)
    }

    private func hairline(leading: Bool) -> some View {
        Rectangle()
            .fill(
                LinearGradient(
                    colors: [theme.inkSecondary.opacity(0), theme.inkSecondary.opacity(0.55)],
                    startPoint: leading ? .leading : .trailing,
                    endPoint: leading ? .trailing : .leading
                )
            )
            .frame(width: 44, height: 0.5)
    }
}

/// The destructive confirmation shared by the sealed screen and the reader.
struct CapsuleScreenDeleteDialog: ViewModifier {
    @Binding var isPresented: Bool
    let message: LocalizedStringKey
    let onDelete: () -> Void

    func body(content: Content) -> some View {
        content
            .confirmationDialog("Delete this letter?", isPresented: $isPresented, titleVisibility: .visible) {
                Button("Delete forever", role: .destructive) {
                    onDelete()
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text(message)
            }
    }
}

// MARK: - Previews

private struct CapsuleDestinationPreview: View {
    @Query private var capsules: [TimeCapsule]
    private let pick: (TimeCapsule) -> Bool

    init(_ pick: @escaping (TimeCapsule) -> Bool) {
        self.pick = pick
    }

    var body: some View {
        if let capsule = capsules.first(where: pick) {
            CapsuleDestinationView(capsule: capsule)
        } else {
            ContentUnavailableView("No sample letter", systemImage: "envelope")
        }
    }
}

#Preview("Sealed") {
    CapsuleDestinationPreview { $0.state() == .sealed }
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
}

#Preview("Ready to open") {
    CapsuleDestinationPreview { $0.state() == .ready }
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
}

#Preview("Opened") {
    CapsuleDestinationPreview { $0.state() == .opened }
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
}

import SwiftUI
import SwiftData

/// Top of the view hierarchy: applies the app-wide style, gates onboarding,
/// overlays the privacy lock and receives `.timeleaf` files opened from other apps.
struct AppShell: View {
    @Environment(AppRouter.self) private var router
    @Environment(AppLock.self) private var appLock
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage(SettingsKey.theme) private var themeRaw = ThemeID.aurora.rawValue
    @AppStorage(SettingsKey.onboarded) private var onboarded = false

    private var theme: Theme { (ThemeID(rawValue: themeRaw) ?? .aurora).theme }

    var body: some View {
        ZStack {
            if onboarded {
                RootView()
                    .transition(.opacity)
            } else {
                OnboardingView {
                    withAnimation(.smooth(duration: 0.8)) { onboarded = true }
                }
                .transition(.opacity)
            }

            if appLock.isLocked {
                LockScreenView()
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.smooth(duration: 0.35), value: appLock.isLocked)
        .animation(.smooth(duration: 0.6), value: themeRaw)
        .screenTheme(theme)
        .onOpenURL { url in
            handleIncoming(url)
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                appLock.lockIfNeeded()
            case .active:
                if appLock.isLocked {
                    Task { await appLock.unlock() }
                }
            default:
                break
            }
        }
        .alert(
            "Timeleaf",
            isPresented: Binding(
                get: { router.alertMessage != nil },
                set: { if !$0 { router.alertMessage = nil } }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(router.alertMessage ?? "")
        }
    }

    private func handleIncoming(_ url: URL) {
        guard url.pathExtension.lowercased() == CapsulePackage.fileExtension else { return }
        do {
            let capsule = try CapsulePackage.importPackage(from: url, into: modelContext)
            router.selectedTab = .vault
            router.presentedCapsuleID = capsule.id
        } catch {
            router.alertMessage = error.localizedDescription
        }
    }
}

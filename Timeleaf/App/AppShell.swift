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
    @State private var lockWindow = LockWindowController()

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

            // Fallback; normally the lock window (above every cover) hides this.
            if appLock.isLocked {
                LockScreenView()
                    .transition(.opacity)
                    .zIndex(10)
            }
        }
        .animation(.smooth(duration: 0.35), value: appLock.isLocked)
        .animation(.smooth(duration: 0.6), value: themeRaw)
        .screenTheme(theme)
        .onChange(of: appLock.isLocked, initial: true) { _, isLocked in
            lockWindow.update(isLocked: isLocked, appLock: appLock, theme: theme)
        }
        .onOpenURL { url in
            handleIncoming(url)
        }
        .task {
            // Once per launch, before any compose flow can exist.
            CapsuleActions.removeOrphanedMedia(in: modelContext)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            // No cover on .inactive: system prompts (microphone, camera, notifications)
            // make the scene inactive mid-flow and must not flash the lock screen.
            switch phase {
            case .background:
                appLock.lockIfNeeded()
                // Synchronously, so the cover exists before the App Switcher snapshot.
                lockWindow.update(isLocked: appLock.isLocked, appLock: appLock, theme: theme)
            case .active:
                if appLock.isLocked {
                    Task { await appLock.unlock() }
                } else {
                    lockWindow.update(isLocked: false, appLock: appLock, theme: theme)
                }
                // Letters sealed while notifications were off still deserve their knock.
                Task { await CapsuleActions.rescheduleNotifications(in: modelContext) }
            case .inactive:
                break
            @unknown default:
                break
            }
        }
        .routerAlert(router)
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

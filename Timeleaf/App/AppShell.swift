import SwiftUI
import SwiftData
import UIKit

/// Top of the view hierarchy: applies the app-wide style, gates onboarding,
/// overlays the privacy lock and receives `.timeleaf` files opened from other apps.
struct AppShell: View {
    @Environment(AppRouter.self) private var router
    @Environment(AppLock.self) private var appLock
    @Environment(\.modelContext) private var modelContext
    @Environment(\.scenePhase) private var scenePhase

    @AppStorage(SettingsKey.theme) private var themeRaw = ThemeID.aurora.rawValue
    @AppStorage(SettingsKey.onboarded) private var onboarded = false
    @AppStorage(SettingsKey.appLock) private var lockEnabled = false
    /// One per scene: covers this window (and only this one) above every sheet and cover.
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
        // Text grows with Dynamic Type up to a size every screen can still hold.
        .dynamicTypeSize(...DynamicTypeSize.accessibility2)
        .background {
            sceneProbe
        }
        .onChange(of: appLock.isLocked, initial: true) { _, isLocked in
            if isLocked {
                lockWindow.update(.locked, appLock: appLock, theme: theme)
            } else if scenePhase != .background {
                // Unlocked in the foreground (perhaps in another iPad window). A window still
                // in the background keeps its cover until it returns (veil, then nothing).
                lockWindow.update(.hidden, appLock: appLock, theme: theme)
            }
        }
        .onOpenURL { url in
            handleIncoming(url)
        }
        .task {
            // Once per launch, before any compose flow can exist.
            CapsuleActions.removeOrphanedMedia(in: modelContext)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            handleScenePhase(phase)
        }
        .routerAlert(router)
    }

    /// Reports this window's scene to the lock window controller.
    private var sceneProbe: some View {
        let controller = lockWindow
        return AppShellSceneProbe { scene in
            controller.attach(to: scene)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    /// Every cover change happens synchronously, so it exists before the system shows or
    /// snapshots this window's App Switcher card.
    private func handleScenePhase(_ phase: ScenePhase) {
        switch phase {
        case .background:
            appLock.lockIfNeeded()
            lockWindow.update(appLock.isLocked ? .locked : .hidden, appLock: appLock, theme: theme)
        case .inactive:
            // The App Switcher shows a live card while the scene is only inactive. A veil hides
            // the letters without taking the keyboard or asking for Face ID, so system prompts
            // (microphone, camera, notifications) simply rest on a calm backdrop.
            if appLock.isLocked {
                lockWindow.update(.locked, appLock: appLock, theme: theme)
            } else if lockEnabled, !appLock.isAuthenticating {
                lockWindow.update(.veil, appLock: appLock, theme: theme)
            }
        case .active:
            if appLock.isLocked {
                Task { await appLock.unlock() }
            } else {
                lockWindow.update(.hidden, appLock: appLock, theme: theme)
            }
            // Letters sealed while notifications were off still deserve their knock.
            Task { await CapsuleActions.rescheduleNotifications(in: modelContext) }
        @unknown default:
            break
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

// MARK: - Scene probe

/// An invisible view controller that reports the `UIWindowScene` hosting it, so each
/// `AppShell` binds its lock window to its own scene (iPad can show several at once).
private struct AppShellSceneProbe: UIViewControllerRepresentable {
    let onScene: (UIWindowScene) -> Void

    func makeUIViewController(context: Context) -> AppShellSceneProbeController {
        let controller = AppShellSceneProbeController(nibName: nil, bundle: nil)
        controller.onScene = onScene
        return controller
    }

    func updateUIViewController(_ controller: AppShellSceneProbeController, context: Context) {
        controller.onScene = onScene
        controller.reportScene()
    }
}

private final class AppShellSceneProbeController: UIViewController {
    var onScene: ((UIWindowScene) -> Void)?
    private weak var reportedScene: UIWindowScene?

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        view.isUserInteractionEnabled = false
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        reportScene()
    }

    override func viewWillLayoutSubviews() {
        super.viewWillLayoutSubviews()
        reportScene()
    }

    func reportScene() {
        guard let scene = view.window?.windowScene, scene !== reportedScene else { return }
        reportedScene = scene
        onScene?(scene)
    }
}

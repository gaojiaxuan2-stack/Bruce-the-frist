import SwiftUI
import UIKit

/// Wraps the main UI with the optional Face ID lock (Settings → Privacy & security).
///
/// While the lock is on, Unhook locks whenever it goes to the background and asks for Face ID (falling back to
/// the passcode) once each time it becomes active again. Whenever the app isn't active, a privacy shield hides
/// the content so the app switcher snapshot never shows anyone's habits.
///
/// The cover is drawn twice: over `content` here, so nothing flashes before the first frame, and in its own
/// window above the app, so sheets, alerts and full-screen covers are hidden too. SwiftUI presents those above
/// the root view, out of reach of an overlay.
struct AppLockContainer<Content: View>: View {
    @Environment(\.scenePhase) private var scenePhase
    @AppStorage(AppLockSettings.enabledKey) private var isEnabled = false
    @State private var coverWindow = AppLockCoverWindow()

    private let content: Content

    private var lock: AppLock { AppLock.shared }

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            content
                .accessibilityHidden(isCovered)
            if isCovered {
                AppLockCover(lock: lock)
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .background {
            AppLockWindowAnchor(coverWindow: coverWindow)
        }
        .onChange(of: scenePhase, initial: true) { _, phase in
            switch phase {
            case .background:
                lock.lock()
            case .active:
                lock.promptIfNeeded()
            default:
                break
            }
            updateCoverWindow(phase: phase, isEnabled: isEnabled)
        }
        .onChange(of: isEnabled) { _, enabled in
            if !enabled {
                lock.reset()
            }
            updateCoverWindow(phase: scenePhase, isEnabled: enabled)
        }
        .onChange(of: lock.isLocked) { _, _ in
            updateCoverWindow(phase: scenePhase, isEnabled: isEnabled)
        }
        .onDisappear {
            coverWindow.update(isVisible: false, isLocked: false)
        }
    }

    private var isCovered: Bool {
        Self.shouldCover(phase: scenePhase, isEnabled: isEnabled, isLocked: lock.isLocked)
    }

    private func updateCoverWindow(phase: ScenePhase, isEnabled: Bool) {
        coverWindow.update(
            isVisible: Self.shouldCover(phase: phase, isEnabled: isEnabled, isLocked: lock.isLocked),
            isLocked: isEnabled && lock.isLocked
        )
    }

    private static func shouldCover(phase: ScenePhase, isEnabled: Bool, isLocked: Bool) -> Bool {
        isEnabled && (isLocked || phase != .active)
    }
}

/// Shows `AppLockCover` in a window above everything else in the scene.
@MainActor
final class AppLockCoverWindow {
    private weak var scene: UIWindowScene?
    private var window: UIWindow?
    private weak var previousKeyWindow: UIWindow?
    private var wantsVisible = false
    private var wantsLocked = false

    nonisolated init() {}

    /// Shows or hides the cover. `isLocked` makes it the key window (so VoiceOver and keyboards stay on the
    /// lock screen) and ends any text editing underneath.
    func update(isVisible: Bool, isLocked: Bool) {
        let isNewlyLocked = isVisible && isLocked && !(wantsVisible && wantsLocked)
        wantsVisible = isVisible
        wantsLocked = isLocked
        apply(endEditing: isNewlyLocked)
    }

    /// Called when the app's content moves into (or out of) a window.
    func sceneDidChange(_ newScene: UIWindowScene?) {
        guard let newScene, newScene !== scene else { return }
        scene = newScene
        apply(endEditing: wantsVisible && wantsLocked)
    }

    private func apply(endEditing: Bool) {
        guard wantsVisible else {
            hide()
            return
        }
        guard let scene else { return }
        let window = self.window ?? makeWindow(in: scene)
        if window.windowScene !== scene {
            window.windowScene = scene
        }
        if endEditing {
            for other in scene.windows where other !== window {
                other.endEditing(true)
            }
        }
        if let keyWindow = scene.keyWindow, keyWindow !== window {
            previousKeyWindow = keyWindow
        }
        if wantsLocked {
            if !window.isKeyWindow || window.isHidden {
                window.makeKeyAndVisible()
            }
        } else if window.isHidden {
            window.isHidden = false
        }
    }

    private func hide() {
        guard let window, !window.isHidden else { return }
        let wasKey = window.isKeyWindow
        window.isHidden = true
        if wasKey {
            previousKeyWindow?.makeKey()
        }
        previousKeyWindow = nil
    }

    private func makeWindow(in scene: UIWindowScene) -> UIWindow {
        let window = UIWindow(windowScene: scene)
        window.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.alert.rawValue + 1)
        window.backgroundColor = .black
        // Light status bar text over the night-sky background.
        window.overrideUserInterfaceStyle = .dark

        let host = UIHostingController(rootView: AppLockCover(lock: AppLock.shared))
        host.view.backgroundColor = .clear
        host.view.accessibilityViewIsModal = true
        window.rootViewController = host
        window.isHidden = true
        self.window = window
        return window
    }
}

/// An invisible UIKit view that tells the cover window which window scene the app's content lives in.
private struct AppLockWindowAnchor: UIViewRepresentable {
    let coverWindow: AppLockCoverWindow

    func makeUIView(context: Context) -> AnchorView {
        let view = AnchorView()
        view.isUserInteractionEnabled = false
        view.isAccessibilityElement = false
        view.coverWindow = coverWindow
        return view
    }

    func updateUIView(_ uiView: AnchorView, context: Context) {
        uiView.coverWindow = coverWindow
    }

    final class AnchorView: UIView {
        weak var coverWindow: AppLockCoverWindow?

        override func didMoveToWindow() {
            super.didMoveToWindow()
            coverWindow?.sceneDidChange(window?.windowScene)
        }
    }
}

#Preview {
    AppLockContainer {
        Text("Your habits")
    }
    .previewEnvironment()
}

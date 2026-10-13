import SwiftUI
import UIKit

/// Shows `LockScreenView` in its own window above every sheet and full-screen cover,
/// so an open letter can never stay visible on top of the privacy lock.
@MainActor
final class LockWindowController {
    private var window: UIWindow?
    private weak var previousKeyWindow: UIWindow?

    /// Shows or hides the lock window. Call synchronously from scene-phase changes so the
    /// cover exists before the system takes its App Switcher snapshot.
    func update(isLocked: Bool, appLock: AppLock, theme: Theme) {
        if isLocked {
            show(appLock: appLock, theme: theme)
        } else {
            hide()
        }
    }

    private func show(appLock: AppLock, theme: Theme) {
        let content = AnyView(LockScreenView().environment(appLock).screenTheme(theme))
        if let window, let host = window.rootViewController as? UIHostingController<AnyView> {
            host.rootView = content
            window.alpha = 1
            window.isHidden = false
            return
        }
        guard let scene = Self.activeScene() else { return }

        // Dismiss the keyboard so neither it nor the QuickType bar (which can echo the
        // letter being written) floats above the lock, and stop typing into hidden fields.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        previousKeyWindow = scene.windows.first { $0.isKeyWindow }

        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        let host = UIHostingController(rootView: content)
        host.view.backgroundColor = .clear
        window.rootViewController = host
        window.makeKeyAndVisible()
        self.window = window
    }

    private func hide() {
        guard let window else { return }
        self.window = nil
        let previous = previousKeyWindow
        previousKeyWindow = nil
        UIView.animate(withDuration: 0.35, animations: {
            window.alpha = 0
        }, completion: { _ in
            window.isHidden = true
            previous?.makeKey()
        })
    }

    private static func activeScene() -> UIWindowScene? {
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.first { $0.activationState == .foregroundActive }
            ?? scenes.first { $0.activationState == .foregroundInactive }
            ?? scenes.first
    }
}

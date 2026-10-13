import SwiftUI
import UIKit

/// Covers one scene's window with a window of its own, above every sheet and full-screen
/// cover, so an open letter never stays visible behind the privacy lock or in the App Switcher.
///
/// Each `AppShell` owns one controller and binds it to its own `UIWindowScene` with
/// `attach(to:)`, so on iPad every window covers itself and never another.
@MainActor
final class LockWindowController {
    enum Cover {
        /// Nothing in front of the app.
        case hidden
        /// A calm, opaque backdrop for the moments the scene is merely inactive (App Switcher,
        /// Control Center, system prompts). Never takes the keyboard and asks for nothing.
        case veil
        /// `LockScreenView`: becomes the key window and dismisses the keyboard.
        case locked
    }

    private weak var scene: UIWindowScene?
    private var window: UIWindow?
    private var shownCover: Cover = .hidden
    private var shownThemeID: ThemeID?
    private weak var previousKeyWindow: UIWindow?
    /// The most recent request, replayed once the scene is known.
    private var request: (cover: Cover, appLock: AppLock, theme: Theme)?

    /// Binds the controller to the scene that hosts its `AppShell`.
    func attach(to newScene: UIWindowScene) {
        guard newScene !== scene else { return }
        if let window, window.windowScene !== newScene {
            // Shown in a provisional scene before the real one was known: start over there.
            removeImmediately(window)
        }
        scene = newScene
        guard request != nil else { return }
        // Out of the layout pass that reported the scene.
        Task { @MainActor [weak self] in
            self?.render()
        }
    }

    /// Shows the requested cover. Call synchronously from scene-phase changes so the cover
    /// exists before the system shows or snapshots the App Switcher card.
    func update(_ cover: Cover, appLock: AppLock, theme: Theme) {
        request = (cover, appLock, theme)
        render()
    }

    // MARK: Private

    /// The bound scene; before it is known, only an unambiguous single scene will do.
    private var targetScene: UIWindowScene? {
        if let scene { return scene }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        return scenes.count == 1 ? scenes.first : nil
    }

    private func render() {
        guard let request else { return }
        switch request.cover {
        case .hidden:
            hide()
        case .veil, .locked:
            // Until the scene is known, AppShell's own lock overlay stands in.
            guard let scene = targetScene else { return }
            show(request.cover, appLock: request.appLock, theme: request.theme, in: scene)
        }
    }

    private func show(_ cover: Cover, appLock: AppLock, theme: Theme, in scene: UIWindowScene) {
        let window = self.window ?? makeWindow(in: scene)
        if shownCover != cover || shownThemeID != theme.id,
           let host = window.rootViewController as? UIHostingController<AnyView> {
            host.rootView = Self.content(for: cover, appLock: appLock, theme: theme)
        }
        shownCover = cover
        shownThemeID = theme.id
        window.alpha = 1
        window.isUserInteractionEnabled = true
        window.isHidden = false

        guard cover == .locked, !window.isKeyWindow else { return }
        // Dismiss the keyboard so neither it nor the QuickType bar (which can echo the
        // letter being written) floats above the lock, and stop typing into hidden fields.
        UIApplication.shared.sendAction(#selector(UIResponder.resignFirstResponder), to: nil, from: nil, for: nil)
        if previousKeyWindow == nil {
            previousKeyWindow = scene.windows.first { $0.isKeyWindow && $0 !== window }
        }
        window.makeKeyAndVisible()
    }

    private func makeWindow(in scene: UIWindowScene) -> UIWindow {
        let window = UIWindow(windowScene: scene)
        window.windowLevel = .alert + 1
        let host = UIHostingController(rootView: AnyView(EmptyView()))
        host.view.backgroundColor = .clear
        window.rootViewController = host
        shownCover = .hidden
        shownThemeID = nil
        self.window = window
        return window
    }

    private func hide() {
        guard let window else { return }
        self.window = nil
        shownCover = .hidden
        shownThemeID = nil
        let previous = previousKeyWindow
        previousKeyWindow = nil
        // Let touches reach the app while the cover fades.
        window.isUserInteractionEnabled = false
        UIView.animate(withDuration: 0.35, animations: {
            window.alpha = 0
        }, completion: { _ in
            // Hand the keyboard focus back only if no newer cover has taken it meanwhile.
            let wasKey = window.isKeyWindow
            window.isHidden = true
            guard wasKey else { return }
            let fallback = window.windowScene?.windows.first {
                $0 !== window && !$0.isHidden && $0.windowLevel == .normal
            }
            (previous ?? fallback)?.makeKey()
        })
    }

    private func removeImmediately(_ window: UIWindow) {
        window.isHidden = true
        self.window = nil
        shownCover = .hidden
        shownThemeID = nil
        previousKeyWindow = nil
    }

    private static func content(for cover: Cover, appLock: AppLock, theme: Theme) -> AnyView {
        switch cover {
        case .locked:
            return AnyView(
                LockScreenView()
                    .environment(appLock)
                    .screenTheme(theme)
                    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            )
        case .veil, .hidden:
            return AnyView(
                LockWindowVeil()
                    .screenTheme(theme)
                    .dynamicTypeSize(...DynamicTypeSize.accessibility2)
            )
        }
    }
}

// MARK: - Veil

/// The style's backdrop with a small seal: hides the letters without asking for anything.
private struct LockWindowVeil: View {
    @AppStorage(SettingsKey.userName) private var userName = ""

    var body: some View {
        ZStack {
            ThemeBackground()
            SealView(monogram: Monogram.make(from: userName))
                .frame(width: 76, height: 76)
                .opacity(0.9)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Timeleaf"))
    }
}

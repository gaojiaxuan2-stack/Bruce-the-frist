import SwiftUI
import Observation

// MARK: - Settings keys

/// `@AppStorage` / `UserDefaults` keys. Always use these constants.
enum SettingsKey {
    /// `ThemeID.rawValue` of the app-wide style.
    static let theme = "tl.theme"
    /// The user's display name, used as sender name and in seals.
    static let userName = "tl.userName"
    /// Bool – require Face ID / passcode when the app comes to the foreground.
    static let appLock = "tl.appLock"
    /// Bool – haptic feedback enabled (default true).
    static let haptics = "tl.haptics"
    /// Bool – onboarding completed.
    static let onboarded = "tl.onboarded"
}

// MARK: - Router

enum AppTab: Hashable {
    case vault
    case horizon
    case styles
}

/// App-wide navigation state, injected with `.environment(router)`.
@Observable
final class AppRouter {
    var selectedTab: AppTab = .vault
    /// When set, RootView presents `CapsuleDestinationView` for the capsule with this id.
    var presentedCapsuleID: UUID?
    /// When true, RootView presents `ComposeFlowView`.
    var isComposing = false
    /// A user-facing message shown as an alert by AppShell (e.g. a failed import).
    var alertMessage: String?
}

// MARK: - Color helpers

extension Color {
    /// `Color(hex: 0xF4E9D8)` / `Color(hex: 0x000000, opacity: 0.4)`
    init(hex: UInt32, opacity: Double = 1) {
        let r = Double((hex >> 16) & 0xFF) / 255
        let g = Double((hex >> 8) & 0xFF) / 255
        let b = Double(hex & 0xFF) / 255
        self.init(.sRGB, red: r, green: g, blue: b, opacity: opacity)
    }
}

// MARK: - Date helpers

extension Date {
    /// Adds calendar components, e.g. `Date.now.adding(.year, 1)`.
    func adding(_ component: Calendar.Component, _ value: Int) -> Date {
        Calendar.current.date(byAdding: component, value: value, to: self) ?? self
    }
}

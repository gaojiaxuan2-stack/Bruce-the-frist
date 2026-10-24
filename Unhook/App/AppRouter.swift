import Observation
import SwiftUI

/// App-wide navigation state: the selected tab and the screens any part of the app (or a Siri Shortcut)
/// can ask to present. Injected into the environment by `UnhookApp`.
@MainActor
@Observable
final class AppRouter {
    static let shared = AppRouter()

    enum Tab: Hashable {
        case today, progress, settings
    }

    var selectedTab: Tab = .today
    /// Shows the SOS breathing screen over everything.
    var isShowingSOS = false
    /// Shows the Unhook Pro paywall.
    var paywallReason: PaywallReason?
    /// Shows a full-screen milestone celebration.
    var celebration: MilestoneCelebration?

    func showPaywall(_ reason: PaywallReason) {
        paywallReason = reason
    }
}

/// A milestone reached since the user last opened the app.
struct MilestoneCelebration: Identifiable {
    let habit: Habit
    let milestone: Milestone

    var id: String { "\(habit.uuid.uuidString)-\(milestone.id)" }
}

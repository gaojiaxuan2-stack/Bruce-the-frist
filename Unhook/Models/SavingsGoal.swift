import Foundation
import SwiftData

/// Something the user is saving toward with the money they no longer spend on their habits.
/// Goals are funded in order from the total money saved across all habits.
@Model
final class SavingsGoal {
    var uuid: UUID = UUID()
    var title: String = ""
    var emoji: String = "🎁"
    var cost: Double = 0
    var createdAt: Date = Date.now
    /// Set when the user marks the goal as bought. Redeemed goals stop drawing from the savings pool
    /// but their cost stays spent.
    var redeemedAt: Date? = nil
    var sortIndex: Int = 0

    init(title: String, emoji: String, cost: Double, sortIndex: Int = 0) {
        self.title = title
        self.emoji = emoji
        self.cost = cost
        self.sortIndex = sortIndex
        self.createdAt = .now
    }
}

extension SavingsGoal {
    var isRedeemed: Bool { redeemedAt != nil }
}

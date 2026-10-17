import Foundation

/// Inputs that unlock achievements. Kept separate from SwiftData so the rules are easy to test.
struct AchievementInput {
    var habitCount = 0
    var bestStreak: TimeInterval = 0
    var cravingsBeaten = 0
    var moneySaved: Double = 0
    var pledgeStreak = 0
    var totalPledges = 0
}

struct Achievement: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let symbol: String
    let theme: HabitTheme
    let isUnlocked: Bool

    static func evaluate(_ input: AchievementInput) -> [Achievement] {
        let day: TimeInterval = 86_400
        return [
            Achievement(id: "first-step", title: "First Step", detail: "Start a streak", symbol: "figure.walk", theme: .ocean, isUnlocked: input.habitCount > 0),
            Achievement(id: "day-1", title: "24 Hours", detail: "One full day free", symbol: "sun.max.fill", theme: .gold, isUnlocked: input.bestStreak >= day),
            Achievement(id: "week-1", title: "Week Warrior", detail: "7 days free", symbol: "star.fill", theme: .sunset, isUnlocked: input.bestStreak >= 7 * day),
            Achievement(id: "month-1", title: "Monthly Master", detail: "30 days free", symbol: "moon.stars.fill", theme: .grape, isUnlocked: input.bestStreak >= 30 * day),
            Achievement(id: "day-100", title: "Centurion", detail: "100 days free", symbol: "trophy.fill", theme: .fire, isUnlocked: input.bestStreak >= 100 * day),
            Achievement(id: "year-1", title: "Year of Freedom", detail: "365 days free", symbol: "crown.fill", theme: .gold, isUnlocked: input.bestStreak >= 365 * day),
            Achievement(id: "craving-1", title: "Wave Rider", detail: "Beat a craving", symbol: "water.waves", theme: .ocean, isUnlocked: input.cravingsBeaten >= 1),
            Achievement(id: "craving-25", title: "Unshakeable", detail: "Beat 25 cravings", symbol: "shield.lefthalf.filled", theme: .midnight, isUnlocked: input.cravingsBeaten >= 25),
            Achievement(id: "saved-100", title: "Saver", detail: "Save 100", symbol: "banknote.fill", theme: .forest, isUnlocked: input.moneySaved >= 100),
            Achievement(id: "saved-1000", title: "Big Saver", detail: "Save 1,000", symbol: "chart.line.uptrend.xyaxis", theme: .mint, isUnlocked: input.moneySaved >= 1_000),
            Achievement(id: "pledge-7", title: "Committed", detail: "7-day pledge streak", symbol: "hand.raised.fill", theme: .candy, isUnlocked: input.pledgeStreak >= 7),
            Achievement(id: "pledge-30", title: "Devoted", detail: "30 pledges taken", symbol: "heart.fill", theme: .candy, isUnlocked: input.totalPledges >= 30),
        ]
    }
}

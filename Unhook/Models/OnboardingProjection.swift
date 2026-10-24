import Foundation

/// What one year without the habit gives back, shown near the end of onboarding.
/// Pure value type so it is easy to test.
struct OnboardingProjection: Equatable {
    static let daysPerYear: Double = 365
    /// Matches `HabitDraft.parse`'s default cap, so yearly totals always stay finite and displayable.
    static let maxDailyValue: Double = 1_000_000

    let dailyCost: Double
    let dailyMinutes: Double
    let unitsPerDay: Double

    /// Negative, NaN and infinite inputs count as zero. Minutes are capped at a full day.
    init(dailyCost: Double, dailyMinutes: Double, unitsPerDay: Double) {
        self.dailyCost = Self.sanitized(dailyCost, upTo: Self.maxDailyValue)
        self.dailyMinutes = Self.sanitized(dailyMinutes, upTo: HabitDraft.maxDailyMinutes)
        self.unitsPerDay = Self.sanitized(unitsPerDay, upTo: Self.maxDailyValue)
    }

    var yearlyMoney: Double { dailyCost * Self.daysPerYear }
    var yearlyHours: Double { dailyMinutes * Self.daysPerYear / 60 }
    var yearlyUnits: Double { unitsPerDay * Self.daysPerYear }

    /// False when nothing can be counted (nail biting, say), so the screen can lead with milestones instead.
    var hasCountableSavings: Bool {
        yearlyMoney > 0 || yearlyHours > 0 || yearlyUnits > 0
    }

    private static func sanitized(_ value: Double, upTo upperBound: Double) -> Double {
        guard value.isFinite, value > 0 else { return 0 }
        return min(value, upperBound)
    }
}

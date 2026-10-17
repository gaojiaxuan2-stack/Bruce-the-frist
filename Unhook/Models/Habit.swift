import Foundation
import SwiftData

/// Something the user is quitting, plus everything needed to show their progress.
@Model
final class Habit {
    var uuid: UUID = UUID()
    var name: String = ""
    var emoji: String = "✨"
    var themeRaw: String = "ocean"
    /// Start of the current clean streak. Moves forward when the user records a slip.
    var streakStart: Date = Date.now
    var createdAt: Date = Date.now
    /// What the habit used to cost per day, in the user's currency.
    var dailyCost: Double = 0
    /// Minutes per day the habit used to take.
    var dailyMinutes: Double = 0
    /// How many units per day (cigarettes, drinks, puffs…) the user used to consume.
    var unitsPerDay: Double = 0
    var unitName: String = ""
    var reasons: [String] = []
    /// Clean time from earlier streaks. A slip resets the streak, never the progress.
    var bankedSeconds: Double = 0
    var bestStreakSeconds: Double = 0
    var sortIndex: Int = 0

    @Relationship(deleteRule: .cascade, inverse: \Relapse.habit)
    var relapses: [Relapse] = []

    @Relationship(deleteRule: .cascade, inverse: \Urge.habit)
    var urges: [Urge] = []

    init(
        name: String,
        emoji: String,
        theme: HabitTheme,
        streakStart: Date = .now,
        dailyCost: Double = 0,
        dailyMinutes: Double = 0,
        unitsPerDay: Double = 0,
        unitName: String = "",
        reasons: [String] = [],
        sortIndex: Int = 0
    ) {
        self.name = name
        self.emoji = emoji
        self.themeRaw = theme.rawValue
        self.streakStart = streakStart
        self.createdAt = .now
        self.dailyCost = dailyCost
        self.dailyMinutes = dailyMinutes
        self.unitsPerDay = unitsPerDay
        self.unitName = unitName
        self.reasons = reasons
        self.sortIndex = sortIndex
    }
}

extension Habit {
    var theme: HabitTheme {
        get { HabitTheme(rawValue: themeRaw) ?? .ocean }
        set { themeRaw = newValue.rawValue }
    }

    var resistedUrgeCount: Int {
        urges.filter(\.resisted).count
    }

    func stats(at now: Date = .now) -> HabitStats {
        HabitStats(
            streakStart: streakStart,
            bankedSeconds: bankedSeconds,
            bestStreakSeconds: bestStreakSeconds,
            dailyCost: dailyCost,
            dailyMinutes: dailyMinutes,
            unitsPerDay: unitsPerDay,
            now: now
        )
    }

    /// Records a slip: banks the streak's clean time, updates the best streak and starts a new streak at `date`.
    @discardableResult
    func recordRelapse(at date: Date = .now, note: String = "", in context: ModelContext) -> Relapse {
        let date = max(date, streakStart)
        let streak = date.timeIntervalSince(streakStart)
        bankedSeconds += streak
        bestStreakSeconds = max(bestStreakSeconds, streak)
        streakStart = date

        let relapse = Relapse(date: date, streakSeconds: streak, note: note)
        context.insert(relapse)
        relapses.append(relapse)
        return relapse
    }
}

/// A snapshot of a habit's progress at a moment in time. Pure value type so it is easy to test.
struct HabitStats: Equatable {
    let streakStart: Date
    let bankedSeconds: Double
    let bestStreakSeconds: Double
    let dailyCost: Double
    let dailyMinutes: Double
    let unitsPerDay: Double
    let now: Date

    private static let secondsPerDay: Double = 86_400

    var currentStreak: TimeInterval { max(0, now.timeIntervalSince(streakStart)) }
    var lifetimeClean: TimeInterval { bankedSeconds + currentStreak }
    var lifetimeDays: Double { lifetimeClean / Self.secondsPerDay }
    var moneySaved: Double { lifetimeDays * dailyCost }
    var minutesReclaimed: Double { lifetimeDays * dailyMinutes }
    var unitsAvoided: Double { lifetimeDays * unitsPerDay }
    var bestStreak: TimeInterval { max(bestStreakSeconds, currentStreak) }
}

/// Totals across every habit, for the home banner and the progress tab.
struct HabitTotals {
    var moneySaved: Double = 0
    var minutesReclaimed: Double = 0
    var bestStreak: TimeInterval = 0

    init(habits: [Habit], at now: Date) {
        for habit in habits {
            let stats = habit.stats(at: now)
            moneySaved += stats.moneySaved
            minutesReclaimed += stats.minutesReclaimed
            bestStreak = max(bestStreak, stats.bestStreak)
        }
    }
}

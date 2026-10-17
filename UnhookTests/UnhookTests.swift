import Foundation
import SwiftData
import Testing
@testable import Unhook

private let day: TimeInterval = 86_400

struct MilestoneTests {
    @Test func nextMilestoneIsFirstUnreached() {
        #expect(Milestone.next(after: 0)?.title == "1 Hour")
        #expect(Milestone.next(after: 3_600)?.title == "12 Hours")
        #expect(Milestone.next(after: 8 * day)?.title == "2 Weeks")
        #expect(Milestone.next(after: 10_000 * day) == nil)
    }

    @Test func progressIsMeasuredFromPreviousMilestone() {
        // Halfway between "1 Day" and "3 Days".
        #expect(abs(Milestone.progress(toward: 2 * day) - 0.5) < 0.0001)
        #expect(Milestone.progress(toward: 0) == 0)
        #expect(Milestone.progress(toward: 10_000 * day) == 1)
    }

    @Test func milestonesAreSortedAndUnique() {
        let seconds = Milestone.all.map(\.seconds)
        #expect(seconds == seconds.sorted())
        #expect(Set(seconds).count == seconds.count)
    }
}

struct HabitStatsTests {
    @Test func savingsIncludeBankedTime() {
        let start = Date(timeIntervalSince1970: 0)
        let stats = HabitStats(
            streakStart: start,
            bankedSeconds: day,
            bestStreakSeconds: day,
            dailyCost: 10,
            dailyMinutes: 60,
            unitsPerDay: 20,
            now: start.addingTimeInterval(2 * day)
        )
        #expect(stats.currentStreak == 2 * day)
        #expect(stats.lifetimeClean == 3 * day)
        #expect(abs(stats.moneySaved - 30) < 0.0001)
        #expect(abs(stats.minutesReclaimed - 180) < 0.0001)
        #expect(abs(stats.unitsAvoided - 60) < 0.0001)
        #expect(stats.bestStreak == 2 * day)
    }

    @Test func streakIsNeverNegative() {
        let stats = HabitStats(
            streakStart: Date(timeIntervalSince1970: 1_000),
            bankedSeconds: 0,
            bestStreakSeconds: 0,
            dailyCost: 5,
            dailyMinutes: 0,
            unitsPerDay: 0,
            now: Date(timeIntervalSince1970: 0)
        )
        #expect(stats.currentStreak == 0)
        #expect(stats.moneySaved == 0)
    }
}

struct RelapseTests {
    @Test func relapseBanksProgressAndRestartsStreak() throws {
        let container = try ModelContainer(
            for: Habit.self, Relapse.self, Urge.self, Pledge.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let context = ModelContext(container)
        let start = Date(timeIntervalSince1970: 0)
        let habit = Habit(name: "Vaping", emoji: "💨", theme: .grape, streakStart: start)
        context.insert(habit)

        let slip = start.addingTimeInterval(5 * day)
        habit.recordRelapse(at: slip, note: "Party", in: context)

        #expect(habit.streakStart == slip)
        #expect(habit.bankedSeconds == 5 * day)
        #expect(habit.bestStreakSeconds == 5 * day)
        #expect(habit.relapses.count == 1)
        #expect(habit.relapses.first?.note == "Party")

        // A shorter second streak keeps the best streak but still banks its time.
        habit.recordRelapse(at: slip.addingTimeInterval(day), in: context)
        #expect(habit.bestStreakSeconds == 5 * day)
        #expect(habit.bankedSeconds == 6 * day)
        #expect(habit.relapses.count == 2)
    }

    @Test func relapseBeforeStreakStartIsClamped() throws {
        let container = try ModelContainer(
            for: Habit.self, Relapse.self, Urge.self, Pledge.self,
            configurations: ModelConfiguration(isStoredInMemoryOnly: true)
        )
        let context = ModelContext(container)
        let start = Date(timeIntervalSince1970: 10 * day)
        let habit = Habit(name: "Sugar", emoji: "🍭", theme: .candy, streakStart: start)
        context.insert(habit)

        habit.recordRelapse(at: start.addingTimeInterval(-day), in: context)

        #expect(habit.streakStart == start)
        #expect(habit.bankedSeconds == 0)
    }
}

struct StreakCalculatorTests {
    let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(identifier: "UTC")!
        return calendar
    }()
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    func dayOffset(_ offset: Int) -> Date {
        calendar.date(byAdding: .day, value: offset, to: now)!
    }

    @Test func countsConsecutiveDaysEndingToday() {
        let dates = [dayOffset(0), dayOffset(-1), dayOffset(-2), dayOffset(-4)]
        #expect(StreakCalculator.consecutiveDays(dates, now: now, calendar: calendar) == 3)
    }

    @Test func streakSurvivesUntilTodayIsOver() {
        #expect(StreakCalculator.consecutiveDays([dayOffset(-1), dayOffset(-2)], now: now, calendar: calendar) == 2)
    }

    @Test func brokenStreakIsZero() {
        #expect(StreakCalculator.consecutiveDays([dayOffset(-2), dayOffset(-3)], now: now, calendar: calendar) == 0)
        #expect(StreakCalculator.consecutiveDays([], now: now, calendar: calendar) == 0)
    }

    @Test func duplicateEntriesCountOnce() {
        #expect(StreakCalculator.consecutiveDays([dayOffset(0), dayOffset(0), dayOffset(-1)], now: now, calendar: calendar) == 2)
    }

    @Test func dailyCountsFillMissingDays() {
        let counts = DailyCounts.make(from: [dayOffset(0), dayOffset(0), dayOffset(-2)], days: 4, now: now, calendar: calendar)
        #expect(counts.map(\.count) == [0, 1, 0, 2])
        #expect(counts.last?.day == calendar.startOfDay(for: now))
    }
}

struct AchievementTests {
    @Test func nothingUnlockedForNewUser() {
        #expect(Achievement.evaluate(AchievementInput()).allSatisfy { !$0.isUnlocked })
    }

    @Test func achievementsUnlockFromProgress() {
        let input = AchievementInput(habitCount: 1, bestStreak: 8 * day, cravingsBeaten: 1)
        let unlocked = Set(Achievement.evaluate(input).filter(\.isUnlocked).map(\.id))
        #expect(unlocked == ["first-step", "day-1", "week-1", "craving-1"])
    }

    @Test func achievementIDsAreUnique() {
        let ids = Achievement.evaluate(AchievementInput()).map(\.id)
        #expect(Set(ids).count == ids.count)
    }
}

struct FormattingTests {
    @Test func compactDurations() {
        #expect(DurationFormatter.compact(42) == "42s")
        #expect(DurationFormatter.compact(125) == "2m 5s")
        #expect(DurationFormatter.compact(3_725) == "1h 2m")
        #expect(DurationFormatter.compact(90_061) == "1d 1h")
    }

    @Test func detailedDurations() {
        #expect(DurationFormatter.detailed(125) == "2m 5s")
        #expect(DurationFormatter.detailed(3_725) == "1h 2m 5s")
        #expect(DurationFormatter.detailed(90_061) == "1d 1h 1m")
    }

    @Test func reclaimedMinutes() {
        #expect(DurationFormatter.minutes(45) == "45m")
        #expect(DurationFormatter.minutes(125) == "2h 5m")
        #expect(DurationFormatter.minutes(1_500) == "1d 1h")
    }

    @Test func draftParsesLocalizedNumbers() {
        #expect(HabitDraft.parse("12,5") == 12.5)
        #expect(HabitDraft.parse(" 8 ") == 8)
        #expect(HabitDraft.parse("abc") == 0)
        #expect(HabitDraft.parse("-4") == 0)
    }

    @Test func draftFromPresetCarriesDefaults() {
        let preset = HabitPreset.all.first { $0.id == "smoking" }!
        let draft = HabitDraft(preset: preset)
        #expect(draft.name == "Smoking")
        #expect(draft.costText == "10")
        #expect(draft.unitName == "cigarettes")
        #expect(draft.isValid)

        let custom = HabitDraft(preset: HabitPreset.all.first { $0.id == HabitPreset.customID }!)
        #expect(custom.name.isEmpty)
        #expect(!custom.isValid)
    }
}

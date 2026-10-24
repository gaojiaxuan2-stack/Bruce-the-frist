import Foundation
import SwiftData
import Testing
@testable import Unhook

// MARK: - Milestone celebrations

@MainActor
struct CelebrationCenterTests {
    private static let hour: TimeInterval = 3_600
    private static let day: TimeInterval = 86_400
    private static let now = Date(timeIntervalSince1970: 1_700_000_000)

    private static func habit(
        _ name: String,
        streak: TimeInterval,
        sortIndex: Int = 0,
        in context: ModelContext
    ) -> Habit {
        let habit = Habit(name: name, emoji: "✨", theme: .ocean, streakStart: now.addingTimeInterval(-streak), sortIndex: sortIndex)
        context.insert(habit)
        return habit
    }

    private static func milestone(titled title: String) throws -> Milestone {
        let match = Milestone.all.first { $0.title == title }
        return try #require(match)
    }

    @Test func nothingToCelebrateBeforeTheFirstHour() {
        #expect(CelebrationCenter.pendingMilestone(elapsed: 0, celebrated: 0) == nil)
        #expect(CelebrationCenter.pendingMilestone(elapsed: Self.hour - 1, celebrated: 0) == nil)
    }

    @Test func firstHourIsCelebratedRightOnTime() {
        #expect(CelebrationCenter.pendingMilestone(elapsed: Self.hour, celebrated: 0)?.title == "1 Hour")
    }

    @Test func jumpsStraightToTheLatestReachedMilestone() {
        #expect(CelebrationCenter.pendingMilestone(elapsed: 8 * Self.day, celebrated: 0)?.title == "1 Week")
        #expect(CelebrationCenter.pendingMilestone(elapsed: 15 * Self.day, celebrated: 7 * Self.day)?.title == "2 Weeks")
    }

    @Test func celebratedMilestonesAreNotRepeated() {
        #expect(CelebrationCenter.pendingMilestone(elapsed: 8 * Self.day, celebrated: 7 * Self.day) == nil)
        #expect(CelebrationCenter.pendingMilestone(elapsed: 8 * Self.day, celebrated: 30 * Self.day) == nil)
    }

    @Test func picksTheBiggestPendingMilestoneAcrossHabits() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let sugar = Self.habit("Sugar", streak: 8 * Self.day, in: context)
        let smoking = Self.habit("Smoking", streak: 31 * Self.day, sortIndex: 1, in: context)
        let vaping = Self.habit("Vaping", streak: 100 * Self.day, sortIndex: 2, in: context)
        vaping.celebratedMilestoneSeconds = 90 * Self.day

        let celebration = try #require(CelebrationCenter.pendingCelebration(for: [sugar, smoking, vaping], now: Self.now))
        #expect(celebration.habit === smoking)
        #expect(celebration.milestone.title == "1 Month")
    }

    @Test func tiesGoToTheFirstHabitOnTheHomeScreen() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let second = Self.habit("Second", streak: 2 * Self.day, sortIndex: 1, in: context)
        let first = Self.habit("First", streak: 2 * Self.day + Self.hour, sortIndex: 0, in: context)

        let celebration = try #require(CelebrationCenter.pendingCelebration(for: [second, first], now: Self.now))
        #expect(celebration.habit === first)
        #expect(celebration.milestone.title == "1 Day")
    }

    @Test func noHabitsOrNothingNewMeansNoCelebration() {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let fresh = Self.habit("Fresh", streak: 10 * 60, in: context)
        let done = Self.habit("Done", streak: 4 * Self.day, sortIndex: 1, in: context)
        done.celebratedMilestoneSeconds = 3 * Self.day

        #expect(CelebrationCenter.pendingCelebration(for: [], now: Self.now)?.milestone == nil)
        #expect(CelebrationCenter.pendingCelebration(for: [fresh, done], now: Self.now)?.milestone == nil)
    }

    @Test func markingCelebratedStopsTheRepeatAndNeverLowersTheRecord() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let habit = Self.habit("Smoking", streak: 8 * Self.day, in: context)

        let celebration = try #require(CelebrationCenter.pendingCelebration(for: [habit], now: Self.now))
        CelebrationCenter.markCelebrated(celebration)
        #expect(habit.celebratedMilestoneSeconds == 7 * Self.day)
        #expect(CelebrationCenter.pendingCelebration(for: [habit], now: Self.now)?.milestone == nil)

        let oneDay = try Self.milestone(titled: "1 Day")
        CelebrationCenter.markCelebrated(MilestoneCelebration(habit: habit, milestone: oneDay))
        #expect(habit.celebratedMilestoneSeconds == 7 * Self.day)
    }

    @Test func aSlipStartsFreshCelebrations() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let habit = Self.habit("Smoking", streak: 8 * Self.day, in: context)
        let week = try #require(CelebrationCenter.pendingCelebration(for: [habit], now: Self.now))
        CelebrationCenter.markCelebrated(week)

        habit.recordRelapse(at: Self.now, in: context)
        let later = Self.now.addingTimeInterval(Self.hour + 1)
        let celebration = try #require(CelebrationCenter.pendingCelebration(for: [habit], now: later))
        #expect(celebration.milestone.title == "1 Hour")
    }

    @Test func everyMilestoneHasEncouragement() {
        for milestone in Milestone.all {
            #expect(!CelebrationCenter.encouragement(for: milestone).isEmpty, "\(milestone.title) has no encouragement")
        }
    }
}

// MARK: - Review prompts

struct ReviewPrompterTests {
    private static let day: TimeInterval = 86_400
    private static let start = Date(timeIntervalSince1970: 1_700_000_000)

    /// Runs `body` with a prompter backed by its own throwaway defaults suite.
    private func withFreshPrompter(_ body: (ReviewPrompter) throws -> Void) throws {
        let suiteName = "ReviewPrompterTests.\(UUID().uuidString)"
        let defaults = try #require(UserDefaults(suiteName: suiteName))
        defer { defaults.removePersistentDomain(forName: suiteName) }
        try body(ReviewPrompter(defaults: defaults))
    }

    private static func recordMoments(_ count: Int, on prompter: ReviewPrompter, at date: Date) {
        for _ in 0..<count {
            prompter.recordPositiveMoment(now: date)
        }
    }

    @Test func freshInstallNeverAsks() throws {
        try withFreshPrompter { prompter in
            #expect(prompter.positiveMomentCount == 0)
            #expect(prompter.firstUseDate == nil)
            #expect(!prompter.shouldRequestReview(now: Self.start))
            #expect(!prompter.shouldRequestReview(now: Self.start.addingTimeInterval(30 * Self.day)))
        }
    }

    @Test func needsThreePositiveMoments() throws {
        try withFreshPrompter { prompter in
            Self.recordMoments(2, on: prompter, at: Self.start)
            #expect(!prompter.shouldRequestReview(now: Self.start.addingTimeInterval(5 * Self.day)))

            prompter.recordPositiveMoment(now: Self.start.addingTimeInterval(5 * Self.day))
            #expect(prompter.positiveMomentCount == 3)
            #expect(prompter.shouldRequestReview(now: Self.start.addingTimeInterval(5 * Self.day)))
        }
    }

    @Test func waitsTwoDaysAfterFirstUse() throws {
        try withFreshPrompter { prompter in
            Self.recordMoments(3, on: prompter, at: Self.start)
            #expect(!prompter.shouldRequestReview(now: Self.start))
            #expect(!prompter.shouldRequestReview(now: Self.start.addingTimeInterval(2 * Self.day - 1)))
            #expect(prompter.shouldRequestReview(now: Self.start.addingTimeInterval(2 * Self.day)))
        }
    }

    @Test func keepsTheOriginalFirstUseDate() throws {
        try withFreshPrompter { prompter in
            prompter.recordPositiveMoment(now: Self.start)
            Self.recordMoments(2, on: prompter, at: Self.start.addingTimeInterval(Self.day))

            #expect(prompter.firstUseDate == Self.start)
            #expect(prompter.shouldRequestReview(now: Self.start.addingTimeInterval(2 * Self.day)))
        }
    }

    @Test func markRequestedResetsTheCountAndCoolsDownFor120Days() throws {
        try withFreshPrompter { prompter in
            let askedAt = Self.start.addingTimeInterval(3 * Self.day)
            Self.recordMoments(3, on: prompter, at: Self.start)
            #expect(prompter.shouldRequestReview(now: askedAt))

            prompter.markRequested(now: askedAt)
            #expect(prompter.positiveMomentCount == 0)
            #expect(prompter.lastRequestDate == askedAt)
            #expect(!prompter.shouldRequestReview(now: askedAt))

            Self.recordMoments(3, on: prompter, at: askedAt.addingTimeInterval(10 * Self.day))
            #expect(!prompter.shouldRequestReview(now: askedAt.addingTimeInterval(119 * Self.day)))
            #expect(prompter.shouldRequestReview(now: askedAt.addingTimeInterval(120 * Self.day)))
        }
    }

    @Test func separateStoresDoNotShareState() throws {
        try withFreshPrompter { first in
            try withFreshPrompter { second in
                Self.recordMoments(3, on: first, at: Self.start)
                #expect(first.positiveMomentCount == 3)
                #expect(second.positiveMomentCount == 0)
                #expect(!second.shouldRequestReview(now: Self.start.addingTimeInterval(10 * Self.day)))
            }
        }
    }
}

// MARK: - App Intents

/// Main actor because the intents run there and use the main context.
@MainActor
struct EngagementIntentTests {
    private static let day: TimeInterval = 86_400
    private static let now = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func loggedCravingIsAttachedToTheOnlyHabit() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let habit = Habit(name: "Smoking", emoji: "🚬", theme: .fire)
        context.insert(habit)
        context.insert(Urge(resisted: false))

        let first = try LogBeatenCravingIntent.logBeatenCraving(in: context)
        #expect(first == 1)
        #expect(habit.resistedUrgeCount == 1)

        let second = try LogBeatenCravingIntent.logBeatenCraving(in: context)
        #expect(second == 2)
        #expect(habit.resistedUrgeCount == 2)
    }

    @Test func loggedCravingStaysUnassignedWithSeveralHabits() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let smoking = Habit(name: "Smoking", emoji: "🚬", theme: .fire)
        let sugar = Habit(name: "Sugar", emoji: "🍬", theme: .candy, sortIndex: 1)
        context.insert(smoking)
        context.insert(sugar)

        let beaten = try LogBeatenCravingIntent.logBeatenCraving(in: context)
        #expect(beaten == 1)
        #expect(smoking.urges.isEmpty)
        #expect(sugar.urges.isEmpty)
    }

    @Test func confirmationMentionsTheCount() {
        let message = String(localized: LogBeatenCravingIntent.confirmation(beatenCount: 7))
        #expect(message.contains("7"))
        #expect(!String(localized: LogBeatenCravingIntent.confirmation(beatenCount: 1)).isEmpty)
    }

    @Test func streakStatusNamesTheLongestStreak() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let sugar = Habit(name: "Sugar", emoji: "🍬", theme: .candy, streakStart: Self.now.addingTimeInterval(-2 * Self.day))
        let smoking = Habit(name: "Smoking", emoji: "🚬", theme: .fire, streakStart: Self.now.addingTimeInterval(-12 * Self.day - 4 * 3_600))
        context.insert(sugar)
        context.insert(smoking)

        let message = String(localized: StreakStatusIntent.status(for: [sugar, smoking], now: Self.now))
        #expect(message.contains("Smoking"))
        #expect(!message.contains("Sugar"))
    }

    @Test func streakStatusIsFriendlyWithoutHabits() {
        let message = String(localized: StreakStatusIntent.status(for: [], now: Self.now))
        #expect(!message.isEmpty)
    }

    @Test func spokenDurationCoversEveryRange() {
        #expect(!StreakStatusIntent.spokenDuration(0).isEmpty)
        #expect(!StreakStatusIntent.spokenDuration(-500).isEmpty)
        #expect(StreakStatusIntent.spokenDuration(3 * 3_600 + 5 * 60).contains("3"))
        #expect(StreakStatusIntent.spokenDuration(12 * Self.day + 4 * 3_600).contains("12"))
        #expect(!StreakStatusIntent.spokenDuration(5_000 * Self.day).isEmpty)
    }
}

import Foundation
import SwiftData
import Testing
@testable import Unhook

private let day: TimeInterval = 86_400

private func isClose(_ lhs: Double, _ rhs: Double) -> Bool {
    abs(lhs - rhs) < 0.0001
}

private func preset(_ id: String) throws -> HabitPreset {
    try #require(HabitPreset.preset(id: id))
}

struct OnboardingProjectionTests {
    @Test func projectsOneYearOfSavings() {
        let projection = OnboardingProjection(dailyCost: 10, dailyMinutes: 60, unitsPerDay: 12)
        #expect(isClose(projection.yearlyMoney, 3_650))
        #expect(isClose(projection.yearlyHours, 365))
        #expect(isClose(projection.yearlyUnits, 4_380))
        #expect(projection.hasCountableSavings)
    }

    @Test func handlesFractionalInputs() {
        let projection = OnboardingProjection(dailyCost: 2.5, dailyMinutes: 90, unitsPerDay: 0.5)
        #expect(isClose(projection.yearlyMoney, 912.5))
        #expect(isClose(projection.yearlyHours, 547.5))
        #expect(isClose(projection.yearlyUnits, 182.5))
    }

    @Test func negativeAndNonFiniteInputsCountAsZero() {
        let projection = OnboardingProjection(dailyCost: -5, dailyMinutes: .nan, unitsPerDay: .infinity)
        #expect(projection.dailyCost == 0)
        #expect(projection.dailyMinutes == 0)
        #expect(projection.unitsPerDay == 0)
        #expect(projection.yearlyMoney == 0)
        #expect(projection.yearlyHours == 0)
        #expect(projection.yearlyUnits == 0)
        #expect(!projection.hasCountableSavings)
    }

    @Test func minutesAreCappedAtAFullDay() {
        let projection = OnboardingProjection(dailyCost: 0, dailyMinutes: 5_000, unitsPerDay: 0)
        #expect(projection.dailyMinutes == HabitDraft.maxDailyMinutes)
        #expect(isClose(projection.yearlyHours, 24 * 365))
        #expect(projection.hasCountableSavings)
    }

    @Test func hugeInputsStayFinite() {
        let projection = OnboardingProjection(dailyCost: .greatestFiniteMagnitude, dailyMinutes: 0, unitsPerDay: 1e300)
        #expect(projection.dailyCost == OnboardingProjection.maxDailyValue)
        #expect(projection.unitsPerDay == OnboardingProjection.maxDailyValue)
        #expect(projection.yearlyMoney.isFinite)
        #expect(projection.yearlyUnits.isFinite)
    }
}

struct OnboardingAnswersTests {
    let now = Date(timeIntervalSince1970: 1_700_000_000)

    @Test func choosingAPresetPrefillsTheAnswers() throws {
        let smoking = try preset("smoking")
        var answers = OnboardingAnswers()
        #expect(answers.selectedPresetID == nil)

        answers.choose(smoking)

        #expect(answers.selectedPresetID == "smoking")
        #expect(answers.habitName == "Smoking")
        #expect(answers.draft.costText == "10")
        #expect(answers.dailyCost == 10)
        #expect(answers.dailyMinutes == 60)
        #expect(answers.unitsPerDay == 12)
        #expect(answers.canLeaveQuitDateStep)
        #expect(isClose(answers.projection.yearlyMoney, 3_650))
    }

    @Test func choosingTheSamePresetAgainKeepsEdits() throws {
        var answers = OnboardingAnswers()
        let smoking = try preset("smoking")
        let reason = try #require(smoking.suggestedReasons.first)
        answers.choose(smoking)
        answers.draft.costText = "15"
        answers.toggleReason(reason)

        answers.choose(smoking)

        #expect(answers.draft.costText == "15")
        #expect(answers.selectedReasons == [reason])
    }

    @Test func switchingPresetsResetsDefaultsButKeepsTheDate() throws {
        let smoking = try preset("smoking")
        let vaping = try preset("vaping")
        let reason = try #require(smoking.suggestedReasons.first)
        var answers = OnboardingAnswers()
        answers.choose(smoking)
        answers.draft.quitDate = now
        answers.toggleReason(reason)

        answers.choose(vaping)

        #expect(answers.selectedPresetID == "vaping")
        #expect(answers.draft.costText == "4")
        #expect(answers.draft.unitName == "puffs")
        #expect(answers.selectedReasons.isEmpty)
        #expect(answers.draft.quitDate == now)
    }

    @Test func customHabitNeedsAName() throws {
        let custom = try preset(HabitPreset.customID)
        var answers = OnboardingAnswers()
        answers.choose(custom)
        #expect(answers.isCustom)
        #expect(!answers.canLeaveQuitDateStep)

        answers.draft.name = "   "
        #expect(!answers.canLeaveQuitDateStep)

        answers.draft.name = "  Biting pens "
        #expect(answers.canLeaveQuitDateStep)
        #expect(answers.habitName == "Biting pens")
    }

    @Test func justNowStartsTheStreakWhenOnboardingEnds() throws {
        let alcohol = try preset("alcohol")
        var answers = OnboardingAnswers()
        answers.choose(alcohol)
        answers.draft.quitDate = now.addingTimeInterval(-5 * day)

        #expect(answers.timing == OnboardingAnswers.QuitTiming.justNow)
        #expect(answers.streakStart(now: now) == now)
        #expect(answers.cleanTime(now: now) == 0)
    }

    @Test func earlierStartsFromThePickedDate() throws {
        let alcohol = try preset("alcohol")
        var answers = OnboardingAnswers()
        answers.choose(alcohol)
        answers.draft.quitDate = now

        // Switching to "Earlier" moves a just-now date back a day so the picker opens somewhere useful.
        answers.setTiming(.earlier, now: now)
        #expect(answers.draft.quitDate == now.addingTimeInterval(-day))
        #expect(answers.streakStart(now: now) == now.addingTimeInterval(-day))
        #expect(answers.cleanTime(now: now) == day)

        // A date the user already picked is left alone.
        answers.draft.quitDate = now.addingTimeInterval(-3 * day)
        answers.setTiming(.justNow, now: now)
        answers.setTiming(.earlier, now: now)
        #expect(answers.draft.quitDate == now.addingTimeInterval(-3 * day))
    }

    @Test func futureQuitDatesAreClampedToNow() throws {
        let sugar = try preset("sugar")
        var answers = OnboardingAnswers()
        answers.choose(sugar)
        answers.setTiming(.earlier, now: now)
        answers.draft.quitDate = now.addingTimeInterval(day)

        #expect(answers.streakStart(now: now) == now)
        #expect(answers.cleanTime(now: now) == 0)
    }

    @Test func ownReasonComesFirstAndAtMostThreeAreKept() throws {
        let smoking = try preset("smoking")
        var answers = OnboardingAnswers()
        answers.choose(smoking)
        let suggestions = smoking.suggestedReasons
        try #require(suggestions.count >= 3)

        let pickedSecond = answers.toggleReason(suggestions[1])
        let pickedFirst = answers.toggleReason(suggestions[0])
        answers.customReason = "  For my kids  "
        #expect(pickedSecond)
        #expect(pickedFirst)
        #expect(!answers.canAddReason)

        let pickedThird = answers.toggleReason(suggestions[2])
        #expect(!pickedThird)
        #expect(answers.reasons == ["For my kids", suggestions[1], suggestions[0]])

        // Deselecting frees a slot again.
        let removed = answers.toggleReason(suggestions[1])
        #expect(removed)
        #expect(answers.canAddReason)
        #expect(answers.reasons == ["For my kids", suggestions[0]])
    }

    @Test func ownReasonLocksWhenThreeSuggestionsArePicked() throws {
        let vaping = try preset("vaping")
        var answers = OnboardingAnswers()
        answers.choose(vaping)
        try #require(vaping.suggestedReasons.count >= OnboardingAnswers.maxReasons)
        for reason in vaping.suggestedReasons.prefix(OnboardingAnswers.maxReasons) {
            answers.toggleReason(reason)
        }

        #expect(answers.selectedReasons.count == OnboardingAnswers.maxReasons)
        #expect(!answers.canEditCustomReason)

        answers.customReason = "   "
        #expect(answers.reasons.count == OnboardingAnswers.maxReasons)
    }

    @Test func milestonePreviewCountsDownToTheNextMilestone() throws {
        let smoking = try preset("smoking")
        var answers = OnboardingAnswers()
        answers.choose(smoking)

        let first = try #require(answers.milestonePreview(now: now))
        #expect(first.milestone.title == "1 Hour")
        #expect(first.remaining == 3_600)
        #expect(first.isFirst)

        answers.setTiming(.earlier, now: now)
        answers.draft.quitDate = now.addingTimeInterval(-2 * day)
        let next = try #require(answers.milestonePreview(now: now))
        #expect(next.milestone.title == "3 Days")
        #expect(next.remaining == day)
        #expect(!next.isFirst)

        answers.draft.quitDate = now.addingTimeInterval(-10_000 * day)
        #expect(answers.milestonePreview(now: now) == nil)
    }

    @Test func makeHabitUsesEveryAnswer() throws {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        var answers = OnboardingAnswers()
        let smoking = try preset("smoking")
        let reason = try #require(smoking.suggestedReasons.first)
        answers.choose(smoking)
        answers.draft.costText = "12,5"
        answers.draft.minutesText = "2000"
        answers.draft.unitsText = "20"
        answers.setTiming(.earlier, now: now)
        answers.draft.quitDate = now.addingTimeInterval(-3 * day)
        answers.toggleReason(reason)
        answers.customReason = "Run a marathon"

        let habit = answers.makeHabit(now: now)
        context.insert(habit)

        #expect(habit.name == "Smoking")
        #expect(habit.emoji == smoking.emoji)
        #expect(habit.theme == smoking.theme)
        #expect(habit.presetID == "smoking")
        #expect(habit.streakStart == now.addingTimeInterval(-3 * day))
        #expect(habit.dailyCost == 12.5)
        #expect(habit.dailyMinutes == HabitDraft.maxDailyMinutes)
        #expect(habit.unitsPerDay == 20)
        #expect(habit.unitName == "cigarettes")
        #expect(habit.reasons == ["Run a marathon", reason])
        #expect(habit.sortIndex == 0)
    }

    @Test func customHabitWithoutCostsSavesZeros() throws {
        // A live container first: creating a @Model with no container loaded can trap in SwiftData.
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let custom = try preset(HabitPreset.customID)
        var answers = OnboardingAnswers()
        answers.choose(custom)
        answers.draft.name = "Late-night snacking"

        let habit = answers.makeHabit(now: now)
        context.insert(habit)

        #expect(habit.name == "Late-night snacking")
        #expect(habit.presetID == HabitPreset.customID)
        #expect(habit.streakStart == now)
        #expect(habit.dailyCost == 0)
        #expect(habit.dailyMinutes == 0)
        #expect(habit.unitsPerDay == 0)
        #expect(habit.reasons.isEmpty)
        #expect(!answers.projection.hasCountableSavings)
    }
}

struct OnboardingStepTests {
    @Test func onlyQuestionScreensShowProgress() {
        #expect(OnboardingStep.welcome.questionNumber == nil)
        #expect(OnboardingStep.habit.questionNumber == 1)
        #expect(OnboardingStep.projection.questionNumber == OnboardingStep.questionCount)
        #expect(OnboardingStep.reminders.questionNumber == nil)
        #expect(OnboardingStep.paywall.questionNumber == nil)
    }

    @Test func stepsAreOrdered() {
        #expect(OnboardingStep.welcome < OnboardingStep.habit)
        #expect(OnboardingStep.allCases == OnboardingStep.allCases.sorted())
        #expect(OnboardingStep.quitDate.previous == OnboardingStep.habit)
        #expect(OnboardingStep.welcome.previous == nil)
    }

    @Test func everyPresetGetsAQuestion() {
        for preset in HabitPreset.all {
            #expect(!OnboardingCopy.lastTimeQuestion(presetID: preset.id).isEmpty)
        }
    }
}

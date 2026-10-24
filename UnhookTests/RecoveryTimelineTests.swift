import Foundation
import Testing
@testable import Unhook

struct RecoveryTimelineTests {
    private static let day: TimeInterval = 86_400

    /// Hand-made steps with round offsets so the progress math is easy to check.
    private static let sampleSteps: [RecoveryStep] = [
        RecoveryStep(offset: 100, title: "A", detail: "First", symbol: "star.fill"),
        RecoveryStep(offset: 200, title: "B", detail: "Second", symbol: "star.fill"),
        RecoveryStep(offset: 400, title: "C", detail: "Third", symbol: "star.fill"),
    ]

    // MARK: Content

    @Test func everyPresetHasSortedUniqueSteps() {
        for preset in HabitPreset.all {
            let steps = RecoveryTimeline.steps(for: preset.id)
            let offsets = steps.map(\.offset)
            #expect(steps.count >= 5, "\(preset.id) has only \(steps.count) steps")
            #expect(steps.count <= 10, "\(preset.id) has \(steps.count) steps")
            #expect(offsets == offsets.sorted(), "\(preset.id) steps are not sorted")
            #expect(Set(offsets).count == offsets.count, "\(preset.id) has duplicate offsets")
            let allAfterStart = offsets.allSatisfy { $0 > 0 }
            #expect(allAfterStart, "\(preset.id) has a step at or before the start")
        }
    }

    @Test func everyStepHasContent() {
        for preset in HabitPreset.all {
            for step in RecoveryTimeline.steps(for: preset.id) {
                #expect(!step.title.isEmpty, "\(preset.id) has a step without a title")
                #expect(!step.detail.isEmpty, "\(preset.id) step \(step.title) has no detail")
                #expect(!step.symbol.isEmpty, "\(preset.id) step \(step.title) has no symbol")
                #expect(!RecoveryTimeline.offsetLabel(step.offset).isEmpty)
            }
        }
    }

    @Test func everyPresetHasItsOwnTimeline() {
        let generic = RecoveryTimeline.steps(for: HabitPreset.customID)
        for preset in HabitPreset.all where preset.id != HabitPreset.customID {
            #expect(RecoveryTimeline.steps(for: preset.id) != generic, "\(preset.id) falls back to the generic timeline")
        }
    }

    @Test func unknownPresetFallsBackToGenericTimeline() {
        let generic = RecoveryTimeline.steps(for: HabitPreset.customID)
        #expect(!generic.isEmpty)
        #expect(RecoveryTimeline.steps(for: "not-a-real-preset") == generic)
        #expect(RecoveryTimeline.steps(for: "") == generic)
        #expect(RecoveryTimeline.steps(for: "Smoking") == generic)
    }

    @Test func onlyGuidanceBasedTimelinesCiteSources() {
        #expect(RecoveryTimeline.sourceNote(for: "smoking") != nil)
        #expect(RecoveryTimeline.sourceNote(for: HabitPreset.customID) == nil)
        #expect(RecoveryTimeline.sourceNote(for: "not-a-real-preset") == nil)
    }

    // MARK: Progress

    @Test func progressAtTheStart() {
        let steps = Self.sampleSteps
        let progress = RecoveryTimeline.progress(elapsed: 0, steps: steps)
        #expect(progress.reached == 0)
        #expect(progress.next == steps[0])
        #expect(progress.fractionToNext == 0)
    }

    @Test func progressBeforeTheFirstStep() {
        let steps = Self.sampleSteps
        let progress = RecoveryTimeline.progress(elapsed: 50, steps: steps)
        #expect(progress.reached == 0)
        #expect(progress.next == steps[0])
        #expect(abs(progress.fractionToNext - 0.5) < 0.0001)

        let almost = RecoveryTimeline.progress(elapsed: 99.9, steps: steps)
        #expect(almost.reached == 0)
        #expect(almost.next == steps[0])
        #expect(almost.fractionToNext < 1)
    }

    @Test func stepIsReachedExactlyAtItsOffset() {
        let steps = Self.sampleSteps
        let progress = RecoveryTimeline.progress(elapsed: 100, steps: steps)
        #expect(progress.reached == 1)
        #expect(progress.next == steps[1])
        #expect(progress.fractionToNext == 0)
    }

    @Test func progressIsMeasuredFromThePreviousStep() {
        let steps = Self.sampleSteps
        // Halfway between 200 and 400.
        let progress = RecoveryTimeline.progress(elapsed: 300, steps: steps)
        #expect(progress.reached == 2)
        #expect(progress.next == steps[2])
        #expect(abs(progress.fractionToNext - 0.5) < 0.0001)
    }

    @Test func progressAfterTheLastStep() {
        let steps = Self.sampleSteps
        for elapsed in [400, 401, 1e12, Double.infinity] {
            let progress = RecoveryTimeline.progress(elapsed: elapsed, steps: steps)
            #expect(progress.reached == 3)
            #expect(progress.next == nil)
            #expect(progress.fractionToNext == 1)
        }
    }

    @Test func progressHandlesBadInput() {
        let steps = Self.sampleSteps

        let negative = RecoveryTimeline.progress(elapsed: -500, steps: steps)
        #expect(negative.reached == 0)
        #expect(negative.next == steps[0])
        #expect(negative.fractionToNext == 0)

        let notANumber = RecoveryTimeline.progress(elapsed: .nan, steps: steps)
        #expect(notANumber.reached == 0)
        #expect(notANumber.next == steps[0])
        #expect(notANumber.fractionToNext == 0)

        let empty = RecoveryTimeline.progress(elapsed: 1_000, steps: [])
        #expect(empty.reached == 0)
        #expect(empty.next == nil)
        #expect(empty.fractionToNext == 1)
    }

    @Test func progressDoesNotDependOnStepOrder() {
        let steps = Self.sampleSteps
        let progress = RecoveryTimeline.progress(elapsed: 300, steps: steps.reversed())
        #expect(progress.reached == 2)
        #expect(progress.next == steps[2])
        #expect(abs(progress.fractionToNext - 0.5) < 0.0001)
    }

    @Test func progressOnARealTimeline() throws {
        let steps = RecoveryTimeline.steps(for: "smoking")
        let first = try #require(steps.first)
        #expect(first.offset == 20 * 60)

        let elapsed = 2.5 * Self.day
        let expectedReached = steps.filter { $0.offset <= elapsed }.count
        let expectedNext = steps.first(where: { $0.offset > elapsed })
        let progress = RecoveryTimeline.progress(elapsed: elapsed, steps: steps)
        #expect(progress.reached == expectedReached)
        #expect(progress.next == expectedNext)
        #expect(progress.fractionToNext > 0)
        #expect(progress.fractionToNext < 1)
    }

    // MARK: Offset labels

    @Test func offsetsUseTheLargestWholeUnit() {
        let day = Self.day
        #expect(RecoveryTimeline.offsetComponents(20 * 60) == DateComponents(minute: 20))
        #expect(RecoveryTimeline.offsetComponents(12 * 3_600) == DateComponents(hour: 12))
        #expect(RecoveryTimeline.offsetComponents(3 * day) == DateComponents(day: 3))
        #expect(RecoveryTimeline.offsetComponents(7 * day) == DateComponents(weekOfMonth: 1))
        #expect(RecoveryTimeline.offsetComponents(14 * day) == DateComponents(weekOfMonth: 2))
        #expect(RecoveryTimeline.offsetComponents(30 * day) == DateComponents(month: 1))
        #expect(RecoveryTimeline.offsetComponents(180 * day) == DateComponents(month: 6))
        #expect(RecoveryTimeline.offsetComponents(365 * day) == DateComponents(year: 1))
        #expect(RecoveryTimeline.offsetComponents(15 * 365 * day) == DateComponents(year: 15))
    }
}

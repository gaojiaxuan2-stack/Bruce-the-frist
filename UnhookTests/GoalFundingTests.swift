import Foundation
import SwiftData
import Testing
@testable import Unhook

struct GoalFundingTests {
    private static func goal(
        _ cost: Double,
        sortIndex: Int,
        redeemed: Bool = false,
        id: UUID = UUID()
    ) -> GoalFundingInput {
        GoalFundingInput(id: id, cost: cost, isRedeemed: redeemed, sortIndex: sortIndex)
    }

    private static func isClose(_ value: Double?, _ expected: Double) -> Bool {
        guard let value else { return false }
        return abs(value - expected) < 0.000_001
    }

    // MARK: Allocation

    @Test func noGoalsMeansNoAllocation() {
        #expect(GoalFunding.allocate(totalSaved: 250, goals: []).isEmpty)
    }

    @Test func partiallyFundsASingleGoal() {
        let airPods = Self.goal(200, sortIndex: 0)
        let allocation = GoalFunding.allocate(totalSaved: 124, goals: [airPods])
        #expect(Self.isClose(allocation[airPods.id], 124))
    }

    @Test func fundedGoalIsCappedAtItsCost() {
        let shoes = Self.goal(140, sortIndex: 0)
        let allocation = GoalFunding.allocate(totalSaved: 5_000, goals: [shoes])
        #expect(allocation[shoes.id] == 140)
    }

    @Test func fundsGoalsInSortOrderNotArrayOrder() {
        let first = Self.goal(60, sortIndex: 0)
        let second = Self.goal(100, sortIndex: 1)
        let third = Self.goal(50, sortIndex: 2)
        let allocation = GoalFunding.allocate(totalSaved: 100, goals: [third, second, first])
        #expect(allocation[first.id] == 60)
        #expect(Self.isClose(allocation[second.id], 40))
        #expect(allocation[third.id] == 0)
    }

    @Test func tiedSortIndexesKeepTheirInputOrder() {
        let a = Self.goal(50, sortIndex: 3)
        let b = Self.goal(50, sortIndex: 3)

        let forward = GoalFunding.allocate(totalSaved: 70, goals: [a, b])
        #expect(forward[a.id] == 50)
        #expect(Self.isClose(forward[b.id], 20))

        let backward = GoalFunding.allocate(totalSaved: 70, goals: [b, a])
        #expect(backward[b.id] == 50)
        #expect(Self.isClose(backward[a.id], 20))
    }

    @Test func redeemedGoalsSpendTheirCostFirst() {
        // The redeemed goal sorts after the active one but was already paid for.
        let active = Self.goal(100, sortIndex: 0)
        let bought = Self.goal(30, sortIndex: 5, redeemed: true)
        let allocation = GoalFunding.allocate(totalSaved: 80, goals: [active, bought])
        #expect(allocation[bought.id] == 30)
        #expect(Self.isClose(allocation[active.id], 50))
    }

    @Test func redeemedGoalsAlwaysShowTheirFullCost() {
        let bought = Self.goal(200, sortIndex: 0, redeemed: true)
        let active = Self.goal(50, sortIndex: 1)
        let allocation = GoalFunding.allocate(totalSaved: 10, goals: [bought, active])
        #expect(allocation[bought.id] == 200)
        #expect(allocation[active.id] == 0)
    }

    @Test func nothingSavedFundsNothing() {
        let active = Self.goal(10, sortIndex: 0)
        let bought = Self.goal(25, sortIndex: 1, redeemed: true)
        let allocation = GoalFunding.allocate(totalSaved: 0, goals: [active, bought])
        #expect(allocation[active.id] == 0)
        #expect(allocation[bought.id] == 25)
    }

    @Test func unusableTotalsCountAsNothingSaved() {
        let active = Self.goal(10, sortIndex: 0)
        let bought = Self.goal(25, sortIndex: 1, redeemed: true)
        for total in [-50, Double.nan, Double.infinity, -Double.infinity] {
            let allocation = GoalFunding.allocate(totalSaved: total, goals: [active, bought])
            #expect(allocation[active.id] == 0, "total \(total)")
            #expect(allocation[bought.id] == 25, "total \(total)")
        }
    }

    @Test func unusableCostsFundNothingAndCostNothing() {
        let notANumber = Self.goal(.nan, sortIndex: 0)
        let negative = Self.goal(-20, sortIndex: 1)
        let infinite = Self.goal(.infinity, sortIndex: 2)
        let real = Self.goal(50, sortIndex: 3)
        let boughtNotANumber = Self.goal(.nan, sortIndex: 4, redeemed: true)
        let allocation = GoalFunding.allocate(
            totalSaved: 40,
            goals: [notANumber, negative, infinite, real, boughtNotANumber]
        )
        #expect(allocation[notANumber.id] == 0)
        #expect(allocation[negative.id] == 0)
        #expect(allocation[infinite.id] == 0)
        #expect(allocation[boughtNotANumber.id] == 0)
        #expect(Self.isClose(allocation[real.id], 40))
    }

    @Test func everyGoalGetsAnEntry() {
        let goals = [
            Self.goal(10, sortIndex: 0),
            Self.goal(20, sortIndex: 1),
            Self.goal(30, sortIndex: 2, redeemed: true),
            Self.goal(0, sortIndex: 3),
        ]
        let allocation = GoalFunding.allocate(totalSaved: 15, goals: goals)
        #expect(Set(allocation.keys) == Set(goals.map(\.id)))
    }

    @Test func repeatedIDsAreOnlyFundedOnce() {
        let shared = UUID()
        let other = Self.goal(50, sortIndex: 2)
        let allocation = GoalFunding.allocate(
            totalSaved: 100,
            goals: [Self.goal(50, sortIndex: 0, id: shared), Self.goal(50, sortIndex: 1, id: shared), other]
        )
        #expect(allocation[shared] == 50)
        #expect(allocation[other.id] == 50)

        // A redeemed copy wins over an active one and is charged once.
        let mixed = GoalFunding.allocate(
            totalSaved: 60,
            goals: [Self.goal(100, sortIndex: 0, id: shared), Self.goal(30, sortIndex: 1, redeemed: true, id: shared), other]
        )
        #expect(mixed[shared] == 30)
        #expect(Self.isClose(mixed[other.id], 30))
    }

    @Test func allocationStaysWithinBoundsAndFillsInOrder() {
        let goals = [
            Self.goal(120, sortIndex: 2),
            Self.goal(35.5, sortIndex: 0),
            Self.goal(80, sortIndex: 5, redeemed: true),
            Self.goal(0, sortIndex: 3),
            Self.goal(999, sortIndex: 4),
            Self.goal(15, sortIndex: 1),
        ]
        let active = goals.filter { !$0.isRedeemed }.sorted { $0.sortIndex < $1.sortIndex }
        let redeemedCost = goals.filter(\.isRedeemed).reduce(0.0) { $0 + $1.cost }
        let activeCost = active.reduce(0.0) { $0 + $1.cost }

        for total in [0, 0.01, 20, 115.5, 151, 1_000, 1e9] {
            let allocation = GoalFunding.allocate(totalSaved: total, goals: goals)

            for goal in goals {
                let funded = allocation[goal.id] ?? -1
                #expect(funded >= 0 && funded <= goal.cost, "total \(total), cost \(goal.cost): \(funded)")
            }

            let activeFunded = active.reduce(0.0) { $0 + (allocation[$1.id] ?? 0) }
            let expected = min(activeCost, max(0, total - redeemedCost))
            #expect(abs(activeFunded - expected) < 0.000_001, "total \(total)")

            // Once a goal isn't full, nothing after it gets any money.
            var foundUnfunded = false
            for goal in active {
                let funded = allocation[goal.id] ?? 0
                if foundUnfunded {
                    #expect(funded == 0, "total \(total), goal \(goal.sortIndex)")
                }
                if funded < goal.cost { foundUnfunded = true }
            }
        }
    }

    // MARK: Days to fund

    @Test func daysRoundUp() {
        #expect(GoalFunding.daysToFund(remaining: 30, dailySavings: 10) == 3)
        #expect(GoalFunding.daysToFund(remaining: 31, dailySavings: 10) == 4)
        #expect(GoalFunding.daysToFund(remaining: 30.0001, dailySavings: 10) == 4)
        #expect(GoalFunding.daysToFund(remaining: 100, dailySavings: 12) == 9)
        #expect(GoalFunding.daysToFund(remaining: 0.5, dailySavings: 10) == 1)
        #expect(GoalFunding.daysToFund(remaining: 1e-12, dailySavings: 10) == 1)
    }

    @Test func roundingNoiseDoesNotAddADay() {
        // 2.1 / 0.3 is 7.000000000000001 in floating point.
        #expect(GoalFunding.daysToFund(remaining: 2.1, dailySavings: 0.3) == 7)
        #expect(GoalFunding.daysToFund(remaining: 2.7, dailySavings: 0.15) == 18)
        // 0.3 / 0.1 is 2.9999999999999996.
        #expect(GoalFunding.daysToFund(remaining: 0.3, dailySavings: 0.1) == 3)
    }

    @Test func fundedGoalNeedsNoMoreDays() {
        #expect(GoalFunding.daysToFund(remaining: 0, dailySavings: 10) == 0)
        #expect(GoalFunding.daysToFund(remaining: -5, dailySavings: 10) == 0)
        #expect(GoalFunding.daysToFund(remaining: -Double.infinity, dailySavings: 10) == 0)
        // Nothing left to save, so no daily savings are needed either.
        #expect(GoalFunding.daysToFund(remaining: 0, dailySavings: 0) == 0)
        #expect(GoalFunding.daysToFund(remaining: 0, dailySavings: .nan) == 0)
    }

    @Test func noDailySavingsMeansNoEstimate() {
        for daily in [0, -1, Double.nan, Double.infinity, -Double.infinity] {
            #expect(GoalFunding.daysToFund(remaining: 50, dailySavings: daily) == nil, "daily \(daily)")
        }
    }

    @Test func unmeasurableRemainingMeansNoEstimate() {
        #expect(GoalFunding.daysToFund(remaining: .nan, dailySavings: 10) == nil)
        #expect(GoalFunding.daysToFund(remaining: .infinity, dailySavings: 10) == nil)
    }

    @Test func hugeEstimatesAreClampedInsteadOfCrashing() {
        #expect(GoalFunding.daysToFund(remaining: 1_000_000, dailySavings: 0.01) == 100_000_000)
        // 1e300 / 1e-300 overflows to infinity.
        #expect(GoalFunding.daysToFund(remaining: 1e300, dailySavings: 1e-300) == 1_000_000_000_000_000)
    }

    // MARK: Progress

    @Test func progressOfAPartlyFundedGoal() {
        let progress = GoalProgress(funded: 25, cost: 100, dailySavings: 5)
        #expect(progress.funded == 25)
        #expect(progress.cost == 100)
        #expect(progress.remaining == 75)
        #expect(Self.isClose(progress.fraction, 0.25))
        #expect(!progress.isFunded)
        #expect(progress.daysToGo == 15)
    }

    @Test func progressOfAFundedGoal() {
        let progress = GoalProgress(funded: 100, cost: 100, dailySavings: 5)
        #expect(progress.isFunded)
        #expect(progress.fraction == 1)
        #expect(progress.remaining == 0)
        #expect(progress.daysToGo == 0)
    }

    @Test func progressClampsFundingToTheCost() {
        let over = GoalProgress(funded: 150, cost: 100, dailySavings: 5)
        #expect(over.funded == 100)
        #expect(over.fraction == 1)
        #expect(over.isFunded)

        let negative = GoalProgress(funded: -10, cost: 100, dailySavings: 5)
        #expect(negative.funded == 0)
        #expect(negative.fraction == 0)
        #expect(negative.daysToGo == 20)

        let notANumber = GoalProgress(funded: .nan, cost: 100, dailySavings: 0)
        #expect(notANumber.funded == 0)
        #expect(notANumber.daysToGo == nil)
        #expect(!notANumber.isFunded)
    }

    @Test func goalsAheadInLineAddToTheEstimate() {
        // 30 still needed by earlier goals plus 50 of its own, at 10 a day.
        let waiting = GoalProgress(funded: 0, cost: 50, dailySavings: 10, queuedAhead: 30)
        #expect(waiting.daysToGo == 8)
        #expect(waiting.remaining == 50)

        // A funded goal is ready whatever is still queued ahead of it.
        let funded = GoalProgress(funded: 50, cost: 50, dailySavings: 10, queuedAhead: 30)
        #expect(funded.daysToGo == 0)

        // Unusable queue amounts are ignored.
        let odd = GoalProgress(funded: 0, cost: 50, dailySavings: 10, queuedAhead: .nan)
        #expect(odd.daysToGo == 5)
    }

    @Test func remainingAheadSumsWhatEarlierActiveGoalsStillNeed() {
        let first = Self.goal(100, sortIndex: 0)
        let second = Self.goal(50, sortIndex: 1)
        let third = Self.goal(40, sortIndex: 2)
        let bought = Self.goal(30, sortIndex: 3, redeemed: true)
        let goals = [third, bought, second, first]
        // 30 pays for the bought goal, 70 goes to the first goal.
        let allocation = GoalFunding.allocate(totalSaved: 100, goals: goals)
        let ahead = GoalFunding.remainingAhead(goals: goals, allocation: allocation)

        #expect(ahead[first.id] == 0)
        #expect(Self.isClose(ahead[second.id], 30))
        #expect(Self.isClose(ahead[third.id], 80))
        #expect(ahead[bought.id] == nil)

        let secondProgress = GoalProgress(
            funded: allocation[second.id] ?? 0,
            cost: second.cost,
            dailySavings: 10,
            queuedAhead: ahead[second.id] ?? 0
        )
        #expect(secondProgress.daysToGo == 8)
    }

    @Test func goalWithoutAUsablePriceCountsAsFunded() {
        for cost in [0, -40, Double.nan, Double.infinity] {
            let progress = GoalProgress(funded: 10, cost: cost, dailySavings: 5)
            #expect(progress.cost == 0, "cost \(cost)")
            #expect(progress.funded == 0, "cost \(cost)")
            #expect(progress.fraction == 1, "cost \(cost)")
            #expect(progress.isFunded, "cost \(cost)")
            #expect(progress.daysToGo == 0, "cost \(cost)")
        }
    }

    // MARK: Models

    @Test func inputMirrorsTheStoredGoal() {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let goal = SavingsGoal(title: "Weekend trip", emoji: "✈️", cost: 300, sortIndex: 4)
        context.insert(goal)

        let input = GoalFundingInput(goal: goal)
        #expect(input.id == goal.uuid)
        #expect(input.cost == 300)
        #expect(input.sortIndex == 4)
        #expect(!input.isRedeemed)

        goal.redeemedAt = Date(timeIntervalSince1970: 0)
        #expect(GoalFundingInput(goal: goal).isRedeemed)
    }

    @Test func savingsFundTheFirstGoalBeforeTheNext() {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)
        let trip = SavingsGoal(title: "Weekend trip", emoji: "✈️", cost: 300, sortIndex: 0)
        let dinner = SavingsGoal(title: "Nice dinner", emoji: "🍣", cost: 80, sortIndex: 1)
        context.insert(trip)
        context.insert(dinner)

        let inputs = [dinner, trip].map { GoalFundingInput(goal: $0) }
        let allocation = GoalFunding.allocate(totalSaved: 340, goals: inputs)
        let tripProgress = GoalProgress(funded: allocation[trip.uuid] ?? 0, cost: trip.cost, dailySavings: 10)
        let dinnerProgress = GoalProgress(funded: allocation[dinner.uuid] ?? 0, cost: dinner.cost, dailySavings: 10)

        #expect(tripProgress.isFunded)
        #expect(tripProgress.daysToGo == 0)
        #expect(Self.isClose(dinnerProgress.funded, 40))
        #expect(Self.isClose(dinnerProgress.fraction, 0.5))
        #expect(dinnerProgress.daysToGo == 4)
    }
}

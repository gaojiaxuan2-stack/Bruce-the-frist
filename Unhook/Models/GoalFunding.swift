import Foundation

/// The parts of a savings goal the funding math needs. A plain value so the math is easy to test.
struct GoalFundingInput: Hashable {
    let id: UUID
    let cost: Double
    let isRedeemed: Bool
    let sortIndex: Int
}

extension GoalFundingInput {
    init(goal: SavingsGoal) {
        self.init(id: goal.uuid, cost: goal.cost, isRedeemed: goal.isRedeemed, sortIndex: goal.sortIndex)
    }
}

/// Turns the money saved across all habits into progress toward the user's savings goals.
enum GoalFunding {
    /// How much of the savings pool belongs to each goal, keyed by goal id.
    ///
    /// Redeemed goals have already spent their cost from the pool, so they always get their full cost and are
    /// paid for first. The rest of the pool funds active goals in `sortIndex` order (ties keep their order in
    /// `goals`): each goal fills up completely before the next one gets anything. Every value is in `0...cost`.
    /// Non-finite or negative totals and costs count as zero. A repeated id is only funded the first time.
    static func allocate(totalSaved: Double, goals: [GoalFundingInput]) -> [UUID: Double] {
        var allocation: [UUID: Double] = [:]
        var pool = nonNegative(totalSaved)

        for goal in goals where goal.isRedeemed && allocation[goal.id] == nil {
            let cost = nonNegative(goal.cost)
            allocation[goal.id] = cost
            pool -= cost
        }
        pool = max(0, pool)

        for goal in activeGoalsInFundingOrder(goals) where allocation[goal.id] == nil {
            let funded = min(nonNegative(goal.cost), pool)
            allocation[goal.id] = funded
            pool -= funded
        }
        return allocation
    }

    /// Whole days of saving `dailySavings` a day it takes to put away `remaining`, rounded up.
    ///
    /// Returns 0 when nothing remains (whatever the daily savings), and nil when nothing is saved per day or the
    /// input can't be measured (NaN, an infinite amount remaining). A quotient within a rounding error of a whole
    /// number snaps to it, so 2.10 at 0.30 a day is 7 days rather than 8.
    static func daysToFund(remaining: Double, dailySavings: Double) -> Int? {
        guard !remaining.isNaN else { return nil }
        guard remaining > 0 else { return 0 }
        guard remaining.isFinite, dailySavings.isFinite, dailySavings > 0 else { return nil }

        let days = remaining / dailySavings
        let nearest = days.rounded()
        let whole = abs(days - nearest) <= nearest * 1e-9 ? nearest : days.rounded(.up)
        // Something is still left to save, so it always takes at least a day.
        return max(1, whole.clampedWholeNumber)
    }

    /// For each active goal, keyed by goal id: what the active goals funded before it still need.
    ///
    /// Savings only reach a goal once every goal ahead of it is full, so this belongs in that goal's time
    /// estimate. The first goal in line gets 0. Redeemed goals get no entry. `allocation` is the result of
    /// `allocate(totalSaved:goals:)` for the same goals.
    static func remainingAhead(goals: [GoalFundingInput], allocation: [UUID: Double]) -> [UUID: Double] {
        let redeemedIDs = Set(goals.filter(\.isRedeemed).map(\.id))
        var ahead: [UUID: Double] = [:]
        var queued = 0.0
        for goal in activeGoalsInFundingOrder(goals) where ahead[goal.id] == nil && !redeemedIDs.contains(goal.id) {
            ahead[goal.id] = queued
            let cost = nonNegative(goal.cost)
            let funded = min(nonNegative(allocation[goal.id] ?? 0), cost)
            queued += cost - funded
        }
        return ahead
    }

    /// `value` when it is a finite amount of zero or more; otherwise zero.
    static func nonNegative(_ value: Double) -> Double {
        value.isFinite ? max(0, value) : 0
    }

    private static func activeGoalsInFundingOrder(_ goals: [GoalFundingInput]) -> [GoalFundingInput] {
        goals.enumerated()
            .filter { !$0.element.isRedeemed }
            .sorted { lhs, rhs in
                if lhs.element.sortIndex != rhs.element.sortIndex {
                    return lhs.element.sortIndex < rhs.element.sortIndex
                }
                return lhs.offset < rhs.offset
            }
            .map { $0.element }
    }
}

/// One goal's funding at a moment in time, ready for display.
struct GoalProgress: Equatable {
    /// Money put toward the goal, in `0...cost`.
    let funded: Double
    /// The goal's price; zero if it was not a usable amount.
    let cost: Double
    /// Days of saving until this goal is funded, counting the goals ahead of it in line: 0 once funded,
    /// nil when nothing is saved per day.
    let daysToGo: Int?

    /// `queuedAhead` is what the goals funded before this one still need (see `GoalFunding.remainingAhead`).
    /// Savings reach this goal only after those goals are full.
    init(funded: Double, cost: Double, dailySavings: Double, queuedAhead: Double = 0) {
        let usableCost = GoalFunding.nonNegative(cost)
        let usableFunded = min(GoalFunding.nonNegative(funded), usableCost)
        let ownRemaining = usableCost - usableFunded
        self.cost = usableCost
        self.funded = usableFunded
        self.daysToGo = GoalFunding.daysToFund(
            remaining: ownRemaining > 0 ? ownRemaining + GoalFunding.nonNegative(queuedAhead) : ownRemaining,
            dailySavings: dailySavings
        )
    }

    var remaining: Double { cost - funded }

    /// Share of the price saved, in 0...1. A goal that costs nothing counts as fully funded.
    var fraction: Double { cost > 0 ? funded / cost : 1 }

    var isFunded: Bool { funded >= cost }
}

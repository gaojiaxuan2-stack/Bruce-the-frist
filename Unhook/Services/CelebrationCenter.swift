import Foundation

/// Decides which streak milestone the app should celebrate. Notifications announce a milestone the moment
/// it unlocks; the next time the app opens, this turns it into a full-screen moment worth sharing.
@MainActor
enum CelebrationCenter {
    /// The latest milestone reached after `elapsed` seconds that is newer than `celebrated`, or nil.
    /// Skipped milestones are not queued: someone who comes back after ten days sees "1 Week", not
    /// "1 Day", "3 Days" and "1 Week" in a row.
    nonisolated static func pendingMilestone(elapsed: TimeInterval, celebrated: TimeInterval) -> Milestone? {
        guard let latest = Milestone.latest(reachedBy: elapsed), latest.seconds > celebrated else { return nil }
        return latest
    }

    /// The biggest uncelebrated milestone across `habits`, or nil when there's nothing new.
    /// Ties go to the habit that comes first on the home screen.
    static func pendingCelebration(for habits: [Habit], now: Date = .now) -> MilestoneCelebration? {
        var best: MilestoneCelebration?
        for habit in habits {
            let elapsed = habit.stats(at: now).currentStreak
            guard let milestone = pendingMilestone(elapsed: elapsed, celebrated: habit.celebratedMilestoneSeconds) else {
                continue
            }
            if let current = best {
                let isBigger = milestone.seconds > current.milestone.seconds
                let winsTie = milestone.seconds == current.milestone.seconds && habit.sortIndex < current.habit.sortIndex
                guard isBigger || winsTie else { continue }
            }
            best = MilestoneCelebration(habit: habit, milestone: milestone)
        }
        return best
    }

    /// Remembers that `celebration` was shown so it never appears twice. Never lowers the record.
    /// A slip resets it (see `Habit.recordRelapse`), so the next streak gets its own celebrations.
    static func markCelebrated(_ celebration: MilestoneCelebration) {
        let habit = celebration.habit
        habit.celebratedMilestoneSeconds = max(habit.celebratedMilestoneSeconds, celebration.milestone.seconds)
    }

    /// A warm line for the celebration screen that grows with the size of the win.
    nonisolated static func encouragement(for milestone: Milestone) -> String {
        let day: TimeInterval = 86_400
        switch milestone.seconds {
        case ..<day:
            return String(localized: "The first hours are the hardest, and you're already through them.")
        case ..<(7 * day):
            return String(localized: "Every day you stay free makes the next one easier. Keep stacking them.")
        case ..<(30 * day):
            return String(localized: "A new rhythm is forming. This is what real change feels like.")
        case ..<(365 * day):
            return String(localized: "This isn't luck anymore. It's who you're becoming.")
        default:
            return String(localized: "You're living proof that people can change. Incredible.")
        }
    }
}

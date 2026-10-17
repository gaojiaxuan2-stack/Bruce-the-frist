import Foundation

/// Streak checkpoints. Early ones arrive fast so new users get a win in their first session.
struct Milestone: Identifiable, Hashable {
    let seconds: TimeInterval
    let title: String
    let symbol: String

    var id: Int { Int(seconds) }

    private static let hour: TimeInterval = 3_600
    private static let day: TimeInterval = 86_400

    static let all: [Milestone] = [
        Milestone(seconds: hour, title: "1 Hour", symbol: "hourglass"),
        Milestone(seconds: 12 * hour, title: "12 Hours", symbol: "sunrise.fill"),
        Milestone(seconds: day, title: "1 Day", symbol: "sun.max.fill"),
        Milestone(seconds: 3 * day, title: "3 Days", symbol: "flame.fill"),
        Milestone(seconds: 7 * day, title: "1 Week", symbol: "star.fill"),
        Milestone(seconds: 14 * day, title: "2 Weeks", symbol: "bolt.fill"),
        Milestone(seconds: 30 * day, title: "1 Month", symbol: "moon.stars.fill"),
        Milestone(seconds: 60 * day, title: "2 Months", symbol: "leaf.fill"),
        Milestone(seconds: 90 * day, title: "3 Months", symbol: "trophy.fill"),
        Milestone(seconds: 180 * day, title: "6 Months", symbol: "medal.fill"),
        Milestone(seconds: 365 * day, title: "1 Year", symbol: "crown.fill"),
        Milestone(seconds: 730 * day, title: "2 Years", symbol: "mountain.2.fill"),
        Milestone(seconds: 1_825 * day, title: "5 Years", symbol: "sparkles"),
    ]

    static func next(after elapsed: TimeInterval) -> Milestone? {
        all.first { $0.seconds > elapsed }
    }

    static func latest(reachedBy elapsed: TimeInterval) -> Milestone? {
        all.last { $0.seconds <= elapsed }
    }

    /// Progress from the previous milestone (or the start) toward the next one, in 0...1.
    static func progress(toward elapsed: TimeInterval) -> Double {
        guard let next = next(after: elapsed) else { return 1 }
        let previous = latest(reachedBy: elapsed)?.seconds ?? 0
        return min(max((elapsed - previous) / (next.seconds - previous), 0), 1)
    }
}

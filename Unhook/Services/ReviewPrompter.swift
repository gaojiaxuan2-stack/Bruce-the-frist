import Foundation

/// Decides when to ask for an App Store rating: only after a few high points (milestone celebrations,
/// beaten cravings), never in the first couple of days, and at most once every four months.
///
/// The system shows the actual prompt at most three times a year and may decide not to show it at all,
/// so this only picks a good moment. Call `markRequested(now:)` whenever you call `requestReview()`.
struct ReviewPrompter {
    static let standard = ReviewPrompter(defaults: .standard)

    static let requiredPositiveMoments = 3
    static let minimumDaysSinceFirstUse = 2
    static let minimumDaysBetweenRequests = 120

    private static let secondsPerDay: TimeInterval = 86_400
    /// Keeps the counter far away from `Int.max`, whatever ends up in the defaults.
    private static let maximumStoredMoments = 10_000

    private enum Keys {
        static let firstUseDate = "review.firstUseDate"
        static let positiveMomentCount = "review.positiveMomentCount"
        static let lastRequestDate = "review.lastRequestDate"
    }

    let defaults: UserDefaults

    init(defaults: UserDefaults) {
        self.defaults = defaults
    }

    /// Positive moments since the last review request.
    var positiveMomentCount: Int {
        min(max(defaults.integer(forKey: Keys.positiveMomentCount), 0), Self.maximumStoredMoments)
    }

    /// When the first positive moment was recorded.
    var firstUseDate: Date? {
        defaults.object(forKey: Keys.firstUseDate) as? Date
    }

    var lastRequestDate: Date? {
        defaults.object(forKey: Keys.lastRequestDate) as? Date
    }

    /// Call after something good happens: a milestone celebration or a beaten craving.
    func recordPositiveMoment(now: Date = .now) {
        if firstUseDate == nil {
            defaults.set(now, forKey: Keys.firstUseDate)
        }
        let next = min(positiveMomentCount + 1, Self.maximumStoredMoments)
        defaults.set(next, forKey: Keys.positiveMomentCount)
    }

    /// True when it's a good moment to ask: at least three positive moments, two days after first use,
    /// and no earlier request in the last 120 days.
    func shouldRequestReview(now: Date = .now) -> Bool {
        guard positiveMomentCount >= Self.requiredPositiveMoments else { return false }
        guard let firstUseDate,
              now.timeIntervalSince(firstUseDate) >= Double(Self.minimumDaysSinceFirstUse) * Self.secondsPerDay
        else { return false }
        guard let lastRequestDate else { return true }
        return now.timeIntervalSince(lastRequestDate) >= Double(Self.minimumDaysBetweenRequests) * Self.secondsPerDay
    }

    /// Records that the rating prompt was requested and starts counting positive moments again.
    func markRequested(now: Date = .now) {
        defaults.set(0, forKey: Keys.positiveMomentCount)
        defaults.set(now, forKey: Keys.lastRequestDate)
    }
}

import Foundation

/// Everything the craving coach knows about the user, as a plain value so coaches stay pure and testable.
/// Built on the device from the user's own habits; it is never sent anywhere.
struct CoachContext: Equatable, Sendable {
    /// The habit's name, or nil when the user has no habits yet (a generic conversation).
    var habitName: String?
    var habitEmoji: String
    /// Length of the current clean streak, in seconds.
    var currentStreak: TimeInterval
    /// The user's own reasons for quitting, trimmed and without blanks.
    var reasons: [String]
    var moneySaved: Double
    var currencyCode: String
    /// The trigger the user logs most often (never `.other`), if any.
    var topTrigger: CravingTrigger?
    var cravingsBeaten: Int

    init(
        habitName: String? = nil,
        habitEmoji: String = "✨",
        currentStreak: TimeInterval = 0,
        reasons: [String] = [],
        moneySaved: Double = 0,
        currencyCode: String = AppSettings.defaultCurrencyCode,
        topTrigger: CravingTrigger? = nil,
        cravingsBeaten: Int = 0
    ) {
        self.habitName = habitName
        self.habitEmoji = habitEmoji
        self.currentStreak = currentStreak.isFinite ? max(0, currentStreak) : 0
        self.reasons = reasons
        self.moneySaved = moneySaved.isFinite ? max(0, moneySaved) : 0
        self.currencyCode = currencyCode
        self.topTrigger = topTrigger
        self.cravingsBeaten = max(0, cravingsBeaten)
    }

    /// A context for someone who hasn't added a habit yet.
    static var generic: CoachContext {
        CoachContext(currencyCode: storedCurrencyCode)
    }

    /// The currency the user picked in Settings.
    static var storedCurrencyCode: String {
        UserDefaults.standard.string(forKey: AppSettings.Keys.currencyCode) ?? AppSettings.defaultCurrencyCode
    }

    /// Builds the context for `habit`, or — when `habit` is nil — for the habit with the longest current streak.
    /// Falls back to a generic context when there are no habits.
    static func make(
        habit: Habit?,
        allHabits: [Habit],
        now: Date = .now,
        currencyCode: String = CoachContext.storedCurrencyCode
    ) -> CoachContext {
        guard let source = habit ?? longestStreakHabit(in: allHabits, at: now) else {
            return CoachContext(currencyCode: currencyCode)
        }

        let stats = source.stats(at: now)
        let name = source.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let reasons = source.reasons
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let urgeTriggers: [CravingTrigger?] = source.urges.map { $0.trigger }
        let relapseTriggers: [CravingTrigger?] = source.relapses.map { $0.trigger }
        let triggers = urgeTriggers + relapseTriggers

        return CoachContext(
            habitName: name.isEmpty ? nil : name,
            habitEmoji: source.emoji.isEmpty ? "✨" : source.emoji,
            currentStreak: stats.currentStreak,
            reasons: reasons,
            moneySaved: stats.moneySaved,
            currencyCode: currencyCode,
            topTrigger: mostCommonTrigger(triggers),
            cravingsBeaten: source.resistedUrgeCount
        )
    }

    /// The habit whose current streak is longest. Ties go to the habit that comes first.
    static func longestStreakHabit(in habits: [Habit], at now: Date) -> Habit? {
        var best: Habit?
        var bestStreak = -Double.infinity
        for habit in habits {
            let streak = habit.stats(at: now).currentStreak
            if streak > bestStreak {
                best = habit
                bestStreak = streak
            }
        }
        return best
    }

    /// The most frequent trigger, ignoring `.other` and unknowns. Ties go to the trigger listed first in `CravingTrigger`.
    static func mostCommonTrigger(_ triggers: [CravingTrigger?]) -> CravingTrigger? {
        var counts: [CravingTrigger: Int] = [:]
        for trigger in triggers {
            guard let trigger, trigger != .other else { continue }
            counts[trigger, default: 0] += 1
        }
        return CravingTrigger.allCases
            .filter { (counts[$0] ?? 0) > 0 }
            .max { (counts[$0] ?? 0) < (counts[$1] ?? 0) }
    }
}

extension CoachContext {
    var isGeneric: Bool { habitName == nil }

    /// The habit's name for use inside a sentence.
    var displayName: String {
        habitName ?? String(localized: "your habit")
    }

    /// The streak in the largest whole unit, localized: "12 days", "5 hours", "1 minute".
    var streakText: String {
        let parts = DurationFormatter.parts(currentStreak)
        let components: DateComponents
        if parts.days > 0 {
            components = DateComponents(day: parts.days)
        } else if parts.hours > 0 {
            components = DateComponents(hour: parts.hours)
        } else if parts.minutes > 0 {
            components = DateComponents(minute: parts.minutes)
        } else {
            return String(localized: "less than a minute")
        }

        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.maximumUnitCount = 1
        formatter.allowedUnits = [.day, .hour, .minute]
        return formatter.string(from: components) ?? DurationFormatter.compact(currentStreak)
    }

    /// Whether the streak is long enough to be worth mentioning (an hour or more on a named habit).
    var hasMeaningfulStreak: Bool {
        !isGeneric && currentStreak >= 3_600
    }

    /// Money saved in whole units, or nil when there's nothing worth mentioning yet.
    var moneySavedText: String? {
        guard moneySaved >= 1 else { return nil }
        return MoneyFormatter.rounded(moneySaved, code: currencyCode)
    }
}

/// One line in the coach chat.
struct CoachMessage: Identifiable, Equatable, Sendable {
    enum Role: Equatable, Sendable {
        case user, coach
    }

    let id: UUID
    let role: Role
    let text: String
    let date: Date

    init(id: UUID = UUID(), role: Role, text: String, date: Date = .now) {
        self.id = id
        self.role = role
        self.text = text
        self.date = date
    }
}

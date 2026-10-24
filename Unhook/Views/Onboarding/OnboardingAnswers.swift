import Foundation

/// The onboarding screens, in order.
enum OnboardingStep: Int, CaseIterable, Comparable {
    case welcome, habit, quitDate, cost, reasons, projection, reminders, paywall

    /// Question screens (habit through projection) show a progress bar and a Back button.
    static let questionCount = OnboardingStep.projection.rawValue

    /// 1-based position among the question screens, or nil for screens without the progress bar.
    var questionNumber: Int? {
        (OnboardingStep.habit...OnboardingStep.projection).contains(self) ? rawValue : nil
    }

    var previous: OnboardingStep? {
        OnboardingStep(rawValue: rawValue - 1)
    }

    static func < (lhs: OnboardingStep, rhs: OnboardingStep) -> Bool {
        lhs.rawValue < rhs.rawValue
    }
}

/// The next streak milestone as seen from the end of onboarding.
struct OnboardingMilestonePreview: Equatable {
    let milestone: Milestone
    /// Seconds until `milestone` unlocks.
    let remaining: TimeInterval
    /// True when no milestone has been reached yet.
    let isFirst: Bool
}

/// Everything the user tells onboarding, and the habit it turns into. Pure value type so it is easy to test.
struct OnboardingAnswers {
    enum QuitTiming: Hashable {
        /// The streak starts when onboarding ends.
        case justNow
        /// Already clean since `draft.quitDate`.
        case earlier
    }

    static let maxReasons = 3
    /// How far back the date picker starts when the user says they stopped earlier.
    static let defaultEarlierOffset: TimeInterval = 86_400

    /// Preset defaults plus the user's edits (name, emoji, theme, quit date, cost texts, unit name).
    var draft = HabitDraft()
    var timing: QuitTiming = .justNow
    var customReason = ""
    /// Suggested reasons the user picked, in the order they tapped them.
    private(set) var selectedReasons: [String] = []
    private(set) var hasChosenPreset = false

    var selectedPresetID: String? { hasChosenPreset ? draft.presetID : nil }
    var isCustom: Bool { draft.presetID == HabitPreset.customID }
    var theme: HabitTheme { draft.theme }

    /// Starts from `preset`'s defaults. Picking the same preset again keeps what the user already entered.
    mutating func choose(_ preset: HabitPreset) {
        guard !hasChosenPreset || preset.id != draft.presetID else { return }
        let quitDate = draft.quitDate
        draft = HabitDraft(preset: preset)
        draft.quitDate = quitDate
        selectedReasons = []
        hasChosenPreset = true
    }

    /// Switching to "Earlier" moves a just-now quit date back a day so the picker opens somewhere useful.
    mutating func setTiming(_ newTiming: QuitTiming, now: Date = .now) {
        timing = newTiming
        if newTiming == .earlier, draft.quitDate > now.addingTimeInterval(-3_600) {
            draft.quitDate = now.addingTimeInterval(-Self.defaultEarlierOffset)
        }
    }

    // MARK: Habit details

    /// Presets are always named; a custom habit needs a name before the user can move on.
    var canLeaveQuitDateStep: Bool { draft.isValid }

    var habitName: String {
        if !draft.trimmedName.isEmpty { return draft.trimmedName }
        if !isCustom, let preset = HabitPreset.preset(id: draft.presetID) { return preset.title }
        return String(localized: "My habit")
    }

    var dailyCost: Double { HabitDraft.parse(draft.costText) }
    var dailyMinutes: Double { HabitDraft.parse(draft.minutesText, upTo: HabitDraft.maxDailyMinutes) }
    var unitsPerDay: Double { HabitDraft.parse(draft.unitsText) }

    var projection: OnboardingProjection {
        OnboardingProjection(dailyCost: dailyCost, dailyMinutes: dailyMinutes, unitsPerDay: unitsPerDay)
    }

    // MARK: Quit date

    func streakStart(now: Date = .now) -> Date {
        switch timing {
        case .justNow:
            return now
        case .earlier:
            return min(draft.quitDate, now)
        }
    }

    /// Clean time already earned at `now`. Never negative.
    func cleanTime(now: Date = .now) -> TimeInterval {
        max(0, now.timeIntervalSince(streakStart(now: now)))
    }

    /// The next milestone to unlock, or nil once every milestone has been passed.
    func milestonePreview(now: Date = .now) -> OnboardingMilestonePreview? {
        let elapsed = cleanTime(now: now)
        guard let next = Milestone.next(after: elapsed) else { return nil }
        return OnboardingMilestonePreview(
            milestone: next,
            remaining: next.seconds - elapsed,
            isFirst: Milestone.latest(reachedBy: elapsed) == nil
        )
    }

    // MARK: Reasons

    var trimmedCustomReason: String {
        customReason.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// What gets saved: the user's own words first, then the picked suggestions, at most `maxReasons`.
    var reasons: [String] {
        var result: [String] = []
        if !trimmedCustomReason.isEmpty {
            result.append(trimmedCustomReason)
        }
        for reason in selectedReasons where !result.contains(reason) {
            result.append(reason)
        }
        return Array(result.prefix(Self.maxReasons))
    }

    private var reasonSlotsUsed: Int {
        selectedReasons.count + (trimmedCustomReason.isEmpty ? 0 : 1)
    }

    var canAddReason: Bool { reasonSlotsUsed < Self.maxReasons }

    /// The free-text reason stays editable while it has text or a slot is free, so nothing is silently dropped.
    var canEditCustomReason: Bool { !trimmedCustomReason.isEmpty || canAddReason }

    func isSelected(_ reason: String) -> Bool {
        selectedReasons.contains(reason)
    }

    /// Selects or deselects a suggested reason. Returns false when the limit blocks a new selection.
    @discardableResult
    mutating func toggleReason(_ reason: String) -> Bool {
        if let index = selectedReasons.firstIndex(of: reason) {
            selectedReasons.remove(at: index)
            return true
        }
        guard canAddReason else { return false }
        selectedReasons.append(reason)
        return true
    }

    // MARK: Result

    /// The user's first habit. Call once, at the very end of onboarding.
    func makeHabit(now: Date = .now) -> Habit {
        Habit(
            name: habitName,
            emoji: draft.emoji.isEmpty ? "✨" : draft.emoji,
            theme: draft.theme,
            streakStart: streakStart(now: now),
            dailyCost: dailyCost,
            dailyMinutes: dailyMinutes,
            unitsPerDay: unitsPerDay,
            unitName: draft.unitName.trimmingCharacters(in: .whitespacesAndNewlines),
            reasons: reasons,
            sortIndex: 0,
            presetID: draft.presetID
        )
    }
}

extension OnboardingAnswers {
    /// Sample answers (Smoking, with its defaults) for SwiftUI previews.
    static var preview: OnboardingAnswers {
        var answers = OnboardingAnswers()
        if let preset = HabitPreset.preset(id: "smoking") {
            answers.choose(preset)
        }
        return answers
    }
}

/// Copy that depends on the user's answers. Whole sentences per case so each one can be translated naturally.
enum OnboardingCopy {
    static func lastTimeQuestion(presetID: String) -> String {
        switch presetID {
        case "smoking": return String(localized: "When did you last smoke?")
        case "vaping": return String(localized: "When did you last vape?")
        case "alcohol": return String(localized: "When did you last drink?")
        case "social": return String(localized: "When did you last doomscroll?")
        case "porn": return String(localized: "When did you last watch porn?")
        case "sugar": return String(localized: "When did you last have sugar?")
        case "junkfood": return String(localized: "When did you last eat junk food?")
        case "caffeine": return String(localized: "When did you last have caffeine?")
        case "cannabis": return String(localized: "When did you last use cannabis?")
        case "gambling": return String(localized: "When did you last gamble?")
        case "gaming": return String(localized: "When did you last play games?")
        case "shopping": return String(localized: "When did you last buy on impulse?")
        case "nailbiting": return String(localized: "When did you last bite your nails?")
        default: return String(localized: "When did it last happen?")
        }
    }

    /// Time until a milestone: "60 minutes" within the hour, otherwise up to two units ("2 days, 4 hours").
    static func timeUntil(_ interval: TimeInterval) -> String {
        let seconds = interval.isFinite ? max(60, interval) : 60
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        if seconds <= 3_600 {
            formatter.allowedUnits = [.minute]
        } else {
            formatter.allowedUnits = [.day, .hour, .minute]
            formatter.maximumUnitCount = 2
        }
        return formatter.string(from: seconds) ?? DurationFormatter.compact(seconds)
    }
}

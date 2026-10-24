import Foundation

/// Editable copy of a habit used by the add/edit form. Numbers are kept as text so typing never loses input.
struct HabitDraft {
    var presetID = HabitPreset.customID
    var name = ""
    var emoji = "✨"
    var theme: HabitTheme = .ocean
    var quitDate = Date.now
    var costText = ""
    var minutesText = ""
    var unitsText = ""
    var unitName = ""
    var reasons = ["", "", ""]
    var suggestedReasons: [String] = []

    init() {}

    init(preset: HabitPreset) {
        presetID = preset.id
        name = preset.defaultName
        emoji = preset.emoji
        theme = preset.theme
        costText = Self.format(preset.dailyCost)
        minutesText = Self.format(preset.dailyMinutes)
        unitsText = Self.format(preset.unitsPerDay)
        unitName = preset.unitName
        suggestedReasons = preset.suggestedReasons
    }

    init(habit: Habit) {
        presetID = habit.presetID
        name = habit.name
        emoji = habit.emoji
        theme = habit.theme
        quitDate = habit.streakStart
        costText = Self.format(habit.dailyCost)
        minutesText = Self.format(habit.dailyMinutes)
        unitsText = Self.format(habit.unitsPerDay)
        unitName = habit.unitName
        reasons = Array((habit.reasons + ["", "", ""]).prefix(3))
    }

    var trimmedName: String { name.trimmingCharacters(in: .whitespacesAndNewlines) }
    var isValid: Bool { !trimmedName.isEmpty }

    var cleanedReasons: [String] {
        reasons
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
    }

    /// Minutes in a day: the most time a habit can take per day.
    static let maxDailyMinutes: Double = 1_440

    /// Parses user input like "12", "12.5" or "12,5" into 0...upperBound. Anything unreadable, including
    /// "inf", counts as zero; the cap keeps a run of digits from producing totals too big to display.
    static func parse(_ text: String, upTo upperBound: Double = 1_000_000) -> Double {
        let cleaned = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        guard let value = Double(cleaned), value.isFinite else { return 0 }
        return min(max(0, value), upperBound)
    }

    static func format(_ value: Double) -> String {
        guard value.isFinite, value > 0 else { return "" }
        if let whole = Int(exactly: value) { return String(whole) }
        return String(value)
    }
}

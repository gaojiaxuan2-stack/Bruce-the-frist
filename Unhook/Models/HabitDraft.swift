import Foundation

/// Editable copy of a habit used by the add/edit form. Numbers are kept as text so typing never loses input.
struct HabitDraft {
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

    /// Parses user input like "12", "12.5" or "12,5". Anything unreadable counts as zero.
    static func parse(_ text: String) -> Double {
        let cleaned = text
            .trimmingCharacters(in: .whitespaces)
            .replacingOccurrences(of: ",", with: ".")
        return max(0, Double(cleaned) ?? 0)
    }

    static func format(_ value: Double) -> String {
        guard value > 0 else { return "" }
        return value.rounded() == value ? String(Int(value)) : String(value)
    }
}

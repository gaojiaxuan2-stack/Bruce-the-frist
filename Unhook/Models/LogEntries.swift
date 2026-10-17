import Foundation
import SwiftData

/// A slip. Stores how long the streak lasted so the history can show it.
@Model
final class Relapse {
    var date: Date = Date.now
    var streakSeconds: Double = 0
    var note: String = ""
    var habit: Habit?

    init(date: Date, streakSeconds: Double, note: String) {
        self.date = date
        self.streakSeconds = streakSeconds
        self.note = note
    }
}

/// A craving the user rode out with the SOS screen.
@Model
final class Urge {
    var date: Date = Date.now
    var resisted: Bool = true
    var habit: Habit?

    init(date: Date = .now, resisted: Bool) {
        self.date = date
        self.resisted = resisted
    }
}

/// The daily "I'll stay free today" commitment, with a mood check-in.
@Model
final class Pledge {
    /// Start of the day the pledge belongs to.
    var day: Date = Date.now
    /// 1 (rough) … 5 (great).
    var mood: Int = 3
    var createdAt: Date = Date.now

    init(day: Date, mood: Int, calendar: Calendar = .current) {
        self.day = calendar.startOfDay(for: day)
        self.mood = min(max(mood, 1), 5)
        self.createdAt = .now
    }
}

enum MoodScale {
    static let emojis = ["😣", "😕", "😐", "🙂", "😄"]

    static func emoji(for mood: Int) -> String {
        emojis[min(max(mood, 1), 5) - 1]
    }
}

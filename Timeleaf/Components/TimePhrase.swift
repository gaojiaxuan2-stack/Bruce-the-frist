import Foundation

/// Human, locale-aware phrases about time.
enum TimePhrase {
    /// The two largest non-zero units between two dates:
    /// "2 years, 3 months", "5 days, 4 hours", "12 minutes". Order of the dates does not matter.
    static func duration(from: Date, to: Date) -> String {
        let start = min(from, to)
        let end = max(from, to)
        guard end.timeIntervalSince(start) >= 60 else {
            return String(localized: "less than a minute")
        }

        let calendar = Calendar.current
        let components = calendar.dateComponents([.year, .month, .day, .hour, .minute], from: start, to: end)

        let formatter = DateComponentsFormatter()
        formatter.calendar = calendar
        formatter.unitsStyle = .full
        formatter.maximumUnitCount = 2
        formatter.allowedUnits = [.year, .month, .day, .hour, .minute]
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: components) ?? String(localized: "a little while")
    }

    /// "in 2 years, 3 months" / "3 days ago" / "in a moment" / "just now".
    static func relative(_ date: Date, now: Date = .now) -> String {
        let interval = date.timeIntervalSince(now)
        if abs(interval) < 60 {
            return interval >= 0 ? String(localized: "in a moment") : String(localized: "just now")
        }
        let phrase = duration(from: now, to: date)
        if interval > 0 {
            return String(localized: "in \(phrase)")
        }
        return String(localized: "\(phrase) ago")
    }

    /// "Tuesday, 13 October 2026" – order and punctuation follow the user's locale.
    static func longDate(_ date: Date) -> String {
        date.formatted(.dateTime.weekday(.wide).day().month(.wide).year())
    }

    /// "a Tuesday evening in October".
    static func moment(_ date: Date) -> String {
        let weekday = date.formatted(.dateTime.weekday(.wide))
        let month = date.formatted(.dateTime.month(.wide))
        let dayPart = Self.dayPart(forHour: Calendar.current.component(.hour, from: date))
        return String(localized: "a \(weekday) \(dayPart) in \(month)")
    }

    private static func dayPart(forHour hour: Int) -> String {
        switch hour {
        case 5..<12:
            return String(localized: "morning")
        case 12..<17:
            return String(localized: "afternoon")
        case 17..<21:
            return String(localized: "evening")
        default:
            return String(localized: "night")
        }
    }
}

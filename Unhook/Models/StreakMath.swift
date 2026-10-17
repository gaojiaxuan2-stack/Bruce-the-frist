import Foundation

enum StreakCalculator {
    /// Consecutive days with at least one entry, ending today. Today still counts as "in progress",
    /// so a streak that ended yesterday stays alive until the day is over.
    static func consecutiveDays(_ dates: [Date], now: Date = .now, calendar: Calendar = .current) -> Int {
        let days = Set(dates.map { calendar.startOfDay(for: $0) })
        var cursor = calendar.startOfDay(for: now)

        if !days.contains(cursor) {
            guard let yesterday = calendar.date(byAdding: .day, value: -1, to: cursor), days.contains(yesterday) else {
                return 0
            }
            cursor = yesterday
        }

        var count = 0
        while days.contains(cursor) {
            count += 1
            guard let previous = calendar.date(byAdding: .day, value: -1, to: cursor) else { break }
            cursor = previous
        }
        return count
    }
}

struct DayCount: Identifiable, Equatable {
    let day: Date
    let count: Int

    var id: Date { day }
}

enum DailyCounts {
    /// One entry per day for the last `days` days (oldest first), including days with zero entries.
    static func make(from dates: [Date], days: Int, now: Date = .now, calendar: Calendar = .current) -> [DayCount] {
        let today = calendar.startOfDay(for: now)
        var counts: [Date: Int] = [:]
        for date in dates {
            counts[calendar.startOfDay(for: date), default: 0] += 1
        }
        return (0..<days).reversed().compactMap { offset in
            guard let day = calendar.date(byAdding: .day, value: -offset, to: today) else { return nil }
            return DayCount(day: day, count: counts[day] ?? 0)
        }
    }
}

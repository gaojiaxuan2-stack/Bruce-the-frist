import Foundation

extension Calendar {
    /// Start of the day before the day that starts at `dayStart`. Steps back one second rather than one
    /// calendar day, because in time zones that switch to daylight saving at midnight some days start at 01:00.
    func startOfPreviousDay(before dayStart: Date) -> Date {
        startOfDay(for: dayStart.addingTimeInterval(-1))
    }
}

enum StreakCalculator {
    /// Consecutive days with at least one entry, ending today. Today still counts as "in progress",
    /// so a streak that ended yesterday stays alive until the day is over.
    static func consecutiveDays(_ dates: [Date], now: Date = .now, calendar: Calendar = .current) -> Int {
        let days = Set(dates.map { calendar.startOfDay(for: $0) })
        var cursor = calendar.startOfDay(for: now)

        if !days.contains(cursor) {
            cursor = calendar.startOfPreviousDay(before: cursor)
            guard days.contains(cursor) else { return 0 }
        }

        var count = 0
        while days.contains(cursor) {
            count += 1
            cursor = calendar.startOfPreviousDay(before: cursor)
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
        var counts: [Date: Int] = [:]
        for date in dates {
            counts[calendar.startOfDay(for: date), default: 0] += 1
        }

        var result: [DayCount] = []
        var day = calendar.startOfDay(for: now)
        for _ in 0..<max(days, 0) {
            result.append(DayCount(day: day, count: counts[day] ?? 0))
            day = calendar.startOfPreviousDay(before: day)
        }
        return result.reversed()
    }
}

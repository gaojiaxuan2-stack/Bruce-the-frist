import Foundation

/// One craving moment the insights learn from: a craving logged in SOS, or a slip.
struct CravingEvent: Hashable {
    let date: Date
    let trigger: CravingTrigger?
    let resisted: Bool
}

extension CravingEvent {
    init(urge: Urge) {
        self.init(date: urge.date, trigger: urge.trigger, resisted: urge.resisted)
    }

    /// A slip is a craving that won this time.
    init(relapse: Relapse) {
        self.init(date: relapse.date, trigger: relapse.trigger, resisted: false)
    }
}

/// How many tagged cravings and slips one trigger was behind.
struct TriggerCount: Hashable, Identifiable {
    let trigger: CravingTrigger
    let count: Int

    var id: CravingTrigger { trigger }
}

/// When and why cravings hit, worked out from the user's logged cravings and slips.
/// Pure value type so it is easy to test.
struct TriggerInsights: Equatable {
    /// One bar of the 24-hour chart.
    struct HourCount: Hashable, Identifiable {
        let hour: Int
        let count: Int

        var id: Int { hour }
    }

    static let hoursPerDay = 24
    static let daysPerWeek = 7

    /// Every event, tagged or not.
    let totalCount: Int
    /// Events the user said a trigger for.
    let taggedCount: Int
    /// Events the user rode out.
    let resistedCount: Int
    /// Tagged events per trigger, most common first. Ties follow `CravingTrigger.allCases` order;
    /// triggers that were never logged are left out.
    let topTriggers: [TriggerCount]
    /// Events per hour of the day in the calendar's time zone. Always 24 buckets; index 0 is midnight to 1 AM.
    let countsByHour: [Int]
    /// Events per weekday. Always 7 buckets; index 0 is Calendar weekday 1 (Sunday in the Gregorian calendar).
    let countsByWeekday: [Int]
    /// The hour (0...23) with the most events, the earliest one on ties. Nil when there are no events.
    let peakHour: Int?
    /// The Calendar weekday (1...7) with the most events, the lowest number on ties. Nil when there are no events.
    let peakWeekday: Int?
    /// Share of events the user resisted, 0...1. Nil when there are no events.
    let resistedRate: Double?

    init(events: [CravingEvent], calendar: Calendar = .current) {
        var hours = Array(repeating: 0, count: Self.hoursPerDay)
        var weekdays = Array(repeating: 0, count: Self.daysPerWeek)
        var triggerCounts: [CravingTrigger: Int] = [:]
        var tagged = 0
        var resisted = 0

        for event in events {
            let hour = calendar.component(.hour, from: event.date)
            if hours.indices.contains(hour) {
                hours[hour] += 1
            }
            let weekdayIndex = calendar.component(.weekday, from: event.date) - 1
            if weekdays.indices.contains(weekdayIndex) {
                weekdays[weekdayIndex] += 1
            }
            if let trigger = event.trigger {
                triggerCounts[trigger, default: 0] += 1
                tagged += 1
            }
            if event.resisted {
                resisted += 1
            }
        }

        totalCount = events.count
        taggedCount = tagged
        resistedCount = resisted
        topTriggers = Self.ranked(triggerCounts)
        countsByHour = hours
        countsByWeekday = weekdays
        peakHour = Self.peakIndex(of: hours)
        peakWeekday = Self.peakIndex(of: weekdays).map { $0 + 1 }
        resistedRate = events.isEmpty ? nil : Double(resisted) / Double(events.count)
    }

    /// The most common trigger, if the user has tagged any.
    var topTrigger: TriggerCount? { topTriggers.first }

    /// How many events fell in the peak hour (0 without events).
    var peakHourCount: Int {
        guard let peakHour, countsByHour.indices.contains(peakHour) else { return 0 }
        return countsByHour[peakHour]
    }

    /// How many events fell on the peak weekday (0 without events).
    var peakWeekdayCount: Int {
        guard let peakWeekday, countsByWeekday.indices.contains(peakWeekday - 1) else { return 0 }
        return countsByWeekday[peakWeekday - 1]
    }

    /// The 24 hourly buckets in a chart-friendly form.
    var hourlyCounts: [HourCount] {
        countsByHour.enumerated().map { HourCount(hour: $0.offset, count: $0.element) }
    }

    /// Share (0...1) of the tagged events that `item` was behind.
    func share(of item: TriggerCount) -> Double {
        guard taggedCount > 0 else { return 0 }
        return min(max(Double(item.count) / Double(taggedCount), 0), 1)
    }

    // MARK: Display helpers

    /// An hour of the day for display, in the user's language and 12/24-hour clock: "9 PM", "21 Uhr", "21時".
    /// Out-of-range hours are clamped to 0...23.
    static func hourLabel(_ hour: Int, locale: Locale = .current) -> String {
        let hour = min(max(hour, 0), hoursPerDay - 1)
        // Formatting in UTC means every hour exists (no daylight-saving gaps) and shows exactly as given.
        let utc = TimeZone(secondsFromGMT: 0) ?? .current
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = utc
        let date = Date(timeIntervalSinceReferenceDate: Double(hour) * 3_600)
        let style = Date.FormatStyle(locale: locale, calendar: calendar, timeZone: utc).hour()
        return date.formatted(style)
    }

    /// The name of a Calendar weekday (1...7) in the calendar's language, such as "Friday". Nil when out of range.
    static func weekdayName(_ weekday: Int, calendar: Calendar = .current) -> String? {
        let symbols = calendar.standaloneWeekdaySymbols
        let index = weekday - 1
        guard symbols.indices.contains(index) else { return nil }
        return symbols[index]
    }

    // MARK: Private

    private static func ranked(_ counts: [CravingTrigger: Int]) -> [TriggerCount] {
        var entries: [(order: Int, item: TriggerCount)] = []
        for (order, trigger) in CravingTrigger.allCases.enumerated() {
            guard let count = counts[trigger], count > 0 else { continue }
            entries.append((order: order, item: TriggerCount(trigger: trigger, count: count)))
        }
        entries.sort { lhs, rhs in
            if lhs.item.count != rhs.item.count {
                return lhs.item.count > rhs.item.count
            }
            return lhs.order < rhs.order
        }
        return entries.map { $0.item }
    }

    /// Index of the largest positive count, the first one on ties. Nil when every count is zero.
    private static func peakIndex(of counts: [Int]) -> Int? {
        var best: Int?
        var bestCount = 0
        for (index, count) in counts.enumerated() where count > bestCount {
            best = index
            bestCount = count
        }
        return best
    }
}

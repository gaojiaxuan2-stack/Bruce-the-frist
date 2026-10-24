import Foundation
import SwiftData
import Testing
@testable import Unhook

struct TriggerInsightsTests {
    /// Monday 1 January 2024, 00:00 UTC.
    private static let monday = Date(timeIntervalSince1970: 1_704_067_200)

    /// A fixed Gregorian calendar in UTC, so hour and weekday buckets don't depend on the test machine.
    private static var utc: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = TimeZone(secondsFromGMT: 0) ?? .current
        calendar.locale = Locale(identifier: "en_US")
        return calendar
    }

    /// `day` days after Monday 1 January 2024, at `hour`:`minute` UTC.
    private static func date(day: Int = 0, hour: Int, minute: Int = 0) -> Date {
        monday.addingTimeInterval(Double(day) * 86_400 + Double(hour) * 3_600 + Double(minute) * 60)
    }

    private static func event(
        day: Int = 0,
        hour: Int = 12,
        minute: Int = 0,
        trigger: CravingTrigger? = nil,
        resisted: Bool = true
    ) -> CravingEvent {
        CravingEvent(date: date(day: day, hour: hour, minute: minute), trigger: trigger, resisted: resisted)
    }

    private static func insights(_ events: [CravingEvent]) -> TriggerInsights {
        TriggerInsights(events: events, calendar: utc)
    }

    // MARK: Empty input

    @Test func emptyInputHasNoInsights() {
        let insights = Self.insights([])
        #expect(insights.totalCount == 0)
        #expect(insights.taggedCount == 0)
        #expect(insights.resistedCount == 0)
        #expect(insights.topTriggers.isEmpty)
        #expect(insights.topTrigger == nil)
        #expect(insights.countsByHour == Array(repeating: 0, count: 24))
        #expect(insights.countsByWeekday == Array(repeating: 0, count: 7))
        #expect(insights.peakHour == nil)
        #expect(insights.peakWeekday == nil)
        #expect(insights.peakHourCount == 0)
        #expect(insights.peakWeekdayCount == 0)
        #expect(insights.resistedRate == nil)
        #expect(insights.hourlyCounts.count == 24)
        #expect(insights.hourlyCounts.allSatisfy { $0.count == 0 })
    }

    // MARK: Top triggers

    @Test func topTriggersAreSortedByCount() {
        let events = [
            Self.event(trigger: .stress),
            Self.event(trigger: .boredom),
            Self.event(trigger: .anxiety),
            Self.event(trigger: .boredom),
            Self.event(trigger: .anxiety),
            Self.event(trigger: .boredom),
            Self.event(),
            Self.event(),
        ]
        let insights = Self.insights(events)
        #expect(insights.topTriggers == [
            TriggerCount(trigger: .boredom, count: 3),
            TriggerCount(trigger: .anxiety, count: 2),
            TriggerCount(trigger: .stress, count: 1),
        ])
        #expect(insights.topTrigger == TriggerCount(trigger: .boredom, count: 3))
        #expect(insights.taggedCount == 6)
        #expect(insights.totalCount == 8)
    }

    @Test func tiesFollowTheTriggerListOrderNotTheLoggingOrder() {
        let events = [
            Self.event(trigger: .other),
            Self.event(trigger: .routine),
            Self.event(trigger: .other),
            Self.event(trigger: .anxiety),
            Self.event(trigger: .anxiety),
            Self.event(trigger: .boredom),
            Self.event(trigger: .boredom),
        ]
        let insights = Self.insights(events)
        #expect(insights.topTriggers.map(\.trigger) == [CravingTrigger.boredom, .anxiety, .other, .routine])
        #expect(insights.topTriggers.map(\.count) == [2, 2, 2, 1])
    }

    @Test func untaggedEventsStillCountTowardTiming() {
        let events = [Self.event(hour: 8), Self.event(hour: 8), Self.event(hour: 20)]
        let insights = Self.insights(events)
        #expect(insights.topTriggers.isEmpty)
        #expect(insights.topTrigger == nil)
        #expect(insights.taggedCount == 0)
        #expect(insights.totalCount == 3)
        #expect(insights.peakHour == 8)
    }

    @Test func sharesAreOfTaggedEvents() throws {
        let events = [
            Self.event(trigger: .stress),
            Self.event(trigger: .stress),
            Self.event(trigger: .stress),
            Self.event(trigger: .social),
            Self.event(),
        ]
        let insights = Self.insights(events)
        let top = try #require(insights.topTrigger)
        #expect(abs(insights.share(of: top) - 0.75) < 0.0001)

        let untagged = Self.insights([Self.event()])
        #expect(untagged.share(of: TriggerCount(trigger: .stress, count: 1)) == 0)
    }

    // MARK: Hours

    @Test func hoursAreBucketedByHourOfDay() {
        let events = [
            Self.event(hour: 0, minute: 0),
            Self.event(day: 3, hour: 0, minute: 59),
            Self.event(hour: 9, minute: 30),
            Self.event(hour: 21),
            Self.event(day: 1, hour: 21, minute: 45),
            Self.event(hour: 23, minute: 59),
        ]
        let insights = Self.insights(events)
        var expected = Array(repeating: 0, count: 24)
        expected[0] = 2
        expected[9] = 1
        expected[21] = 2
        expected[23] = 1
        #expect(insights.countsByHour == expected)
        #expect(insights.countsByHour.reduce(0, +) == events.count)
        #expect(insights.hourlyCounts.map(\.hour) == Array(0..<24))
        #expect(insights.hourlyCounts.map(\.count) == expected)
    }

    @Test func bucketsFollowTheCalendarsTimeZone() throws {
        var plusTwo = Calendar(identifier: .gregorian)
        plusTwo.timeZone = try #require(TimeZone(secondsFromGMT: 2 * 3_600))
        // Monday 23:30 UTC is already Tuesday 01:30 two hours east.
        let events = [Self.event(hour: 23, minute: 30)]

        let utc = Self.insights(events)
        #expect(utc.peakHour == 23)
        #expect(utc.peakWeekday == 2)

        let shifted = TriggerInsights(events: events, calendar: plusTwo)
        #expect(shifted.peakHour == 1)
        #expect(shifted.countsByHour[1] == 1)
        #expect(shifted.peakWeekday == 3)
    }

    @Test func peakHourIsTheBusiestHour() {
        let events = [
            Self.event(hour: 21), Self.event(day: 1, hour: 21), Self.event(day: 2, hour: 21, minute: 50),
            Self.event(hour: 8), Self.event(day: 4, hour: 8),
            Self.event(hour: 13),
        ]
        let insights = Self.insights(events)
        #expect(insights.peakHour == 21)
        #expect(insights.peakHourCount == 3)
    }

    @Test func peakHourTiesGoToTheEarliestHour() {
        let events = [
            Self.event(hour: 22), Self.event(day: 1, hour: 22),
            Self.event(hour: 7), Self.event(day: 2, hour: 7),
        ]
        let insights = Self.insights(events)
        #expect(insights.peakHour == 7)
        #expect(insights.peakHourCount == 2)
    }

    // MARK: Weekdays

    @Test func peakWeekdayIsTheBusiestDay() {
        // 1 January 2024 is a Monday, so day 4 is a Friday and day 6 a Sunday.
        let events = [
            Self.event(day: 4, hour: 9), Self.event(day: 4, hour: 18), Self.event(day: 11, hour: 22),
            Self.event(day: 0),
            Self.event(day: 6),
        ]
        let insights = Self.insights(events)
        #expect(insights.countsByWeekday == [1, 1, 0, 0, 0, 3, 0])
        #expect(insights.peakWeekday == 6)
        #expect(insights.peakWeekdayCount == 3)
    }

    @Test func peakWeekdayTiesGoToTheLowestWeekdayNumber() {
        // Saturday (weekday 7) is logged first, but Sunday (weekday 1) wins the tie.
        let events = [Self.event(day: 5), Self.event(day: 6)]
        let insights = Self.insights(events)
        #expect(insights.peakWeekday == 1)
    }

    // MARK: Resisted rate

    @Test func resistedRateIsTheShareOfEventsResisted() throws {
        let mixed = Self.insights([
            Self.event(resisted: true),
            Self.event(resisted: true),
            Self.event(resisted: true),
            Self.event(resisted: false),
        ])
        #expect(mixed.resistedCount == 3)
        let rate = try #require(mixed.resistedRate)
        #expect(abs(rate - 0.75) < 0.0001)

        let noneResisted = try #require(Self.insights([Self.event(resisted: false)]).resistedRate)
        #expect(noneResisted == 0)
        let allResisted = try #require(Self.insights([Self.event(), Self.event()]).resistedRate)
        #expect(allResisted == 1)
    }

    // MARK: Logged entries

    @Test func eventsComeFromCravingsAndSlips() {
        let container = AppModelContainer.make(inMemory: true)
        let context = ModelContext(container)

        let urge = Urge(date: Self.date(hour: 9), resisted: true, trigger: .stress, intensity: 4)
        let untagged = Urge(date: Self.date(hour: 10), resisted: false)
        let relapse = Relapse(date: Self.date(hour: 22), streakSeconds: 3_600, note: "")
        relapse.trigger = .social
        context.insert(urge)
        context.insert(untagged)
        context.insert(relapse)

        #expect(CravingEvent(urge: urge) == CravingEvent(date: Self.date(hour: 9), trigger: .stress, resisted: true))
        #expect(CravingEvent(urge: untagged) == CravingEvent(date: Self.date(hour: 10), trigger: nil, resisted: false))
        #expect(CravingEvent(relapse: relapse) == CravingEvent(date: Self.date(hour: 22), trigger: .social, resisted: false))
    }

    // MARK: Display helpers

    @Test func hourLabelUsesTheLocale() {
        let english = Locale(identifier: "en_US")
        let evening = TriggerInsights.hourLabel(21, locale: english)
        #expect(evening.hasPrefix("9"))
        #expect(evening.contains("PM"))

        let midnight = TriggerInsights.hourLabel(0, locale: english)
        #expect(midnight.hasPrefix("12"))
        #expect(midnight.contains("AM"))

        let noon = TriggerInsights.hourLabel(12, locale: english)
        #expect(noon.hasPrefix("12"))
        #expect(noon.contains("PM"))

        let german = TriggerInsights.hourLabel(21, locale: Locale(identifier: "de_DE"))
        #expect(german.contains("21"))
        #expect(!german.contains("PM"))
    }

    @Test func hourLabelClampsOutOfRangeHours() {
        let english = Locale(identifier: "en_US")
        #expect(TriggerInsights.hourLabel(-3, locale: english) == TriggerInsights.hourLabel(0, locale: english))
        #expect(TriggerInsights.hourLabel(40, locale: english) == TriggerInsights.hourLabel(23, locale: english))
    }

    @Test func everyHourHasADistinctLabel() {
        for identifier in ["en_US", "de_DE", "ja_JP"] {
            let locale = Locale(identifier: identifier)
            let labels = (0..<24).map { TriggerInsights.hourLabel($0, locale: locale) }
            #expect(Set(labels).count == 24, "\(identifier) repeats an hour label")
            #expect(labels.allSatisfy { !$0.isEmpty })
        }
    }

    @Test func weekdayNamesFollowTheCalendar() {
        let calendar = Self.utc
        #expect(TriggerInsights.weekdayName(1, calendar: calendar) == "Sunday")
        #expect(TriggerInsights.weekdayName(6, calendar: calendar) == "Friday")
        #expect(TriggerInsights.weekdayName(7, calendar: calendar) == "Saturday")
        #expect(TriggerInsights.weekdayName(0, calendar: calendar) == nil)
        #expect(TriggerInsights.weekdayName(8, calendar: calendar) == nil)
    }
}

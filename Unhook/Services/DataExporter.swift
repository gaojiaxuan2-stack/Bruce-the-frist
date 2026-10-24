import Foundation
import SwiftData

/// A portable copy of everything the user has tracked, for "Export my data" in Settings: a JSON archive
/// (the complete record) and a CSV timeline (one row per event, for spreadsheets).
///
/// Everything happens on device. Files are written to the temporary directory and only leave the device
/// if the user shares them.
enum DataExporter {
    /// Bumped whenever the JSON layout changes in a way readers need to know about.
    static let formatVersion = 1
    static let csvHeader = "date,type,habit,detail"

    private static let filePrefix = "Unhook-Export-"

    // MARK: Archive

    /// The whole export, as written to JSON.
    struct Archive: Codable, Equatable {
        var formatVersion: Int
        var exportedAt: Date
        var appVersion: String
        /// ISO 4217 code of the currency chosen in Settings. Every money amount in the archive is in it.
        var currencyCode: String
        var habits: [HabitRecord]
        /// Cravings logged without a habit (from SOS or Siri while several habits are tracked).
        var unassignedUrges: [UrgeRecord]
        var pledges: [PledgeRecord]
        var savingsGoals: [SavingsGoalRecord]
    }

    struct HabitRecord: Codable, Equatable {
        let id: UUID
        let name: String
        let emoji: String
        let theme: String
        let presetID: String
        let sortIndex: Int
        let createdAt: Date
        /// Start of the current clean streak.
        let streakStart: Date
        /// The current streak as of `Archive.exportedAt`.
        let currentStreakSeconds: Double
        /// Clean time from earlier streaks.
        let bankedSeconds: Double
        /// Longest streak so far, including the current one.
        let bestStreakSeconds: Double
        /// Money saved as of `Archive.exportedAt`, in `Archive.currencyCode`.
        let moneySaved: Double
        let dailyCost: Double
        let dailyMinutes: Double
        let unitsPerDay: Double
        let unitName: String
        let reasons: [String]
        let relapses: [RelapseRecord]
        let urges: [UrgeRecord]

        init(habit: Habit, now: Date) {
            let stats = habit.stats(at: now)
            id = habit.uuid
            name = habit.name
            emoji = habit.emoji
            theme = habit.themeRaw
            presetID = habit.presetID
            sortIndex = habit.sortIndex
            createdAt = habit.createdAt
            streakStart = habit.streakStart
            currentStreakSeconds = DataExporter.finite(stats.currentStreak)
            bankedSeconds = DataExporter.finite(habit.bankedSeconds)
            bestStreakSeconds = DataExporter.finite(stats.bestStreak)
            moneySaved = DataExporter.finite(stats.moneySaved)
            dailyCost = DataExporter.finite(habit.dailyCost)
            dailyMinutes = DataExporter.finite(habit.dailyMinutes)
            unitsPerDay = DataExporter.finite(habit.unitsPerDay)
            unitName = habit.unitName
            reasons = habit.reasons
            relapses = habit.relapses
                .sorted { $0.date < $1.date }
                .map { RelapseRecord($0) }
            urges = habit.urges
                .sorted { $0.date < $1.date }
                .map { UrgeRecord($0) }
        }
    }

    struct RelapseRecord: Codable, Equatable {
        let date: Date
        /// How long the streak lasted before this slip.
        let streakSeconds: Double
        /// `CravingTrigger` raw value, when the user picked one.
        let trigger: String?
        let note: String

        init(_ relapse: Relapse) {
            date = relapse.date
            streakSeconds = DataExporter.finite(relapse.streakSeconds)
            trigger = relapse.trigger?.rawValue
            note = relapse.note
        }
    }

    struct UrgeRecord: Codable, Equatable {
        let date: Date
        let resisted: Bool
        /// `CravingTrigger` raw value, when the user picked one.
        let trigger: String?
        /// 1 (mild) … 5 (overwhelming); nil when not rated.
        let intensity: Int?
        let note: String

        init(_ urge: Urge) {
            date = urge.date
            resisted = urge.resisted
            trigger = urge.trigger?.rawValue
            intensity = urge.intensity > 0 ? urge.intensity : nil
            note = urge.note
        }
    }

    struct PledgeRecord: Codable, Equatable {
        /// Start of the day the pledge belongs to.
        let day: Date
        /// 1 (rough) … 5 (great).
        let mood: Int
        let createdAt: Date

        init(_ pledge: Pledge) {
            day = pledge.day
            mood = pledge.mood
            createdAt = pledge.createdAt
        }
    }

    struct SavingsGoalRecord: Codable, Equatable {
        let id: UUID
        let title: String
        let emoji: String
        let cost: Double
        let sortIndex: Int
        let createdAt: Date
        /// When the user marked the goal as bought.
        let redeemedAt: Date?

        init(_ goal: SavingsGoal) {
            id = goal.uuid
            title = goal.title
            emoji = goal.emoji
            cost = DataExporter.finite(goal.cost)
            sortIndex = goal.sortIndex
            createdAt = goal.createdAt
            redeemedAt = goal.redeemedAt
        }
    }

    /// Reads everything from `context` (including unsaved changes) into an archive.
    static func makeArchive(context: ModelContext, now: Date = .now) throws -> Archive {
        let habits = try context.fetch(FetchDescriptor<Habit>(
            sortBy: [SortDescriptor(\Habit.sortIndex), SortDescriptor(\Habit.createdAt)]
        ))
        let urges = try context.fetch(FetchDescriptor<Urge>(sortBy: [SortDescriptor(\Urge.date)]))
        let pledges = try context.fetch(FetchDescriptor<Pledge>(sortBy: [SortDescriptor(\Pledge.day)]))
        let goals = try context.fetch(FetchDescriptor<SavingsGoal>(
            sortBy: [SortDescriptor(\SavingsGoal.sortIndex), SortDescriptor(\SavingsGoal.createdAt)]
        ))

        // Matched by identity rather than `urge.habit`, so the split doesn't depend on when the inverse
        // relationship is filled in.
        var assignedUrges = Set<ObjectIdentifier>()
        for habit in habits {
            for urge in habit.urges {
                assignedUrges.insert(ObjectIdentifier(urge))
            }
        }

        return Archive(
            formatVersion: formatVersion,
            exportedAt: now,
            appVersion: appVersion,
            currencyCode: currencyCode,
            habits: habits.map { HabitRecord(habit: $0, now: now) },
            unassignedUrges: urges
                .filter { !assignedUrges.contains(ObjectIdentifier($0)) }
                .map { UrgeRecord($0) },
            pledges: pledges.map { PledgeRecord($0) },
            savingsGoals: goals.map { SavingsGoalRecord($0) }
        )
    }

    // MARK: JSON

    /// Pretty-printed JSON with sorted keys and ISO 8601 dates.
    static func exportJSON(context: ModelContext, now: Date = .now) throws -> Data {
        try makeEncoder().encode(makeArchive(context: context, now: now))
    }

    /// Reads back a file written by `exportJSON`.
    static func decodeArchive(from data: Data) throws -> Archive {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return try decoder.decode(Archive.self, from: data)
    }

    private static func makeEncoder() -> JSONEncoder {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }

    // MARK: CSV

    /// A timeline with one row per event (habit added, slip, craving, pledge, goal added or bought), oldest
    /// first: `date,type,habit,detail`. Dates are ISO 8601 in `timeZone`.
    ///
    /// This is a data format, so the `type` values and the `detail` labels are stable English keywords
    /// rather than localized text.
    static func exportCSV(context: ModelContext, timeZone: TimeZone = .current) throws -> String {
        try csv(for: makeArchive(context: context), timeZone: timeZone)
    }

    static func csv(for archive: Archive, timeZone: TimeZone = .current) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.timeZone = timeZone
        let rows = timeline(for: archive).map { event in
            [formatter.string(from: event.date), event.type, event.habit, event.detail]
                .map { csvField($0) }
                .joined(separator: ",")
        }
        return ([csvHeader] + rows).joined(separator: "\r\n") + "\r\n"
    }

    /// One CSV field: quoted when it contains a comma, quote or line break (RFC 4180), and prefixed with an
    /// apostrophe when a spreadsheet app would otherwise run it as a formula.
    static func csvField(_ value: String) -> String {
        var field = value
        if let first = field.first, "=+-@\t\r".contains(first) {
            field = "'" + field
        }
        guard field.contains(where: { $0 == "," || $0 == "\"" || $0.isNewline }) else { return field }
        return "\"" + field.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    private struct TimelineEvent {
        let date: Date
        let type: String
        let habit: String
        let detail: String
    }

    private static func timeline(for archive: Archive) -> [TimelineEvent] {
        var events: [TimelineEvent] = []
        for habit in archive.habits {
            events.append(TimelineEvent(date: habit.createdAt, type: "habit_added", habit: habit.name, detail: detail(for: habit)))
            for relapse in habit.relapses {
                events.append(TimelineEvent(date: relapse.date, type: "slip", habit: habit.name, detail: detail(for: relapse)))
            }
            for urge in habit.urges {
                events.append(event(for: urge, habit: habit.name))
            }
        }
        for urge in archive.unassignedUrges {
            events.append(event(for: urge, habit: ""))
        }
        for pledge in archive.pledges {
            events.append(TimelineEvent(date: pledge.day, type: "pledge", habit: "", detail: "mood: \(pledge.mood)/5"))
        }
        for goal in archive.savingsGoals {
            let detail = "\(goal.emoji) \(goal.title); cost: \(number(goal.cost))"
            events.append(TimelineEvent(date: goal.createdAt, type: "goal_added", habit: "", detail: detail))
            if let redeemedAt = goal.redeemedAt {
                events.append(TimelineEvent(date: redeemedAt, type: "goal_redeemed", habit: "", detail: detail))
            }
        }
        // Oldest first; events at the same moment keep the order above.
        return events.enumerated()
            .sorted { lhs, rhs in
                lhs.element.date == rhs.element.date ? lhs.offset < rhs.offset : lhs.element.date < rhs.element.date
            }
            .map { $0.element }
    }

    private static func event(for urge: UrgeRecord, habit: String) -> TimelineEvent {
        let parts: [String?] = [
            urge.trigger.map { "trigger: \($0)" },
            urge.intensity.map { "intensity: \($0)/5" },
            urge.note.isEmpty ? nil : "note: \(urge.note)",
        ]
        return TimelineEvent(
            date: urge.date,
            type: urge.resisted ? "craving_resisted" : "craving",
            habit: habit,
            detail: joined(parts)
        )
    }

    private static func detail(for habit: HabitRecord) -> String {
        let units = [number(habit.unitsPerDay), habit.unitName]
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        let parts: [String?] = [
            habit.dailyCost > 0 ? "daily cost: \(number(habit.dailyCost))" : nil,
            habit.dailyMinutes > 0 ? "minutes per day: \(number(habit.dailyMinutes))" : nil,
            habit.unitsPerDay > 0 ? "per day: \(units)" : nil,
        ]
        return joined(parts)
    }

    private static func detail(for relapse: RelapseRecord) -> String {
        let parts: [String?] = [
            "streak: \(DurationFormatter.compact(relapse.streakSeconds))",
            relapse.trigger.map { "trigger: \($0)" },
            relapse.note.isEmpty ? nil : "note: \(relapse.note)",
        ]
        return joined(parts)
    }

    private static func joined(_ parts: [String?]) -> String {
        parts.compactMap { $0 }.joined(separator: "; ")
    }

    /// Locale-independent, so the file reads the same everywhere: "1200", "12.5".
    private static func number(_ value: Double) -> String {
        let style = FloatingPointFormatStyle<Double>(locale: Locale(identifier: "en_US_POSIX"))
            .grouping(.never)
            .precision(.fractionLength(0...2))
        return finite(value).formatted(style)
    }

    // MARK: Files

    /// Writes the JSON export to the temporary directory as "Unhook-Export-YYYY-MM-DD.json".
    static func writeExportFile(context: ModelContext, now: Date = .now) throws -> URL {
        let data = try exportJSON(context: context, now: now)
        return try write(data, named: fileName(for: now, fileExtension: "json"))
    }

    /// Writes the CSV timeline to the temporary directory as "Unhook-Export-YYYY-MM-DD.csv".
    static func writeCSVFile(context: ModelContext, now: Date = .now) throws -> URL {
        let csv = try exportCSV(context: context)
        // A byte-order mark so spreadsheet apps read emoji and accents as UTF-8.
        return try write(Data(("\u{FEFF}" + csv).utf8), named: fileName(for: now, fileExtension: "csv"))
    }

    /// "Unhook-Export-2026-10-24.json", using the Gregorian calendar whatever the device's calendar is.
    static func fileName(for date: Date, fileExtension: String = "json", timeZone: TimeZone = .current) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let parts = calendar.dateComponents([.year, .month, .day], from: date)
        let stamp = String(format: "%04ld-%02ld-%02ld", parts.year ?? 0, parts.month ?? 0, parts.day ?? 0)
        return "\(filePrefix)\(stamp).\(fileExtension)"
    }

    /// Deletes export files left in the temporary directory, for example after the user erases their data.
    static func removeExportFiles() {
        let fileManager = FileManager.default
        let directory = fileManager.temporaryDirectory
        guard let urls = try? fileManager.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) else { return }
        for url in urls where url.lastPathComponent.hasPrefix(filePrefix) {
            try? fileManager.removeItem(at: url)
        }
    }

    private static func write(_ data: Data, named name: String) throws -> URL {
        let url = FileManager.default.temporaryDirectory.appending(path: name, directoryHint: .notDirectory)
        try data.write(to: url, options: [.atomic, .completeFileProtectionUnlessOpen])
        return url
    }

    // MARK: Helpers

    private static var appVersion: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "1.0"
    }

    /// The currency picked in Settings (the same value `@AppStorage(AppSettings.Keys.currencyCode)` reads).
    private static var currencyCode: String {
        UserDefaults.standard.string(forKey: AppSettings.Keys.currencyCode) ?? AppSettings.defaultCurrencyCode
    }

    /// JSON can't hold infinity or NaN; a corrupted value exports as 0 instead of failing the whole export.
    private static func finite(_ value: Double) -> Double {
        value.isFinite ? value : 0
    }
}

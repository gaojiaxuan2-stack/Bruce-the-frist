import AppIntents
import Foundation
import SwiftData

// MARK: - SOS

/// Opens the SOS breathing screen from Siri, Spotlight, the Shortcuts app or the Action button, so help
/// is one press away when a craving hits. Like SOS everywhere in the app, it's never behind the paywall.
struct OpenSOSIntent: AppIntent {
    static var title: LocalizedStringResource = "Open SOS Breathing"
    static var description = IntentDescription("Opens Unhook's guided breathing to help you ride out a craving.")
    static var openAppWhenRun: Bool = true

    @MainActor
    func perform() async throws -> some IntentResult {
        let router = AppRouter.shared
        // Another full-screen moment would block the SOS screen from appearing. SOS always wins.
        if router.celebration != nil || router.paywallReason != nil {
            router.celebration = nil
            router.paywallReason = nil
            try? await Task.sleep(for: .milliseconds(600))
        }
        router.isShowingSOS = true
        return .result()
    }
}

// MARK: - Beaten craving

/// Logs a craving the user rode out, without opening the app. Great on the Action button.
struct LogBeatenCravingIntent: AppIntent {
    static var title: LocalizedStringResource = "Log a Beaten Craving"
    static var description = IntentDescription("Records a craving you resisted, without opening Unhook.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let beaten = try Self.logBeatenCraving(in: AppModelContainer.shared.mainContext)
        ReviewPrompter.standard.recordPositiveMoment()
        return .result(dialog: IntentDialog(Self.confirmation(beatenCount: beaten)))
    }

    /// Inserts a resisted `Urge` (attached to the habit when the user tracks exactly one, like the SOS
    /// screen does), saves, and returns how many cravings the user has beaten in total.
    static func logBeatenCraving(in context: ModelContext, at date: Date = .now) throws -> Int {
        let habits = try context.fetch(FetchDescriptor<Habit>())
        let urge = Urge(date: date, resisted: true)
        context.insert(urge)
        if habits.count == 1, let habit = habits.first {
            habit.urges.append(urge)
        }
        try context.save()
        let urges = try context.fetch(FetchDescriptor<Urge>())
        return urges.filter(\.resisted).count
    }

    /// What Siri says after logging.
    static func confirmation(beatenCount: Int) -> LocalizedStringResource {
        if beatenCount <= 1 {
            return "Logged your first beaten craving! Each one you ride out proves you can do it 💪"
        }
        return "Logged! That's \(beatenCount) cravings beaten. Keep going 💪"
    }
}

// MARK: - Streak status

/// Answers "how long have I been free?" with the user's longest current streak.
struct StreakStatusIntent: AppIntent {
    static var title: LocalizedStringResource = "Check My Streak"
    static var description = IntentDescription("Tells you how long you've been free from your habit.")
    static var openAppWhenRun: Bool = false
    /// The answer names the habit out loud, so Siri must not give it on a locked iPhone. Habit names can be
    /// sensitive, and the app's Face ID lock promises nobody else sees them.
    static var authenticationPolicy: IntentAuthenticationPolicy = .requiresAuthentication

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let habits = try AppModelContainer.shared.mainContext.fetch(FetchDescriptor<Habit>())
        return .result(dialog: IntentDialog(Self.status(for: habits)))
    }

    /// A spoken summary of the longest current streak, or a friendly nudge when nothing is tracked yet.
    static func status(for habits: [Habit], now: Date = .now) -> LocalizedStringResource {
        var longest: (name: String, streak: TimeInterval)?
        for habit in habits {
            let streak = habit.stats(at: now).currentStreak
            if let current = longest, current.streak >= streak { continue }
            longest = (name: habit.name, streak: streak)
        }
        guard let winner = longest else {
            return "You're not tracking a habit yet. Open Unhook to start your first streak."
        }

        let duration = spokenDuration(winner.streak)
        if let next = Milestone.next(after: winner.streak) {
            return "You've been free from \(winner.name) for \(duration). Next up: \(next.title). Keep going!"
        }
        return "You've been free from \(winner.name) for \(duration). Every milestone unlocked. Legend!"
    }

    /// A localized duration that reads well out loud: "12 days, 4 hours", "3 hours, 5 minutes".
    static func spokenDuration(_ interval: TimeInterval) -> String {
        guard interval >= 60 else { return String(localized: "less than a minute") }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = interval >= 86_400 ? [.day, .hour] : [.hour, .minute]
        formatter.maximumUnitCount = 2
        formatter.zeroFormattingBehavior = .dropAll
        return formatter.string(from: interval) ?? DurationFormatter.compact(interval)
    }
}

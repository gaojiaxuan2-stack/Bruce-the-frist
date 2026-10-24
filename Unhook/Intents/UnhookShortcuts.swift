import AppIntents

/// Siri phrases, Spotlight results and Action button options. They work as soon as the app is installed,
/// with no setup in the Shortcuts app.
struct UnhookShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenSOSIntent(),
            phrases: [
                "Open SOS in \(.applicationName)",
                "Start SOS breathing in \(.applicationName)",
                "I'm having a craving in \(.applicationName)",
                "Help me with a craving in \(.applicationName)",
            ],
            shortTitle: "SOS Breathing",
            systemImageName: "wind"
        )
        AppShortcut(
            intent: LogBeatenCravingIntent(),
            phrases: [
                "I beat a craving in \(.applicationName)",
                "Log a beaten craving in \(.applicationName)",
                "I resisted a craving in \(.applicationName)",
            ],
            shortTitle: "Log Beaten Craving",
            systemImageName: "hand.thumbsup.fill"
        )
        AppShortcut(
            intent: StreakStatusIntent(),
            phrases: [
                "Check my streak in \(.applicationName)",
                "What's my streak in \(.applicationName)",
                "How long have I been free in \(.applicationName)",
            ],
            shortTitle: "Check My Streak",
            systemImageName: "flame.fill"
        )
    }
}

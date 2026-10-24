import Foundation

/// UserDefaults keys and the few settings that non-view code needs to read.
enum AppSettings {
    enum Keys {
        static let hasOnboarded = "hasOnboarded"
        static let didPromptFirstHabit = "didPromptFirstHabit"
        static let currencyCode = "currencyCode"
        static let hapticsEnabled = "hapticsEnabled"
        static let reminderEnabled = "reminderEnabled"
        static let reminderHour = "reminderHour"
        static let reminderMinute = "reminderMinute"
        static let milestoneAlertsEnabled = "milestoneAlertsEnabled"
        static let dataResetCount = "dataResetCount"
    }

    static let defaultReminderHour = 9
    static let defaultReminderMinute = 0

    static var defaultCurrencyCode: String {
        Locale.current.currency?.identifier ?? "USD"
    }

    static var hapticsEnabled: Bool {
        UserDefaults.standard.object(forKey: Keys.hapticsEnabled) as? Bool ?? true
    }

    static var milestoneAlertsEnabled: Bool {
        UserDefaults.standard.object(forKey: Keys.milestoneAlertsEnabled) as? Bool ?? true
    }

    static var reminderHour: Int {
        UserDefaults.standard.object(forKey: Keys.reminderHour) as? Int ?? defaultReminderHour
    }

    static var reminderMinute: Int {
        UserDefaults.standard.object(forKey: Keys.reminderMinute) as? Int ?? defaultReminderMinute
    }
}

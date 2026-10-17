import Foundation
import UserNotifications

/// Local notifications only: a daily pledge reminder and alerts for upcoming milestones.
enum NotificationManager {
    static let dailyReminderID = "daily-pledge-reminder"
    /// iOS keeps at most 64 pending notifications, so only the next few milestones per habit are scheduled.
    private static let milestonesAhead = 3

    private static var center: UNUserNotificationCenter { .current() }

    static func configure() {
        center.delegate = NotificationDelegate.shared
    }

    @discardableResult
    static func requestAuthorization() async -> Bool {
        do {
            return try await center.requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    static func scheduleDailyReminder(hour: Int, minute: Int) {
        let content = UNMutableNotificationContent()
        content.title = "Take today's pledge 🤝"
        content.body = "One day at a time. Commit to staying free today."
        content.sound = .default

        var components = DateComponents()
        components.hour = hour
        components.minute = minute
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: true)
        center.add(UNNotificationRequest(identifier: dailyReminderID, content: content, trigger: trigger))
    }

    static func cancelDailyReminder() {
        center.removePendingNotificationRequests(withIdentifiers: [dailyReminderID])
    }

    /// Replaces any scheduled milestone alerts for `habit` with ones for its current streak.
    static func scheduleMilestones(for habit: Habit, now: Date = .now) {
        cancelMilestones(for: habit.uuid)
        guard AppSettings.milestoneAlertsEnabled else { return }

        let elapsed = now.timeIntervalSince(habit.streakStart)
        let upcoming = Milestone.all.filter { $0.seconds > elapsed }.prefix(milestonesAhead)
        for milestone in upcoming {
            let interval = habit.streakStart.addingTimeInterval(milestone.seconds).timeIntervalSince(now)
            guard interval > 1 else { continue }

            let content = UNMutableNotificationContent()
            content.title = "\(milestone.title) free from \(habit.name) \(habit.emoji)"
            content.body = "Milestone unlocked! Open Unhook to celebrate and keep it going."
            content.sound = .default

            let trigger = UNTimeIntervalNotificationTrigger(timeInterval: interval, repeats: false)
            center.add(UNNotificationRequest(identifier: milestoneID(habit.uuid, milestone), content: content, trigger: trigger))
        }
    }

    static func cancelMilestones(for habitID: UUID) {
        center.removePendingNotificationRequests(withIdentifiers: Milestone.all.map { milestoneID(habitID, $0) })
    }

    static func cancelAll() {
        center.removeAllPendingNotificationRequests()
    }

    private static func milestoneID(_ habitID: UUID, _ milestone: Milestone) -> String {
        "milestone-\(habitID.uuidString)-\(milestone.id)"
    }
}

/// Shows milestone banners even while the app is open.
final class NotificationDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationDelegate()

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        completionHandler([.banner, .list, .sound])
    }
}

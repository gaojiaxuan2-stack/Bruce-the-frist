import Foundation
import UserNotifications

// MARK: - Scheduler

/// Local notifications that knock gently when a letter may be opened.
/// Identifiers: `capsule-<uuid>` (arrival) and `capsule-<uuid>-half` (halfway, journeys ≥ 30 days).
/// Every notification carries `userInfo["capsuleID"] = uuidString`.
enum NotificationScheduler {
    private static let capsuleIDKey = "capsuleID"
    private static let threadIdentifier = "timeleaf.letters"
    private static let halfwayThreshold: TimeInterval = 30 * 24 * 60 * 60

    /// Asks for alert, sound and badge permission. Returns `false` when denied or on error.
    static func requestAuthorization() async -> Bool {
        do {
            return try await UNUserNotificationCenter.current()
                .requestAuthorization(options: [.alert, .sound, .badge])
        } catch {
            return false
        }
    }

    /// Schedules the arrival notification (and, for long journeys of the author's own letters,
    /// a quiet halfway note). Replaces anything previously scheduled for this capsule.
    /// - Parameter recipientName: optional; lets the sender's copy say who the letter went to.
    /// - Parameter sealedAt: optional; when the journey began (defaults to now). Pass it when
    ///   rescheduling so the halfway note and "sealed … ago" stay true.
    static func schedule(
        capsuleID: UUID,
        title: String,
        unlockDate: Date,
        senderName: String,
        isIncoming: Bool,
        toSelf: Bool,
        recipientName: String = "",
        sealedAt: Date? = nil
    ) {
        let center = UNUserNotificationCenter.current()
        let identifiers = notificationIdentifiers(for: capsuleID)
        center.removePendingNotificationRequests(withIdentifiers: identifiers)

        let now = Date.now
        guard unlockDate > now else { return }
        let start = min(sealedAt ?? now, now)

        let letterTitle = displayTitle(title)
        let sender = trimmed(senderName)
        let recipient = trimmed(recipientName)
        let journey = journeyPhrase(from: start, to: unlockDate)

        let arrival = makeRequest(
            identifier: arrivalIdentifier(for: capsuleID),
            title: arrivalTitle(isIncoming: isIncoming, toSelf: toSelf, sender: sender, recipient: recipient),
            body: arrivalBody(isIncoming: isIncoming, toSelf: toSelf, letterTitle: letterTitle, journey: journey),
            capsuleID: capsuleID,
            fireDate: unlockDate,
            relevance: 1
        )
        center.add(arrival, withCompletionHandler: nil)

        // "Halfway" is measured from the moment of sealing, which only the author knows.
        let duration = unlockDate.timeIntervalSince(start)
        guard !isIncoming, duration >= halfwayThreshold else { return }
        let halfwayDate = start.addingTimeInterval(duration / 2)
        guard halfwayDate > now.addingTimeInterval(60) else { return }
        let halfway = makeRequest(
            identifier: halfwayIdentifier(for: capsuleID),
            title: halfwayTitle(toSelf: toSelf, recipient: recipient),
            body: halfwayBody(letterTitle: letterTitle, unlockDate: unlockDate),
            capsuleID: capsuleID,
            fireDate: halfwayDate,
            relevance: 0.3
        )
        center.add(halfway, withCompletionHandler: nil)
    }

    /// Removes both pending and already-delivered notifications for the capsule.
    static func cancel(capsuleID: UUID) {
        let center = UNUserNotificationCenter.current()
        let identifiers = notificationIdentifiers(for: capsuleID)
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

// MARK: - Private: copy

extension NotificationScheduler {
    private static func arrivalTitle(isIncoming: Bool, toSelf: Bool, sender: String, recipient: String) -> String {
        if isIncoming {
            let from = sender.isEmpty ? String(localized: "someone dear") : sender
            return String(localized: "A letter from \(from) is ready to open")
        }
        if toSelf {
            return String(localized: "A letter from your past has arrived")
        }
        if recipient.isEmpty {
            return String(localized: "The letter you sent can now be opened")
        }
        return String(localized: "The letter you sent to \(recipient) can now be opened")
    }

    private static func arrivalBody(isIncoming: Bool, toSelf: Bool, letterTitle: String, journey: String?) -> String {
        if isIncoming {
            return String(localized: "“\(letterTitle)” has finished its journey to you. Tap to break the seal.")
        }
        if toSelf {
            if let journey {
                return String(localized: "“\(letterTitle)” — sealed \(journey) ago. Tap to break the seal.")
            }
            return String(localized: "“\(letterTitle)” — sealed moments ago. Tap to break the seal.")
        }
        if let journey {
            return String(localized: "“\(letterTitle)” has reached the day you chose, \(journey) after you sealed it.")
        }
        return String(localized: "“\(letterTitle)” has reached the day you chose.")
    }

    private static func halfwayTitle(toSelf: Bool, recipient: String) -> String {
        if toSelf || recipient.isEmpty {
            return String(localized: "Your letter is halfway through its journey")
        }
        return String(localized: "Your letter to \(recipient) is halfway there")
    }

    private static func halfwayBody(letterTitle: String, unlockDate: Date) -> String {
        let day = unlockDate.formatted(date: .long, time: .omitted)
        return String(localized: "“\(letterTitle)” is still sealed, drifting quietly toward \(day).")
    }

    private static func displayTitle(_ title: String) -> String {
        let value = trimmed(title)
        return value.isEmpty ? String(localized: "Your letter") : value
    }

    private static func trimmed(_ value: String) -> String {
        value.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// "1 year, 2 months" / "5 days, 4 hours" – the two largest units, localized by the system.
    private static func journeyPhrase(from start: Date, to end: Date) -> String? {
        let interval = end.timeIntervalSince(start)
        guard interval >= 1 else { return nil }
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.maximumUnitCount = 2
        let units: NSCalendar.Unit
        if interval >= 60 {
            units = [.year, .month, .day, .hour, .minute]
        } else {
            units = [.second]
        }
        formatter.allowedUnits = units
        guard let phrase = formatter.string(from: start, to: end), !phrase.isEmpty else { return nil }
        return phrase
    }
}

// MARK: - Private: requests

extension NotificationScheduler {
    private static func arrivalIdentifier(for capsuleID: UUID) -> String {
        "capsule-\(capsuleID.uuidString)"
    }

    private static func halfwayIdentifier(for capsuleID: UUID) -> String {
        "capsule-\(capsuleID.uuidString)-half"
    }

    private static func notificationIdentifiers(for capsuleID: UUID) -> [String] {
        [arrivalIdentifier(for: capsuleID), halfwayIdentifier(for: capsuleID)]
    }

    private static func makeRequest(
        identifier: String,
        title: String,
        body: String,
        capsuleID: UUID,
        fireDate: Date,
        relevance: Double
    ) -> UNNotificationRequest {
        let content = UNMutableNotificationContent()
        content.title = title
        content.body = body
        content.sound = .default
        content.threadIdentifier = threadIdentifier
        content.relevanceScore = relevance
        content.userInfo = [capsuleIDKey: capsuleID.uuidString]

        // Pin the absolute instant: floating components would be re-read in whatever time zone
        // the device is in later. Rounded up so the knock never comes before the seal may break.
        let fireInstant = Date(timeIntervalSinceReferenceDate: fireDate.timeIntervalSinceReferenceDate.rounded(.up))
        var calendar = Calendar.current
        calendar.timeZone = TimeZone.current
        var components = calendar.dateComponents(
            [.year, .month, .day, .hour, .minute, .second],
            from: fireInstant
        )
        components.calendar = calendar
        components.timeZone = calendar.timeZone
        let trigger = UNCalendarNotificationTrigger(dateMatching: components, repeats: false)
        return UNNotificationRequest(identifier: identifier, content: content, trigger: trigger)
    }
}

// MARK: - Delegate

/// Shows Timeleaf notifications as banners in the foreground and routes taps to the capsule.
final class NotificationCenterDelegate: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationCenterDelegate()

    /// Called on the main actor with the tapped capsule's id. Setting it delivers any id
    /// that arrived before it was set (e.g. the app was launched from a notification).
    var onOpenCapsule: ((UUID) -> Void)? {
        didSet { flushPendingCapsule() }
    }

    private var pendingCapsuleID: UUID?

    private override init() {
        super.init()
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        guard let rawID = userInfo["capsuleID"] as? String,
              let capsuleID = UUID(uuidString: rawID) else { return }
        await MainActor.run {
            self.deliver(capsuleID)
        }
    }

    @MainActor
    private func deliver(_ capsuleID: UUID) {
        if let handler = onOpenCapsule {
            handler(capsuleID)
        } else {
            pendingCapsuleID = capsuleID
        }
    }

    private func flushPendingCapsule() {
        guard let handler = onOpenCapsule, let capsuleID = pendingCapsuleID else { return }
        pendingCapsuleID = nil
        handler(capsuleID)
    }
}

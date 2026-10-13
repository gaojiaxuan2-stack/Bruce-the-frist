import Foundation
import SwiftData

/// The few moments in a letter's life that touch storage, files and notifications together.
@MainActor
enum CapsuleActions {
    /// Seals the letter: stamps `sealedAt` (if not yet set), inserts it if needed, saves,
    /// then asks for notification permission and schedules its arrival.
    static func seal(_ capsule: TimeCapsule, in context: ModelContext) async {
        if capsule.sealedAt == nil {
            capsule.sealedAt = .now
        }
        if capsule.modelContext == nil {
            context.insert(capsule)
        }
        try? context.save()

        // Capture everything before suspending; the model may change while we wait.
        let capsuleID = capsule.id
        let title = capsule.title
        let unlockDate = capsule.unlockDate
        let senderName = capsule.displaySender
        let recipientName = capsule.recipientName
        let isIncoming = capsule.isIncoming
        let toSelf = capsule.recipientKind == .myself

        guard unlockDate > .now else { return }
        guard await NotificationScheduler.requestAuthorization() else { return }
        NotificationScheduler.schedule(
            capsuleID: capsuleID,
            title: title,
            unlockDate: unlockDate,
            senderName: senderName,
            isIncoming: isIncoming,
            toSelf: toSelf,
            recipientName: recipientName
        )
    }

    /// Records the moment the seal was broken (the first time only), saves and
    /// clears any pending or delivered notifications.
    static func markOpened(_ capsule: TimeCapsule, in context: ModelContext) {
        if capsule.openedAt == nil {
            capsule.openedAt = .now
        }
        try? context.save()
        NotificationScheduler.cancel(capsuleID: capsule.id)
    }

    /// Lets a letter go: notifications, media files, the still-sealed inbox package and the model.
    static func delete(_ capsule: TimeCapsule, in context: ModelContext) {
        let capsuleID = capsule.id
        NotificationScheduler.cancel(capsuleID: capsuleID)

        if let packageFileName = capsule.packageFileName {
            let packageURL = MediaStore.inboxURL.appending(component: packageFileName, directoryHint: .notDirectory)
            try? FileManager.default.removeItem(at: packageURL)
        }
        MediaStore.deleteAll(for: capsuleID)

        if capsule.modelContext != nil {
            context.delete(capsule)
        }
        try? context.save()
    }
}

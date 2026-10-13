import Foundation
import SwiftData
import UserNotifications

/// The few moments in a letter's life that touch storage, files and notifications together.
@MainActor
enum CapsuleActions {
    /// iOS keeps the 64 soonest pending requests; each letter may hold two (arrival + halfway).
    private static let rescheduleLimit = 30
    /// Orphan cleanup runs once per launch (a second iPad window must not touch a live draft).
    private static var hasRemovedOrphanedMedia = false

    /// Seals the letter: stamps `sealedAt` (if not yet set), inserts it if needed, saves,
    /// then asks for notification permission and schedules its arrival.
    static func seal(_ capsule: TimeCapsule, in context: ModelContext) async {
        guard !capsule.isDeleted else { return }
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
        let sealedAt = capsule.sealedAt
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
            recipientName: recipientName,
            sealedAt: sealedAt
        )
    }

    /// Records the moment the seal was broken (the first time only), saves and
    /// clears any pending or delivered notifications.
    static func markOpened(_ capsule: TimeCapsule, in context: ModelContext) {
        guard !capsule.isDeleted, capsule.modelContext != nil else { return }
        if capsule.openedAt == nil {
            capsule.openedAt = .now
        }
        try? context.save()
        NotificationScheduler.cancel(capsuleID: capsule.id)
    }

    /// Lets a letter go: notifications, media files, the still-sealed inbox package and the model.
    static func delete(_ capsule: TimeCapsule, in context: ModelContext) {
        guard !capsule.isDeleted else { return }
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

    /// Re-creates the arrival (and halfway) notifications of every letter still on its way,
    /// soonest first. Never asks for permission: does nothing unless notifications are allowed.
    /// Use it when permission is granted later, and on returning to the foreground.
    static func rescheduleNotifications(in context: ModelContext) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral:
            break
        default:
            return
        }

        let now = Date.now
        var descriptor = FetchDescriptor<TimeCapsule>(
            predicate: #Predicate<TimeCapsule> { capsule in
                capsule.sealedAt != nil && capsule.openedAt == nil && capsule.unlockDate > now
            },
            sortBy: [SortDescriptor(\TimeCapsule.unlockDate, order: .forward)]
        )
        descriptor.fetchLimit = rescheduleLimit
        guard let capsules = try? context.fetch(descriptor) else { return }

        for capsule in capsules where !capsule.isDeleted {
            NotificationScheduler.schedule(
                capsuleID: capsule.id,
                title: capsule.title,
                unlockDate: capsule.unlockDate,
                senderName: capsule.displaySender,
                isIncoming: capsule.isIncoming,
                toSelf: !capsule.isIncoming && capsule.recipientKind == .myself,
                recipientName: capsule.recipientName,
                sealedAt: capsule.sealedAt
            )
        }
    }

    /// Clears files no letter owns any more: media folders and inbox packages whose capsule id
    /// matches no `TimeCapsule` (e.g. a draft abandoned when the app was closed), plus leftover
    /// export copies. Runs once per launch, before any compose flow can exist; never touches
    /// the files of an existing capsule.
    static func removeOrphanedMedia(in context: ModelContext) {
        guard !hasRemovedOrphanedMedia else { return }
        hasRemovedOrphanedMedia = true

        CapsulePackage.removeTemporaryFiles()

        // If the store cannot be read, keep everything.
        guard let capsules = try? context.fetch(FetchDescriptor<TimeCapsule>()) else { return }
        let knownIDs: Set<UUID> = Set(capsules.map { $0.id })
        let fileManager = FileManager.default

        if let folders = try? fileManager.contentsOfDirectory(
            at: MediaStore.rootURL,
            includingPropertiesForKeys: [.isDirectoryKey],
            options: [.skipsHiddenFiles]
        ) {
            for folder in folders {
                guard (try? folder.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory == true,
                      let capsuleID = UUID(uuidString: folder.lastPathComponent),
                      !knownIDs.contains(capsuleID) else { continue }
                MediaStore.deleteAll(for: capsuleID)
            }
        }

        if let packages = try? fileManager.contentsOfDirectory(
            at: MediaStore.inboxURL,
            includingPropertiesForKeys: nil,
            options: [.skipsHiddenFiles]
        ) {
            for package in packages where package.pathExtension.lowercased() == CapsulePackage.fileExtension {
                guard let capsuleID = UUID(uuidString: package.deletingPathExtension().lastPathComponent),
                      !knownIDs.contains(capsuleID) else { continue }
                try? fileManager.removeItem(at: package)
            }
        }
    }
}

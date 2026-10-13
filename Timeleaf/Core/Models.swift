import Foundation
import SwiftData

// MARK: - Supporting enums

/// Who a capsule is written for.
enum RecipientKind: String, Codable, CaseIterable, Identifiable {
    case myself
    case someone

    var id: String { rawValue }
}

/// The kinds of memories that can travel inside a capsule.
enum MediaKind: String, Codable, CaseIterable, Identifiable {
    case photo
    case video
    case audio

    var id: String { rawValue }

    var symbolName: String {
        switch self {
        case .photo: "photo"
        case .video: "video"
        case .audio: "waveform"
        }
    }
}

/// Lifecycle of a capsule, derived from its dates.
enum CapsuleState: String, Equatable {
    /// Not sealed yet (only exists transiently while composing).
    case draft
    /// Sealed and travelling through time; content must stay hidden.
    case sealed
    /// The unlock date has passed but the capsule has not been opened yet.
    case ready
    /// Opened and readable.
    case opened
}

// MARK: - TimeCapsule

/// A letter to the future. Named `TimeCapsule` to avoid clashing with SwiftUI's `Capsule` shape.
@Model
final class TimeCapsule {
    var id: UUID
    var title: String
    /// The written letter.
    var message: String
    var createdAt: Date
    /// When the capsule was sealed. `nil` means draft.
    var sealedAt: Date?
    /// The moment the capsule may be opened.
    var unlockDate: Date
    /// When the capsule was opened (ceremony completed).
    var openedAt: Date?
    /// Raw value of `ThemeID` – the stationery the letter was written on.
    var themeRaw: String
    /// Raw value of `RecipientKind`.
    var recipientKindRaw: String
    /// Recipient's display name ("" when writing to myself).
    var recipientName: String
    /// Author's display name.
    var senderName: String
    /// A single emoji describing how the author felt while writing ("" if none).
    var mood: String
    /// The writing prompt that inspired the letter ("" if none).
    var prompt: String
    /// A reflection the reader writes back after opening ("" if none).
    var replyText: String
    /// `true` when the capsule was received from someone else as a `.timeleaf` file.
    var isIncoming: Bool
    /// For incoming capsules: the still-encrypted package file name inside `MediaStore.inboxURL`.
    /// Cleared after the package has been unpacked on opening.
    var packageFileName: String?
    /// Incoming capsules may be locked with a secret word chosen by the sender.
    var requiresPassphrase: Bool
    var passphraseHint: String

    @Relationship(deleteRule: .cascade, inverse: \CapsuleMedia.capsule)
    var media: [CapsuleMedia] = []

    init(
        id: UUID = UUID(),
        title: String,
        message: String,
        createdAt: Date = .now,
        sealedAt: Date? = nil,
        unlockDate: Date,
        openedAt: Date? = nil,
        theme: ThemeID = .aurora,
        recipientKind: RecipientKind = .myself,
        recipientName: String = "",
        senderName: String = "",
        mood: String = "",
        prompt: String = "",
        replyText: String = "",
        isIncoming: Bool = false,
        packageFileName: String? = nil,
        requiresPassphrase: Bool = false,
        passphraseHint: String = ""
    ) {
        self.id = id
        self.title = title
        self.message = message
        self.createdAt = createdAt
        self.sealedAt = sealedAt
        self.unlockDate = unlockDate
        self.openedAt = openedAt
        self.themeRaw = theme.rawValue
        self.recipientKindRaw = recipientKind.rawValue
        self.recipientName = recipientName
        self.senderName = senderName
        self.mood = mood
        self.prompt = prompt
        self.replyText = replyText
        self.isIncoming = isIncoming
        self.packageFileName = packageFileName
        self.requiresPassphrase = requiresPassphrase
        self.passphraseHint = passphraseHint
    }

    // MARK: Derived values

    var theme: ThemeID {
        get { ThemeID(rawValue: themeRaw) ?? .aurora }
        set { themeRaw = newValue.rawValue }
    }

    var recipientKind: RecipientKind {
        get { RecipientKind(rawValue: recipientKindRaw) ?? .myself }
        set { recipientKindRaw = newValue.rawValue }
    }

    func state(at now: Date = .now) -> CapsuleState {
        if openedAt != nil { return .opened }
        guard sealedAt != nil else { return .draft }
        return now >= unlockDate ? .ready : .sealed
    }

    /// Fraction (0...1) of the journey from sealing to unlocking that has elapsed.
    func progress(at now: Date = .now) -> Double {
        let start = sealedAt ?? createdAt
        let total = unlockDate.timeIntervalSince(start)
        guard total > 0 else { return 1 }
        return min(max(now.timeIntervalSince(start) / total, 0), 1)
    }

    /// Media ordered as the author arranged it.
    var sortedMedia: [CapsuleMedia] {
        media.sorted { $0.sortIndex < $1.sortIndex }
    }

    /// Name shown as "To …" on envelopes.
    var displayRecipient: String {
        switch recipientKind {
        case .myself: String(localized: "Future Me")
        case .someone: recipientName.isEmpty ? String(localized: "Someone dear") : recipientName
        }
    }

    /// Name shown as "From …" on envelopes.
    var displaySender: String {
        if senderName.isEmpty {
            return isIncoming ? String(localized: "Someone dear") : String(localized: "Past Me")
        }
        return senderName
    }

    /// One or two letters used inside wax seals and monograms.
    var monogram: String {
        Monogram.make(from: isIncoming ? senderName : (recipientKind == .myself ? senderName : recipientName))
    }
}

// MARK: - CapsuleMedia

/// A photo, video or voice note stored on disk by `MediaStore`.
@Model
final class CapsuleMedia {
    var id: UUID
    /// Raw value of `MediaKind`.
    var kindRaw: String
    /// File name inside `MediaStore.directory(for: capsule.id)`.
    var fileName: String
    var createdAt: Date
    var sortIndex: Int
    /// Seconds, for video and audio (0 for photos).
    var duration: Double
    var caption: String
    var capsule: TimeCapsule?

    init(
        id: UUID = UUID(),
        kind: MediaKind,
        fileName: String,
        createdAt: Date = .now,
        sortIndex: Int,
        duration: Double = 0,
        caption: String = ""
    ) {
        self.id = id
        self.kindRaw = kind.rawValue
        self.fileName = fileName
        self.createdAt = createdAt
        self.sortIndex = sortIndex
        self.duration = duration
        self.caption = caption
    }

    var kind: MediaKind {
        get { MediaKind(rawValue: kindRaw) ?? .photo }
        set { kindRaw = newValue.rawValue }
    }
}

// MARK: - Monogram

enum Monogram {
    /// "Bruce Wayne" → "BW", "高佳轩" → "高", "" → "✦".
    static func make(from name: String) -> String {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = trimmed.first else { return "✦" }
        // CJK names: a single character carries the whole meaning.
        if first.unicodeScalars.first.map({ $0.properties.isIdeographic }) == true {
            return String(first)
        }
        let parts = trimmed.split(whereSeparator: { $0 == " " }).prefix(2)
        let letters = parts.compactMap { $0.first }.map { String($0).uppercased() }
        return letters.isEmpty ? "✦" : letters.joined()
    }
}

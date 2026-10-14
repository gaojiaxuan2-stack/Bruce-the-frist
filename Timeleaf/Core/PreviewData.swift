import SwiftUI
import SwiftData

/// In-memory sample data for SwiftUI previews:
/// `#Preview { VaultView().modelContainer(PreviewData.container).environment(AppRouter()) }`
@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let configuration = ModelConfiguration(isStoredInMemoryOnly: true)
        do {
            let container = try ModelContainer(
                for: TimeCapsule.self, CapsuleMedia.self,
                configurations: configuration
            )
            for capsule in samples {
                container.mainContext.insert(capsule)
            }
            return container
        } catch {
            fatalError("Preview container failed: \(error)")
        }
    }()

    static var samples: [TimeCapsule] {
        let now = Date.now
        return [
            TimeCapsule(
                title: "To the one who survived senior year",
                message: "Dear future me,\n\nI hope you still laugh at the same silly things. Tonight the rain sounds like applause.",
                createdAt: now.adding(.year, -1),
                sealedAt: now.adding(.year, -1),
                unlockDate: now.adding(.day, -2),
                theme: .parchment,
                senderName: "Bruce",
                mood: "🌧️",
                prompt: "What are you afraid of right now?"
            ),
            TimeCapsule(
                title: "Open on your 30th birthday",
                message: "Happy birthday, old friend.",
                createdAt: now.adding(.month, -2),
                sealedAt: now.adding(.month, -2),
                unlockDate: now.adding(.year, 3),
                theme: .celestial,
                recipientKind: .someone,
                recipientName: "Mei",
                senderName: "Bruce",
                mood: "✨"
            ),
            TimeCapsule(
                title: "A spring morning",
                message: "The cherry tree outside finally bloomed.",
                createdAt: now.adding(.day, -20),
                sealedAt: now.adding(.day, -20),
                unlockDate: now.adding(.month, 5),
                theme: .blossom,
                senderName: "Bruce",
                mood: "🌸"
            ),
            TimeCapsule(
                title: "First letter",
                message: "If you are reading this, it worked. 时间会证明一切。",
                createdAt: now.adding(.year, -2),
                sealedAt: now.adding(.year, -2),
                unlockDate: now.adding(.month, -3),
                openedAt: now.adding(.month, -3),
                theme: .inkwash,
                senderName: "Bruce",
                mood: "🍵",
                replyText: "It did work. Thank you, past me."
            ),
        ]
    }
}

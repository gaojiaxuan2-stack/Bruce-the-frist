import Foundation
import SwiftData

/// Sample data for SwiftUI previews.
@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let schema = Schema([Habit.self, Relapse.self, Urge.self, Pledge.self])
        do {
            let container = try ModelContainer(for: schema, configurations: ModelConfiguration(isStoredInMemoryOnly: true))
            populate(container.mainContext)
            return container
        } catch {
            fatalError("Could not create preview container: \(error)")
        }
    }()

    static var sampleHabit: Habit {
        let habits = (try? container.mainContext.fetch(FetchDescriptor<Habit>(sortBy: [SortDescriptor(\.sortIndex)]))) ?? []
        return habits.first ?? Habit(name: "Smoking", emoji: "🚬", theme: .fire)
    }

    private static func populate(_ context: ModelContext) {
        let day: TimeInterval = 86_400
        let smoking = Habit(
            name: "Smoking", emoji: "🚬", theme: .fire,
            streakStart: .now.addingTimeInterval(-12 * day - 5_000),
            dailyCost: 12, dailyMinutes: 60, unitsPerDay: 15, unitName: "cigarettes",
            reasons: ["Breathe easier on my runs", "Save for a trip to Japan"],
            sortIndex: 0
        )
        smoking.bankedSeconds = 4 * day
        smoking.bestStreakSeconds = 4 * day
        let scrolling = Habit(
            name: "Doomscrolling", emoji: "📱", theme: .ocean,
            streakStart: .now.addingTimeInterval(-2 * day - 3_600),
            dailyMinutes: 150,
            reasons: ["Be present with my family"],
            sortIndex: 1
        )
        context.insert(smoking)
        context.insert(scrolling)

        let moods = [3, 4, 3, 5, 4, 2, 4, 5, 4, 3]
        for (offset, mood) in moods.enumerated() {
            let urge = Urge(date: .now.addingTimeInterval(-Double(offset) * day * 0.7), resisted: true)
            context.insert(urge)
            smoking.urges.append(urge)
            context.insert(Pledge(day: .now.addingTimeInterval(-Double(offset) * day), mood: mood))
        }
    }
}

import SwiftUI
import SwiftData

/// Sample data for SwiftUI previews.
@MainActor
enum PreviewData {
    static let container: ModelContainer = {
        let container = AppModelContainer.make(inMemory: true)
        populate(container.mainContext)
        return container
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
        smoking.presetID = "smoking"
        scrolling.presetID = "social"
        context.insert(smoking)
        context.insert(scrolling)
        context.insert(SavingsGoal(title: "Trip to Japan", emoji: "🗾", cost: 1_200, sortIndex: 0))
        context.insert(SavingsGoal(title: "New running shoes", emoji: "👟", cost: 140, sortIndex: 1))

        let moods = [3, 4, 3, 5, 4, 2, 4, 5, 4, 3]
        for (offset, mood) in moods.enumerated() {
            let urge = Urge(date: .now.addingTimeInterval(-Double(offset) * day * 0.7), resisted: true)
            context.insert(urge)
            urge.trigger = CravingTrigger.allCases[offset % CravingTrigger.allCases.count]
            urge.intensity = 1 + offset % 5
            smoking.urges.append(urge)
            context.insert(Pledge(day: .now.addingTimeInterval(-Double(offset) * day), mood: mood))
        }
    }
}

extension View {
    /// Sample data plus the environment objects every screen expects. Use in `#Preview`s.
    @MainActor func previewEnvironment() -> some View {
        modelContainer(PreviewData.container)
            .environment(AppRouter.shared)
            .environment(Store.shared)
    }
}

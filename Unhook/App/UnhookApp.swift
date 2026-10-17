import SwiftUI
import SwiftData

@main
struct UnhookApp: App {
    init() {
        NotificationManager.configure()
    }

    var body: some Scene {
        WindowGroup {
            RootView()
        }
        .modelContainer(for: [Habit.self, Relapse.self, Urge.self, Pledge.self])
    }
}

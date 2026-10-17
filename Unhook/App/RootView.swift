import SwiftUI
import SwiftData

struct RootView: View {
    @AppStorage(AppSettings.Keys.hasOnboarded) private var hasOnboarded = false
    /// Bumped when the user erases their data so every navigation stack starts fresh.
    @AppStorage(AppSettings.Keys.dataResetCount) private var dataResetCount = 0

    var body: some View {
        ZStack {
            if hasOnboarded {
                MainTabView()
                    .id(dataResetCount)
                    .transition(.opacity)
            } else {
                OnboardingView {
                    withAnimation(.easeInOut(duration: 0.4)) { hasOnboarded = true }
                }
                .transition(.opacity)
            }
        }
    }
}

struct MainTabView: View {
    @Environment(\.scenePhase) private var scenePhase
    @Query private var habits: [Habit]

    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
            InsightsView()
                .tabItem { Label("Progress", systemImage: "chart.bar.xaxis") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
        // Only the next few milestone alerts are scheduled at a time, so top them up whenever the app opens.
        .onChange(of: scenePhase, initial: true) { _, phase in
            guard phase == .active else { return }
            for habit in habits {
                NotificationManager.scheduleMilestones(for: habit)
            }
        }
    }
}

#Preview {
    MainTabView()
        .modelContainer(PreviewData.container)
}

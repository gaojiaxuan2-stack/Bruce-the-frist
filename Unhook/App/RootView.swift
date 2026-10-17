import SwiftUI

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
    var body: some View {
        TabView {
            HomeView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
            InsightsView()
                .tabItem { Label("Progress", systemImage: "chart.bar.xaxis") }
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
        }
    }
}

#Preview {
    MainTabView()
        .modelContainer(PreviewData.container)
}

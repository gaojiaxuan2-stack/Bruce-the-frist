import StoreKit
import SwiftUI
import SwiftData

struct RootView: View {
    @AppStorage(AppSettings.Keys.hasOnboarded) private var hasOnboarded = false
    /// Bumped when the user erases their data so every navigation stack starts fresh.
    @AppStorage(AppSettings.Keys.dataResetCount) private var dataResetCount = 0

    var body: some View {
        ZStack {
            if hasOnboarded {
                AppLockContainer {
                    MainTabView()
                }
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
    @Environment(\.requestReview) private var requestReview
    @Environment(AppRouter.self) private var router
    @Query private var habits: [Habit]

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            HomeView()
                .tabItem { Label("Today", systemImage: "sun.max.fill") }
                .tag(AppRouter.Tab.today)
            InsightsView()
                .tabItem { Label("Progress", systemImage: "chart.bar.xaxis") }
                .tag(AppRouter.Tab.progress)
            SettingsView()
                .tabItem { Label("Settings", systemImage: "gearshape.fill") }
                .tag(AppRouter.Tab.settings)
        }
        .fullScreenCover(isPresented: $router.isShowingSOS) {
            SOSView(habit: nil)
        }
        .sheet(item: $router.paywallReason) { reason in
            PaywallView(reason: reason)
        }
        // An overlay rather than a full-screen cover: if a sheet is open when a milestone unlocks, the
        // celebration simply waits underneath instead of failing to present and getting stuck.
        .overlay {
            if let celebration = router.celebration {
                MilestoneCelebrationView(celebration: celebration) {
                    router.celebration = nil
                    requestReviewIfAppropriate()
                }
                .transition(.opacity)
                .zIndex(1)
            }
        }
        .animation(.easeInOut(duration: 0.35), value: router.celebration?.id)
        .onChange(of: scenePhase, initial: true) { _, phase in
            guard phase == .active else { return }
            // Only the next few milestone alerts are scheduled at a time, so top them up whenever the app opens.
            for habit in habits {
                NotificationManager.scheduleMilestones(for: habit)
            }
            presentPendingCelebration()
        }
        .task {
            // Catch milestones that unlock while the app is open (the first hour, for example).
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(60))
                if scenePhase == .active && router.selectedTab == .today {
                    presentPendingCelebration()
                }
            }
        }
    }

    private func presentPendingCelebration() {
        guard router.celebration == nil, !router.isShowingSOS, router.paywallReason == nil else { return }
        guard let celebration = CelebrationCenter.pendingCelebration(for: habits) else { return }
        CelebrationCenter.markCelebrated(celebration)
        ReviewPrompter.standard.recordPositiveMoment()
        router.celebration = celebration
    }

    /// Asks for an App Store rating right after a high point, at most a few times a year.
    private func requestReviewIfAppropriate() {
        let prompter = ReviewPrompter.standard
        guard prompter.shouldRequestReview() else { return }
        prompter.markRequested()
        requestReview()
    }
}

#Preview {
    MainTabView()
        .previewEnvironment()
}

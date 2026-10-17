import SwiftUI

struct OnboardingView: View {
    let onFinish: () -> Void

    @State private var page = 0
    @State private var isFinishing = false

    private let pages = OnboardingPage.all

    private var isLastPage: Bool { page == pages.count - 1 }

    var body: some View {
        ZStack {
            Brand.night
                .ignoresSafeArea()

            VStack(spacing: 20) {
                TabView(selection: $page) {
                    ForEach(pages.indices, id: \.self) { index in
                        OnboardingPageView(page: pages[index])
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .always))

                Button(action: advance) {
                    Text(isLastPage ? "Get started" : "Continue")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(isFinishing)
                .padding(.horizontal, 24)

                Text("Free · Private · No account needed")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.bottom, 12)
        }
        .environment(\.colorScheme, .dark)
    }

    private func advance() {
        Haptics.tap()
        guard isLastPage else {
            withAnimation { page += 1 }
            return
        }
        isFinishing = true
        Task {
            if await NotificationManager.requestAuthorization() {
                UserDefaults.standard.set(true, forKey: AppSettings.Keys.reminderEnabled)
                NotificationManager.scheduleDailyReminder(hour: AppSettings.reminderHour, minute: AppSettings.reminderMinute)
            }
            onFinish()
        }
    }
}

private struct OnboardingPage {
    let symbol: String
    let title: String
    let message: String
    let theme: HabitTheme

    static let all: [OnboardingPage] = [
        OnboardingPage(
            symbol: "link",
            title: "Break free from any habit",
            message: "Smoking, vaping, drinking, doomscrolling, sugar. Unhook helps you quit anything, one day at a time.",
            theme: .grape
        ),
        OnboardingPage(
            symbol: "chart.line.uptrend.xyaxis",
            title: "Watch your progress grow",
            message: "See every second, dollar and hour you win back, and unlock milestones as your streak grows.",
            theme: .forest
        ),
        OnboardingPage(
            symbol: "wind",
            title: "Beat cravings in 60 seconds",
            message: "Craving hits? Tap SOS. A guided breathing exercise and your own reasons carry you through it.",
            theme: .ocean
        ),
        OnboardingPage(
            symbol: "lock.shield.fill",
            title: "Private by design",
            message: "No account, no ads, no tracking. Everything stays on your iPhone.",
            theme: .candy
        ),
    ]
}

private struct OnboardingPageView: View {
    let page: OnboardingPage

    var body: some View {
        VStack(spacing: 32) {
            Spacer()
            ZStack {
                Circle()
                    .fill(page.theme.gradient)
                    .frame(width: 200, height: 200)
                    .blur(radius: 50)
                    .opacity(0.8)
                Circle()
                    .fill(page.theme.gradient)
                    .frame(width: 150, height: 150)
                Image(systemName: page.symbol)
                    .font(.system(size: 64, weight: .semibold))
                    .foregroundStyle(.white)
                    .symbolEffect(.pulse, options: .repeating)
            }
            VStack(spacing: 14) {
                Text(page.title)
                    .font(.largeTitle.bold())
                    .multilineTextAlignment(.center)
                Text(page.message)
                    .font(.body)
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.75))
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 32)
            Spacer()
            Spacer()
        }
    }
}

#Preview {
    OnboardingView {}
}

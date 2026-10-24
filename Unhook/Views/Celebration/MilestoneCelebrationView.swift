import SwiftUI

/// The full-screen "milestone unlocked" moment shown when the app opens after a streak checkpoint.
/// Sharing from the high point turns a personal win into word of mouth.
struct MilestoneCelebrationView: View {
    let celebration: MilestoneCelebration
    let onDone: () -> Void

    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var hasAppeared = false
    @State private var showsDetails = false
    @State private var showingShare = false

    private var habit: Habit { celebration.habit }
    private var milestone: Milestone { celebration.milestone }

    var body: some View {
        ZStack {
            CelebrationBackground(theme: habit.theme)

            GeometryReader { proxy in
                ScrollView {
                    hero
                        .padding(.horizontal, 24)
                        .padding(.vertical, 16)
                        .frame(maxWidth: 560)
                        .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }
            .safeAreaInset(edge: .bottom) {
                actions
            }

            if !reduceMotion {
                ConfettiView()
            }
        }
        .environment(\.colorScheme, .dark)
        .sheet(isPresented: $showingShare) {
            ShareProgressSheet(habit: habit)
        }
        .onAppear(perform: celebrate)
    }

    // MARK: Content

    private var hero: some View {
        VStack(spacing: 28) {
            CelebrationBadge(
                emoji: habit.emoji,
                symbol: milestone.symbol,
                theme: habit.theme,
                isVisible: hasAppeared || reduceMotion
            )

            VStack(spacing: 24) {
                headline
                CelebrationStatsRow(stats: statItems)
                Text(CelebrationCenter.encouragement(for: milestone))
                    .font(.title3.weight(.medium))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .opacity(showsDetails || reduceMotion ? 1 : 0)
            .offset(y: showsDetails || reduceMotion ? 0 : 18)
        }
    }

    private var headline: some View {
        VStack(spacing: 10) {
            Text("MILESTONE UNLOCKED")
                .font(.caption.weight(.heavy))
                .tracking(2)
                .foregroundStyle(.white.opacity(0.7))
            Text("\(milestone.title) free from \(habit.name)!")
                .font(.system(.largeTitle, design: .rounded, weight: .heavy))
                .multilineTextAlignment(.center)
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var actions: some View {
        VStack(spacing: 12) {
            Button {
                Haptics.tap()
                showingShare = true
            } label: {
                Label("Share my progress", systemImage: "square.and.arrow.up")
            }
            .buttonStyle(PrimaryButtonStyle(gradient: habit.theme.gradient))
            .shadow(color: habit.theme.accent.opacity(0.4), radius: 14, y: 6)

            Button("Keep going") {
                Haptics.tap()
                onDone()
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .padding(.horizontal, 24)
        .padding(.top, 16)
        .padding(.bottom, 12)
        .frame(maxWidth: 560)
        .frame(maxWidth: .infinity)
        .background {
            // Lets long content (large Dynamic Type) scroll softly under the buttons.
            LinearGradient(
                colors: [CelebrationBackground.baseColor.opacity(0), CelebrationBackground.baseColor],
                startPoint: .top,
                endPoint: .center
            )
            .ignoresSafeArea()
        }
    }

    /// Money and time when the habit tracks them; otherwise cravings beaten or the streak itself.
    private var statItems: [CelebrationStat] {
        let stats = habit.stats()
        var items: [CelebrationStat] = []
        if stats.moneySaved >= 1 {
            items.append(CelebrationStat(
                id: "money",
                value: MoneyFormatter.rounded(stats.moneySaved, code: currencyCode),
                title: String(localized: "Money saved"),
                systemImage: "banknote.fill"
            ))
        }
        if stats.minutesReclaimed >= 1 {
            items.append(CelebrationStat(
                id: "time",
                value: DurationFormatter.minutes(stats.minutesReclaimed),
                title: String(localized: "Time reclaimed"),
                systemImage: "clock.fill"
            ))
        }
        let beaten = habit.resistedUrgeCount
        if items.count < 2 && beaten > 0 {
            items.append(CelebrationStat(
                id: "cravings",
                value: beaten.formatted(),
                title: String(localized: "Cravings beaten"),
                systemImage: "shield.lefthalf.filled"
            ))
        }
        if items.isEmpty {
            items.append(CelebrationStat(
                id: "streak",
                value: DurationFormatter.compact(stats.currentStreak),
                title: String(localized: "Free for"),
                systemImage: "timer"
            ))
        }
        return items
    }

    // MARK: Actions

    private func celebrate() {
        // Presenting the share sheet and coming back must not replay the moment.
        guard !hasAppeared else { return }
        Haptics.success()
        withAnimation(.spring(response: 0.6, dampingFraction: 0.55).delay(0.15)) {
            hasAppeared = true
        }
        withAnimation(.easeOut(duration: 0.5).delay(0.45)) {
            showsDetails = true
        }
    }
}

#Preview {
    MilestoneCelebrationView(
        celebration: MilestoneCelebration(habit: PreviewData.sampleHabit, milestone: Milestone.all[4])
    ) {}
    .previewEnvironment()
}

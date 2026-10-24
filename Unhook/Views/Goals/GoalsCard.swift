import SwiftUI
import SwiftData

/// Savings goals on the Today screen: the next reward the user is saving toward, paid for by the money they no
/// longer spend on their habits. Lives inside the Today tab's NavigationStack.
struct GoalsCard: View {
    @Query(sort: [SortDescriptor(\SavingsGoal.sortIndex), SortDescriptor(\SavingsGoal.createdAt)])
    private var goals: [SavingsGoal]
    @Query(sort: \Habit.sortIndex) private var habits: [Habit]
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @Environment(Store.self) private var store
    @Environment(AppRouter.self) private var router

    @State private var showingEditor = false
    @State private var showingAllGoals = false

    private var activeGoals: [SavingsGoal] {
        goals.filter { !$0.isRedeemed }
    }

    var body: some View {
        Card(title: String(localized: "Savings goals"), systemImage: "gift.fill", tint: .pink) {
            if goals.isEmpty {
                emptyState
            } else {
                TimelineView(.periodic(from: .now, by: 60)) { timeline in
                    content(at: timeline.date)
                }
            }
        }
        .sheet(isPresented: $showingEditor) {
            GoalEditorView()
        }
        // Attached to the card rather than a link inside it, so deleting the last goal on the goals screen
        // (which swaps this card to its empty state) doesn't pop that screen.
        .navigationDestination(isPresented: $showingAllGoals) {
            GoalsView()
        }
    }

    private func content(at date: Date) -> some View {
        let snapshot = GoalFundingSnapshot(goals: goals, habits: habits, at: date)
        let nextGoal = activeGoals.first
        return VStack(alignment: .leading, spacing: 14) {
            if let nextGoal {
                GoalSummaryView(
                    emoji: nextGoal.emoji,
                    title: nextGoal.title,
                    progress: snapshot.progress(for: nextGoal),
                    currencyCode: currencyCode
                )
            } else {
                allBoughtState
            }
            Divider()
            allGoalsRow
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Reward yourself")
                .font(.title3.bold())
            Text("Pick something you'd love, like a weekend away or new sneakers. The money you no longer spend on your habit pays for it.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Set a savings goal", action: addGoal)
                .buttonStyle(PrimaryButtonStyle())
                .padding(.top, 4)
        }
    }

    /// Shown when every goal has been bought.
    private var allBoughtState: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Every goal treated! 🎉")
                .font(.headline)
            Text("What's next? Set a new goal and keep the rewards coming.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            Button("Set a savings goal", action: addGoal)
                .buttonStyle(PrimaryButtonStyle())
        }
    }

    private var allGoalsRow: some View {
        Button {
            showingAllGoals = true
        } label: {
            HStack(spacing: 8) {
                Label("All goals", systemImage: "list.bullet")
                Spacer(minLength: 0)
                Text(goals.count, format: .number)
                    .foregroundStyle(.secondary)
                    .monospacedDigit()
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    /// Free users save toward one goal at a time; another active goal opens the Pro paywall.
    private func addGoal() {
        if ProLimits.canAddGoal(activeCount: activeGoals.count, isPro: store.isPro) {
            showingEditor = true
        } else {
            router.showPaywall(.moreGoals)
        }
    }
}

#Preview {
    NavigationStack {
        ScrollView {
            GoalsCard()
                .padding()
        }
        .background(Color(.systemGroupedBackground))
    }
    .previewEnvironment()
}

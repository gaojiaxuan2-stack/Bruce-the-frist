import SwiftUI

/// Funding for every savings goal at one moment: the habits' total savings split across the goals,
/// plus how much more is saved each day.
struct GoalFundingSnapshot {
    let totalSaved: Double
    let dailySavings: Double
    private let allocation: [UUID: Double]
    /// What the active goals ahead of each active goal still need, so later goals get honest time estimates.
    private let remainingAhead: [UUID: Double]

    /// `goals` should be in display order (sort index, then creation date) so ties fund in the order shown.
    init(goals: [SavingsGoal], habits: [Habit], at date: Date) {
        let saved = HabitTotals(habits: habits, at: date).moneySaved
        let daily = habits.reduce(0.0) { $0 + GoalFunding.nonNegative($1.dailyCost) }
        let inputs = goals.map { GoalFundingInput(goal: $0) }
        let funding = GoalFunding.allocate(totalSaved: saved, goals: inputs)
        totalSaved = saved
        dailySavings = daily
        allocation = funding
        remainingAhead = GoalFunding.remainingAhead(goals: inputs, allocation: funding)
    }

    func progress(for goal: SavingsGoal) -> GoalProgress {
        GoalProgress(
            funded: allocation[goal.uuid] ?? 0,
            cost: goal.cost,
            dailySavings: dailySavings,
            queuedAhead: goal.isRedeemed ? 0 : (remainingAhead[goal.uuid] ?? 0)
        )
    }
}

/// Money amounts shown on goals.
enum GoalMoney {
    /// A goal's price, with cents only when it has them.
    static func price(_ amount: Double, code: String) -> String {
        amount.rounded() == amount
            ? MoneyFormatter.rounded(amount, code: code)
            : MoneyFormatter.precise(amount, code: code)
    }

    /// Money put toward a goal. Rounded down so it never shows the full price before the goal is funded.
    static func funded(_ progress: GoalProgress, code: String) -> String {
        if progress.isFunded {
            return price(progress.cost, code: code)
        }
        return MoneyFormatter.rounded(progress.funded.rounded(.down), code: code)
    }
}

/// Ready-made posts for sharing goal progress.
enum GoalShareText {
    static func progress(emoji: String, title: String, fraction: Double) -> String {
        let percent = fraction.formatted(.percent.precision(.fractionLength(0)).rounded(rule: .down))
        return String(localized: "\(title) \(emoji): \(percent) funded with the money I save by breaking a habit. 💪 #Unhook")
    }

    static func bought(emoji: String, title: String) -> String {
        String(localized: "Just treated myself to \(title) \(emoji), paid for with the money I saved by breaking a habit. 🎉 #Unhook")
    }
}

/// Emoji, title and funding progress of one active goal. Used on the Today card and in the goals list.
struct GoalSummaryView: View {
    let emoji: String
    let title: String
    let progress: GoalProgress
    let currencyCode: String

    @ScaledMetric(relativeTo: .title2) private var badgeSize: CGFloat = 52

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Text(emoji)
                    .font(.title)
                    .frame(width: badgeSize, height: badgeSize)
                    .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                VStack(alignment: .leading, spacing: 2) {
                    Text(title)
                        .font(.headline)
                        .lineLimit(2)
                    Text("\(GoalMoney.funded(progress, code: currencyCode)) of \(GoalMoney.price(progress.cost, code: currencyCode))")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .monospacedDigit()
                }
                Spacer(minLength: 0)
                // Rounded down so it never reads 100% before the goal is actually funded.
                Text(progress.fraction, format: .percent.precision(.fractionLength(0)).rounded(rule: .down))
                    .font(.headline)
                    .monospacedDigit()
                    .foregroundStyle(Brand.gradient)
            }
            GoalProgressBar(fraction: progress.fraction)
            GoalStatusLine(progress: progress)
        }
        .accessibilityElement(children: .combine)
    }
}

/// "About 8 days to go", or a celebration once the goal is funded.
struct GoalStatusLine: View {
    let progress: GoalProgress

    var body: some View {
        Group {
            if progress.isFunded {
                Label {
                    Text("Ready to treat yourself! 🎉")
                } icon: {
                    Image(systemName: "gift.fill")
                        .foregroundStyle(.pink)
                }
                .foregroundStyle(.primary)
            } else if let days = progress.daysToGo {
                Label {
                    if days <= 1 {
                        Text("About a day to go")
                    } else {
                        Text("About \(days) days to go")
                    }
                } icon: {
                    Image(systemName: "hourglass")
                        .foregroundStyle(Color.accentColor)
                }
                .foregroundStyle(.secondary)
            } else {
                Label {
                    Text("Add what a habit cost you per day to start saving toward this.")
                } icon: {
                    Image(systemName: "banknote")
                        .foregroundStyle(.green)
                }
                .foregroundStyle(.secondary)
            }
        }
        .font(.subheadline.weight(.medium))
    }
}

/// A capsule progress bar filled with the brand gradient.
struct GoalProgressBar: View {
    let fraction: Double

    private var clampedFraction: CGFloat {
        guard !fraction.isNaN else { return 0 }
        return CGFloat(min(max(fraction, 0), 1))
    }

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                Capsule()
                    .fill(Brand.gradient)
                    .frame(width: fillWidth(total: proxy.size.width))
            }
        }
        .frame(height: 10)
        .animation(.easeInOut(duration: 0.6), value: fraction)
        .accessibilityHidden(true)
    }

    /// At least a dot once any money is in, so early progress is visible.
    private func fillWidth(total: CGFloat) -> CGFloat {
        guard clampedFraction > 0 else { return 0 }
        return min(total, max(10, total * clampedFraction))
    }
}

#Preview {
    VStack(spacing: 24) {
        GoalSummaryView(
            emoji: "🎧",
            title: "New AirPods",
            progress: GoalProgress(funded: 124, cost: 199, dailySavings: 12),
            currencyCode: "USD"
        )
        GoalSummaryView(
            emoji: "👟",
            title: "New running shoes",
            progress: GoalProgress(funded: 140, cost: 140, dailySavings: 12),
            currencyCode: "USD"
        )
    }
    .padding()
    .previewEnvironment()
}

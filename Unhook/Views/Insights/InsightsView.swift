import SwiftUI
import SwiftData
import Charts

struct InsightsView: View {
    @Query(sort: \Habit.sortIndex) private var habits: [Habit]
    @Query(sort: \Urge.date) private var urges: [Urge]
    @Query(sort: \Pledge.day) private var pledges: [Pledge]
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode

    private var resistedCount: Int {
        urges.filter(\.resisted).count
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    totalsGrid
                    cravingsChart
                    moodChart
                    achievementsCard
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Progress")
        }
    }

    private var totalsGrid: some View {
        TimelineView(.periodic(from: .now, by: 60)) { timeline in
            let totals = HabitTotals(habits: habits, at: timeline.date)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                StatTile(title: "Total saved", value: MoneyFormatter.rounded(totals.moneySaved, code: currencyCode), systemImage: "banknote.fill", tint: .green)
                StatTile(title: "Time reclaimed", value: DurationFormatter.minutes(totals.minutesReclaimed), systemImage: "clock.fill", tint: .blue)
                StatTile(title: "Cravings beaten", value: "\(resistedCount)", systemImage: "shield.lefthalf.filled", tint: .purple)
                StatTile(title: "Longest streak", value: DurationFormatter.compact(totals.bestStreak), systemImage: "trophy.fill", tint: .orange)
            }
        }
    }

    private var cravingsChart: some View {
        let data = DailyCounts.make(from: urges.filter(\.resisted).map(\.date), days: 14)
        let isEmpty = data.allSatisfy { $0.count == 0 }
        return Card(title: "Cravings beaten · last 14 days", systemImage: "chart.bar.fill", tint: .purple) {
            if isEmpty {
                placeholder("Tap SOS when a craving hits. Every one you beat shows up here.")
            } else {
                Chart(data) { item in
                    BarMark(
                        x: .value("Day", item.day, unit: .day),
                        y: .value("Cravings", item.count)
                    )
                    .foregroundStyle(HabitTheme.grape.gradient)
                    .cornerRadius(5)
                }
                .chartXAxis {
                    AxisMarks(values: .stride(by: .day, count: 3)) { _ in
                        AxisValueLabel(format: .dateTime.month(.abbreviated).day())
                    }
                }
                .frame(height: 180)
            }
        }
    }

    private var moodChart: some View {
        let calendar = Calendar.current
        let cutoff = calendar.date(byAdding: .day, value: -29, to: calendar.startOfDay(for: .now)) ?? .distantPast
        let recent = pledges.filter { $0.day >= cutoff }
        return Card(title: "Mood · last 30 days", systemImage: "face.smiling", tint: .orange) {
            if recent.count < 2 {
                placeholder("Take your daily pledge to see how your mood lifts over time.")
            } else {
                Chart(recent) { pledge in
                    LineMark(
                        x: .value("Day", pledge.day, unit: .day),
                        y: .value("Mood", pledge.mood)
                    )
                    .interpolationMethod(.catmullRom)
                    .foregroundStyle(HabitTheme.sunset.gradient)

                    PointMark(
                        x: .value("Day", pledge.day, unit: .day),
                        y: .value("Mood", pledge.mood)
                    )
                    .foregroundStyle(HabitTheme.sunset.accent)
                }
                .chartYScale(domain: 1...5)
                .chartYAxis {
                    AxisMarks(values: [1, 3, 5]) { value in
                        AxisGridLine()
                        AxisValueLabel {
                            if let mood = value.as(Int.self) {
                                Text(MoodScale.emoji(for: mood))
                            }
                        }
                    }
                }
                .frame(height: 160)
            }
        }
    }

    private var achievementsCard: some View {
        let totals = HabitTotals(habits: habits, at: .now)
        let input = AchievementInput(
            habitCount: habits.count,
            bestStreak: totals.bestStreak,
            cravingsBeaten: resistedCount,
            moneySaved: totals.moneySaved,
            pledgeStreak: StreakCalculator.consecutiveDays(pledges.map(\.day)),
            totalPledges: pledges.count
        )
        let achievements = Achievement.evaluate(input)
        let unlocked = achievements.filter(\.isUnlocked).count
        return Card(title: "Achievements · \(unlocked) of \(achievements.count)", systemImage: "rosette", tint: .yellow) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 96), spacing: 12)], spacing: 18) {
                ForEach(achievements) { achievement in
                    AchievementBadge(achievement: achievement)
                }
            }
        }
    }

    private func placeholder(_ text: String) -> some View {
        Text(text)
            .font(.subheadline)
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
    }
}

private struct AchievementBadge: View {
    let achievement: Achievement

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                Circle()
                    .fill(achievement.isUnlocked ? AnyShapeStyle(achievement.theme.gradient) : AnyShapeStyle(Color.primary.opacity(0.08)))
                    .frame(width: 60, height: 60)
                Image(systemName: achievement.isUnlocked ? achievement.symbol : "lock.fill")
                    .font(.system(size: 24, weight: .semibold))
                    .foregroundStyle(achievement.isUnlocked ? Color.white : Color.secondary)
            }
            Text(achievement.title)
                .font(.caption.weight(.semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
            Text(achievement.detail)
                .font(.caption2)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .lineLimit(2)
        }
        .opacity(achievement.isUnlocked ? 1 : 0.55)
        .accessibilityElement(children: .combine)
        .accessibilityValue(achievement.isUnlocked ? "Unlocked" : "Locked")
    }
}

#Preview {
    InsightsView()
        .modelContainer(PreviewData.container)
}

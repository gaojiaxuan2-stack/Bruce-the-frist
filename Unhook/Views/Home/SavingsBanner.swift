import SwiftUI

/// Money and time won back across all habits, ticking up live.
struct SavingsBanner: View {
    let habits: [Habit]
    let currencyCode: String

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let totals = HabitTotals(habits: habits, at: timeline.date)
            HStack(spacing: 0) {
                metric(
                    title: "Money saved",
                    value: MoneyFormatter.precise(totals.moneySaved, code: currencyCode),
                    systemImage: "banknote.fill",
                    tint: .green
                )
                Divider()
                    .frame(height: 44)
                metric(
                    title: "Time reclaimed",
                    value: DurationFormatter.minutes(totals.minutesReclaimed),
                    systemImage: "clock.fill",
                    tint: .blue
                )
            }
            .padding(.vertical, 16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    private func metric(title: String, value: String, systemImage: String, tint: Color) -> some View {
        VStack(spacing: 6) {
            Label {
                Text(title)
            } icon: {
                Image(systemName: systemImage)
                    .foregroundStyle(tint)
            }
            .font(.caption.weight(.semibold))
            .foregroundStyle(.secondary)

            Text(value)
                .font(.title2.bold())
                .monospacedDigit()
                .contentTransition(.numericText())
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
        .padding(.horizontal, 8)
        .accessibilityElement(children: .combine)
    }
}

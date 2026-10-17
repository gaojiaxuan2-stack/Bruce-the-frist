import SwiftUI

/// A habit's live streak on the home screen.
struct HabitCard: View {
    let habit: Habit

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = habit.stats(at: timeline.date).currentStreak
            HStack(spacing: 16) {
                ZStack {
                    ProgressRing(progress: Milestone.progress(toward: elapsed), colors: habit.theme.colors, lineWidth: 6)
                    Text(habit.emoji)
                        .font(.system(size: 28))
                }
                .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 4) {
                    Text(habit.name)
                        .font(.subheadline.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Text(DurationFormatter.detailed(elapsed))
                        .font(.title3.bold())
                        .monospacedDigit()
                        .contentTransition(.numericText())
                    nextMilestone(elapsed)
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
            }
            .padding(16)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
    }

    @ViewBuilder
    private func nextMilestone(_ elapsed: TimeInterval) -> some View {
        if let next = Milestone.next(after: elapsed) {
            Text("\(DurationFormatter.compact(next.seconds - elapsed)) to \(next.title)")
                .font(.caption.weight(.medium))
                .foregroundStyle(habit.theme.accent)
        } else {
            Text("Every milestone unlocked")
                .font(.caption.weight(.medium))
                .foregroundStyle(habit.theme.accent)
        }
    }
}

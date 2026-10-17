import SwiftUI

struct MilestoneListView: View {
    let habit: Habit

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { timeline in
            let elapsed = habit.stats(at: timeline.date).currentStreak
            let next = Milestone.next(after: elapsed)
            Card(title: "Milestones", systemImage: "flag.checkered", tint: habit.theme.accent) {
                VStack(spacing: 0) {
                    ForEach(Milestone.all) { milestone in
                        MilestoneRow(
                            milestone: milestone,
                            date: habit.streakStart.addingTimeInterval(milestone.seconds),
                            isReached: elapsed >= milestone.seconds,
                            isNext: next == milestone,
                            theme: habit.theme
                        )
                    }
                }
            }
        }
    }
}

private struct MilestoneRow: View {
    let milestone: Milestone
    let date: Date
    let isReached: Bool
    let isNext: Bool
    let theme: HabitTheme

    var body: some View {
        HStack(spacing: 14) {
            ZStack {
                Circle()
                    .fill(isReached ? AnyShapeStyle(theme.gradient) : AnyShapeStyle(Color.primary.opacity(0.08)))
                Image(systemName: isReached ? milestone.symbol : "lock.fill")
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(isReached ? Color.white : Color.secondary)
            }
            .frame(width: 38, height: 38)

            VStack(alignment: .leading, spacing: 2) {
                Text(milestone.title)
                    .font(.subheadline.weight(.semibold))
                Text(caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            Spacer()

            if isReached {
                Image(systemName: "checkmark.circle.fill")
                    .foregroundStyle(theme.accent)
            } else if isNext {
                Text("NEXT")
                    .font(.caption2.weight(.heavy))
                    .foregroundStyle(theme.accent)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(theme.accent.opacity(0.15), in: Capsule())
            }
        }
        .padding(.vertical, 7)
        .opacity(isReached || isNext ? 1 : 0.55)
        .accessibilityElement(children: .combine)
    }

    private var caption: String {
        if isReached {
            return "Unlocked \(date.formatted(date: .abbreviated, time: .omitted))"
        }
        return date.formatted(date: .abbreviated, time: .shortened)
    }
}

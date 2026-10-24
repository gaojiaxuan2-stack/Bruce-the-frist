import SwiftUI

/// The big, live streak counter at the top of a habit's page.
struct HabitHeroView: View {
    let habit: Habit

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let elapsed = habit.stats(at: timeline.date).currentStreak
            let parts = DurationFormatter.parts(elapsed)
            VStack(spacing: 14) {
                Text(habit.emoji)
                    .font(.system(size: 52))
                Text("FREE FOR")
                    .font(.caption.weight(.heavy))
                    .tracking(2)
                    .opacity(0.85)
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text("\(parts.days)")
                        .font(.system(size: 76, weight: .heavy, design: .rounded))
                        .contentTransition(.numericText())
                    Text(parts.days == 1 ? "day" : "days")
                        .font(.title2.weight(.bold))
                }
                .monospacedDigit()
                HStack(spacing: 10) {
                    TimeUnitView(value: parts.hours, label: "hours")
                    TimeUnitView(value: parts.minutes, label: "min")
                    TimeUnitView(value: parts.seconds, label: "sec")
                }
                milestoneProgress(elapsed)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 28)
            .padding(.horizontal, 20)
            .background(habit.theme.gradient, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
            .shadow(color: habit.theme.accent.opacity(0.35), radius: 18, y: 10)
            .animation(.easeInOut(duration: 0.3), value: parts)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel("Free for \(parts.days) days, \(parts.hours) hours and \(parts.minutes) minutes")
        }
    }

    @ViewBuilder
    private func milestoneProgress(_ elapsed: TimeInterval) -> some View {
        if let next = Milestone.next(after: elapsed) {
            VStack(spacing: 8) {
                GeometryReader { proxy in
                    ZStack(alignment: .leading) {
                        Capsule()
                            .fill(Color.white.opacity(0.25))
                        Capsule()
                            .fill(Color.white)
                            .frame(width: proxy.size.width * Milestone.progress(toward: elapsed))
                    }
                }
                .frame(height: 8)
                Text("\(DurationFormatter.compact(next.seconds - elapsed)) until \(next.title)")
                    .font(.footnote.weight(.semibold))
                    .opacity(0.9)
            }
            .padding(.top, 6)
        } else {
            Label("Every milestone unlocked. Legend.", systemImage: "crown.fill")
                .font(.footnote.weight(.semibold))
        }
    }
}

private struct TimeUnitView: View {
    let value: Int
    let label: String

    var body: some View {
        VStack(spacing: 2) {
            Text(String(format: "%02d", value))
                .font(.system(size: 26, weight: .bold, design: .rounded))
                .monospacedDigit()
                .contentTransition(.numericText())
            Text(label)
                .font(.caption2.weight(.semibold))
                .opacity(0.8)
        }
        .frame(width: 72)
        .padding(.vertical, 10)
        .background(Color.white.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

import SwiftUI

/// "What's happening in your body and mind": the habit's recovery steps measured against its current streak.
/// Embedded in the habit detail scroll view.
struct RecoveryTimelineView: View {
    let habit: Habit

    @State private var isExpanded = false

    /// Steps shown before the "Show all" toggle.
    private static let collapsedCount = 4

    private var steps: [RecoveryStep] {
        RecoveryTimeline.steps(for: habit.presetID)
    }

    var body: some View {
        Card(title: String(localized: "Recovery timeline"), systemImage: "heart.text.square.fill", tint: habit.theme.accent) {
            TimelineView(.periodic(from: .now, by: 30)) { timeline in
                content(steps: steps, elapsed: habit.stats(at: timeline.date).currentStreak)
            }
        }
    }

    private func content(steps: [RecoveryStep], elapsed: TimeInterval) -> some View {
        let progress = RecoveryTimeline.progress(elapsed: elapsed, steps: steps)
        let theme = habit.theme
        return VStack(alignment: .leading, spacing: 16) {
            if let next = progress.next {
                NextRecoveryStepView(
                    step: next,
                    remaining: next.offset - elapsed,
                    fraction: progress.fractionToNext,
                    theme: theme
                )
            } else {
                RecoveryCompleteView(theme: theme)
            }
            Text("\(progress.reached) of \(steps.count) steps reached")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            stepList(steps: steps, elapsed: elapsed, next: progress.next, theme: theme)
            footer
        }
    }

    private func stepList(steps: [RecoveryStep], elapsed: TimeInterval, next: RecoveryStep?, theme: HabitTheme) -> some View {
        let visible = isExpanded ? steps : Array(steps.prefix(Self.collapsedCount))
        return VStack(spacing: 0) {
            ForEach(visible) { step in
                RecoveryStepRow(
                    step: step,
                    isReached: step.offset <= elapsed,
                    isNext: step == next,
                    theme: theme
                )
            }
            if steps.count > Self.collapsedCount {
                expandButton(total: steps.count, theme: theme)
            }
        }
    }

    private func expandButton(total: Int, theme: HabitTheme) -> some View {
        Button {
            Haptics.selection()
            withAnimation(.easeInOut(duration: 0.25)) {
                isExpanded.toggle()
            }
        } label: {
            HStack(spacing: 6) {
                if isExpanded {
                    Text("Show less")
                } else {
                    Text("Show all \(total) steps")
                }
                Image(systemName: "chevron.down")
                    .rotationEffect(.degrees(isExpanded ? 180 : 0))
                    .accessibilityHidden(true)
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(theme.accent)
            .frame(maxWidth: .infinity)
            .padding(.top, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 4) {
            if let note = RecoveryTimeline.sourceNote(for: habit.presetID) {
                Text(note)
            }
            Text("Everyone is different. This is general information, not medical advice.")
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// The highlighted step the user is working toward, with a live countdown.
private struct NextRecoveryStepView: View {
    let step: RecoveryStep
    let remaining: TimeInterval
    let fraction: Double
    let theme: HabitTheme

    @ScaledMetric(relativeTo: .title3) private var iconSize: CGFloat = 44

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: step.symbol)
                    .font(.title3.weight(.semibold))
                    .foregroundStyle(.white)
                    .frame(width: iconSize, height: iconSize)
                    .background(theme.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 4) {
                    Text("UP NEXT")
                        .font(.caption2.weight(.heavy))
                        .tracking(1.5)
                        .foregroundStyle(theme.accent)
                    Text(step.title)
                        .font(.headline)
                    Text(step.detail)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            RecoveryProgressBar(fraction: fraction, theme: theme)
            HStack {
                Text("\(DurationFormatter.compact(remaining)) to go")
                    .monospacedDigit()
                Spacer()
                // Rounded down so it never reads 100% before the step is actually reached.
                Text(fraction, format: .percent.precision(.fractionLength(0)).rounded(rule: .down))
                    .monospacedDigit()
            }
            .font(.footnote.weight(.semibold))
            .foregroundStyle(.secondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

/// Shown once every step on the timeline has been reached.
private struct RecoveryCompleteView: View {
    let theme: HabitTheme

    var body: some View {
        Label {
            Text("You've reached every step on this timeline. Your progress keeps building from here.")
        } icon: {
            Image(systemName: "sparkles")
                .foregroundStyle(theme.accent)
        }
        .font(.subheadline.weight(.semibold))
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.accent.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct RecoveryProgressBar: View {
    let fraction: Double
    let theme: HabitTheme

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
                    .fill(theme.gradient)
                    .frame(width: proxy.size.width * clampedFraction)
            }
        }
        .frame(height: 8)
        .animation(.easeInOut(duration: 0.6), value: fraction)
        .accessibilityHidden(true)
    }
}

private struct RecoveryStepRow: View {
    let step: RecoveryStep
    let isReached: Bool
    let isNext: Bool
    let theme: HabitTheme

    @ScaledMetric(relativeTo: .subheadline) private var badgeSize: CGFloat = 36

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            badge
            VStack(alignment: .leading, spacing: 2) {
                Text(RecoveryTimeline.offsetLabel(step.offset))
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(isReached || isNext ? theme.accent : Color.secondary)
                Text(step.title)
                    .font(.subheadline.weight(.semibold))
                Text(step.detail)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            status
        }
        .padding(.vertical, 8)
        .opacity(isReached || isNext ? 1 : 0.6)
        .accessibilityElement(children: .combine)
        .accessibilityValue(statusDescription)
    }

    private var badge: some View {
        ZStack {
            Circle()
                .fill(badgeFill)
            Image(systemName: step.symbol)
                .font(.subheadline.weight(.bold))
                .foregroundStyle(symbolColor)
        }
        .frame(width: badgeSize, height: badgeSize)
        .accessibilityHidden(true)
    }

    private var badgeFill: AnyShapeStyle {
        if isReached { return AnyShapeStyle(theme.gradient) }
        if isNext { return AnyShapeStyle(theme.accent.opacity(0.18)) }
        return AnyShapeStyle(Color.primary.opacity(0.08))
    }

    private var symbolColor: Color {
        if isReached { return .white }
        if isNext { return theme.accent }
        return .secondary
    }

    @ViewBuilder
    private var status: some View {
        if isReached {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.accent)
                .accessibilityHidden(true)
        } else if isNext {
            Text("NEXT")
                .font(.caption2.weight(.heavy))
                .foregroundStyle(theme.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(theme.accent.opacity(0.15), in: Capsule())
                .accessibilityHidden(true)
        }
    }

    private var statusDescription: Text {
        if isReached { return Text("Reached") }
        if isNext { return Text("Up next") }
        return Text("Upcoming")
    }
}

#Preview {
    ScrollView {
        RecoveryTimelineView(habit: PreviewData.sampleHabit)
            .padding()
    }
    .background(Color(.systemGroupedBackground))
    .previewEnvironment()
}

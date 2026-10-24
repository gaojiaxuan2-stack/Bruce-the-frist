import SwiftUI
import SwiftData
import Charts

/// Progress-tab card that shows when and why cravings hit: the #1 trigger, the peak time, the top triggers
/// and a 24-hour chart. The #1 trigger is free; the rest is part of Unhook Pro.
struct TriggerInsightsCard: View {
    @Environment(AppRouter.self) private var router
    @Environment(Store.self) private var store
    @Query private var urges: [Urge]
    @Query private var relapses: [Relapse]

    /// With fewer events than this the patterns would be noise, so the card explains how to fill it in instead.
    static let minimumEvents = 3

    private var events: [CravingEvent] {
        urges.map(CravingEvent.init(urge:)) + relapses.map(CravingEvent.init(relapse:))
    }

    var body: some View {
        let insights = TriggerInsights(events: events)
        Card(title: String(localized: "Craving patterns"), systemImage: "waveform.path.ecg", tint: .pink) {
            if insights.totalCount < Self.minimumEvents {
                emptyState
            } else {
                VStack(alignment: .leading, spacing: 18) {
                    TopTriggerSummary(insights: insights)
                    if store.isPro {
                        TriggerInsightsDetails(insights: insights)
                    } else {
                        lockedTeaser
                    }
                }
            }
        }
    }

    private var emptyState: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Learn what sets off your cravings")
                .font(.subheadline.weight(.semibold))
            Text("After you beat a craving in SOS, tap what set it off. Log a few and your top triggers and toughest times show up here.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var lockedTeaser: some View {
        ZStack {
            LockedInsightsPreview()
                .blur(radius: 7)
                .opacity(0.7)
                .allowsHitTesting(false)
                .accessibilityHidden(true)

            VStack(spacing: 12) {
                Image(systemName: "lock.fill")
                    .font(.title2)
                    .foregroundStyle(HabitTheme.candy.gradient)
                    .accessibilityHidden(true)
                Text("See when your cravings peak and everything that sets them off.")
                    .font(.subheadline.weight(.semibold))
                    .multilineTextAlignment(.center)
                Button {
                    Haptics.tap()
                    router.showPaywall(.insights)
                } label: {
                    Label("Unlock all insights", systemImage: "sparkles")
                }
                .buttonStyle(PrimaryButtonStyle(gradient: HabitTheme.candy.gradient))
            }
            .padding(.horizontal, 8)
        }
        .frame(maxWidth: .infinity)
    }
}

// MARK: - #1 trigger

/// "Your #1 trigger: 😤 Stress". The one insight free users get.
private struct TopTriggerSummary: View {
    let insights: TriggerInsights

    var body: some View {
        if let top = insights.topTrigger {
            VStack(alignment: .leading, spacing: 4) {
                Text("Your #1 trigger: \(top.trigger.emoji) \(top.trigger.title)")
                    .font(.title3.bold())
                Text("Behind \(percent(insights.share(of: top))) of the cravings and slips you tagged.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityElement(children: .combine)
        } else {
            Text("Tap what set off a craving after you beat it in SOS to find your #1 trigger.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func percent(_ value: Double) -> String {
        value.formatted(.percent.precision(.fractionLength(0)))
    }
}

// MARK: - Pro details

private struct TriggerInsightsDetails: View {
    let insights: TriggerInsights

    /// A peak needs at least this many events in one bucket before it's worth pointing out.
    private static let minimumPeakCount = 2

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            timingInsights
            topTriggerBars
            hourChart
        }
    }

    // MARK: Timing

    private var timingInsights: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let hour = insights.peakHour, insights.peakHourCount >= Self.minimumPeakCount {
                InsightLine(systemImage: "clock.fill", tint: .orange) {
                    Text("Cravings peak around \(TriggerInsights.hourLabel(hour)) — plan something for then.")
                }
            } else {
                InsightLine(systemImage: "clock", tint: .orange) {
                    Text("No clear peak time yet. Keep logging and it will show up.")
                }
            }
            if let weekday = insights.peakWeekday,
               insights.peakWeekdayCount >= Self.minimumPeakCount,
               let name = TriggerInsights.weekdayName(weekday) {
                InsightLine(systemImage: "calendar", tint: .blue) {
                    Text("Toughest day: \(name). A little extra support then goes a long way.")
                }
            }
        }
    }

    // MARK: Top triggers

    /// Hidden until something is tagged; the summary above already explains how to tag.
    @ViewBuilder
    private var topTriggerBars: some View {
        if let top = insights.topTrigger {
            VStack(alignment: .leading, spacing: 12) {
                Text("Top triggers")
                    .font(.subheadline.weight(.semibold))
                    .accessibilityAddTraits(.isHeader)
                ForEach(Array(insights.topTriggers.prefix(3))) { item in
                    TriggerBarRow(
                        item: item,
                        share: insights.share(of: item),
                        fraction: top.count > 0 ? Double(item.count) / Double(top.count) : 0
                    )
                }
            }
        }
    }

    // MARK: Time of day

    private var hourChart: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Cravings by time of day")
                .font(.subheadline.weight(.semibold))
                .accessibilityAddTraits(.isHeader)
            Chart(insights.hourlyCounts) { item in
                BarMark(
                    x: .value("Hour", String(item.hour)),
                    y: .value("Cravings", item.count)
                )
                .foregroundStyle(barStyle(for: item.hour))
                .cornerRadius(3)
                .accessibilityLabel(Text(TriggerInsights.hourLabel(item.hour)))
                .accessibilityValue(Text("Cravings: \(item.count)"))
            }
            .chartXAxis {
                AxisMarks(values: ["0", "6", "12", "18"]) { value in
                    AxisValueLabel {
                        if let raw = value.as(String.self), let hour = Int(raw) {
                            Text(TriggerInsights.hourLabel(hour))
                        }
                    }
                }
            }
            .frame(height: 160)
        }
    }

    /// Only highlights the peak bar when the text above calls out a peak, so the chart never contradicts it.
    private func barStyle(for hour: Int) -> AnyShapeStyle {
        if hour == insights.peakHour, insights.peakHourCount >= Self.minimumPeakCount {
            return AnyShapeStyle(HabitTheme.candy.gradient)
        }
        return AnyShapeStyle(Color.pink.opacity(0.35))
    }
}

/// An icon plus one sentence of insight.
private struct InsightLine<Content: View>: View {
    let systemImage: String
    let tint: Color
    @ViewBuilder var content: Content

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
                .accessibilityHidden(true)
            content
                .font(.subheadline)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct TriggerBarRow: View {
    let item: TriggerCount
    /// Share of all tagged events, for the label.
    let share: Double
    /// Length relative to the top trigger, for the bar.
    let fraction: Double

    private var percent: String {
        share.formatted(.percent.precision(.fractionLength(0)))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack {
                Text("\(item.trigger.emoji) \(item.trigger.title)")
                    .font(.subheadline)
                Spacer(minLength: 8)
                Text(percent)
                    .font(.subheadline.weight(.semibold))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            GeometryReader { proxy in
                ZStack(alignment: .leading) {
                    Capsule()
                        .fill(Color.primary.opacity(0.08))
                    Capsule()
                        .fill(HabitTheme.candy.gradient)
                        .frame(width: proxy.size.width * CGFloat(min(max(fraction, 0), 1)))
                }
            }
            .frame(height: 8)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text(item.trigger.title))
        .accessibilityValue(Text("\(percent) of tagged cravings, \(item.count) in total"))
    }
}

/// Stand-in shapes behind the Pro teaser. Deliberately not the user's real data.
private struct LockedInsightsPreview: View {
    private static let barFractions: [Double] = [0.9, 0.6, 0.35]
    private static let hourHeights: [Double] = [
        0.2, 0.1, 0.05, 0.05, 0.1, 0.2, 0.35, 0.5, 0.4, 0.3, 0.35, 0.45,
        0.55, 0.4, 0.35, 0.45, 0.6, 0.7, 0.8, 0.95, 1, 0.85, 0.6, 0.35,
    ]
    private static let chartHeight: Double = 90

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Self.barFractions.indices, id: \.self) { index in
                GeometryReader { proxy in
                    Capsule()
                        .fill(HabitTheme.candy.gradient)
                        .frame(width: proxy.size.width * CGFloat(Self.barFractions[index]))
                }
                .frame(height: 10)
            }
            HStack(alignment: .bottom, spacing: 3) {
                ForEach(Self.hourHeights.indices, id: \.self) { index in
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(Color.pink.opacity(0.5))
                        .frame(height: CGFloat(Self.chartHeight * Self.hourHeights[index]))
                }
            }
            .frame(height: CGFloat(Self.chartHeight), alignment: .bottom)
        }
        .padding(.vertical, 8)
    }
}

// MARK: - Trigger picker (shared by the SOS screen and the slip sheet)

/// A wrapping set of trigger chips. Single choice and optional: tapping the selected chip clears it.
/// Uses primary-based colors so it reads well on the dark SOS screen and in light or dark forms.
struct CravingTriggerPicker: View {
    @Binding var selection: CravingTrigger?
    var tint: LinearGradient = Brand.gradient

    var body: some View {
        TriggerChipFlowLayout(spacing: 8) {
            ForEach(CravingTrigger.allCases) { trigger in
                chip(for: trigger)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .animation(.spring(response: 0.3, dampingFraction: 0.75), value: selection)
    }

    private func chip(for trigger: CravingTrigger) -> some View {
        let isSelected = selection == trigger
        return Button {
            selection = isSelected ? nil : trigger
            Haptics.selection()
        } label: {
            HStack(spacing: 6) {
                Text(trigger.emoji)
                Text(trigger.title)
                    .fontWeight(.semibold)
            }
            .font(.subheadline)
            .foregroundStyle(isSelected ? Color.white : Color.primary)
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                isSelected ? AnyShapeStyle(tint) : AnyShapeStyle(Color.primary.opacity(0.1)),
                in: Capsule()
            )
            .contentShape(Capsule())
        }
        // Plain style keeps each chip its own tap target inside a Form row.
        .buttonStyle(.plain)
        .accessibilityLabel(trigger.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

/// Lays chips out left to right and wraps them onto new rows, like words in a paragraph.
private struct TriggerChipFlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        arrangement(of: subviews, maxWidth: proposal.width ?? .infinity).size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let frames = arrangement(of: subviews, maxWidth: bounds.width).frames
        for (subview, frame) in zip(subviews, frames) {
            subview.place(
                at: CGPoint(x: bounds.minX + frame.minX, y: bounds.minY + frame.minY),
                anchor: .topLeading,
                proposal: ProposedViewSize(frame.size)
            )
        }
    }

    private func arrangement(of subviews: Subviews, maxWidth: CGFloat) -> (frames: [CGRect], size: CGSize) {
        var frames: [CGRect] = []
        frames.reserveCapacity(subviews.count)
        var x: CGFloat = 0
        var y: CGFloat = 0
        var rowHeight: CGFloat = 0
        var widest: CGFloat = 0

        for subview in subviews {
            var size = subview.sizeThatFits(.unspecified)
            if size.width > maxWidth {
                // Too wide for a row on its own (very large text): let it wrap within the width.
                size = subview.sizeThatFits(ProposedViewSize(width: maxWidth, height: nil))
            }
            if x > 0, x + size.width > maxWidth {
                x = 0
                y += rowHeight + spacing
                rowHeight = 0
            }
            frames.append(CGRect(x: x, y: y, width: size.width, height: size.height))
            x += size.width
            widest = max(widest, x)
            x += spacing
            rowHeight = max(rowHeight, size.height)
        }
        return (frames, CGSize(width: widest, height: y + rowHeight))
    }
}

#Preview {
    ScrollView {
        TriggerInsightsCard()
            .padding()
    }
    .background(Color(.systemGroupedBackground))
    .previewEnvironment()
}

import SwiftUI

/// Renders a shareable progress card. Every share is free word-of-mouth marketing.
struct ShareProgressSheet: View {
    let habit: Habit

    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode

    @State private var renderedImage: Image?

    private static let cardSize = CGSize(width: 300, height: 380)

    var body: some View {
        NavigationStack {
            VStack(spacing: 28) {
                card
                    .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                    .shadow(color: .black.opacity(0.2), radius: 20, y: 10)

                if let renderedImage {
                    ShareLink(
                        item: renderedImage,
                        preview: SharePreview("My Unhook streak", image: renderedImage)
                    ) {
                        Label("Share", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(PrimaryButtonStyle(gradient: habit.theme.gradient))
                } else {
                    ProgressView()
                }
            }
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Share your progress")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear(perform: render)
        }
    }

    private var card: some View {
        ShareCardView(habit: habit, stats: habit.stats(), currencyCode: currencyCode)
            .frame(width: Self.cardSize.width, height: Self.cardSize.height)
    }

    private func render() {
        let renderer = ImageRenderer(content: card)
        renderer.scale = 3
        if let uiImage = renderer.uiImage {
            renderedImage = Image(uiImage: uiImage)
        }
    }
}

struct ShareCardView: View {
    let habit: Habit
    let stats: HabitStats
    let currencyCode: String

    var body: some View {
        let days = DurationFormatter.parts(stats.currentStreak).days
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text(habit.emoji)
                    .font(.system(size: 44))
                Spacer()
                Text("UNHOOK")
                    .font(.caption.weight(.black))
                    .tracking(3)
                    .opacity(0.85)
            }

            Spacer()

            Text("I've been free from")
                .font(.headline)
                .opacity(0.9)
            Text(habit.name)
                .font(.system(size: 30, weight: .heavy, design: .rounded))
                .lineLimit(2)
                .minimumScaleFactor(0.6)
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(days)")
                    .font(.system(size: 84, weight: .black, design: .rounded))
                Text(days == 1 ? "day" : "days")
                    .font(.title.bold())
            }

            Spacer()

            HStack(alignment: .top, spacing: 18) {
                if stats.moneySaved >= 1 {
                    metric(MoneyFormatter.rounded(stats.moneySaved, code: currencyCode), label: "saved")
                }
                if stats.minutesReclaimed >= 1 {
                    metric(DurationFormatter.minutes(stats.minutesReclaimed), label: "reclaimed")
                }
                metric(Milestone.latest(reachedBy: stats.currentStreak)?.title ?? "Day one", label: "milestone")
            }
        }
        .foregroundStyle(.white)
        .padding(26)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .background(habit.theme.gradient)
    }

    private func metric(_ value: String, label: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(value)
                .font(.headline.weight(.bold))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(label.uppercased())
                .font(.caption2.weight(.semibold))
                .opacity(0.8)
        }
    }
}

#Preview {
    ShareProgressSheet(habit: PreviewData.sampleHabit)
        .modelContainer(PreviewData.container)
}

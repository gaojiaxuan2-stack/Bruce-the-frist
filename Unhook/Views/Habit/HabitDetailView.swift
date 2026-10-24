import SwiftUI
import SwiftData

struct HabitDetailView: View {
    let habit: Habit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode

    @State private var showingSOS = false
    @State private var showingRelapse = false
    @State private var showingEdit = false
    @State private var showingShare = false
    @State private var confirmingDelete = false

    var body: some View {
        ScrollView {
            VStack(spacing: 16) {
                HabitHeroView(habit: habit)
                statsGrid
                RecoveryTimelineView(habit: habit)
                reasonsCard
                CoachEntryCard(habit: habit)
                MilestoneListView(habit: habit)
                historyCard
            }
            .padding(.horizontal)
            .padding(.bottom, 24)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(habit.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar { toolbarContent }
        .safeAreaInset(edge: .bottom) { actionBar }
        .fullScreenCover(isPresented: $showingSOS) {
            SOSView(habit: habit)
        }
        .sheet(isPresented: $showingRelapse) {
            RelapseSheet(habit: habit)
        }
        .sheet(isPresented: $showingEdit) {
            AddHabitView(editing: habit)
        }
        .sheet(isPresented: $showingShare) {
            ShareProgressSheet(habit: habit)
        }
        .confirmationDialog("Delete \(habit.name)?", isPresented: $confirmingDelete, titleVisibility: .visible) {
            Button("Delete habit and history", role: .destructive, action: deleteHabit)
        } message: {
            Text("This removes the streak, milestones and history for this habit. It can't be undone.")
        }
    }

    @ToolbarContentBuilder
    private var toolbarContent: some ToolbarContent {
        ToolbarItem(placement: .topBarTrailing) {
            Menu {
                Button {
                    showingShare = true
                } label: {
                    Label("Share progress", systemImage: "square.and.arrow.up")
                }
                Button {
                    showingEdit = true
                } label: {
                    Label("Edit", systemImage: "pencil")
                }
                Divider()
                Button(role: .destructive) {
                    confirmingDelete = true
                } label: {
                    Label("Delete", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
            }
            .accessibilityLabel("More options")
        }
    }

    private var actionBar: some View {
        HStack(spacing: 12) {
            Button {
                showingRelapse = true
            } label: {
                Label("I slipped", systemImage: "arrow.counterclockwise")
            }
            .buttonStyle(SecondaryButtonStyle())

            Button {
                Haptics.tap()
                showingSOS = true
            } label: {
                Label("SOS", systemImage: "wind")
            }
            .buttonStyle(PrimaryButtonStyle(gradient: HabitTheme.fire.gradient))
        }
        .padding(.horizontal)
        .padding(.vertical, 10)
        .background(.bar)
    }

    private var unitsTitle: String {
        let unit = habit.unitName.isEmpty ? "Units" : habit.unitName.capitalized
        return "\(unit) avoided"
    }

    private var statsGrid: some View {
        TimelineView(.periodic(from: .now, by: 1)) { timeline in
            let stats = habit.stats(at: timeline.date)
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                StatTile(title: "Money saved", value: MoneyFormatter.rounded(stats.moneySaved, code: currencyCode), systemImage: "banknote.fill", tint: .green)
                StatTile(title: "Time reclaimed", value: DurationFormatter.minutes(stats.minutesReclaimed), systemImage: "clock.fill", tint: .blue)
                if habit.unitsPerDay > 0 {
                    StatTile(title: unitsTitle, value: stats.unitsAvoided.clampedWholeNumber.formatted(), systemImage: "xmark.circle.fill", tint: .orange)
                }
                StatTile(title: "Best streak", value: DurationFormatter.compact(stats.bestStreak), systemImage: "trophy.fill", tint: .yellow)
                StatTile(title: "Cravings beaten", value: "\(habit.resistedUrgeCount)", systemImage: "shield.lefthalf.filled", tint: .purple)
                StatTile(title: "Slips", value: "\(habit.relapses.count)", systemImage: "arrow.counterclockwise", tint: .pink)
            }
        }
    }

    private var reasonsCard: some View {
        Card(title: "Why I'm quitting", systemImage: "heart.fill", tint: .pink) {
            if habit.reasons.isEmpty {
                Button {
                    showingEdit = true
                } label: {
                    Text("Add your reasons. They show up on the SOS screen when a craving hits.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
            } else {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(habit.reasons, id: \.self) { reason in
                        Label {
                            Text(reason)
                        } icon: {
                            Image(systemName: "checkmark.circle.fill")
                                .foregroundStyle(habit.theme.accent)
                        }
                    }
                }
            }
        }
    }

    private struct HistoryItem: Identifiable {
        let id: PersistentIdentifier
        let date: Date
        let title: String
        let detail: String
        let systemImage: String
        let tint: Color
    }

    private var historyItems: [HistoryItem] {
        let urgeItems = habit.urges.map { urge in
            HistoryItem(
                id: urge.persistentModelID,
                date: urge.date,
                title: urge.resisted ? String(localized: "Beat a craving") : String(localized: "Logged a craving"),
                detail: Self.cravingDetail(trigger: urge.trigger, intensity: urge.intensity, note: urge.note),
                systemImage: "shield.lefthalf.filled",
                tint: .purple
            )
        }
        let relapseItems = habit.relapses.map { relapse in
            HistoryItem(
                id: relapse.persistentModelID,
                date: relapse.date,
                title: String(localized: "Slipped after \(DurationFormatter.compact(relapse.streakSeconds))"),
                detail: Self.cravingDetail(trigger: relapse.trigger, intensity: 0, note: relapse.note),
                systemImage: "arrow.counterclockwise",
                tint: .pink
            )
        }
        return (urgeItems + relapseItems).sorted { $0.date > $1.date }
    }

    /// "😤 Stress · 4/5 · note", leaving out whatever wasn't logged.
    private static func cravingDetail(trigger: CravingTrigger?, intensity: Int, note: String) -> String {
        var parts: [String] = []
        if let trigger {
            parts.append("\(trigger.emoji) \(trigger.title)")
        }
        if intensity > 0 {
            parts.append(String(localized: "\(intensity)/5 strength"))
        }
        if !note.isEmpty {
            parts.append(note)
        }
        return parts.joined(separator: " · ")
    }

    private var historyCard: some View {
        Card(title: "History", systemImage: "clock.arrow.circlepath", tint: .secondary) {
            let items = historyItems
            if items.isEmpty {
                Text("Cravings you beat and slips you bounce back from will show up here.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                VStack(spacing: 12) {
                    ForEach(items.prefix(20)) { item in
                        HistoryRow(item: item)
                    }
                }
            }
        }
    }

    private struct HistoryRow: View {
        let item: HistoryItem

        var body: some View {
            HStack(spacing: 12) {
                Image(systemName: item.systemImage)
                    .foregroundStyle(item.tint)
                    .frame(width: 28)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.title)
                        .font(.subheadline.weight(.medium))
                    if !item.detail.isEmpty {
                        Text(item.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                Text(item.date, format: .relative(presentation: .named))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }

    private func deleteHabit() {
        // Pop back first so this screen never renders a deleted model.
        let habit = self.habit
        let context = self.context
        NotificationManager.cancelMilestones(for: habit.uuid)
        dismiss()
        Task {
            try? await Task.sleep(for: .milliseconds(450))
            context.delete(habit)
            try? context.save()
        }
    }
}

#Preview {
    NavigationStack {
        HabitDetailView(habit: PreviewData.sampleHabit)
    }
    .previewEnvironment()
}

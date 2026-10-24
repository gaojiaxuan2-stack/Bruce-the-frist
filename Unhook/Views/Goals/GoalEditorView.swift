import SwiftUI
import SwiftData

/// Creates a savings goal, or edits one when `goal` is given. Presented as a sheet.
struct GoalEditorView: View {
    let goal: SavingsGoal?

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss
    @Query private var goals: [SavingsGoal]
    @Query private var habits: [Habit]
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode

    @State private var title: String
    @State private var emoji: String
    @State private var costText: String
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case emoji, title, cost
    }

    private struct QuickPick: Identifiable {
        let emoji: String
        let title: String

        var id: String { emoji }
    }

    private static let defaultEmoji = "🎁"

    private static let quickPicks: [QuickPick] = [
        QuickPick(emoji: "✈️", title: String(localized: "Weekend trip")),
        QuickPick(emoji: "👟", title: String(localized: "New sneakers")),
        QuickPick(emoji: "🎟️", title: String(localized: "Concert tickets")),
        QuickPick(emoji: "💆", title: String(localized: "Spa day")),
        QuickPick(emoji: "📱", title: String(localized: "New phone")),
        QuickPick(emoji: "🍣", title: String(localized: "Nice dinner")),
    ]

    init(goal: SavingsGoal? = nil) {
        self.goal = goal
        _title = State(initialValue: goal?.title ?? "")
        _emoji = State(initialValue: goal?.emoji ?? Self.defaultEmoji)
        _costText = State(initialValue: HabitDraft.format(goal?.cost ?? 0))
    }

    private var trimmedTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var parsedCost: Double {
        HabitDraft.parse(costText)
    }

    private var isValid: Bool {
        !trimmedTitle.isEmpty && parsedCost > 0
    }

    private var dailySavings: Double {
        habits.reduce(0.0) { $0 + GoalFunding.nonNegative($1.dailyCost) }
    }

    var body: some View {
        NavigationStack {
            Form {
                identitySection
                costSection
                ideasSection
            }
            .navigationTitle(goal == nil ? "New goal" : "Edit goal")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save", action: save)
                        .fontWeight(.semibold)
                        .disabled(!isValid)
                }
                ToolbarItemGroup(placement: .keyboard) {
                    Spacer()
                    Button("Done") { focusedField = nil }
                }
            }
            .onAppear {
                if title.isEmpty { focusedField = .title }
            }
        }
    }

    // MARK: Sections

    private var identitySection: some View {
        Section {
            HStack(spacing: 14) {
                TextField(Self.defaultEmoji, text: $emoji)
                    .font(.system(size: 34))
                    .multilineTextAlignment(.center)
                    .frame(width: 60, height: 60)
                    .background(Color.accentColor.opacity(0.15), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .focused($focusedField, equals: .emoji)
                    .onChange(of: emoji) { _, newValue in
                        if newValue.count > 1 { emoji = String(newValue.suffix(1)) }
                    }
                    .accessibilityLabel("Emoji")
                TextField("What are you saving for?", text: $title)
                    .font(.title3.weight(.semibold))
                    .focused($focusedField, equals: .title)
                    .submitLabel(.next)
                    .onSubmit { focusedField = .cost }
            }
            .padding(.vertical, 4)
        } footer: {
            Text("Tap the emoji to pick your own.")
        }
    }

    private var costSection: some View {
        Section {
            HStack {
                Text("Price")
                Spacer()
                Text(currencySymbol)
                    .foregroundStyle(.secondary)
                TextField("0", text: $costText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 120)
                    .focused($focusedField, equals: .cost)
            }
        } header: {
            Text("How much does it cost?")
        } footer: {
            costFooter
        }
    }

    @ViewBuilder
    private var costFooter: some View {
        let cost = parsedCost
        if cost > 0, let days = GoalFunding.daysToFund(remaining: cost, dailySavings: dailySavings) {
            if days <= 1 {
                Text("That's about one day of savings. An easy win!")
            } else {
                Text("That's about \(days) days of savings at your current pace.")
            }
        } else {
            Text("Your savings fill goals in order, starting with the first one.")
        }
    }

    private var ideasSection: some View {
        Section("Need ideas?") {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 10)], spacing: 10) {
                ForEach(Self.quickPicks) { pick in
                    quickPickChip(pick)
                }
            }
            .padding(.vertical, 6)
        }
    }

    private func quickPickChip(_ pick: QuickPick) -> some View {
        let isSelected = trimmedTitle == pick.title && emoji == pick.emoji
        return Button {
            apply(pick)
        } label: {
            Text(verbatim: "\(pick.emoji) \(pick.title)")
                .font(.subheadline.weight(.medium))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
                .frame(maxWidth: .infinity)
                .padding(.horizontal, 10)
                .padding(.vertical, 10)
                .background(
                    isSelected ? Color.accentColor.opacity(0.2) : Color(.tertiarySystemFill),
                    in: Capsule()
                )
                .overlay {
                    Capsule()
                        .strokeBorder(isSelected ? Color.accentColor : Color.clear, lineWidth: 1.5)
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Helpers

    private var currencySymbol: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        return formatter.currencySymbol ?? currencyCode
    }

    private func apply(_ pick: QuickPick) {
        title = pick.title
        emoji = pick.emoji
        Haptics.selection()
        if costText.isEmpty { focusedField = .cost }
    }

    private func save() {
        guard isValid else { return }
        let cleanTitle = trimmedTitle
        let cleanEmoji = emoji.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? Self.defaultEmoji : emoji
        let cost = parsedCost

        if let goal {
            goal.title = cleanTitle
            goal.emoji = cleanEmoji
            goal.cost = cost
        } else {
            let nextIndex = (goals.map(\.sortIndex).max() ?? -1) + 1
            context.insert(SavingsGoal(title: cleanTitle, emoji: cleanEmoji, cost: cost, sortIndex: nextIndex))
        }

        Haptics.success()
        dismiss()
    }
}

#Preview("New goal") {
    GoalEditorView()
        .previewEnvironment()
}

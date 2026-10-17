import SwiftUI
import SwiftData

struct HabitFormView: View {
    let editing: Habit?
    let onSave: () -> Void

    @Environment(\.modelContext) private var context
    @Query(sort: \Habit.sortIndex) private var habits: [Habit]
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode

    @State private var draft: HabitDraft
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case name, emoji, cost, minutes, units, unitName
        case reason(Int)
    }

    init(draft: HabitDraft, editing: Habit?, onSave: @escaping () -> Void) {
        _draft = State(initialValue: draft)
        self.editing = editing
        self.onSave = onSave
    }

    var body: some View {
        Form {
            identitySection
            themeSection
            dateSection
            costSection
            reasonsSection
        }
        .navigationTitle(editing == nil ? "New habit" : "Edit habit")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .confirmationAction) {
                Button(editing == nil ? "Start" : "Save", action: save)
                    .fontWeight(.semibold)
                    .disabled(!draft.isValid)
            }
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
        .onAppear {
            if draft.name.isEmpty { focusedField = .name }
        }
    }

    // MARK: Sections

    private var identitySection: some View {
        Section {
            HStack(spacing: 14) {
                TextField("✨", text: $draft.emoji)
                    .font(.system(size: 34))
                    .multilineTextAlignment(.center)
                    .frame(width: 60, height: 60)
                    .background(draft.theme.accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    .focused($focusedField, equals: .emoji)
                    .onChange(of: draft.emoji) { _, newValue in
                        if newValue.count > 1 { draft.emoji = String(newValue.suffix(1)) }
                    }
                    .accessibilityLabel("Emoji")
                TextField("What are you quitting?", text: $draft.name)
                    .font(.title3.weight(.semibold))
                    .focused($focusedField, equals: .name)
                    .submitLabel(.done)
            }
            .padding(.vertical, 4)
        } footer: {
            Text("Tap the emoji to pick your own.")
        }
    }

    private var themeSection: some View {
        Section("Color") {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 14) {
                    ForEach(HabitTheme.allCases) { theme in
                        Button {
                            draft.theme = theme
                            Haptics.selection()
                        } label: {
                            Circle()
                                .fill(theme.gradient)
                                .frame(width: 38, height: 38)
                                .padding(4)
                                .overlay(
                                    Circle().stroke(Color.primary, lineWidth: draft.theme == theme ? 2.5 : 0)
                                )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(theme.displayName)
                        .accessibilityAddTraits(draft.theme == theme ? .isSelected : [])
                    }
                }
                .padding(.vertical, 6)
                .padding(.horizontal, 2)
            }
        }
    }

    private var dateSection: some View {
        Section {
            DatePicker("Quit date", selection: $draft.quitDate, in: ...Date.now)
        } header: {
            Text(editing == nil ? "When did you quit?" : "Current streak started")
        } footer: {
            Text(editing == nil
                 ? "Already clean for a while? Pick the date and Unhook counts it."
                 : "Fix the date if you set it wrong.")
        }
    }

    private var costSection: some View {
        Section {
            numberRow("Money per day", text: $draft.costText, prefix: currencySymbol, field: .cost)
            numberRow("Minutes per day", text: $draft.minutesText, prefix: nil, field: .minutes)
            HStack {
                Text("Amount per day")
                Spacer()
                TextField("0", text: $draft.unitsText)
                    .keyboardType(.decimalPad)
                    .multilineTextAlignment(.trailing)
                    .frame(maxWidth: 70)
                    .focused($focusedField, equals: .units)
                TextField("units", text: $draft.unitName)
                    .frame(maxWidth: 100)
                    .foregroundStyle(.secondary)
                    .focused($focusedField, equals: .unitName)
            }
        } header: {
            Text("What it cost you")
        } footer: {
            Text("Used to show the money, time and \(draft.unitName.isEmpty ? "units" : draft.unitName) you win back. Leave blank if it doesn't apply.")
        }
    }

    private var reasonsSection: some View {
        Section {
            ForEach(draft.reasons.indices, id: \.self) { index in
                TextField(reasonPlaceholder(index), text: $draft.reasons[index], axis: .vertical)
                    .focused($focusedField, equals: .reason(index))
            }
        } header: {
            Text("Why are you quitting?")
        } footer: {
            Text("Your reasons appear on the SOS screen when a craving hits. Make them personal.")
        }
    }

    // MARK: Helpers

    private func numberRow(_ title: String, text: Binding<String>, prefix: String?, field: Field) -> some View {
        HStack {
            Text(title)
            Spacer()
            if let prefix {
                Text(prefix)
                    .foregroundStyle(.secondary)
            }
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .frame(maxWidth: 100)
                .focused($focusedField, equals: field)
        }
    }

    private func reasonPlaceholder(_ index: Int) -> String {
        if index < draft.suggestedReasons.count {
            return "e.g. \(draft.suggestedReasons[index])"
        }
        return "Reason \(index + 1)"
    }

    private var currencySymbol: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        return formatter.currencySymbol ?? currencyCode
    }

    private func save() {
        let habit: Habit
        if let editing {
            habit = editing
        } else {
            let nextIndex = (habits.map(\.sortIndex).max() ?? -1) + 1
            habit = Habit(name: draft.trimmedName, emoji: draft.emoji, theme: draft.theme, sortIndex: nextIndex)
            context.insert(habit)
        }

        habit.name = draft.trimmedName
        habit.emoji = draft.emoji.isEmpty ? "✨" : draft.emoji
        habit.theme = draft.theme
        habit.dailyCost = HabitDraft.parse(draft.costText)
        habit.dailyMinutes = HabitDraft.parse(draft.minutesText, upTo: HabitDraft.maxDailyMinutes)
        habit.unitsPerDay = HabitDraft.parse(draft.unitsText)
        habit.unitName = draft.unitName.trimmingCharacters(in: .whitespacesAndNewlines)
        habit.reasons = draft.cleanedReasons
        habit.streakStart = min(draft.quitDate, .now)

        NotificationManager.scheduleMilestones(for: habit)
        Haptics.success()
        onSave()
    }
}

#Preview {
    NavigationStack {
        HabitFormView(draft: HabitDraft(preset: HabitPreset.all[0]), editing: nil) {}
    }
    .modelContainer(PreviewData.container)
}

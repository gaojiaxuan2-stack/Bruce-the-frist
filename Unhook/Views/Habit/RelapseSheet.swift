import SwiftUI
import SwiftData

/// Recording a slip, written to be kind: shame drives people away, compassion brings them back.
struct RelapseSheet: View {
    let habit: Habit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date.now
    @State private var note = ""
    @State private var trigger: CravingTrigger?

    private var savedProgress: TimeInterval {
        habit.stats(at: date).lifetimeClean
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    VStack(alignment: .leading, spacing: 10) {
                        Text("Slips happen. 💛")
                            .font(.title3.bold())
                        Text("A slip doesn't erase your progress. Your \(DurationFormatter.compact(savedProgress)) of clean time stays in your totals. What matters is the next hour.")
                            .foregroundStyle(.secondary)
                    }
                    .padding(.vertical, 6)
                }

                Section("When did it happen?") {
                    DatePicker("Date", selection: $date, in: min(habit.streakStart, .now)...Date.now)
                }

                Section {
                    CravingTriggerPicker(selection: $trigger, tint: habit.theme.gradient)
                        .padding(.vertical, 6)
                } header: {
                    Text("What set it off?")
                } footer: {
                    Text("Optional. Spotting your triggers is the fastest way to beat them next time.")
                }

                Section("Anything else? (optional)") {
                    TextField("Where you were, how you felt…", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                }
            }
            .navigationTitle("Reset streak")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Reset", action: reset)
                        .fontWeight(.semibold)
                }
            }
        }
    }

    private func reset() {
        habit.recordRelapse(
            at: date,
            note: note.trimmingCharacters(in: .whitespacesAndNewlines),
            trigger: trigger,
            in: context
        )
        NotificationManager.scheduleMilestones(for: habit)
        Haptics.warning()
        dismiss()
    }
}

#Preview {
    RelapseSheet(habit: PreviewData.sampleHabit)
        .previewEnvironment()
}

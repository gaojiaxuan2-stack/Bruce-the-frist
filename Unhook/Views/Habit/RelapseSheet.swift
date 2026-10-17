import SwiftUI
import SwiftData

/// Recording a slip, written to be kind: shame drives people away, compassion brings them back.
struct RelapseSheet: View {
    let habit: Habit

    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var date = Date.now
    @State private var note = ""

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
                    TextField("Stress, boredom, a party…", text: $note, axis: .vertical)
                        .lineLimit(2...4)
                } header: {
                    Text("What triggered it? (optional)")
                } footer: {
                    Text("Spotting your triggers is the fastest way to beat them next time.")
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
        habit.recordRelapse(at: date, note: note.trimmingCharacters(in: .whitespacesAndNewlines), in: context)
        NotificationManager.scheduleMilestones(for: habit)
        Haptics.warning()
        dismiss()
    }
}

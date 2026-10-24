import SwiftUI

/// Entry point for creating a habit (preset picker, then form) or editing one (form only).
struct AddHabitView: View {
    var editing: Habit? = nil

    @Environment(\.dismiss) private var dismiss
    @State private var selectedPreset: HabitPreset?

    var body: some View {
        NavigationStack {
            Group {
                if let editing {
                    HabitFormView(draft: HabitDraft(habit: editing), editing: editing) { dismiss() }
                } else {
                    PresetPickerView { preset in
                        selectedPreset = preset
                    }
                    .navigationDestination(item: $selectedPreset) { preset in
                        HabitFormView(draft: HabitDraft(preset: preset), editing: nil) { dismiss() }
                    }
                }
            }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
            }
        }
    }
}

struct PresetPickerView: View {
    let onSelect: (HabitPreset) -> Void

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 12)]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("What do you want to quit?")
                        .font(.title.bold())
                    Text("Pick one to start. You can track more habits anytime.")
                        .foregroundStyle(.secondary)
                }
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(HabitPreset.all) { preset in
                        Button {
                            Haptics.selection()
                            onSelect(preset)
                        } label: {
                            PresetTile(preset: preset)
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding()
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("New habit")
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct PresetTile: View {
    let preset: HabitPreset

    var body: some View {
        VStack(spacing: 10) {
            Text(preset.emoji)
                .font(.system(size: 36))
            Text(preset.title)
                .font(.subheadline.weight(.semibold))
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 112)
        .padding(8)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(alignment: .bottom) {
            Capsule()
                .fill(preset.theme.gradient)
                .frame(width: 28, height: 4)
                .padding(.bottom, 10)
        }
    }
}

#Preview {
    AddHabitView()
        .previewEnvironment()
}

import SwiftUI
import SwiftData

struct PledgeCard: View {
    let pledgedToday: Bool
    let streak: Int
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: pledgedToday ? "checkmark.seal.fill" : "hand.raised.fill")
                    .font(.system(size: 30))
                    .symbolEffect(.bounce, value: pledgedToday)
                VStack(alignment: .leading, spacing: 2) {
                    Text(pledgedToday ? "Pledge complete" : "Take today's pledge")
                        .font(.headline)
                    Text(subtitle)
                        .font(.subheadline)
                        .opacity(0.9)
                }
                Spacer(minLength: 0)
                if !pledgedToday {
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.bold))
                }
            }
            .foregroundStyle(.white)
            .padding(18)
            .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    private var subtitle: String {
        if pledgedToday {
            return streak > 1 ? "\(streak)-day pledge streak 🔥" : "See you tomorrow. Stay strong today."
        }
        return streak > 0 ? "Keep your \(streak)-day streak alive." : "Commit to one clean day. Just today."
    }
}

struct PledgeSheet: View {
    @Environment(\.modelContext) private var context
    @Environment(\.dismiss) private var dismiss

    @State private var mood = 3
    @State private var pledged = false

    var body: some View {
        VStack(spacing: 28) {
            VStack(spacing: 8) {
                Text("Today's pledge")
                    .font(.title2.bold())
                Text("I choose to stay free today. Not forever, just today.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
            }

            VStack(spacing: 12) {
                Text("How are you feeling?")
                    .font(.subheadline.weight(.semibold))
                HStack(spacing: 10) {
                    ForEach(1...5, id: \.self) { value in
                        moodButton(value)
                    }
                }
                .animation(.spring(response: 0.3, dampingFraction: 0.7), value: mood)
            }

            Button(action: pledge) {
                Label(
                    pledged ? "Pledged!" : "I pledge for today",
                    systemImage: pledged ? "checkmark.seal.fill" : "hand.raised.fill"
                )
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(pledged)
        }
        .padding(24)
        .presentationDragIndicator(.visible)
    }

    private func moodButton(_ value: Int) -> some View {
        let isSelected = mood == value
        return Button {
            mood = value
            Haptics.selection()
        } label: {
            Text(MoodScale.emoji(for: value))
                .font(.system(size: 34))
                .frame(width: 54, height: 54)
                .background(Circle().fill(isSelected ? Color.accentColor.opacity(0.2) : Color.clear))
                .overlay(Circle().stroke(isSelected ? Color.accentColor : Color.clear, lineWidth: 2))
                .scaleEffect(isSelected ? 1.1 : 1)
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Mood \(value) of 5")
    }

    private func pledge() {
        context.insert(Pledge(day: .now, mood: mood))
        pledged = true
        Haptics.success()
        Task {
            try? await Task.sleep(for: .milliseconds(700))
            dismiss()
        }
    }
}

#Preview {
    PledgeSheet()
        .previewEnvironment()
}

import SwiftUI

/// A compact card for the Today screen that opens the private craving coach in a sheet.
struct CoachEntryCard: View {
    /// The habit to talk about, or nil to let the coach pick the habit with the longest streak.
    let habit: Habit?

    @State private var isShowingCoach = false
    @State private var hasOnDeviceAI = false

    private var subtitle: String {
        hasOnDeviceAI
            ? String(localized: "Private on-device AI that talks you through any craving.")
            : String(localized: "A private chat that talks you through any craving.")
    }

    var body: some View {
        Button {
            Haptics.tap()
            isShowingCoach = true
        } label: {
            Card {
                HStack(spacing: 14) {
                    icon
                    VStack(alignment: .leading, spacing: 3) {
                        Text("Talk to your coach")
                            .font(.headline)
                            .foregroundStyle(.primary)
                        Text(subtitle)
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(.tertiary)
                        .accessibilityHidden(true)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens a private chat with your coach")
        .onAppear {
            hasOnDeviceAI = CoachProvider.isOnDeviceAIAvailable
        }
        .sheet(isPresented: $isShowingCoach) {
            CoachView(habit: habit)
        }
    }

    private var icon: some View {
        Image(systemName: "sparkles")
            .font(.title2)
            .foregroundStyle(.white)
            .frame(width: 48, height: 48)
            .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .accessibilityHidden(true)
    }
}

#Preview {
    CoachEntryCard(habit: nil)
        .padding()
        .frame(maxHeight: .infinity)
        .background(Color(.systemGroupedBackground))
        .previewEnvironment()
}

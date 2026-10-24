import SwiftUI

/// "Why do you want to quit?": pick from the preset's suggestions and/or write one in your own words.
struct OnboardingReasonsStep: View {
    @Binding var answers: OnboardingAnswers
    let onContinue: () -> Void

    @FocusState private var isCustomFocused: Bool

    init(answers: Binding<OnboardingAnswers>, onContinue: @escaping () -> Void) {
        _answers = answers
        self.onContinue = onContinue
    }

    private var tint: LinearGradient { answers.theme.gradient }
    private var suggestions: [String] { answers.draft.suggestedReasons }

    var body: some View {
        OnboardingStepLayout(title: Text("Why do you want to quit?"), subtitle: subtitle) {
            VStack(alignment: .leading, spacing: 10) {
                ForEach(suggestions, id: \.self) { reason in
                    reasonChip(reason)
                }
                customField
                    .padding(.top, suggestions.isEmpty ? 0 : 6)
                if !answers.canAddReason {
                    Text("That's \(OnboardingAnswers.maxReasons). Tap one to swap it out.")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.6))
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.8), value: answers.selectedReasons)
        } footer: {
            Button {
                isCustomFocused = false
                Haptics.tap()
                onContinue()
            } label: {
                Text(answers.reasons.isEmpty ? "Skip for now" : "Continue")
            }
            .buttonStyle(PrimaryButtonStyle(gradient: tint))
        }
    }

    private var subtitle: Text {
        if suggestions.isEmpty {
            return Text("In your own words. It shows up on the SOS screen when a craving hits.")
        }
        return Text("Pick up to \(OnboardingAnswers.maxReasons). They show up on the SOS screen when a craving hits.")
    }

    private func reasonChip(_ reason: String) -> some View {
        let isSelected = answers.isSelected(reason)
        let isAvailable = isSelected || answers.canAddReason
        return Button {
            toggle(reason)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: isSelected ? "checkmark.circle.fill" : "plus.circle")
                    .font(.headline)
                    .accessibilityHidden(true)
                Text(reason)
                    .font(.body.weight(.medium))
                    .multilineTextAlignment(.leading)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
            .onboardingPanel(cornerRadius: 18, isHighlighted: isSelected, tint: tint)
        }
        .buttonStyle(.plain)
        .disabled(!isAvailable)
        .opacity(isAvailable ? 1 : 0.45)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var customField: some View {
        TextField("Add your own reason (optional)", text: $answers.customReason)
            .foregroundStyle(.white)
            .submitLabel(.done)
            .focused($isCustomFocused)
            .onSubmit { isCustomFocused = false }
            .padding(16)
            .onboardingPanel(
                cornerRadius: 18,
                isHighlighted: isCustomFocused || !answers.trimmedCustomReason.isEmpty,
                tint: tint
            )
            .disabled(!answers.canEditCustomReason)
            .opacity(answers.canEditCustomReason ? 1 : 0.45)
    }

    private func toggle(_ reason: String) {
        if answers.toggleReason(reason) {
            Haptics.selection()
        } else {
            Haptics.warning()
        }
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingReasonsStep(answers: .constant(.preview)) {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

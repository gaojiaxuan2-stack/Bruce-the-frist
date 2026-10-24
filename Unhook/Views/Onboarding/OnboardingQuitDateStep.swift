import SwiftUI

/// "When did you last …?": start the streak now, or count the clean time already earned.
/// Custom habits are named here too.
struct OnboardingQuitDateStep: View {
    @Binding var answers: OnboardingAnswers
    let onContinue: () -> Void

    @FocusState private var isNameFocused: Bool

    init(answers: Binding<OnboardingAnswers>, onContinue: @escaping () -> Void) {
        _answers = answers
        self.onContinue = onContinue
    }

    private var tint: LinearGradient { answers.theme.gradient }

    var body: some View {
        OnboardingStepLayout(
            title: Text(OnboardingCopy.lastTimeQuestion(presetID: answers.draft.presetID)),
            subtitle: Text("Already been going without? Unhook counts every minute you've earned.")
        ) {
            VStack(alignment: .leading, spacing: 24) {
                if answers.isCustom {
                    nameField
                }
                timingChoices
            }
        } footer: {
            Button("Continue") {
                isNameFocused = false
                Haptics.tap()
                onContinue()
            }
            .buttonStyle(PrimaryButtonStyle(gradient: tint))
            .disabled(!answers.canLeaveQuitDateStep)
        }
    }

    private var nameField: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Name your habit")
                .font(.headline)
                .foregroundStyle(.white)
            TextField("e.g. Late-night snacking", text: $answers.draft.name)
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
                .submitLabel(.done)
                .focused($isNameFocused)
                .onSubmit { isNameFocused = false }
                .padding(16)
                .onboardingPanel(isHighlighted: isNameFocused, tint: tint)
        }
    }

    private var timingChoices: some View {
        VStack(spacing: 12) {
            OnboardingChoiceRow(
                title: Text("Just now"),
                subtitle: Text("I'm starting fresh today"),
                systemImage: "sparkles",
                isSelected: answers.timing == .justNow,
                tint: tint
            ) {
                select(.justNow)
            }
            OnboardingChoiceRow(
                title: Text("Earlier"),
                subtitle: Text("I've already been going without"),
                systemImage: "calendar",
                isSelected: answers.timing == .earlier,
                tint: tint
            ) {
                select(.earlier)
            }
            if answers.timing == .earlier {
                earlierPicker
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
    }

    private var earlierPicker: some View {
        VStack(alignment: .leading, spacing: 12) {
            DatePicker("Last time", selection: $answers.draft.quitDate, in: ...Date.now)
                .font(.headline)
            if let encouragement {
                Text(encouragement)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .padding(16)
        .onboardingPanel()
    }

    private var encouragement: String? {
        let clean = answers.cleanTime()
        guard clean >= 60 else { return nil }
        return String(localized: "That's \(DurationFormatter.compact(clean)) already. It all counts.")
    }

    private func select(_ timing: OnboardingAnswers.QuitTiming) {
        guard answers.timing != timing else { return }
        Haptics.selection()
        withAnimation(.spring(response: 0.35, dampingFraction: 0.85)) {
            answers.setTiming(timing)
        }
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingQuitDateStep(answers: .constant(.preview)) {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

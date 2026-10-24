import SwiftUI
import SwiftData

/// First-run flow: pick the habit, personalize it, see what quitting gives back, opt into reminders and
/// meet Unhook Pro. The habit is created only at the very end, so leaving midway never saves half an answer.
struct OnboardingView: View {
    let onFinish: () -> Void

    @Environment(\.modelContext) private var context
    @Environment(Store.self) private var store
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var step: OnboardingStep = .welcome
    @State private var answers = OnboardingAnswers()
    @State private var isMovingForward = true
    @State private var didFinish = false

    init(onFinish: @escaping () -> Void) {
        self.onFinish = onFinish
    }

    var body: some View {
        ZStack {
            Brand.night
                .ignoresSafeArea()

            VStack(spacing: 0) {
                if let number = step.questionNumber {
                    OnboardingTopBar(
                        questionNumber: number,
                        questionCount: OnboardingStep.questionCount,
                        tint: accentGradient,
                        onBack: { goBack() }
                    )
                    .transition(.opacity)
                }

                ZStack {
                    currentStep
                        .id(step)
                        .transition(stepTransition)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .environment(\.colorScheme, .dark)
    }

    @ViewBuilder
    private var currentStep: some View {
        switch step {
        case .welcome:
            OnboardingWelcomeStep { move(to: .habit) }
        case .habit:
            OnboardingHabitStep(selectedPresetID: answers.selectedPresetID) { preset in choose(preset) }
        case .quitDate:
            OnboardingQuitDateStep(answers: $answers) { move(to: .cost) }
        case .cost:
            OnboardingCostStep(answers: $answers) { move(to: .reasons) }
        case .reasons:
            OnboardingReasonsStep(answers: $answers) { move(to: .projection) }
        case .projection:
            OnboardingProjectionStep(answers: answers) { move(to: .reminders) }
        case .reminders:
            OnboardingRemindersStep(theme: answers.theme) { leaveReminders() }
        case .paywall:
            PaywallView(reason: .onboarding, onClose: { finish() })
        }
    }

    /// The chosen habit's colors once there is one, the brand's before that.
    private var accentGradient: LinearGradient {
        answers.hasChosenPreset ? answers.theme.gradient : Brand.gradient
    }

    /// Only the incoming screen moves (the outgoing one fades), so the direction is always read from current
    /// state and going back never slides the wrong way.
    private var stepTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .offset(x: isMovingForward ? 48 : -48).combined(with: .opacity),
            removal: .opacity
        )
    }

    // MARK: Navigation

    private func move(to target: OnboardingStep) {
        guard target != step, !didFinish else { return }
        isMovingForward = target > step
        withAnimation(.spring(response: 0.45, dampingFraction: 0.9)) {
            step = target
        }
    }

    private func goBack() {
        guard let previous = step.previous else { return }
        Haptics.tap()
        move(to: previous)
    }

    private func choose(_ preset: HabitPreset) {
        Haptics.selection()
        answers.choose(preset)
        move(to: .quitDate)
    }

    /// Members who already have Pro (restored, or Family Sharing) skip straight past the paywall.
    private func leaveReminders() {
        if store.isPro {
            finish()
        } else {
            move(to: .paywall)
        }
    }

    // MARK: Finish

    private func finish() {
        guard !didFinish else { return }
        didFinish = true

        let habit = answers.makeHabit()
        context.insert(habit)
        // Save right away: this is the user's whole setup, and autosave may not run before the app is closed.
        try? context.save()
        NotificationManager.scheduleMilestones(for: habit)
        UserDefaults.standard.set(true, forKey: AppSettings.Keys.didPromptFirstHabit)
        Haptics.success()
        onFinish()
    }
}

#Preview {
    OnboardingView {}
        .previewEnvironment()
}

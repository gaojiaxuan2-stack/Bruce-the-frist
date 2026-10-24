import SwiftUI

/// Explains the daily pledge reminder and milestone alerts before iOS asks for notification permission,
/// so the system prompt arrives with context instead of out of nowhere.
struct OnboardingRemindersStep: View {
    let theme: HabitTheme
    let onDone: () -> Void

    @State private var isRequesting = false

    init(theme: HabitTheme, onDone: @escaping () -> Void) {
        self.theme = theme
        self.onDone = onDone
    }

    var body: some View {
        OnboardingStepLayout(
            title: Text("Stay on track"),
            subtitle: Text("Gentle nudges at the moments that matter. Change them anytime in Settings.")
        ) {
            VStack(spacing: 12) {
                bell
                featureRow(
                    systemImage: "hand.raised.fill",
                    title: Text("Daily pledge"),
                    detail: Text("A reminder at \(reminderTime) to commit to one clean day. Just today.")
                )
                featureRow(
                    systemImage: "trophy.fill",
                    title: Text("Milestone alerts"),
                    detail: Text("Know the moment you hit 1 hour, 1 day, 1 week and beyond.")
                )
                featureRow(
                    systemImage: "lock.fill",
                    title: Text("Private and quiet"),
                    detail: Text("No marketing, ever. Reminders are created right on your device.")
                )
            }
        } footer: {
            Button {
                Task { await enableReminders() }
            } label: {
                if isRequesting {
                    ProgressView()
                        .tint(.white)
                } else {
                    Text("Turn on reminders")
                }
            }
            .buttonStyle(PrimaryButtonStyle(gradient: theme.gradient))
            .disabled(isRequesting)

            Button("Maybe later") {
                Haptics.tap()
                onDone()
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white.opacity(0.7))
            .padding(.vertical, 4)
            .disabled(isRequesting)
        }
    }

    private var bell: some View {
        Image(systemName: "bell.badge.fill")
            .font(.system(size: 44, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: 96, height: 96)
            .background(theme.gradient, in: Circle())
            .shadow(color: theme.accent.opacity(0.5), radius: 20)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 8)
            .accessibilityHidden(true)
    }

    private func featureRow(systemImage: String, title: Text, detail: Text) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(theme.gradient)
                .frame(width: 28)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                title
                    .font(.headline)
                    .foregroundStyle(.white)
                detail
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.7))
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .onboardingPanel()
        .accessibilityElement(children: .combine)
    }

    private var reminderTime: String {
        let date = Calendar.current.date(
            bySettingHour: AppSettings.reminderHour,
            minute: AppSettings.reminderMinute,
            second: 0,
            of: .now
        ) ?? .now
        return date.formatted(date: .omitted, time: .shortened)
    }

    private func enableReminders() async {
        guard !isRequesting else { return }
        isRequesting = true
        Haptics.tap()
        if await NotificationManager.requestAuthorization() {
            UserDefaults.standard.set(true, forKey: AppSettings.Keys.reminderEnabled)
            NotificationManager.scheduleDailyReminder(hour: AppSettings.reminderHour, minute: AppSettings.reminderMinute)
        }
        isRequesting = false
        onDone()
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingRemindersStep(theme: .grape) {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

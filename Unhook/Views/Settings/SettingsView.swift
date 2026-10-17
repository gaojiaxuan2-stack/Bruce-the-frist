import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Query private var habits: [Habit]
    @Query private var pledges: [Pledge]
    @Query private var urges: [Urge]
    @Query private var relapses: [Relapse]

    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @AppStorage(AppSettings.Keys.hapticsEnabled) private var hapticsEnabled = true
    @AppStorage(AppSettings.Keys.reminderEnabled) private var reminderEnabled = false
    @AppStorage(AppSettings.Keys.reminderHour) private var reminderHour = AppSettings.defaultReminderHour
    @AppStorage(AppSettings.Keys.reminderMinute) private var reminderMinute = AppSettings.defaultReminderMinute
    @AppStorage(AppSettings.Keys.milestoneAlertsEnabled) private var milestoneAlertsEnabled = true
    @AppStorage(AppSettings.Keys.dataResetCount) private var dataResetCount = 0

    @State private var confirmingErase = false
    @State private var notificationsDenied = false

    private static let currencies = [
        "USD", "EUR", "GBP", "CNY", "JPY", "KRW", "INR", "CAD", "AUD", "NZD",
        "CHF", "SEK", "NOK", "SGD", "HKD", "BRL", "MXN", "ZAR", "AED", "TRY",
    ]

    var body: some View {
        NavigationStack {
            Form {
                remindersSection
                preferencesSection
                supportSection
                privacySection
                dataSection
                aboutSection
            }
            .navigationTitle("Settings")
            .confirmationDialog("Erase everything?", isPresented: $confirmingErase, titleVisibility: .visible) {
                Button("Erase all data", role: .destructive, action: eraseAll)
            } message: {
                Text("All habits, streaks, pledges and history will be permanently deleted.")
            }
        }
    }

    // MARK: Sections

    private var remindersSection: some View {
        Section {
            Toggle("Daily pledge reminder", isOn: $reminderEnabled)
            if reminderEnabled {
                DatePicker("Time", selection: reminderTime, displayedComponents: .hourAndMinute)
            }
            Toggle("Milestone alerts", isOn: $milestoneAlertsEnabled)
        } header: {
            Text("Reminders")
        } footer: {
            if notificationsDenied {
                Text("Notifications are off for Unhook. Turn them on in the Settings app.")
            }
        }
        .onChange(of: reminderEnabled) { _, enabled in
            Task { await updateReminder(enabled: enabled) }
        }
        .onChange(of: milestoneAlertsEnabled) { _, enabled in
            Task { await updateMilestoneAlerts(enabled: enabled) }
        }
    }

    private var preferencesSection: some View {
        Section("Preferences") {
            Picker("Currency", selection: $currencyCode) {
                ForEach(currencyOptions, id: \.self) { code in
                    Text(currencyLabel(code)).tag(code)
                }
            }
            Toggle("Haptics", isOn: $hapticsEnabled)
        }
    }

    private var supportSection: some View {
        Section {
            Link(destination: URL(string: "https://findahelpline.com")!) {
                Label("Find a free helpline near you", systemImage: "lifepreserver.fill")
            }
            ShareLink(item: "I'm breaking my bad habits with Unhook, one day at a time. 💪") {
                Label("Tell a friend", systemImage: "heart.fill")
            }
        } header: {
            Text("Support")
        } footer: {
            Text("Unhook is a self-help tool, not a substitute for professional care. If you're struggling, please reach out to a doctor or a helpline.")
        }
    }

    private var privacySection: some View {
        Section("Privacy") {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Your data stays on your iPhone")
                        .font(.subheadline.weight(.semibold))
                    Text("No account, no tracking, no ads. Unhook never sends your habits anywhere.")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "lock.shield.fill")
                    .foregroundStyle(.green)
            }
        }
    }

    private var dataSection: some View {
        Section {
            Button("Erase all data", role: .destructive) {
                confirmingErase = true
            }
        }
    }

    private var aboutSection: some View {
        Section {
            LabeledContent("Version", value: appVersion)
        } footer: {
            Text("Made with 💜 for everyone breaking free.")
                .frame(maxWidth: .infinity)
                .padding(.top, 8)
        }
    }

    // MARK: Helpers

    private var reminderTime: Binding<Date> {
        Binding {
            Calendar.current.date(bySettingHour: reminderHour, minute: reminderMinute, second: 0, of: .now) ?? .now
        } set: { newValue in
            let components = Calendar.current.dateComponents([.hour, .minute], from: newValue)
            reminderHour = components.hour ?? AppSettings.defaultReminderHour
            reminderMinute = components.minute ?? AppSettings.defaultReminderMinute
            NotificationManager.scheduleDailyReminder(hour: reminderHour, minute: reminderMinute)
        }
    }

    private var currencyOptions: [String] {
        Self.currencies.contains(currencyCode) ? Self.currencies : [currencyCode] + Self.currencies
    }

    private func currencyLabel(_ code: String) -> String {
        let name = Locale.current.localizedString(forCurrencyCode: code) ?? code
        return "\(code) · \(name)"
    }

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "1.0"
        let build = info?["CFBundleVersion"] as? String ?? "1"
        return "\(version) (\(build))"
    }

    private func updateReminder(enabled: Bool) async {
        guard enabled else {
            NotificationManager.cancelDailyReminder()
            return
        }
        if await NotificationManager.requestAuthorization() {
            notificationsDenied = false
            NotificationManager.scheduleDailyReminder(hour: reminderHour, minute: reminderMinute)
        } else {
            notificationsDenied = true
            reminderEnabled = false
        }
    }

    private func updateMilestoneAlerts(enabled: Bool) async {
        guard enabled else {
            for habit in habits {
                NotificationManager.cancelMilestones(for: habit.uuid)
            }
            return
        }
        if await NotificationManager.requestAuthorization() {
            notificationsDenied = false
            for habit in habits {
                NotificationManager.scheduleMilestones(for: habit)
            }
        } else {
            notificationsDenied = true
            milestoneAlertsEnabled = false
        }
    }

    private func eraseAll() {
        NotificationManager.cancelAll()
        relapses.forEach { context.delete($0) }
        urges.forEach { context.delete($0) }
        pledges.forEach { context.delete($0) }
        habits.forEach { context.delete($0) }
        do {
            try context.save()
        } catch {
            assertionFailure("Failed to erase data: \(error)")
        }
        reminderEnabled = false
        dataResetCount += 1
        Haptics.warning()
    }
}

#Preview {
    SettingsView()
        .modelContainer(PreviewData.container)
}

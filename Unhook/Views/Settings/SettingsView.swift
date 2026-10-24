import StoreKit
import SwiftUI
import SwiftData

struct SettingsView: View {
    @Environment(\.modelContext) private var context
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.requestReview) private var requestReview
    @Environment(Store.self) private var store
    @Environment(AppRouter.self) private var router
    @Query private var habits: [Habit]
    @Query private var pledges: [Pledge]
    @Query private var urges: [Urge]
    @Query private var relapses: [Relapse]
    @Query private var savingsGoals: [SavingsGoal]

    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @AppStorage(AppSettings.Keys.hapticsEnabled) private var hapticsEnabled = true
    @AppStorage(AppSettings.Keys.reminderEnabled) private var reminderEnabled = false
    @AppStorage(AppSettings.Keys.reminderHour) private var reminderHour = AppSettings.defaultReminderHour
    @AppStorage(AppSettings.Keys.reminderMinute) private var reminderMinute = AppSettings.defaultReminderMinute
    @AppStorage(AppSettings.Keys.milestoneAlertsEnabled) private var milestoneAlertsEnabled = true
    @AppStorage(AppSettings.Keys.dataResetCount) private var dataResetCount = 0
    @AppStorage(AppLockSettings.enabledKey) private var appLockEnabled = false

    @State private var confirmingErase = false
    @State private var notificationsDenied = false
    @State private var isRestoring = false
    @State private var showingManageSubscriptions = false
    @State private var isEnablingAppLock = false
    /// Filled in on appear; asking LocalAuthentication on every init of this view would be wasted work.
    @State private var appLockMethod: AppLockMethod = .faceID
    @State private var canUseAppLock = true
    @State private var exportFiles: DataExportFiles?
    @State private var alert: SettingsAlert?
    @ScaledMetric(relativeTo: .title3) private var upgradeIconSize: CGFloat = 44

    /// A one-button alert: restore results, export and lock errors.
    private struct SettingsAlert {
        let title: String
        let message: String
    }

    private static let currencies = [
        "USD", "EUR", "GBP", "CNY", "JPY", "KRW", "INR", "CAD", "AUD", "NZD",
        "CHF", "SEK", "NOK", "SGD", "HKD", "BRL", "MXN", "ZAR", "AED", "TRY",
    ]

    var body: some View {
        NavigationStack {
            form
                .navigationTitle("Settings")
                .confirmationDialog("Erase everything?", isPresented: $confirmingErase, titleVisibility: .visible) {
                    Button("Erase all data", role: .destructive, action: eraseAll)
                } message: {
                    Text("All habits, streaks, pledges, savings goals and history will be permanently deleted.")
                }
                .alert(alert?.title ?? "", isPresented: isShowingAlert, presenting: alert) { _ in
                    Button("OK", role: .cancel) {}
                } message: { alert in
                    Text(alert.message)
                }
                .sheet(item: $exportFiles) { files in
                    DataExportSheet(files: files)
                }
                .manageSubscriptionsSheet(isPresented: $showingManageSubscriptions)
                .onAppear {
                    refreshAppLockAvailability()
                }
                .onChange(of: scenePhase) { _, phase in
                    // The user may have set up Face ID or a passcode in the Settings app meanwhile.
                    if phase == .active {
                        refreshAppLockAvailability()
                    }
                }
        }
    }

    private var form: some View {
        Form {
            proSection
            remindersSection
            preferencesSection
            appIconSection
            supportSection
            privacySection
            dataSection
            aboutSection
        }
    }

    // MARK: Sections

    private var proSection: some View {
        Section {
            if store.isPro {
                proActiveRow
                if hasActiveSubscription {
                    Button {
                        showingManageSubscriptions = true
                    } label: {
                        Label("Manage subscription", systemImage: "creditcard")
                    }
                }
            } else {
                upgradeRow
                restoreButton
            }
        } header: {
            Text("Unhook Pro")
        }
    }

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

    private var appIconSection: some View {
        Section {
            AppIconPicker()
        } header: {
            HStack(spacing: 6) {
                Text("App icon")
                if !store.isPro {
                    ProBadge()
                }
            }
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
            Button(action: rateApp) {
                Label("Rate Unhook", systemImage: "star.fill")
            }
        } header: {
            Text("Support")
        } footer: {
            Text("Unhook is a self-help tool, not a substitute for professional care. If you're struggling, please reach out to a doctor or a helpline.")
        }
    }

    private var privacySection: some View {
        Section {
            appLockToggle
            privacyPromise
            NavigationLink {
                PrivacyPolicyView()
            } label: {
                Label("Privacy Policy", systemImage: "hand.raised.fill")
            }
        } header: {
            Text("Privacy & security")
        } footer: {
            Text(appLockFooter)
        }
    }

    private var dataSection: some View {
        Section {
            Button(action: exportData) {
                Label("Export my data", systemImage: "square.and.arrow.up")
            }
            Button(role: .destructive) {
                confirmingErase = true
            } label: {
                Label("Erase all data", systemImage: "trash")
            }
        } header: {
            Text("Your data")
        } footer: {
            Text("Export a copy of everything you've tracked as a file you can save or share. Erasing deletes it all from this device.")
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

    // MARK: Rows

    private var proActiveRow: some View {
        LabeledContent {
            Text("Active")
                .foregroundStyle(.green)
        } label: {
            Label {
                Text("Unhook Pro")
            } icon: {
                Image(systemName: "crown.fill")
                    .foregroundStyle(Brand.gradient)
            }
        }
    }

    private var upgradeRow: some View {
        Button {
            Haptics.tap()
            router.showPaywall(.settings)
        } label: {
            HStack(spacing: 14) {
                Image(systemName: "crown.fill")
                    .font(.title3)
                    .foregroundStyle(.white)
                    .frame(width: upgradeIconSize, height: upgradeIconSize)
                    .background(Brand.gradient, in: RoundedRectangle(cornerRadius: upgradeIconSize * 0.27, style: .continuous))
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Upgrade to Pro")
                        .font(.headline)
                        .foregroundStyle(.primary)
                    Text("Unlimited habits and goals, deeper insights and new app icons.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer(minLength: 8)
                Image(systemName: "chevron.right")
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(.tertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 6)
        }
    }

    private var restoreButton: some View {
        Button {
            Task { await restorePurchases() }
        } label: {
            HStack {
                Label("Restore purchases", systemImage: "arrow.clockwise")
                Spacer()
                if isRestoring {
                    ProgressView()
                }
            }
        }
        .disabled(isRestoring || store.isPurchasing)
    }

    private var appLockToggle: some View {
        Toggle(isOn: appLockBinding) {
            Label("Lock with \(appLockMethod.kindName)", systemImage: appLockMethod.systemImage)
        }
        // Stays switchable while on, so the lock can always be turned off.
        .disabled(isEnablingAppLock || (!canUseAppLock && !appLockEnabled))
    }

    private var privacyPromise: some View {
        Label {
            VStack(alignment: .leading, spacing: 4) {
                Text("Your data stays on your device")
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

    /// Shows the lock as on while it's being confirmed, and only turns it on once the owner authenticates.
    private var appLockBinding: Binding<Bool> {
        Binding {
            appLockEnabled || isEnablingAppLock
        } set: { isOn in
            if isOn {
                guard !appLockEnabled, !isEnablingAppLock else { return }
                // Set before the prompt so the switch doesn't flick back off while it appears.
                isEnablingAppLock = true
                Task { await confirmAndEnableAppLock() }
            } else {
                appLockEnabled = false
            }
        }
    }

    private var isShowingAlert: Binding<Bool> {
        Binding {
            alert != nil
        } set: { isPresented in
            if !isPresented {
                alert = nil
            }
        }
    }

    private var appLockFooter: String {
        if !canUseAppLock && !appLockEnabled {
            return String(localized: "To lock Unhook, set up a passcode in the Settings app first.")
        }
        return String(localized: "Unhook asks for \(appLockMethod.inlineName) each time you come back, and hides your progress in the app switcher.")
    }

    private var hasActiveSubscription: Bool {
        store.purchasedProductIDs.contains(Store.ProductID.yearly)
            || store.purchasedProductIDs.contains(Store.ProductID.monthly)
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

    private func refreshAppLockAvailability() {
        appLockMethod = AppLockSettings.currentMethod()
        canUseAppLock = AppLockSettings.canAuthenticate()
    }

    // MARK: Actions

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

    private func restorePurchases() async {
        guard !isRestoring else { return }
        Haptics.tap()
        isRestoring = true
        // Only report errors from this restore, not an older one (a failed product load at launch, say).
        store.lastErrorMessage = nil
        await store.restorePurchases()
        isRestoring = false

        if store.isPro {
            Haptics.success()
            alert = SettingsAlert(
                title: String(localized: "Purchases restored"),
                message: String(localized: "Unhook Pro is active. Thank you for supporting Unhook! 💜")
            )
        } else if let message = store.lastErrorMessage {
            store.lastErrorMessage = nil
            alert = SettingsAlert(title: String(localized: "Couldn't restore purchases"), message: message)
        } else {
            alert = SettingsAlert(
                title: String(localized: "No purchases found"),
                message: String(localized: "We couldn't find an earlier Unhook Pro purchase for this Apple ID. Purchases are restored for the Apple ID you're signed in with.")
            )
        }
    }

    private func confirmAndEnableAppLock() async {
        let result = await AppLockSettings.authenticate(
            reason: String(localized: "Confirm it's you to turn on the app lock.")
        )
        isEnablingAppLock = false

        switch result {
        case .success:
            appLockEnabled = true
            Haptics.success()
        case .cancelled:
            break
        case .passcodeNotSet:
            canUseAppLock = false
            alert = SettingsAlert(
                title: String(localized: "Set up a passcode first"),
                message: String(localized: "To lock Unhook, turn on a passcode in the Settings app, then try again.")
            )
        case .failed(let message):
            alert = SettingsAlert(title: String(localized: "Couldn't turn on the lock"), message: message)
        }
    }

    private func exportData() {
        Haptics.tap()
        do {
            let json = try DataExporter.writeExportFile(context: context)
            // The spreadsheet copy is a bonus; the JSON alone is a complete export.
            let csv = try? DataExporter.writeCSVFile(context: context)
            exportFiles = DataExportFiles(json: json, csv: csv)
        } catch {
            alert = SettingsAlert(title: String(localized: "Couldn't export your data"), message: error.localizedDescription)
        }
    }

    private func rateApp() {
        // A manual request uses up one of the system's few prompts, so hold off on the automatic one.
        ReviewPrompter.standard.markRequested()
        requestReview()
    }

    private func eraseAll() {
        NotificationManager.cancelAll()
        relapses.forEach { context.delete($0) }
        urges.forEach { context.delete($0) }
        pledges.forEach { context.delete($0) }
        habits.forEach { context.delete($0) }
        savingsGoals.forEach { context.delete($0) }
        do {
            try context.save()
        } catch {
            assertionFailure("Failed to erase data: \(error)")
        }
        // An earlier export would still hold everything that was just erased.
        DataExporter.removeExportFiles()
        exportFiles = nil
        reminderEnabled = false
        dataResetCount += 1
        Haptics.warning()
    }
}

#Preview {
    SettingsView()
        .previewEnvironment()
}

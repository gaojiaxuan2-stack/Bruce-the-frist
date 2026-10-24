import SwiftUI

/// Unhook's privacy policy in plain words. Push it inside a `NavigationStack`, or present
/// `PrivacyPolicySheet` when there isn't one.
///
/// Keep it in step with the hosted policy (AppStore/PRIVACY_POLICY.md) and the App Privacy answers.
struct PrivacyPolicyView: View {
    private static let applePrivacyURL = URL(string: "https://www.apple.com/legal/privacy/")!

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                summary
                dataSection
                accountsSection
                trackingSection
                purchasesSection
                deviceFeaturesSection
                deletingSection
                changesSection
                contactSection
                Text("Last updated October 2026")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 4)
            }
            .padding(20)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Privacy Policy")
        .navigationBarTitleDisplayMode(.inline)
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 10) {
            Image(systemName: "lock.shield.fill")
                .font(.largeTitle)
                .foregroundStyle(Brand.gradient)
                .accessibilityHidden(true)
            Text("Your privacy, in plain words")
                .font(.title2.bold())
                .accessibilityAddTraits(.isHeader)
            Text("Unhook was built so you can work on personal habits without sharing them with anyone, including us. We don't collect, store or sell your personal data.")
                .foregroundStyle(.secondary)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(.bottom, 4)
    }

    private var dataSection: some View {
        Card(title: String(localized: "Your data stays on your device"), systemImage: "iphone", tint: .green) {
            Text("Everything you enter (habits, quit dates, costs, reasons, slips, cravings, notes, moods and savings goals) is stored only on your device. It's never uploaded to us, and we can't see it. If you share your progress or export your data, you choose where it goes. Device backups you make, such as iCloud Backup, follow your Apple settings.")
                .policyBody()
        }
    }

    private var accountsSection: some View {
        Card(title: String(localized: "No accounts"), systemImage: "person.crop.circle.badge.xmark", tint: .blue) {
            Text("You never sign up or sign in. There's no Unhook account and no server holding your information.")
                .policyBody()
        }
    }

    private var trackingSection: some View {
        Card(title: String(localized: "No tracking, ads or analytics"), systemImage: "eye.slash.fill", tint: .purple) {
            Text("Unhook has no advertising, no analytics and no third-party tracking code. We never sell or share your data. Insights and suggestions are worked out on your device, and so are the coach's replies: what you tell the coach isn't sent to us or to any AI service, and the conversation isn't saved after you close it.")
                .policyBody()
        }
    }

    private var purchasesSection: some View {
        Card(title: String(localized: "Purchases are handled by Apple"), systemImage: "creditcard.fill", tint: .orange) {
            VStack(alignment: .leading, spacing: 10) {
                Text("Unhook Pro is sold through the App Store, and Apple processes your payment. We only learn what Apple tells every developer, for example that a subscription is active. We never receive your name, email address or payment details.")
                    .policyBody()
                Link("Apple's privacy policy", destination: Self.applePrivacyURL)
                    .font(.subheadline.weight(.semibold))
            }
        }
    }

    private var deviceFeaturesSection: some View {
        Card(title: String(localized: "Reminders and app lock"), systemImage: "bell.badge.fill", tint: .pink) {
            Text("Reminders and milestone alerts are scheduled on your device, with no notification server. If you lock the app with Face ID, Touch ID or your passcode, your device only tells Unhook whether unlocking succeeded. Unhook never receives your face or fingerprint data.")
                .policyBody()
        }
    }

    private var deletingSection: some View {
        Card(title: String(localized: "Deleting your data"), systemImage: "trash.fill", tint: .red) {
            Text("Use Erase all data in Unhook's Settings, or delete the app, to remove everything from your device.")
                .policyBody()
        }
    }

    private var changesSection: some View {
        Card(title: String(localized: "If anything changes"), systemImage: "arrow.triangle.2.circlepath", tint: .teal) {
            Text("If we ever change how Unhook handles data, we'll update this policy and explain the change in the release notes before it takes effect.")
                .policyBody()
        }
    }

    private var contactSection: some View {
        Card(title: String(localized: "Questions?"), systemImage: "envelope.fill", tint: .indigo) {
            Text("Reach us through the support link on Unhook's App Store page. We're happy to help.")
                .policyBody()
        }
    }
}

/// `PrivacyPolicyView` in its own navigation stack with a Done button, for presenting as a sheet.
struct PrivacyPolicySheet: View {
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            PrivacyPolicyView()
                .toolbar {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Done") { dismiss() }
                    }
                }
        }
    }
}

private extension View {
    /// Body text inside a policy card.
    func policyBody() -> some View {
        font(.subheadline)
            .foregroundStyle(.secondary)
            .fixedSize(horizontal: false, vertical: true)
    }
}

#Preview {
    PrivacyPolicySheet()
        .previewEnvironment()
}

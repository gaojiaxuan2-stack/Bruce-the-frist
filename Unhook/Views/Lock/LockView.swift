import SwiftUI
import UIKit

/// Full-screen lock shown while Face ID (or the passcode) protects Unhook.
struct LockView: View {
    let isAuthenticating: Bool
    let errorMessage: String?
    let onUnlock: () -> Void

    @State private var method = AppLockSettings.currentMethod()

    private static let helplineURL = URL(string: "https://findahelpline.com")!

    init(isAuthenticating: Bool = false, errorMessage: String? = nil, onUnlock: @escaping () -> Void) {
        self.isAuthenticating = isAuthenticating
        self.errorMessage = errorMessage
        self.onUnlock = onUnlock
    }

    var body: some View {
        ZStack {
            Brand.night
                .ignoresSafeArea()

            VStack(spacing: 0) {
                Spacer(minLength: 24)
                AppLockIcon()
                header
                    .padding(.top, 28)
                Spacer(minLength: 24)
                footer
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 12)
            .frame(maxWidth: 480)
        }
        .environment(\.colorScheme, .dark)
        .animation(.easeInOut(duration: 0.2), value: errorMessage)
        .animation(.easeInOut(duration: 0.2), value: isAuthenticating)
    }

    private var header: some View {
        VStack(spacing: 10) {
            Text("Unhook is locked")
                .font(.title2.bold())
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Text("Your progress stays private. Unlock with \(method.inlineName) to continue.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var footer: some View {
        VStack(spacing: 16) {
            if let errorMessage {
                Text(errorMessage)
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.8))
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                    .transition(.opacity)
            }

            Button(action: onUnlock) {
                ZStack {
                    Label("Unlock", systemImage: method.systemImage)
                        .opacity(isAuthenticating ? 0 : 1)
                    if isAuthenticating {
                        ProgressView()
                            .tint(.white)
                    }
                }
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(isAuthenticating)

            // Crisis help never sits behind the lock: it reveals nothing about the user's data.
            Link(destination: Self.helplineURL) {
                Label("Need help right now? Find a helpline", systemImage: "lifepreserver.fill")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
    }
}

/// Covers the app while it's in the app switcher or briefly inactive, so its snapshot never shows the user's data.
struct PrivacyShieldView: View {
    var body: some View {
        ZStack {
            Brand.night
                .ignoresSafeArea()
            AppLockIcon()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Unhook")
    }
}

/// What covers the app while the lock is on: the lock screen when locked, otherwise the privacy shield.
struct AppLockCover: View {
    let lock: AppLock

    var body: some View {
        if lock.isLocked {
            LockView(isAuthenticating: lock.isAuthenticating, errorMessage: lock.errorMessage) {
                Task { await lock.unlock() }
            }
        } else {
            PrivacyShieldView()
        }
    }
}

/// The app's current home-screen icon, glowing softly.
struct AppLockIcon: View {
    @ScaledMetric(relativeTo: .largeTitle) private var scaledSize: CGFloat = 88

    private var size: CGFloat { min(scaledSize, 140) }

    var body: some View {
        Image(AppIconOption(alternateIconName: UIApplication.shared.alternateIconName).previewImageName)
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .shadow(color: Brand.colors[0].opacity(0.5), radius: 24, y: 8)
            .accessibilityHidden(true)
    }
}

#Preview("Locked") {
    LockView {}
        .previewEnvironment()
}

#Preview("Failed") {
    LockView(errorMessage: "Unhook couldn't confirm it's you. Please try again.") {}
        .previewEnvironment()
}

#Preview("Shield") {
    PrivacyShieldView()
        .previewEnvironment()
}

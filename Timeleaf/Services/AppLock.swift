import Foundation
import LocalAuthentication
import Observation

/// Privacy lock: when the "appLock" setting is on, the vault hides behind Face ID / Touch ID /
/// passcode whenever the app returns from the background.
@MainActor
@Observable
final class AppLock {
    private(set) var isLocked: Bool
    private(set) var isAuthenticating: Bool = false

    /// After a cancelled or failed attempt the scene briefly becomes active again; this keeps
    /// that bounce from immediately re-presenting the system prompt in a loop.
    @ObservationIgnored private var retryNotBefore: Date = .distantPast

    init() {
        isLocked = UserDefaults.standard.bool(forKey: SettingsKey.appLock)
    }

    private var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: SettingsKey.appLock)
    }

    /// Locks if the setting is on. Call when the app moves to the background.
    func lockIfNeeded() {
        guard isEnabled else { return }
        isLocked = true
    }

    /// Asks for Face ID / Touch ID / passcode. Unlocks immediately when the setting is off.
    /// On failure or cancellation the app stays locked; calling again retries.
    func unlock() async {
        guard isEnabled else {
            isLocked = false
            return
        }
        guard isLocked, !isAuthenticating, Date.now >= retryNotBefore else { return }

        let context = LAContext()
        context.localizedCancelTitle = String(localized: "Not now")
        var availabilityError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
            // Without a device passcode there is nothing to authenticate against.
            // Never lock someone out of their own letters.
            isLocked = false
            return
        }

        isAuthenticating = true
        defer { isAuthenticating = false }

        do {
            let success = try await context.evaluatePolicy(
                .deviceOwnerAuthentication,
                localizedReason: String(localized: "Unlock Timeleaf to read your letters.")
            )
            if success {
                isLocked = false
            } else {
                retryNotBefore = Date.now.addingTimeInterval(1)
            }
        } catch {
            retryNotBefore = Date.now.addingTimeInterval(1)
        }
    }

    /// "Face ID" / "Touch ID" / "Optic ID" / "Passcode".
    nonisolated static var biometryLabel: String {
        switch availableBiometry() {
        case .faceID: return String(localized: "Face ID")
        case .touchID: return String(localized: "Touch ID")
        case .opticID: return String(localized: "Optic ID")
        default: return String(localized: "Passcode")
        }
    }

    /// SF Symbol name: "faceid" / "touchid" / "opticid" / "lock".
    nonisolated static var biometrySymbol: String {
        switch availableBiometry() {
        case .faceID: return "faceid"
        case .touchID: return "touchid"
        case .opticID: return "opticid"
        default: return "lock"
        }
    }

    private nonisolated static func availableBiometry() -> LABiometryType {
        let context = LAContext()
        var error: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return LABiometryType.none
        }
        return context.biometryType
    }
}

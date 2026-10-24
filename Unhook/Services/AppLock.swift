import LocalAuthentication
import Observation
import SwiftUI

/// How the device confirms its owner when Unhook is locked.
enum AppLockMethod: Equatable {
    case faceID, touchID, opticID, passcode

    /// "Face ID", "Touch ID", "Optic ID" or "Passcode", for labels like "Lock with Face ID".
    var kindName: String {
        switch self {
        case .faceID: "Face ID"
        case .touchID: "Touch ID"
        case .opticID: "Optic ID"
        case .passcode: String(localized: "Passcode")
        }
    }

    /// The method as it reads mid-sentence: "Face ID", or "your passcode".
    var inlineName: String {
        switch self {
        case .faceID, .touchID, .opticID: kindName
        case .passcode: String(localized: "your passcode")
        }
    }

    var systemImage: String {
        switch self {
        case .faceID: "faceid"
        case .touchID: "touchid"
        case .opticID: "opticid"
        case .passcode: "lock.open.fill"
        }
    }
}

/// The outcome of asking the device owner to authenticate.
enum AppLockAuthResult: Equatable {
    case success
    /// The user (or the system, for example when the app went to the background) cancelled the prompt.
    case cancelled
    /// The device has no passcode, so there's nothing to authenticate with.
    case passcodeNotSet
    /// Anything else, with a friendly message to show.
    case failed(String)
}

/// The optional Face ID / Touch ID / passcode lock setting, plus the LocalAuthentication calls behind it.
enum AppLockSettings {
    /// UserDefaults key for the "Lock with Face ID" setting. Read it with `@AppStorage(AppLockSettings.enabledKey)`.
    static let enabledKey = "appLock.enabled"

    static var isEnabled: Bool {
        UserDefaults.standard.bool(forKey: enabledKey)
    }

    /// Whether Face ID, Touch ID or Optic ID is set up and usable, and what to call the unlock method
    /// ("Face ID", "Touch ID", or "Passcode" when only the device passcode is available).
    static func canUseBiometrics() -> (available: Bool, kindName: String) {
        let method = currentMethod()
        return (method != .passcode, method.kindName)
    }

    /// The unlock method the system will offer first.
    static func currentMethod() -> AppLockMethod {
        let context = LAContext()
        var error: NSError?
        // `biometryType` is only filled in after `canEvaluatePolicy` runs.
        guard context.canEvaluatePolicy(.deviceOwnerAuthenticationWithBiometrics, error: &error) else {
            return .passcode
        }
        switch context.biometryType {
        case .faceID: return .faceID
        case .touchID: return .touchID
        case .opticID: return .opticID
        default: return .passcode
        }
    }

    /// Whether the device can confirm its owner at all (biometrics or passcode). False when no passcode is set,
    /// in which case the lock can't be turned on.
    static func canAuthenticate() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    /// Asks the device owner to authenticate with Face ID, Touch ID or, as a fallback, the device passcode.
    /// Resumes on the main actor.
    @MainActor
    static func authenticate(reason: String) async -> AppLockAuthResult {
        let context = LAContext()
        var availabilityError: NSError?
        guard context.canEvaluatePolicy(.deviceOwnerAuthentication, error: &availabilityError) else {
            if let availabilityError {
                return result(for: availabilityError)
            }
            return .failed(failureMessage)
        }
        do {
            let didAuthenticate = try await context.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason)
            return didAuthenticate ? .success : .failed(failureMessage)
        } catch {
            return result(for: error)
        }
    }

    private static var failureMessage: String {
        String(localized: "Unhook couldn't confirm it's you. Please try again.")
    }

    private static func result(for error: Error) -> AppLockAuthResult {
        guard let authError = error as? LAError else { return .failed(failureMessage) }
        switch authError.code {
        case .userCancel, .appCancel, .systemCancel:
            return .cancelled
        case .passcodeNotSet:
            return .passcodeNotSet
        default:
            return .failed(failureMessage)
        }
    }
}

/// Whether Unhook is currently locked. Shared by every window so unlocking once unlocks the app.
///
/// `AppLockContainer` drives it from the scene phase: `lock()` when the app goes to the background,
/// `promptIfNeeded()` when it becomes active again.
@MainActor
@Observable
final class AppLock {
    static let shared = AppLock(isLocked: AppLockSettings.isEnabled)

    /// True from the moment the app goes to the background until the owner authenticates again.
    private(set) var isLocked: Bool
    private(set) var isAuthenticating = false
    /// Why the last unlock attempt failed, shown on the lock screen. Nil after a cancel.
    private(set) var errorMessage: String?

    /// Set once the automatic prompt has run since the app was last locked, so a cancelled prompt doesn't
    /// immediately reappear (the prompt itself makes the app inactive, then active again).
    @ObservationIgnored private var hasAutoPrompted = false
    /// Bumped on every `lock()`, so an authentication that finishes after the app was locked again is ignored.
    @ObservationIgnored private var lockGeneration = 0

    init(isLocked: Bool) {
        self.isLocked = isLocked
    }

    /// Locks the app if the setting is on.
    func lock() {
        guard AppLockSettings.isEnabled else { return }
        isLocked = true
        errorMessage = nil
        hasAutoPrompted = false
        lockGeneration += 1
    }

    /// Shows the system prompt once after the app becomes active while locked.
    func promptIfNeeded() {
        guard isLocked, !hasAutoPrompted, !isAuthenticating else { return }
        hasAutoPrompted = true
        Task { await unlock() }
    }

    /// Asks the owner to authenticate and unlocks on success.
    func unlock() async {
        guard isLocked, !isAuthenticating else { return }
        guard AppLockSettings.isEnabled else {
            reset()
            return
        }
        isAuthenticating = true
        errorMessage = nil
        let generation = lockGeneration
        let result = await AppLockSettings.authenticate(reason: String(localized: "Unlock Unhook to see your progress."))
        isAuthenticating = false
        guard generation == lockGeneration else { return }

        switch result {
        case .success:
            withAnimation(.easeOut(duration: 0.25)) {
                isLocked = false
            }
        case .cancelled:
            break
        case .passcodeNotSet:
            // Without a passcode the device can't confirm anyone, so the lock can't do its job. Rather than
            // shutting the owner out of their own data, let them in and switch the setting off.
            UserDefaults.standard.set(false, forKey: AppLockSettings.enabledKey)
            reset()
        case .failed(let message):
            errorMessage = message
        }
    }

    /// Clears the lock, for example when the setting is turned off.
    func reset() {
        isLocked = false
        errorMessage = nil
        hasAutoPrompted = false
    }
}

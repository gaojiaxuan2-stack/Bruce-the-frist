import UIKit

/// Quiet, purposeful haptics. Every call is a no-op when the user turned haptics off
/// (`SettingsKey.haptics`, default on). Safe to call from any thread; feedback is always
/// produced on the main thread.
enum Haptics {
    /// A light, crisp acknowledgement for ordinary taps and selections.
    static func tap() {
        perform { HapticsEngine.light.impactOccurred(intensity: 0.85) }
    }

    /// A cushioned touch — for gentle moments (a page settling, a card landing).
    static func soft() {
        perform { HapticsEngine.soft.impactOccurred() }
    }

    /// A firm, precise click — for decisive actions such as pressing the seal.
    static func rigid() {
        perform { HapticsEngine.rigid.impactOccurred() }
    }

    /// The system success pattern — for sealing and opening a letter.
    static func success() {
        perform { HapticsEngine.notification.notificationOccurred(.success) }
    }

    /// The system warning pattern — e.g. "Not yet" on a sealed envelope.
    static func warning() {
        perform { HapticsEngine.notification.notificationOccurred(.warning) }
    }

    /// Two soft pulses, like a heartbeat.
    static func heartbeat() {
        perform {
            HapticsEngine.soft.impactOccurred(intensity: 1)
            HapticsEngine.soft.prepare()
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.14) {
                MainActor.assumeIsolated {
                    HapticsEngine.soft.impactOccurred(intensity: 0.65)
                }
            }
        }
    }

    /// A rigid impact whose strength follows `value` (clamped to 0...1) — for rising tension,
    /// e.g. while the seal is being pressed and held.
    static func intensity(_ value: Double) {
        let clamped = min(max(value, 0), 1)
        guard clamped > 0 else { return }
        perform {
            HapticsEngine.rigid.impactOccurred(intensity: CGFloat(clamped))
            HapticsEngine.rigid.prepare()
        }
    }

    // MARK: Private

    private static var isEnabled: Bool {
        UserDefaults.standard.object(forKey: SettingsKey.haptics) as? Bool ?? true
    }

    private static func perform(_ feedback: @escaping @MainActor @Sendable () -> Void) {
        guard isEnabled else { return }
        if Thread.isMainThread {
            MainActor.assumeIsolated {
                feedback()
            }
        } else {
            Task { @MainActor in
                feedback()
            }
        }
    }
}

/// Reused generators keep the Taptic Engine warm and the response immediate.
@MainActor
private enum HapticsEngine {
    static let light = UIImpactFeedbackGenerator(style: .light)
    static let soft = UIImpactFeedbackGenerator(style: .soft)
    static let rigid = UIImpactFeedbackGenerator(style: .rigid)
    static let notification = UINotificationFeedbackGenerator()
}

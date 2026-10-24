import Foundation
#if canImport(FoundationModels)
import FoundationModels
#endif

/// Something that can talk the user through a craving. Everything runs on the device.
@MainActor
protocol CravingCoach {
    /// True when replies come from Apple's on-device language model rather than the built-in script.
    var usesOnDeviceModel: Bool { get }

    /// Optional warm-up before the first message (for example, loading the model). The default does nothing.
    func prepare(context: CoachContext, history: [CoachMessage])

    /// The coach's answer to `message`. `history` is the conversation *before* `message`, oldest first.
    func reply(to message: String, history: [CoachMessage], context: CoachContext) async -> String
}

extension CravingCoach {
    var usesOnDeviceModel: Bool { false }

    func prepare(context: CoachContext, history: [CoachMessage]) {}
}

/// Picks the best coach this device can run.
enum CoachProvider {
    /// Apple's on-device model on iOS 26+ when Apple Intelligence is ready, otherwise the scripted coach.
    @MainActor static func makeCoach() -> any CravingCoach {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *), isOnDeviceAIAvailable {
            return OnDeviceCoach()
        }
        #endif
        return ScriptedCoach()
    }

    /// Whether Apple's on-device language model can be used right now.
    static var isOnDeviceAIAvailable: Bool {
        #if canImport(FoundationModels)
        if #available(iOS 26.0, *) {
            return SystemLanguageModel.default.isAvailable
        }
        #endif
        return false
    }
}

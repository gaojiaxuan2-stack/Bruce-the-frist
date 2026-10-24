#if canImport(FoundationModels)
import Foundation
import FoundationModels

/// The craving coach powered by Apple's on-device language model (Apple Intelligence). Nothing leaves the device.
/// Keeps one model session per conversation; any model error falls back to the scripted coach for that reply.
@available(iOS 26.0, *)
@MainActor
final class OnDeviceCoach: CravingCoach {
    private let fallback = ScriptedCoach()
    private var session: LanguageModelSession?

    init() {}

    var usesOnDeviceModel: Bool { true }

    func prepare(context: CoachContext, history: [CoachMessage]) {
        guard session == nil else { return }
        let newSession = makeSession(context: context, history: history)
        session = newSession
        newSession.prewarm()
    }

    func reply(to message: String, history: [CoachMessage], context: CoachContext) async -> String {
        // Never let a model improvise around a crisis: the fixed reply points to real help.
        if CoachSafety.isCrisis(message) {
            return CoachSafety.crisisReply
        }

        let activeSession = session ?? makeSession(context: context, history: history)
        session = activeSession
        guard !activeSession.isResponding else {
            return fallback.response(to: message, history: history, context: context)
        }

        do {
            let response = try await activeSession.respond(to: message)
            let text = Self.clean(response.content)
            return text.isEmpty ? fallback.response(to: message, history: history, context: context) : text
        } catch {
            // Guardrail violation, full context window, model unavailable… Start a fresh session (seeded with a
            // recap of the conversation) next time, and answer this message with the scripted coach.
            session = nil
            return fallback.response(to: message, history: history, context: context)
        }
    }

    private func makeSession(context: CoachContext, history: [CoachMessage]) -> LanguageModelSession {
        let instructions: String = CoachPrompt.instructions(context: context, history: history)
        return LanguageModelSession(instructions: instructions)
    }

    /// Trims whitespace and strips markdown emphasis the model sometimes adds.
    private static func clean(_ text: String) -> String {
        text.replacingOccurrences(of: "**", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}
#endif

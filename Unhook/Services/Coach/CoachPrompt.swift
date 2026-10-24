import Foundation

/// Builds the instructions for the on-device language model. Pure, so it compiles and is tested on every
/// toolchain even where Apple's Foundation Models framework isn't available.
/// The text is a prompt for the model, not UI, so it is deliberately not localized; the model is told to
/// answer in the user's language.
enum CoachPrompt {
    /// How many earlier messages are replayed when a session has to be (re)started mid-conversation.
    static let maxRecapMessages = 6
    static let maxRecapCharacters = 280
    static let maxReasons = 5
    static let maxReasonCharacters = 120

    static let persona = """
    You are the Unhook coach: a warm, upbeat companion inside a private iPhone app that helps people quit a habit. \
    You talk the user through cravings in the moment.

    How to reply:
    - Answer in 2 to 4 short sentences, in the language the user writes in.
    - Be kind and calm. Never shame or lecture. Celebrate wins. Treat slips as something to learn from, not a failure.
    - Always end with one concrete thing they can do in the next few minutes, such as urge surfing (watching the \
    craving rise and fall without acting on it), waiting 10 minutes before deciding, a short walk, cold water, slow \
    breathing, texting a friend, or a HALT check (hungry, angry, lonely, tired).
    - Use the facts below when they help: the habit, the streak, their own reasons and their usual trigger. \
    Never invent facts about the user.
    - Plain text only: no lists, headings or markdown.

    Safety rules:
    - You are not a doctor or therapist. Never give medical advice, never diagnose, and never suggest, change or dose \
    medication. For withdrawal symptoms or health questions, suggest talking to a doctor or pharmacist.
    - If the user mentions self-harm, suicide, wanting to die, or being in immediate danger, reply ONLY with a short \
    caring message telling them to contact their local emergency number or a crisis line right now, and that \
    findahelpline.com lists free helplines. Say nothing else in that reply.
    """

    static func instructions(context: CoachContext, history: [CoachMessage]) -> String {
        var lines = [persona, "", "Facts about the user:"]
        lines.append(contentsOf: facts(for: context))

        let recapLines = recap(of: history)
        if !recapLines.isEmpty {
            lines.append("")
            lines.append("Conversation so far (continue it naturally and don't repeat yourself):")
            lines.append(contentsOf: recapLines)
        }
        return lines.joined(separator: "\n")
    }

    static func facts(for context: CoachContext) -> [String] {
        var lines: [String] = []
        if let name = context.habitName {
            lines.append("- They are quitting: \(name) \(context.habitEmoji)")
            lines.append("- Current streak: \(context.streakText)")
        } else {
            lines.append("- They haven't added the habit they're quitting to the app yet.")
        }

        let quotedReasons: [String] = context.reasons.prefix(maxReasons).map { reason in
            "“" + truncated(reason, to: maxReasonCharacters) + "”"
        }
        if !quotedReasons.isEmpty {
            lines.append("- Their own reasons for quitting: " + quotedReasons.joined(separator: "; "))
        }
        if let trigger = context.topTrigger {
            lines.append("- Their most common craving trigger: \(trigger.title)")
        }
        if context.cravingsBeaten > 0 {
            lines.append("- Cravings they have beaten so far: \(context.cravingsBeaten)")
        }
        if let saved = context.moneySavedText {
            lines.append("- Money saved so far: \(saved)")
        }
        return lines
    }

    /// The last few messages as "User: …" / "Coach: …" lines.
    static func recap(of history: [CoachMessage]) -> [String] {
        history.suffix(maxRecapMessages).map { message in
            let speaker = message.role == .user ? "User" : "Coach"
            let text = message.text.replacingOccurrences(of: "\n", with: " ")
            return "\(speaker): \(truncated(text, to: maxRecapCharacters))"
        }
    }

    static func truncated(_ text: String, to limit: Int) -> String {
        guard text.count > limit else { return text }
        return String(text.prefix(max(limit, 0))) + "…"
    }
}

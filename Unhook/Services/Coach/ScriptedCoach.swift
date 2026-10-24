import Foundation

/// One coach answer: a warm opener plus one concrete thing to do right now.
struct CoachReply: Equatable, Sendable {
    let intent: CoachIntent
    let opener: String
    let action: String

    var text: String {
        action.isEmpty ? opener : "\(opener) \(action)"
    }
}

/// The coach that works on every device: warm, evidence-informed replies (urge surfing, delay-distract-decide,
/// HALT check, the user's own reasons and streak) chosen by keyword intent. Pure and deterministic.
struct ScriptedCoach {
    init() {}

    /// Suggested first messages, shown as chips while the conversation is short.
    static let quickReplies: [String] = [
        String(localized: "I'm craving right now"),
        String(localized: "I'm stressed"),
        String(localized: "I'm bored"),
        String(localized: "I'm at a party"),
        String(localized: "I slipped"),
        String(localized: "I did it! 💪"),
    ]

    /// The coach's first message, personalized with the user's streak.
    static func openingMessage(for context: CoachContext) -> String {
        guard let name = context.habitName else {
            return String(localized: "Hey, I'm your Unhook coach. Whatever you're feeling right now, we can talk it through together. What's going on?")
        }
        if context.currentStreak >= 86_400 {
            return String(localized: "Hey — \(context.streakText) free from \(name). That's huge. What's going on right now?")
        }
        if context.currentStreak >= 3_600 {
            return String(localized: "Hey — \(context.streakText) free from \(name) already, and every hour counts. What's going on right now?")
        }
        return String(localized: "Hey — every minute free from \(name) counts, and you've already started. What's going on right now?")
    }

    func response(to message: String, history: [CoachMessage], context: CoachContext) -> String {
        plan(for: message, history: history, context: context).text
    }

    /// Picks a reply for `message`. Phrasing rotates with the number of messages the user has sent and never
    /// repeats an answer already given in `history` while another one is available.
    func plan(for message: String, history: [CoachMessage], context: CoachContext) -> CoachReply {
        let intent = CoachIntent.detect(in: message)
        let seed = history.filter { $0.role == .user }.count
        let options = Self.replies(for: intent, context: context, seed: seed)
        guard !options.isEmpty else { return Self.fallbackReply }

        let previous = Set(history.filter { $0.role == .coach }.map(\.text))
        for offset in 0..<options.count {
            let candidate = options[(seed + offset) % options.count]
            if !previous.contains(candidate.text) { return candidate }
        }
        return options[seed % options.count]
    }

    /// Every reply the coach can give for `intent`. Never empty.
    static func replies(for intent: CoachIntent, context: CoachContext, seed: Int = 0) -> [CoachReply] {
        let reason = Self.pickReason(from: context.reasons, seed: seed)
        switch intent {
        case .crisis: return [CoachSafety.crisisResponse]
        case .slipped: return slippedReplies(context)
        case .proud: return proudReplies(context)
        case .lonely: return lonelyReplies(reason: reason)
        case .social: return socialReplies(context, reason: reason)
        case .stressed: return stressedReplies()
        case .angry: return angryReplies()
        case .tired: return tiredReplies()
        case .hungry: return hungryReplies()
        case .bored: return boredReplies()
        case .craving: return cravingReplies(context, reason: reason)
        case .thanks: return thanksReplies(context)
        case .greeting: return greetingReplies(context)
        case .general: return generalReplies(context, reason: reason)
        }
    }

    /// One of the user's reasons, rotating with `seed`. Safe for any seed, including negative ones.
    static func pickReason(from reasons: [String], seed: Int) -> String? {
        guard !reasons.isEmpty else { return nil }
        let count = reasons.count
        return reasons[((seed % count) + count) % count]
    }

    // MARK: Reply library

    /// Used only if a reply list is ever empty (none are).
    private static var fallbackReply: CoachReply {
        CoachReply(
            intent: .general,
            opener: String(localized: "I hear you."),
            action: String(localized: "Let's slow down together: breathe in for 4, hold for 4, out for 6. Then tell me how strong the craving is from 1 to 10.")
        )
    }

    /// "Remember why you started…" using the user's own reason or streak, if there is one.
    private static func anchorLine(_ context: CoachContext, reason: String?) -> String? {
        if let reason {
            return String(localized: "Remember why you started: “\(reason)”.")
        }
        if context.hasMeaningfulStreak {
            return String(localized: "Remember how far you've come: \(context.streakText) free from \(context.displayName).")
        }
        return nil
    }

    private static func cravingReplies(_ context: CoachContext, reason: String?) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .craving,
                opener: String(localized: "Cravings feel urgent, but they peak and fade, usually within 10 to 20 minutes."),
                action: String(localized: "Let's surf this one: breathe in for 4, hold for 4, out for 6, and notice where you feel the urge in your body. Watch it rise and fall like a wave, without acting on it.")
            ),
            CoachReply(
                intent: .craving,
                opener: String(localized: "You don't have to resist forever, only for the next ten minutes."),
                action: String(localized: "Try delay, distract, decide: set a 10-minute timer, keep your hands busy with a walk, cold water or a quick tidy, then decide again when it rings.")
            ),
            CoachReply(
                intent: .craving,
                opener: String(localized: "Sometimes a craving is really another need in disguise."),
                action: String(localized: "Quick HALT check: are you Hungry, Angry, Lonely or Tired? Tell me which one fits and we'll take care of that first.")
            ),
        ]
        if let anchor = anchorLine(context, reason: reason) {
            replies.append(CoachReply(
                intent: .craving,
                opener: anchor,
                action: String(localized: "Drink a big glass of cold water slowly, then tell me how strong the craving is from 1 to 10.")
            ))
        }
        return replies
    }

    private static func stressedReplies() -> [CoachReply] {
        [
            CoachReply(
                intent: .stressed,
                opener: String(localized: "Stress makes the old habit look like relief, but it only pauses the pressure and then adds to it."),
                action: String(localized: "Try a physiological sigh: two quick breaths in through your nose, one long breath out through your mouth. Do it three times, then tell me what's weighing on you.")
            ),
            CoachReply(
                intent: .stressed,
                opener: String(localized: "That sounds like a lot to carry. Your body is looking for a quick escape, and that's normal."),
                action: String(localized: "Put both feet flat on the floor and name five things you can see. Grounding yourself takes the edge off the urge faster than you'd think.")
            ),
            CoachReply(
                intent: .stressed,
                opener: String(localized: "Anxiety and cravings feed each other, and you can break that loop."),
                action: String(localized: "Write down the one thing stressing you most, then the smallest next step you could take on it. A tiny action beats a lot of worry.")
            ),
        ]
    }

    private static func boredReplies() -> [CoachReply] {
        [
            CoachReply(
                intent: .bored,
                opener: String(localized: "Boredom is one of the sneakiest triggers. Your brain is just asking for something new."),
                action: String(localized: "Give it something: a five-minute walk, a song you love at full volume, or 15 squats. Pick one and do it now.")
            ),
            CoachReply(
                intent: .bored,
                opener: String(localized: "An empty moment is the perfect time to build something better."),
                action: String(localized: "Set a 10-minute timer and do one small task you've been putting off. The craving is usually gone before it rings.")
            ),
            CoachReply(
                intent: .bored,
                opener: String(localized: "Cravings love idle hands."),
                action: String(localized: "Text someone you haven't talked to in a while, or start something with your hands: cook, draw, or tidy one drawer.")
            ),
        ]
    }

    private static func tiredReplies() -> [CoachReply] {
        [
            CoachReply(
                intent: .tired,
                opener: String(localized: "Tiredness drains willpower, so this craving isn't a character flaw. It's a low battery."),
                action: String(localized: "If you can, rest: lie down for 10 minutes or head to bed early. If you can't, drink some water and step into fresh air for two minutes.")
            ),
            CoachReply(
                intent: .tired,
                opener: String(localized: "Being exhausted makes everything feel harder, cravings included."),
                action: String(localized: "Have a glass of water and a small snack, then do a slow stretch. Your body is asking for rest and fuel.")
            ),
            CoachReply(
                intent: .tired,
                opener: String(localized: "You're running on empty, and that's when old habits shout the loudest."),
                action: String(localized: "Make tonight an early night if you can. Put your phone across the room and give tomorrow a fresh start.")
            ),
        ]
    }

    private static func lonelyReplies(reason: String?) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .lonely,
                opener: String(localized: "I'm sorry you're feeling this way. Loneliness hurts, and it makes cravings louder."),
                action: String(localized: "Reach out to one person right now, even with a short text like “thinking of you”. Connection is one of the strongest craving breakers there is.")
            ),
            CoachReply(
                intent: .lonely,
                opener: String(localized: "Feeling low is hard, and you don't have to push it away."),
                action: String(localized: "Be gentle with yourself: make a warm drink, wrap up in something cozy, and tell me one thing that went okay today, however small.")
            ),
        ]
        let opener: String
        if let reason {
            opener = String(localized: "You matter, and so does what you're working toward: “\(reason)”.")
        } else {
            opener = String(localized: "You matter, and you deserve support, not just willpower.")
        }
        replies.append(CoachReply(
            intent: .lonely,
            opener: opener,
            action: String(localized: "Go somewhere with people around, like a café or a park, or call someone you trust for a few minutes.")
        ))
        return replies
    }

    private static func angryReplies() -> [CoachReply] {
        [
            CoachReply(
                intent: .angry,
                opener: String(localized: "Anger is a lot of energy looking for an exit, and the old habit is an exit that costs you."),
                action: String(localized: "Burn it off instead: a brisk walk, 20 push-ups, or squeeze a pillow as hard as you can for ten seconds and let go.")
            ),
            CoachReply(
                intent: .angry,
                opener: String(localized: "It's okay to be angry. Giving in to a craving won't fix what made you mad."),
                action: String(localized: "For one minute, breathe out longer than you breathe in. Then write down exactly what's bothering you to get it out of your head.")
            ),
        ]
    }

    private static func hungryReplies() -> [CoachReply] {
        [
            CoachReply(
                intent: .hungry,
                opener: String(localized: "Hunger can easily disguise itself as a craving."),
                action: String(localized: "Eat something with protein or crunch, like nuts, an apple or carrot sticks, and drink a glass of water. Then check in on the urge again.")
            ),
            CoachReply(
                intent: .hungry,
                opener: String(localized: "Low blood sugar makes cravings feel stronger than they are."),
                action: String(localized: "Have a proper snack now, even a small one, and sip some water. Give it 10 minutes and notice how the craving changes.")
            ),
        ]
    }

    private static func socialReplies(_ context: CoachContext, reason: String?) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .social,
                opener: String(localized: "Social situations are a big test, and planning ahead is half the win."),
                action: String(localized: "Get a drink that keeps you on track, like sparkling water with lime, so your hands are busy, and have your line ready: “I'm good, thanks.”")
            ),
            CoachReply(
                intent: .social,
                opener: String(localized: "You can enjoy tonight and stay free."),
                action: String(localized: "Stick close to someone who supports you, step outside for a breather if it gets intense, and give yourself permission to leave early. Leaving is a win, not a loss.")
            ),
        ]
        let opener: String
        if let reason {
            opener = String(localized: "When the offers start, remember: “\(reason)”.")
        } else if context.hasMeaningfulStreak {
            opener = String(localized: "When the offers start, remember your \(context.streakText) streak. Tonight doesn't get to undo it.")
        } else {
            opener = String(localized: "A plan made now beats willpower later.")
        }
        replies.append(CoachReply(
            intent: .social,
            opener: opener,
            action: String(localized: "Decide right now what you'll say if someone offers, and pick the time you'll head home.")
        ))
        return replies
    }

    private static func slippedReplies(_ context: CoachContext) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .slipped,
                opener: String(localized: "Thank you for telling me. A slip doesn't erase your progress: every clean hour you banked still counts."),
                action: String(localized: "Let's learn from it. What was happening right before? Log the slip with its trigger, and we'll plan what you'll do differently next time.")
            ),
            CoachReply(
                intent: .slipped,
                opener: String(localized: "Be kind to yourself. Most people who quit for good slipped along the way. What matters is what you do next."),
                action: String(localized: "Take one small step now: get rid of whatever is left, drink some water, and start your next clean hour right now.")
            ),
        ]
        let opener: String
        if context.cravingsBeaten >= 2 {
            opener = String(localized: "One slip is a moment, not a verdict. You've beaten \(context.cravingsBeaten) cravings before, and that strength is still yours.")
        } else {
            opener = String(localized: "One slip is a moment, not a verdict. Shame feeds cravings; kindness weakens them.")
        }
        replies.append(CoachReply(
            intent: .slipped,
            opener: opener,
            action: String(localized: "Write down the trigger and one thing that would have helped. Then do something kind for yourself today.")
        ))
        return replies
    }

    private static func proudReplies(_ context: CoachContext) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .proud,
                opener: String(localized: "Yes! That's a real win, and every craving you ride out proves you can do it again."),
                action: String(localized: "Take 30 seconds to really notice how good this feels. Your brain is learning that you don't need the old habit to feel okay.")
            ),
            CoachReply(
                intent: .proud,
                opener: String(localized: "I'm so proud of you. You just proved the craving doesn't get to decide."),
                action: String(localized: "Write down what worked this time, so you can use it again when the next one shows up.")
            ),
        ]
        let opener: String
        if context.hasMeaningfulStreak {
            opener = String(localized: "\(context.streakText) free from \(context.displayName), and you just added another win.")
        } else {
            opener = String(localized: "That's how streaks are built: one beaten craving at a time.")
        }
        let action: String
        if let saved = context.moneySavedText {
            action = String(localized: "Celebrate with something that supports you. You've already saved \(saved), so maybe put some of it toward something you want.")
        } else {
            action = String(localized: "Celebrate with something that supports you: your favorite snack, a walk outside, or a song you love.")
        }
        replies.append(CoachReply(intent: .proud, opener: opener, action: action))
        return replies
    }

    private static func thanksReplies(_ context: CoachContext) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .thanks,
                opener: String(localized: "Anytime. Reaching out instead of giving in is exactly the skill that keeps you free."),
                action: String(localized: "Before you go, pick one small thing for the next ten minutes: water, a short walk, or a text to a friend.")
            ),
            CoachReply(
                intent: .thanks,
                opener: String(localized: "You did the hard part. I just kept you company."),
                action: String(localized: "If the urge comes back, open SOS breathing and ride the next wave the same way.")
            ),
        ]
        if context.hasMeaningfulStreak {
            replies.append(CoachReply(
                intent: .thanks,
                opener: String(localized: "That means a lot. \(context.streakText) free and counting."),
                action: String(localized: "Take a second to notice how you feel right now, and come back whenever you need me.")
            ))
        }
        return replies
    }

    private static func greetingReplies(_ context: CoachContext) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .greeting,
                opener: String(localized: "Hi! I'm glad you reached out."),
                action: String(localized: "On a scale of 1 to 10, how strong is the craving right now? Tell me what's going on and we'll ride it out together.")
            ),
            CoachReply(
                intent: .greeting,
                opener: String(localized: "Hey there. Checking in is a strong move."),
                action: String(localized: "Take one slow breath first, then tell me what's happening around you right now.")
            ),
        ]
        if context.hasMeaningfulStreak {
            replies.append(CoachReply(
                intent: .greeting,
                opener: String(localized: "Hello! You're \(context.streakText) into this, and I'm here for every minute of it."),
                action: String(localized: "What's on your mind? If a craving is building, tell me how strong it feels from 1 to 10.")
            ))
        }
        return replies
    }

    private static func generalReplies(_ context: CoachContext, reason: String?) -> [CoachReply] {
        var replies = [
            CoachReply(
                intent: .general,
                opener: String(localized: "I hear you."),
                action: String(localized: "Let's slow down together: breathe in for 4, hold for 4, out for 6. Then tell me how strong the craving is from 1 to 10.")
            ),
            CoachReply(
                intent: .general,
                opener: String(localized: "Thanks for sharing that with me. Whatever you're feeling will pass, and you don't have to act on it."),
                action: String(localized: "Try a quick HALT check: are you Hungry, Angry, Lonely or Tired? Taking care of that need often takes the edge off.")
            ),
        ]
        if let trigger = context.topTrigger {
            replies.append(CoachReply(
                intent: .general,
                opener: String(localized: "Your log shows \(trigger.emoji) \(trigger.title) often comes before a craving. Is that part of what's happening now?"),
                action: String(localized: "If it is, name it: “This is just \(trigger.title) talking.” Then take a five-minute walk or a few slow breaths before deciding anything.")
            ))
        }
        if let anchor = anchorLine(context, reason: reason) {
            replies.append(CoachReply(
                intent: .general,
                opener: anchor,
                action: String(localized: "Pick one thing for the next ten minutes: a walk, cold water, or texting a friend. Then come back and tell me how it went.")
            ))
        }
        return replies
    }
}

extension ScriptedCoach: CravingCoach {
    func reply(to message: String, history: [CoachMessage], context: CoachContext) async -> String {
        response(to: message, history: history, context: context)
    }
}

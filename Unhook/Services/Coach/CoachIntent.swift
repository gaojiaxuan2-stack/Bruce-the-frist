import Foundation

/// What the user seems to be telling the coach. Detected from English keywords; anything unrecognized is `.general`.
enum CoachIntent: String, CaseIterable, Sendable {
    case crisis, slipped, proud, lonely, social, stressed, angry, tired, hungry, bored, craving, thanks, greeting, general

    /// Most specific first: a slip matters more than a greeting in the same message.
    static let detectionOrder: [CoachIntent] = [
        .slipped, .proud, .lonely, .social, .stressed, .angry, .tired, .hungry, .bored, .craving, .thanks, .greeting,
    ]

    /// "I almost gave in" or "I haven't slipped" is a win, not a slip.
    static let nearMissKeywords: [String] = [
        "almost slipped", "nearly slipped", "almost gave in", "nearly gave in", "almost caved", "nearly caved",
        "almost relapsed", "nearly relapsed", "didnt give in", "did not give in", "didnt cave", "didnt slip",
        "didnt relapse", "did not relapse", "never gave in",
        "havent slipped", "have not slipped", "havent relapsed", "have not relapsed", "havent caved",
        "have not caved", "havent given in", "have not given in", "never slipped", "not slipped", "no slips",
        "didnt smoke", "did not smoke", "didnt vape", "did not vape", "didnt drink", "did not drink",
        "stayed clean", "still clean",
    ]

    /// Questions like "how do I beat this?" ask for help; they aren't celebrations.
    static let helpRequestKeywords: [String] = [
        "how do i", "how can i", "how to", "what should i", "what do i", "help me", "should i",
    ]

    static func detect(in text: String) -> CoachIntent {
        if CoachSafety.isCrisis(text) { return .crisis }

        let normalized = CoachText.normalize(text)
        let isHelpRequest = CoachText.matchesAny(normalized, helpRequestKeywords)
        if CoachText.matchesAny(normalized, nearMissKeywords) {
            return isHelpRequest ? .craving : .proud
        }

        for intent in detectionOrder {
            if intent == .proud && isHelpRequest { continue }
            if CoachText.matchesAny(normalized, intent.keywords) { return intent }
        }
        return .general
    }

    /// Normalized keywords (see `CoachText.normalize`). A trailing `*` matches any word ending.
    var keywords: [String] {
        switch self {
        case .crisis:
            CoachSafety.crisisPhrases
        case .slipped:
            [
                "slipped", "slip up", "slipup", "relapsed", "had a relapse", "caved", "gave in", "messed up",
                "screwed up", "blew it", "broke my streak", "lost my streak", "fell off", "failed again",
                "did it again", "i smoked", "i vaped", "i drank", "i had a cigarette", "i had a drink", "i had a smoke",
                "i had a few", "used again", "back to day one", "back to zero", "starting over", "start over",
            ]
        case .proud:
            [
                "proud", "i did it", "we did it", "i made it", "made it through", "i won", "i beat it",
                "i beat this", "i beat that", "i beat one",
                "beat the craving", "beat the urge", "beat my craving", "resisted", "it passed", "craving passed",
                "urge passed", "craving is gone", "urge is gone", "its gone", "it went away", "nailed it",
                "crushed it", "said no", "survived", "fought the urge", "fought it off", "and won", "havent smoked",
                "havent vaped", "havent touched", "days clean", "days free", "clean for",
            ]
        case .lonely:
            [
                "lonely", "lonel*", "alone", "no friends", "no one", "nobody", "isolated", "sad", "sadness",
                "feeling down", "feel down", "depressed", "upset", "cry", "crying", "heartbroken", "broke up",
                "breakup", "feel empty", "feeling empty", "feel bad", "feel awful", "feel terrible",
                "dont feel good", "not feeling good", "hopeless", "griev*", "grief",
            ]
        case .social:
            [
                "party", "parties", "partying", "bar", "pub", "club", "clubbing", "nightclub", "friends",
                "wedding", "festival", "concert", "night out", "going out", "drinks", "drinking", "beer*", "wine",
                "cocktail*", "shots", "peer pressure", "offered", "offering", "everyone is", "everyones",
                "smoke break", "hanging out", "happy hour", "bbq", "barbecue",
            ]
        case .stressed:
            [
                "stress*", "anxi*", "overwhelm*", "panic*", "nervous", "worried", "worry*", "pressure", "deadline*",
                "exam", "exams", "work is", "my boss", "tense", "on edge", "freaking out", "cant cope", "too much",
            ]
        case .angry:
            [
                "angry", "anger", "mad", "furious", "pissed", "annoyed", "irritat*", "frustrat*", "rage", "hate",
                "argument", "arguing",
            ]
        case .tired:
            [
                "tired", "exhaust*", "sleepy", "drained", "worn out", "no energy", "fatigue*", "cant sleep",
                "insomnia", "long day", "burnt out", "burned out", "burnout",
            ]
        case .hungry:
            [
                "hungry", "starving", "havent eaten", "skipped lunch", "skipped breakfast", "skipped dinner",
                "need food", "snack",
            ]
        case .bored:
            ["bored", "boring", "boredom", "nothing to do", "killing time", "idle", "restless"]
        case .craving:
            [
                "crav*", "urge*", "tempt*", "want to smoke", "want to drink", "want to vape", "want a", "want one",
                "wanna", "need a", "need one", "need to", "itch*", "triggered", "about to", "gonna", "give in",
                "giving in", "relapse", "so close", "cant stop thinking", "struggling", "struggle", "hard right now",
                "really hard", "dying for", "how do i", "how can i", "what should i", "help me", "need help", "sos",
            ]
        case .thanks:
            ["thank*", "thx", "ty", "appreciate*", "that helps", "that helped", "helpful", "cheers"]
        case .greeting:
            [
                "hi", "hello", "hey", "hiya", "heya", "yo", "sup", "howdy", "good morning", "good afternoon",
                "good evening", "morning", "evening",
            ]
        case .general:
            []
        }
    }
}

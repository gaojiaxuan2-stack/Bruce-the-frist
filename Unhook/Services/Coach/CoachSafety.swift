import Foundation

/// Crisis detection. Checked before any coach (scripted or model) sees a message, so a person in danger
/// always gets the same caring answer and a way to reach real help. Never paywalled.
enum CoachSafety {
    /// Free directory of crisis lines in most countries.
    static let helplineURL = URL(string: "https://findahelpline.com")

    /// Phrases, already normalized (see `CoachText.normalize`), that mean the user may be in danger.
    /// Matched as whole words, so "I want to diet" or "this craving is killing me" don't trigger it.
    static let crisisPhrases: [String] = [
        "suicide", "suicidal", "kill myself", "killing myself", "killed myself",
        "end my life", "ending my life", "end it all", "take my own life", "taking my own life",
        "want to die", "wanna die", "want to be dead", "wish i was dead", "wish i were dead", "better off dead",
        "dont want to live", "dont want to be alive", "dont want to be here anymore", "do not want to live",
        "no reason to live", "nothing to live for", "not worth living", "no point in living", "no point living",
        "dont want to wake up", "rather be dead", "hang myself", "hanging myself", "shoot myself",
        "self harm", "selfharm", "hurt myself", "hurting myself", "harm myself", "harming myself",
        "cut myself", "cutting myself", "overdose", "overdosed", "overdosing", "unalive",
        "im in danger", "i am in danger", "in immediate danger",
    ]

    static func isCrisis(_ text: String) -> Bool {
        CoachText.matchesAny(CoachText.normalize(text), crisisPhrases)
    }

    /// The fixed, supportive reply to a crisis message.
    static var crisisResponse: CoachReply {
        CoachReply(
            intent: .crisis,
            opener: String(localized: "I'm really sorry you're feeling this way, and I'm glad you told me. You deserve support from a real person right now."),
            action: String(localized: "Please call your local emergency number or a crisis line. findahelpline.com lists free, confidential helplines in your country.")
        )
    }

    static var crisisReply: String { crisisResponse.text }
}

/// Text helpers shared by intent and crisis detection.
enum CoachText {
    /// Lowercased words separated by single spaces, padded with a space on each side so whole-word matching is a
    /// plain `contains`. Apostrophes are dropped ("don't" → "dont") and everything else that isn't a letter or digit
    /// (punctuation, emoji) becomes a space.
    static func normalize(_ text: String) -> String {
        var scalars = String.UnicodeScalarView()
        for scalar in text.lowercased().unicodeScalars {
            if scalar == "'" || scalar == "\u{2019}" || scalar == "\u{2018}" || scalar == "`" {
                continue
            }
            if CharacterSet.alphanumerics.contains(scalar) {
                scalars.append(scalar)
            } else {
                scalars.append(" ")
            }
        }
        let words = String(scalars).split(separator: " ")
        return " " + words.joined(separator: " ") + " "
    }

    /// Whether `normalized` contains `keyword` as whole words. A trailing `*` matches any word ending
    /// ("stress*" matches "stressed" and "stressful").
    static func matches(_ normalized: String, keyword: String) -> Bool {
        if keyword.hasSuffix("*") {
            return normalized.contains(" " + String(keyword.dropLast()))
        }
        return normalized.contains(" " + keyword + " ")
    }

    static func matchesAny(_ normalized: String, _ keywords: [String]) -> Bool {
        keywords.contains { matches(normalized, keyword: $0) }
    }
}

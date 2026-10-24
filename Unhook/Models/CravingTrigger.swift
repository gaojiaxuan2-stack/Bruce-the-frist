import Foundation

/// What set off a craving or a slip. Logging it powers the trigger insights.
enum CravingTrigger: String, CaseIterable, Identifiable, Codable {
    case stress, boredom, anxiety, loneliness, tired, social, celebration, routine, other

    var id: String { rawValue }

    var emoji: String {
        switch self {
        case .stress: "😤"
        case .boredom: "🥱"
        case .anxiety: "😰"
        case .loneliness: "🫥"
        case .tired: "😴"
        case .social: "🍻"
        case .celebration: "🎉"
        case .routine: "🔁"
        case .other: "💭"
        }
    }

    var title: String {
        switch self {
        case .stress: String(localized: "Stress")
        case .boredom: String(localized: "Boredom")
        case .anxiety: String(localized: "Anxiety")
        case .loneliness: String(localized: "Loneliness")
        case .tired: String(localized: "Tired")
        case .social: String(localized: "Social")
        case .celebration: String(localized: "Celebrating")
        case .routine: String(localized: "Routine")
        case .other: String(localized: "Other")
        }
    }
}

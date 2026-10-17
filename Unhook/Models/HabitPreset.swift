import Foundation

/// One-tap starting points so a new user is tracking within seconds.
struct HabitPreset: Identifiable, Hashable {
    let id: String
    let title: String
    let emoji: String
    let theme: HabitTheme
    var dailyCost: Double = 0
    var dailyMinutes: Double = 0
    var unitsPerDay: Double = 0
    var unitName: String = ""
    var suggestedReasons: [String] = []

    static let customID = "custom"

    var defaultName: String { id == Self.customID ? "" : title }

    static let all: [HabitPreset] = [
        HabitPreset(
            id: "smoking", title: "Smoking", emoji: "🚬", theme: .fire,
            dailyCost: 10, dailyMinutes: 60, unitsPerDay: 12, unitName: "cigarettes",
            suggestedReasons: ["Breathe easier and taste food again", "Be around longer for the people I love", "Stop burning money"]
        ),
        HabitPreset(
            id: "vaping", title: "Vaping", emoji: "💨", theme: .grape,
            dailyCost: 4, dailyMinutes: 45, unitsPerDay: 150, unitName: "puffs",
            suggestedReasons: ["Break the nicotine loop", "Stop feeling anxious without it", "Clear lungs, clear head"]
        ),
        HabitPreset(
            id: "alcohol", title: "Alcohol", emoji: "🍺", theme: .sunset,
            dailyCost: 12, dailyMinutes: 120, unitsPerDay: 3, unitName: "drinks",
            suggestedReasons: ["Wake up clear-headed", "Sleep better", "Be fully present"]
        ),
        HabitPreset(
            id: "social", title: "Social Media", emoji: "📱", theme: .ocean,
            dailyMinutes: 150,
            suggestedReasons: ["Be present with the people around me", "Stop comparing myself to others", "Get my focus back"]
        ),
        HabitPreset(
            id: "porn", title: "Porn", emoji: "🔞", theme: .midnight,
            dailyMinutes: 30,
            suggestedReasons: ["Build real connection", "Get my energy and focus back", "Feel in control again"]
        ),
        HabitPreset(
            id: "sugar", title: "Sugar", emoji: "🍭", theme: .candy,
            dailyCost: 3, dailyMinutes: 10, unitsPerDay: 3, unitName: "sweets",
            suggestedReasons: ["Steady energy all day", "Feel better in my body", "Stop the crash"]
        ),
        HabitPreset(
            id: "junkfood", title: "Junk Food", emoji: "🍔", theme: .gold,
            dailyCost: 9, dailyMinutes: 20, unitsPerDay: 1, unitName: "meals",
            suggestedReasons: ["Feel lighter and stronger", "Save money for things I love", "Take care of my health"]
        ),
        HabitPreset(
            id: "caffeine", title: "Caffeine", emoji: "☕️", theme: .sunset,
            dailyCost: 5, dailyMinutes: 15, unitsPerDay: 3, unitName: "cups",
            suggestedReasons: ["Sleep deeply again", "Calmer mornings", "Energy that doesn't crash"]
        ),
        HabitPreset(
            id: "cannabis", title: "Cannabis", emoji: "🌿", theme: .forest,
            dailyCost: 10, dailyMinutes: 60, unitsPerDay: 2, unitName: "sessions",
            suggestedReasons: ["Sharper memory and motivation", "Remember my dreams", "Feel like myself"]
        ),
        HabitPreset(
            id: "gambling", title: "Gambling", emoji: "🎰", theme: .gold,
            dailyCost: 25, dailyMinutes: 60,
            suggestedReasons: ["Protect my savings", "Rebuild trust", "Stop chasing losses"]
        ),
        HabitPreset(
            id: "gaming", title: "Gaming", emoji: "🎮", theme: .candy,
            dailyMinutes: 180,
            suggestedReasons: ["Spend time on real goals", "Sleep on time", "See friends in person"]
        ),
        HabitPreset(
            id: "shopping", title: "Impulse Buys", emoji: "🛍️", theme: .candy,
            dailyCost: 15, dailyMinutes: 20,
            suggestedReasons: ["Build my savings", "Want less, live more", "Get out of debt"]
        ),
        HabitPreset(
            id: "nailbiting", title: "Nail Biting", emoji: "💅", theme: .mint,
            suggestedReasons: ["Healthy, good-looking nails", "Less anxiety on autopilot", "Feel confident with my hands"]
        ),
        HabitPreset(id: customID, title: "Something else", emoji: "✨", theme: .grape),
    ]
}

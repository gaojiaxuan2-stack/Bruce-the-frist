import SwiftUI

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

enum Brand {
    static let colors = [Color(hex: 0x7C5CFF), Color(hex: 0x22D3EE)]
    static let gradient = LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    /// Deep night sky used behind onboarding and the SOS screen.
    static let night = LinearGradient(
        colors: [Color(hex: 0x0F0C29), Color(hex: 0x302B63), Color(hex: 0x24243E)],
        startPoint: .top,
        endPoint: .bottom
    )
}

/// The color personality of a habit. Stored on the model by raw value.
enum HabitTheme: String, CaseIterable, Identifiable {
    case ocean, sunset, forest, grape, fire, candy, mint, gold, midnight

    var id: String { rawValue }

    var displayName: String { rawValue.capitalized }

    var colors: [Color] {
        switch self {
        case .ocean: [Color(hex: 0x00C6FB), Color(hex: 0x005BEA)]
        case .sunset: [Color(hex: 0xFF9A44), Color(hex: 0xFC6076)]
        case .forest: [Color(hex: 0x38D98A), Color(hex: 0x11998E)]
        case .grape: [Color(hex: 0xB06AB3), Color(hex: 0x4568DC)]
        case .fire: [Color(hex: 0xFF512F), Color(hex: 0xDD2476)]
        case .candy: [Color(hex: 0xFF6CAB), Color(hex: 0x7366FF)]
        case .mint: [Color(hex: 0x2BC4A1), Color(hex: 0x0B8F87)]
        case .gold: [Color(hex: 0xF7B733), Color(hex: 0xFC4A1A)]
        case .midnight: [Color(hex: 0x4B6CB7), Color(hex: 0x182848)]
        }
    }

    var accent: Color { colors[0] }

    var gradient: LinearGradient {
        LinearGradient(colors: colors, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

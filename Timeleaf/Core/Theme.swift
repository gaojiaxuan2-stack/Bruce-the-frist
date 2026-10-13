import SwiftUI

// MARK: - ThemeID

/// Every visual style ("stationery") Timeleaf offers.
/// The app chrome uses the style picked in Settings; each capsule also remembers
/// the style it was written in, so it opens exactly as the author saw it.
enum ThemeID: String, CaseIterable, Codable, Identifiable {
    case aurora
    case parchment
    case inkwash
    case celestial
    case blossom
    case monolith

    var id: String { rawValue }

    var theme: Theme {
        switch self {
        case .aurora: .aurora
        case .parchment: .parchment
        case .inkwash: .inkwash
        case .celestial: .celestial
        case .blossom: .blossom
        case .monolith: .monolith
        }
    }
}

// MARK: - Theme

/// Design tokens for one style. Concrete values live in `Themes/<Name>Theme.swift`
/// as `static let` members on `Theme`.
struct Theme {
    let id: ThemeID
    /// English display name, e.g. "Aurora".
    let name: String
    /// Chinese display name, e.g. "极光".
    let nativeName: String
    /// A short poetic line shown in the style gallery.
    let tagline: String
    /// The color scheme the style is designed for.
    let colorScheme: ColorScheme

    // Palette
    /// Solid base drawn behind the animated background.
    let background: Color
    /// Card / sheet fill (may be translucent).
    let surface: Color
    /// Hairline stroke around cards.
    let surfaceStroke: Color
    /// Primary text.
    let ink: Color
    /// Secondary text, captions, metadata.
    let inkSecondary: Color
    /// Buttons, highlights, progress.
    let accent: Color
    /// Text/icons drawn on top of `accent`.
    let accentInk: Color
    /// Glow used for capsules that are ready to open.
    let glow: Color
    /// Main color of the seal.
    let seal: Color
    /// 2–4 signature colors, used for previews and gradients.
    let gradient: [Color]

    // Shape & typography
    let cornerRadius: CGFloat
    /// Custom font used for titles (nil = system font with `fontDesign`).
    let displayFontName: String?
    /// Custom font used for long-form letter text (nil = system font with `fontDesign`).
    let bodyFontName: String?
    let fontDesign: Font.Design
    /// When true, cards layer `.ultraThinMaterial` beneath `surface`.
    let usesMaterial: Bool

    /// Large, expressive titles.
    func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if let displayFontName {
            return Font.custom(displayFontName, size: size, relativeTo: .title).weight(weight)
        }
        return Font.system(size: size, weight: weight, design: fontDesign)
    }

    /// Letter text and other long-form reading.
    func body(_ size: CGFloat = 17, weight: Font.Weight = .regular) -> Font {
        if let bodyFontName {
            return Font.custom(bodyFontName, size: size, relativeTo: .body).weight(weight)
        }
        return Font.system(size: size, weight: weight, design: fontDesign)
    }

    /// Small UI labels and metadata (always system font for legibility).
    func label(_ size: CGFloat = 13, weight: Font.Weight = .medium) -> Font {
        Font.system(size: size, weight: weight, design: fontDesign == .serif ? .serif : .default)
    }

    /// Signature gradient as a `LinearGradient`.
    var linearGradient: LinearGradient {
        LinearGradient(colors: gradient, startPoint: .topLeading, endPoint: .bottomTrailing)
    }
}

// MARK: - Environment

extension EnvironmentValues {
    /// The active style. Set at the app root from Settings, and overridden per capsule.
    @Entry var theme: Theme = .aurora
}

extension View {
    /// Applies a style to a subtree: environment value, local color scheme and tint.
    /// Safe to use on small previews (does not touch the window's color scheme).
    func theme(_ theme: Theme) -> some View {
        self
            .environment(\.theme, theme)
            .environment(\.colorScheme, theme.colorScheme)
            .tint(theme.accent)
    }

    /// Like `theme(_:)` but also sets the presentation's preferred color scheme
    /// (status bar, sheets). Use only at the root of a screen or full-screen cover.
    func screenTheme(_ theme: Theme) -> some View {
        self
            .theme(theme)
            .preferredColorScheme(theme.colorScheme)
    }
}

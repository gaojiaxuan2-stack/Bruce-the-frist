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

    /// How far Dynamic Type scales system-font text in the current environment
    /// (1 at the default text size), following the `.title`, `.body` and `.footnote` text styles.
    /// Filled in by `theme(_:)` / `screenTheme(_:)`; style definitions leave it at the default.
    var typeScale: (display: CGFloat, body: CGFloat, label: CGFloat) = (1, 1, 1)

    /// Large, expressive titles. Scales with Dynamic Type like `.title`.
    func display(_ size: CGFloat, weight: Font.Weight = .regular) -> Font {
        if let displayFontName {
            return Font.custom(displayFontName, size: size, relativeTo: .title).weight(weight)
        }
        return Font.system(size: size * typeScale.display, weight: weight, design: fontDesign)
    }

    /// Letter text and other long-form reading. Scales with Dynamic Type like `.body`.
    func body(_ size: CGFloat = 17, weight: Font.Weight = .regular) -> Font {
        if let bodyFontName {
            return Font.custom(bodyFontName, size: size, relativeTo: .body).weight(weight)
        }
        return Font.system(size: size * typeScale.body, weight: weight, design: fontDesign)
    }

    /// Small UI labels and metadata (always system font for legibility).
    /// Scales with Dynamic Type like `.footnote`.
    func label(_ size: CGFloat = 13, weight: Font.Weight = .medium) -> Font {
        Font.system(size: size * typeScale.label, weight: weight, design: fontDesign == .serif ? .serif : .default)
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
    /// The theme's system-font text follows the subtree's Dynamic Type size.
    /// Safe to use on small previews (does not touch the window's color scheme).
    func theme(_ theme: Theme) -> some View {
        self
            .modifier(DynamicTypeScaling(theme: theme))
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

// MARK: - Dynamic Type

/// Measures how far Dynamic Type scales each kind of text at this point of the hierarchy
/// (honouring any `dynamicTypeSize` limit above it) and hands the theme on with those factors,
/// so the system-font paths of `display`, `body` and `label` grow like their text styles.
private struct DynamicTypeScaling: ViewModifier {
    let theme: Theme

    /// A large base keeps the measured ratios precise.
    private static let base: CGFloat = 1_000
    @ScaledMetric(relativeTo: .title) private var displayMetric: CGFloat = DynamicTypeScaling.base
    @ScaledMetric(relativeTo: .body) private var bodyMetric: CGFloat = DynamicTypeScaling.base
    @ScaledMetric(relativeTo: .footnote) private var labelMetric: CGFloat = DynamicTypeScaling.base

    init(theme: Theme) {
        self.theme = theme
    }

    func body(content: Content) -> some View {
        var scaled = theme
        scaled.typeScale = (
            display: displayMetric / Self.base,
            body: bodyMetric / Self.base,
            label: labelMetric / Self.base
        )
        return content.environment(\.theme, scaled)
    }
}

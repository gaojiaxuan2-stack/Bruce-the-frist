import SwiftUI

// MARK: - Themed modifiers (contract)

extension View {
    /// Surface fill (layered over `.ultraThinMaterial` when the style asks for it),
    /// a hairline stroke, the style's corner radius and a soft, scheme-aware shadow.
    func themedCard(padding: CGFloat = 20) -> some View {
        modifier(ThemedCardModifier(padding: padding))
    }

    /// A gentle breathing halo in `theme.glow` while `active` is true.
    /// Static when Reduce Motion is on. Never changes the identity of the content.
    func themedGlow(_ active: Bool) -> some View {
        modifier(ThemedGlowModifier(active: active))
    }

    /// Styling for `TextField` / `TextEditor` containers.
    func themedField() -> some View {
        modifier(ThemedFieldModifier())
    }
}

// MARK: - Button style (contract)

struct ThemedButtonStyle: ButtonStyle {
    enum Kind {
        case primary
        case secondary
        case ghost
    }

    var kind: Kind

    func makeBody(configuration: Configuration) -> some View {
        ThemedButtonBody(configuration: configuration, kind: kind)
    }
}

extension ButtonStyle where Self == ThemedButtonStyle {
    /// Full-width, accent fill, `accentInk` text.
    static var themedPrimary: ThemedButtonStyle { ThemedButtonStyle(kind: .primary) }
    /// Full-width, surface fill + hairline stroke.
    static var themedSecondary: ThemedButtonStyle { ThemedButtonStyle(kind: .secondary) }
    /// Text only, in the accent colour.
    static var themedGhost: ThemedButtonStyle { ThemedButtonStyle(kind: .ghost) }
}

// MARK: - Card

private struct ThemedCardModifier: ViewModifier {
    @Environment(\.theme) private var theme
    let padding: CGFloat

    func body(content: Content) -> some View {
        content
            .padding(padding)
            .background {
                ThemedSurface(theme: theme, cornerRadius: theme.cornerRadius, depth: 1)
            }
    }
}

/// The shared "sheet of the style" used by cards and fields.
/// Only the bottom-most layer carries the shadow, so translucent surfaces stay clean.
private struct ThemedSurface: View {
    let theme: Theme
    let cornerRadius: CGFloat
    /// 0 = flat (fields), 1 = lifted card.
    let depth: Double

    private var isDark: Bool { theme.colorScheme == .dark }

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    private var ambientShadow: Color {
        isDark ? Color.black.opacity(0.38 * depth) : theme.ink.opacity(0.09 * depth)
    }

    private var contactShadow: Color {
        isDark ? Color.black.opacity(0.28 * depth) : theme.ink.opacity(0.06 * depth)
    }

    /// Soft light falling from above.
    private var sheen: LinearGradient {
        LinearGradient(
            colors: [Color.white.opacity(isDark ? 0.05 : 0.22), Color.white.opacity(0)],
            startPoint: .top,
            endPoint: .center
        )
    }

    /// A whisper of rim light on the top edge.
    private var rimLight: LinearGradient {
        LinearGradient(
            colors: [Color.white.opacity(isDark ? 0.10 : 0.45), Color.white.opacity(0)],
            startPoint: .top,
            endPoint: .center
        )
    }

    var body: some View {
        ZStack {
            base
            shape.fill(sheen)
            shape.strokeBorder(theme.surfaceStroke, lineWidth: 0.75)
            shape.strokeBorder(rimLight, lineWidth: 0.75)
        }
        .allowsHitTesting(false)
    }

    @ViewBuilder
    private var base: some View {
        if theme.usesMaterial {
            shape
                .fill(.ultraThinMaterial)
                .shadow(color: ambientShadow, radius: 18 * depth, x: 0, y: 10 * depth)
                .shadow(color: contactShadow, radius: 1.5, x: 0, y: 1)
            shape.fill(theme.surface)
        } else {
            shape
                .fill(theme.surface)
                .shadow(color: ambientShadow, radius: 18 * depth, x: 0, y: 10 * depth)
                .shadow(color: contactShadow, radius: 1.5, x: 0, y: 1)
        }
    }
}

// MARK: - Glow

private struct ThemedGlowModifier: ViewModifier {
    @Environment(\.theme) private var theme
    let active: Bool

    func body(content: Content) -> some View {
        content
            .background {
                ZStack {
                    if active {
                        ThemedGlowHalo(color: theme.glow, cornerRadius: theme.cornerRadius)
                            .transition(.opacity)
                    }
                }
                .animation(.easeInOut(duration: 0.8), value: active)
            }
    }
}

/// A halo drawn *behind* the content; breathes slowly unless Reduce Motion is on.
private struct ThemedGlowHalo: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let color: Color
    let cornerRadius: CGFloat

    var body: some View {
        if reduceMotion {
            ThemedGlowLayers(color: color, cornerRadius: cornerRadius)
                .opacity(0.8)
        } else {
            ThemedGlowLayers(color: color, cornerRadius: cornerRadius)
                .phaseAnimator([false, true]) { layers, bloom in
                    layers
                        .opacity(bloom ? 1 : 0.5)
                        .scaleEffect(bloom ? 1.025 : 0.995)
                } animation: { _ in
                    .easeInOut(duration: 2.6)
                }
        }
    }
}

private struct ThemedGlowLayers: View {
    let color: Color
    let cornerRadius: CGFloat

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
    }

    var body: some View {
        ZStack {
            shape
                .fill(color.opacity(0.42))
                .padding(-10)
                .blur(radius: 26)
            shape
                .fill(color.opacity(0.5))
                .padding(-2)
                .blur(radius: 9)
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

// MARK: - Field

private struct ThemedFieldModifier: ViewModifier {
    @Environment(\.theme) private var theme

    private var radius: CGFloat { min(theme.cornerRadius * 0.7, 18) }

    func body(content: Content) -> some View {
        content
            .padding(14)
            .font(theme.body(17))
            .foregroundStyle(theme.ink)
            .tint(theme.accent)
            .scrollContentBackground(.hidden)
            .background {
                ThemedSurface(theme: theme, cornerRadius: radius, depth: 0)
            }
    }
}

// MARK: - Button body

private struct ThemedButtonBody: View {
    @Environment(\.theme) private var theme
    @Environment(\.isEnabled) private var isEnabled

    let configuration: ButtonStyleConfiguration
    let kind: ThemedButtonStyle.Kind

    private var isDark: Bool { theme.colorScheme == .dark }
    private var isPressed: Bool { configuration.isPressed }

    private var shape: AnyShape {
        if theme.cornerRadius >= 16 {
            return AnyShape(Capsule(style: .continuous))
        }
        return AnyShape(RoundedRectangle(cornerRadius: theme.cornerRadius, style: .continuous))
    }

    private var foreground: Color {
        switch kind {
        case .primary: return theme.accentInk
        case .secondary: return theme.ink
        case .ghost: return theme.accent
        }
    }

    private var resolvedOpacity: Double {
        if !isEnabled { return 0.42 }
        return isPressed ? 0.82 : 1
    }

    private var primaryShadow: Color {
        guard isEnabled else { return Color.clear }
        return theme.accent.opacity(isPressed ? 0.16 : (isDark ? 0.42 : 0.3))
    }

    var body: some View {
        configuration.label
            .font(theme.label(16, weight: .semibold))
            .multilineTextAlignment(.center)
            .foregroundStyle(foreground)
            .padding(.horizontal, kind == .ghost ? 12 : 24)
            .padding(.vertical, 12)
            .frame(maxWidth: kind == .ghost ? nil : .infinity, minHeight: kind == .ghost ? 44 : 54)
            .background { background }
            .contentShape(shape)
            .scaleEffect(isPressed ? 0.97 : 1)
            .opacity(resolvedOpacity)
            .animation(.spring(response: 0.3, dampingFraction: 0.72), value: isPressed)
    }

    @ViewBuilder
    private var background: some View {
        switch kind {
        case .primary:
            ZStack {
                shape
                    .fill(theme.accent)
                    .shadow(color: primaryShadow, radius: isPressed ? 5 : 14, x: 0, y: isPressed ? 2 : 8)
                shape.fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.2), Color.white.opacity(0)],
                        startPoint: .top,
                        endPoint: .center
                    )
                )
                shape.stroke(Color.white.opacity(isDark ? 0.14 : 0.22), lineWidth: 0.75)
            }
        case .secondary:
            ZStack {
                if theme.usesMaterial {
                    shape.fill(.ultraThinMaterial)
                }
                shape.fill(theme.surface)
                shape.stroke(theme.surfaceStroke, lineWidth: 0.75)
            }
        case .ghost:
            Color.clear
        }
    }
}

// MARK: - Previews

#Preview("Themed styles") {
    ThemedStylesPreviewGallery()
}

private struct ThemedStylesPreviewGallery: View {
    @State private var title = "To the one who survived senior year"

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                ForEach(ThemeID.allCases) { id in
                    ThemedStylesPreviewSample(title: $title)
                        .padding(20)
                        .background { ThemeBackground() }
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                        .theme(id.theme)
                }
            }
            .padding(16)
        }
    }
}

private struct ThemedStylesPreviewSample: View {
    @Environment(\.theme) private var theme
    @Binding var title: String

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(theme.name)
                    .font(theme.display(24))
                    .foregroundStyle(theme.ink)
                Text(theme.tagline)
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .themedCard()
            .themedGlow(true)

            TextField("Title", text: $title)
                .themedField()

            Button("Seal the letter") {}
                .buttonStyle(.themedPrimary)
            Button("Save for later") {}
                .buttonStyle(.themedSecondary)
            Button("Not now") {}
                .buttonStyle(.themedGhost)
        }
    }
}

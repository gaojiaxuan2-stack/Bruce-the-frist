import SwiftUI

// Dispatch views: every screen uses these, and each one forwards to the
// concrete implementation inside `Themes/<Name>Theme.swift`.

/// Full-bleed animated backdrop for the active style. Ignores safe areas.
struct ThemeBackground: View {
    @Environment(\.theme) private var theme

    var body: some View {
        ZStack {
            theme.background
            switch theme.id {
            case .aurora: AuroraBackground()
            case .parchment: ParchmentBackground()
            case .inkwash: InkWashBackground()
            case .celestial: CelestialBackground()
            case .blossom: BlossomBackground()
            case .monolith: MonolithBackground()
            }
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The style's seal (wax seal, vermilion chop, star sigil …) showing a monogram.
/// Fills the proposed square; give it a `.frame(width:height:)`.
struct SealView: View {
    @Environment(\.theme) private var theme
    var monogram: String

    var body: some View {
        Group {
            switch theme.id {
            case .aurora: AuroraSeal(monogram: monogram)
            case .parchment: ParchmentSeal(monogram: monogram)
            case .inkwash: InkWashSeal(monogram: monogram)
            case .celestial: CelestialSeal(monogram: monogram)
            case .blossom: BlossomSeal(monogram: monogram)
            case .monolith: MonolithSeal(monogram: monogram)
            }
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityLabel(Text("Seal"))
    }
}

/// A one-shot celebratory effect played when a capsule is unsealed.
/// Plays its animation on appear (~1.5–2.5 s) and then settles/fades.
/// Insert it into the hierarchy at the moment the seal breaks.
struct CeremonyBurst: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            switch theme.id {
            case .aurora: AuroraBurst()
            case .parchment: ParchmentBurst()
            case .inkwash: InkWashBurst()
            case .celestial: CelestialBurst()
            case .blossom: BlossomBurst()
            case .monolith: MonolithBurst()
            }
        }
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

/// The paper a letter is written on (texture, ruling, ornaments). Fills its frame;
/// the letter text is laid on top of it.
struct StationeryView: View {
    @Environment(\.theme) private var theme

    var body: some View {
        Group {
            switch theme.id {
            case .aurora: AuroraStationery()
            case .parchment: ParchmentStationery()
            case .inkwash: InkWashStationery()
            case .celestial: CelestialStationery()
            case .blossom: BlossomStationery()
            case .monolith: MonolithStationery()
            }
        }
        .accessibilityHidden(true)
    }
}

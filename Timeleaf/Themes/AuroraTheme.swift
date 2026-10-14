import SwiftUI

// Aurora 极光 — northern lights over a still night.
// Teal, mint and violet light breathes slowly above a midnight horizon; the seal is a
// glass orb that holds a little of that light, and the paper is a sheet of frosted glass.

// MARK: - Tokens

extension Theme {
    static let aurora = Theme(
        id: .aurora,
        name: "Aurora",
        nativeName: "极光",
        tagline: String(localized: "Your words, held in drifting northern light."),
        colorScheme: .dark,
        background: Color(hex: 0x070B1A),
        surface: Color(hex: 0x111A33, opacity: 0.66),
        surfaceStroke: Color(hex: 0xBFEFFF, opacity: 0.16),
        ink: Color(hex: 0xEEF4FF),
        inkSecondary: Color(hex: 0xA9B6D3),
        accent: Color(hex: 0x7CF5D3),
        accentInk: Color(hex: 0x04111A),
        glow: Color(hex: 0x7CF5D3),
        seal: Color(hex: 0x9B7BFF),
        gradient: [Color(hex: 0x16A3A0), Color(hex: 0x7CF5D3), Color(hex: 0x9B7BFF)],
        cornerRadius: 24,
        displayFontName: "Avenir Next",
        bodyFontName: "Avenir Next",
        fontDesign: .rounded,
        usesMaterial: true
    )
}

// MARK: - Palette & math

private enum AuroraPalette {
    static let night = Color(hex: 0x070B1A)
    static let teal = Color(hex: 0x16A3A0)
    static let mint = Color(hex: 0x7CF5D3)
    static let violet = Color(hex: 0x9B7BFF)
    static let ice = Color(hex: 0x6FD6FF)
    static let rose = Color(hex: 0xFF9EDB)
    static let dawn = Color(hex: 0xFFE7A8)
    static let frost = Color(hex: 0xF2FFFB)

    static func ray(_ hue: Int) -> Color {
        switch hue {
        case 0: mint
        case 1: teal
        default: violet
        }
    }
}

/// Deterministic pseudo-random number in 0..<1, stable for a given index and salt.
private func auroraRandom(_ index: Int, _ salt: Double) -> Double {
    let value = sin(Double(index) * 12.9898 + salt * 78.233) * 43_758.5453
    return value - value.rounded(.down)
}

private func auroraClamp(_ value: Double) -> Double {
    min(max(value, 0), 1)
}

private func auroraEaseOut(_ value: Double) -> Double {
    let x = auroraClamp(value)
    return 1 - (1 - x) * (1 - x) * (1 - x)
}

private func auroraSmoothstep(_ edge0: Double, _ edge1: Double, _ value: Double) -> Double {
    let x = auroraClamp((value - edge0) / (edge1 - edge0))
    return x * x * (3 - 2 * x)
}

private func auroraDot(_ center: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
}

// MARK: - Background

/// Full-bleed northern lights: a drifting mesh of colour, soft curtain streaks and a sparse starfield.
struct AuroraBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            AuroraSky(time: reduceMotion ? 48 : timeline.date.timeIntervalSinceReferenceDate)
        }
    }
}

private struct AuroraSky: View {
    let time: Double

    var body: some View {
        ZStack {
            AuroraMesh(time: time)
            Canvas { context, size in
                AuroraSkyPainter.draw(in: &context, size: size, time: time)
            }
            AuroraHorizonVeil()
        }
    }
}

/// A 4×4 mesh whose interior points drift on slow sine paths (12–29 s periods).
/// The light lives in the upper third; the centre and bottom stay deep and quiet for text.
private struct AuroraMesh: View {
    let time: Double

    var body: some View {
        MeshGradient(width: 4, height: 4, points: points, colors: colors)
    }

    private func wave(_ period: Double, _ phase: Double) -> Float {
        Float(sin(time * 2 * .pi / period + phase))
    }

    private var points: [SIMD2<Float>] {
        let topA: Float = 0.34 + 0.05 * wave(23, 0.3)
        let topB: Float = 0.66 + 0.05 * wave(19, 1.7)
        let leftUpper: Float = 0.22 + 0.04 * wave(17, 0.9)
        let rightUpper: Float = 0.26 + 0.04 * wave(21, 2.6)
        let leftLower: Float = 0.54 + 0.03 * wave(29, 1.4)
        let rightLower: Float = 0.52 + 0.03 * wave(25, 0.7)
        let inner11 = SIMD2<Float>(0.30 + 0.08 * wave(13, 2.1), 0.22 + 0.06 * wave(21, 0.4))
        let inner21 = SIMD2<Float>(0.68 + 0.08 * wave(16, 4.0), 0.20 + 0.07 * wave(27, 1.2))
        let inner12 = SIMD2<Float>(0.36 + 0.07 * wave(18, 3.3), 0.52 + 0.05 * wave(14, 0.2))
        let inner22 = SIMD2<Float>(0.64 + 0.07 * wave(24, 5.1), 0.55 + 0.05 * wave(12, 2.9))
        let row0: [SIMD2<Float>] = [SIMD2<Float>(0, 0), SIMD2<Float>(topA, 0), SIMD2<Float>(topB, 0), SIMD2<Float>(1, 0)]
        let row1: [SIMD2<Float>] = [SIMD2<Float>(0, leftUpper), inner11, inner21, SIMD2<Float>(1, rightUpper)]
        let row2: [SIMD2<Float>] = [SIMD2<Float>(0, leftLower), inner12, inner22, SIMD2<Float>(1, rightLower)]
        let row3: [SIMD2<Float>] = [SIMD2<Float>(0, 1), SIMD2<Float>(0.33, 1), SIMD2<Float>(0.67, 1), SIMD2<Float>(1, 1)]
        return row0 + row1 + row2 + row3
    }

    private var colors: [Color] {
        let breath = 0.5 + 0.5 * sin(time * 2 * .pi / 15)
        let pulse = 0.5 + 0.5 * sin(time * 2 * .pi / 22 + 1.3)
        let night = AuroraPalette.night
        let deep = Color(hex: 0x0A1128)
        let mintCore = Color(hex: 0x1C8A78, opacity: 0.5 + 0.3 * breath)
        let violetCore = Color(hex: 0x4A3BA0, opacity: 0.4 + 0.3 * pulse)
        let row0: [Color] = [night, Color(hex: 0x1A1645), Color(hex: 0x0B2A3C), night]
        let row1: [Color] = [Color(hex: 0x0E4B52, opacity: 0.9), mintCore, violetCore, Color(hex: 0x0F3A4C)]
        let row2: [Color] = [deep, Color(hex: 0x0B2D35, opacity: 0.85), Color(hex: 0x17134A, opacity: 0.85), deep]
        let row3: [Color] = [night, night, night, night]
        return row0 + row1 + row2 + row3
    }
}

/// Darkens the lower half a touch so the horizon feels still and text stays crisp.
private struct AuroraHorizonVeil: View {
    var body: some View {
        LinearGradient(
            stops: [
                Gradient.Stop(color: AuroraPalette.night.opacity(0), location: 0),
                Gradient.Stop(color: AuroraPalette.night.opacity(0), location: 0.5),
                Gradient.Stop(color: Color(hex: 0x05081A, opacity: 0.55), location: 1)
            ],
            startPoint: .top,
            endPoint: .bottom
        )
    }
}

private struct AuroraStar {
    let x: Double
    let y: Double
    let radius: Double
    let brightness: Double
    let speed: Double
    let phase: Double
}

private struct AuroraRay {
    let x: Double
    let y: Double
    let width: Double
    let height: Double
    let period: Double
    let phase: Double
    let hue: Int
}

/// Deterministic particle field: 64 stars + 14 curtain streaks.
private enum AuroraField {
    static let stars: [AuroraStar] = (0..<64).map { (index: Int) -> AuroraStar in
        AuroraStar(
            x: auroraRandom(index, 1),
            y: pow(auroraRandom(index, 2), 1.6) * 0.8,
            radius: 0.35 + pow(auroraRandom(index, 3), 3) * 1.1,
            brightness: 0.2 + auroraRandom(index, 4) * 0.45,
            speed: 0.3 + auroraRandom(index, 5) * 0.9,
            phase: auroraRandom(index, 6) * 2 * .pi
        )
    }

    static let rays: [AuroraRay] = (0..<14).map { (index: Int) -> AuroraRay in
        let hue = index % 3 == 2 ? 2 : index % 2
        return AuroraRay(
            x: (Double(index) + 0.5) / 14 + (auroraRandom(index, 11) - 0.5) * 0.05,
            y: (hue == 2 ? 0.12 : 0.2) + auroraRandom(index, 12) * 0.07,
            width: 30 + auroraRandom(index, 13) * 46,
            height: 0.14 + auroraRandom(index, 14) * 0.14,
            period: 12 + auroraRandom(index, 15) * 18,
            phase: auroraRandom(index, 16) * 2 * .pi,
            hue: hue
        )
    }
}

private enum AuroraSkyPainter {
    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        guard size.width > 0, size.height > 0 else { return }
        drawCurtains(in: &context, size: size, time: time)
        drawStars(in: &context, size: size, time: time)
    }

    /// Soft vertical streaks (elliptical radial glows) that sway and shimmer like a curtain.
    private static func drawCurtains(in context: inout GraphicsContext, size: CGSize, time: Double) {
        var light = context
        light.blendMode = .plusLighter
        for ray in AuroraField.rays {
            let sway = sin(time * 2 * .pi / ray.period + ray.phase)
            let shimmer = 0.5 + 0.5 * sin(time * 2 * .pi / (ray.period * 0.4) + ray.phase * 1.7)
            let alpha = 0.03 + 0.07 * shimmer
            let width = CGFloat(ray.width)
            let height = CGFloat(ray.height) * size.height
            let reach = width / 2
            let color = AuroraPalette.ray(ray.hue)
            var streak = light
            streak.translateBy(x: CGFloat(ray.x + 0.022 * sway) * size.width, y: CGFloat(ray.y) * size.height)
            streak.scaleBy(x: 1, y: max(1, height / width))
            streak.fill(
                Path(CGRect(x: -reach, y: -reach, width: width, height: width)),
                with: .radialGradient(
                    Gradient(colors: [color.opacity(alpha), color.opacity(0)]),
                    center: .zero,
                    startRadius: 0,
                    endRadius: reach
                )
            )
        }
    }

    private static func drawStars(in context: inout GraphicsContext, size: CGSize, time: Double) {
        for star in AuroraField.stars {
            let twinkle = 0.62 + 0.38 * sin(time * star.speed + star.phase)
            let dx = (star.x - 0.5) / 0.5
            let dy = (star.y - 0.5) / 0.4
            let calm = 0.35 + 0.65 * auroraSmoothstep(0.2, 0.95, (dx * dx + dy * dy).squareRoot())
            let alpha = star.brightness * twinkle * calm
            let radius = CGFloat(star.radius)
            let center = CGPoint(x: CGFloat(star.x) * size.width, y: CGFloat(star.y) * size.height)
            if radius > 1.0 {
                let halo = radius * 4
                context.fill(
                    auroraDot(center, halo),
                    with: .radialGradient(
                        Gradient(colors: [Color.white.opacity(alpha * 0.3), Color.white.opacity(0)]),
                        center: center,
                        startRadius: 0,
                        endRadius: halo
                    )
                )
            }
            context.fill(auroraDot(center, radius), with: .color(Color.white.opacity(alpha)))
        }
    }
}

// MARK: - Seal

/// A luminous glass orb with an iridescent rim and a softly glowing monogram.
struct AuroraSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            AuroraOrb(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
    }
}

private struct AuroraOrb: View {
    let monogram: String
    let side: CGFloat

    /// The glass body is slightly smaller than the frame so the halo stays inside it.
    private var diameter: CGFloat { side * 0.86 }

    var body: some View {
        ZStack {
            halo
            groundShadow
            interior
            rim
            specular
            glyph
        }
    }

    private var halo: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [AuroraPalette.mint.opacity(0.34), AuroraPalette.violet.opacity(0.14), AuroraPalette.violet.opacity(0)],
                    center: .center,
                    startRadius: diameter * 0.44,
                    endRadius: side * 0.5
                )
            )
    }

    private var groundShadow: some View {
        Ellipse()
            .fill(Color.black.opacity(0.4))
            .frame(width: diameter * 0.6, height: diameter * 0.1)
            .offset(y: diameter * 0.47)
            .blur(radius: diameter * 0.04)
    }

    private var interior: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color(hex: 0x2B2470), Color(hex: 0x111A44), Color(hex: 0x060A1C)],
                        center: UnitPoint(x: 0.5, y: 0.62),
                        startRadius: 0,
                        endRadius: diameter * 0.56
                    )
                )
            Circle()
                .strokeBorder(rimGradient, lineWidth: diameter * 0.2)
                .blur(radius: diameter * 0.08)
                .opacity(0.7)
                .blendMode(.screen)
            Circle()
                .fill(
                    RadialGradient(
                        colors: [Color.black.opacity(0), Color.black.opacity(0.5)],
                        center: UnitPoint(x: 0.42, y: 0.36),
                        startRadius: diameter * 0.18,
                        endRadius: diameter * 0.56
                    )
                )
            Circle()
                .fill(
                    RadialGradient(
                        colors: [AuroraPalette.night.opacity(0.6), AuroraPalette.night.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: diameter * 0.3
                    )
                )
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [AuroraPalette.mint.opacity(0.7), AuroraPalette.mint.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: diameter * 0.3
                    )
                )
                .frame(width: diameter * 0.7, height: diameter * 0.32)
                .offset(y: diameter * 0.32)
                .blendMode(.plusLighter)
        }
        .frame(width: diameter, height: diameter)
        .clipShape(Circle())
    }

    private var rimGradient: AngularGradient {
        AngularGradient(
            colors: [
                AuroraPalette.mint, AuroraPalette.ice, AuroraPalette.violet,
                AuroraPalette.rose, AuroraPalette.dawn, AuroraPalette.mint
            ],
            center: .center,
            angle: .degrees(-30)
        )
    }

    private var rim: some View {
        ZStack {
            Circle()
                .strokeBorder(rimGradient, lineWidth: max(1, diameter * 0.035))
                .blur(radius: diameter * 0.02)
                .opacity(0.8)
            Circle()
                .strokeBorder(rimGradient, lineWidth: max(0.75, diameter * 0.016))
            Circle()
                .strokeBorder(Color.white.opacity(0.3), lineWidth: max(0.5, diameter * 0.005))
                .padding(diameter * 0.032)
        }
        .frame(width: diameter, height: diameter)
    }

    private var specular: some View {
        ZStack {
            Ellipse()
                .fill(
                    LinearGradient(
                        colors: [Color.white.opacity(0.78), Color.white.opacity(0)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .frame(width: diameter * 0.52, height: diameter * 0.3)
                .offset(y: -diameter * 0.27)
            Circle()
                .fill(Color.white.opacity(0.9))
                .frame(width: max(1.5, diameter * 0.04), height: max(1.5, diameter * 0.04))
                .blur(radius: diameter * 0.006)
                .offset(x: diameter * 0.2, y: -diameter * 0.3)
        }
        .rotationEffect(.degrees(-28))
    }

    private var glyphSize: CGFloat {
        monogram.count > 1 ? diameter * 0.34 : diameter * 0.44
    }

    private var glyphWeight: Font.Weight {
        side < 80 ? .regular : .light
    }

    private var glyph: some View {
        Text(monogram)
            .font(.system(size: glyphSize, weight: glyphWeight, design: .rounded))
            .foregroundStyle(AuroraPalette.frost)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .frame(width: diameter * 0.66)
            .shadow(color: AuroraPalette.mint.opacity(0.85), radius: side * 0.035)
            .shadow(color: AuroraPalette.violet.opacity(0.55), radius: side * 0.09)
    }
}

// MARK: - Burst

/// Unsealing: a bloom of light, then aurora ribbons sweep across and dissolve.
struct AuroraBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate: Date?
    @State private var isFinished = false

    var body: some View {
        ZStack {
            Color.clear
            if let startDate, !isFinished {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { timeline in
                    Canvas { context, size in
                        AuroraBurstPainter.draw(
                            in: &context,
                            size: size,
                            elapsed: timeline.date.timeIntervalSince(startDate),
                            sweeps: !reduceMotion
                        )
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .onAppear {
            if startDate == nil {
                startDate = .now
            }
        }
        .task {
            try? await Task.sleep(for: .seconds(AuroraBurstPainter.duration + 0.15))
            isFinished = true
        }
    }
}

private struct AuroraRibbon {
    /// Unit coordinates of the ribbon's path ends (may lie slightly off-canvas).
    let start: CGPoint
    let end: CGPoint
    /// Wobble amplitude as a fraction of the shorter side.
    let amplitude: CGFloat
    let waves: Double
    let phase: Double
    let width: CGFloat
    let delay: Double
    let colors: [Color]
}

private enum AuroraBurstPainter {
    static let duration: Double = 2.3

    static let ribbons: [AuroraRibbon] = [
        AuroraRibbon(
            start: CGPoint(x: -0.15, y: 0.86), end: CGPoint(x: 1.15, y: 0.18),
            amplitude: 0.06, waves: 1.3, phase: 0, width: 38, delay: 0,
            colors: [AuroraPalette.teal, AuroraPalette.mint, AuroraPalette.violet]
        ),
        AuroraRibbon(
            start: CGPoint(x: -0.15, y: 0.66), end: CGPoint(x: 1.15, y: 0.04),
            amplitude: 0.045, waves: 1.7, phase: 1.1, width: 24, delay: 0.12,
            colors: [AuroraPalette.mint, AuroraPalette.ice, AuroraPalette.mint]
        ),
        AuroraRibbon(
            start: CGPoint(x: -0.15, y: 1.02), end: CGPoint(x: 1.15, y: 0.36),
            amplitude: 0.07, waves: 1.0, phase: 2.3, width: 30, delay: 0.22,
            colors: [AuroraPalette.violet, AuroraPalette.mint, AuroraPalette.teal]
        ),
        AuroraRibbon(
            start: CGPoint(x: 1.15, y: 0.92), end: CGPoint(x: -0.15, y: 0.26),
            amplitude: 0.05, waves: 1.4, phase: 3.7, width: 20, delay: 0.34,
            colors: [AuroraPalette.violet, AuroraPalette.rose, AuroraPalette.violet]
        )
    ]

    /// Widths (× the ribbon's width) and opacities of the nested strokes that make a ribbon's glow.
    /// Summed, they follow a Gaussian-blurred stroke of the ribbon's width (blur ≈ 0.45 × width).
    private static let glowLayers: [(width: CGFloat, opacity: Double)] = [
        (width: 2.7, opacity: 0.05),
        (width: 2.15, opacity: 0.11),
        (width: 1.6, opacity: 0.18),
        (width: 1.1, opacity: 0.2),
        (width: 0.6, opacity: 0.16)
    ]

    static func draw(in context: inout GraphicsContext, size: CGSize, elapsed: Double, sweeps: Bool) {
        guard elapsed >= 0, elapsed < duration, size.width > 0, size.height > 0 else { return }
        var light = context
        light.blendMode = .plusLighter
        drawBloom(in: &light, size: size, elapsed: elapsed)
        guard sweeps else { return }
        for ribbon in ribbons {
            drawRibbon(ribbon, in: &light, size: size, elapsed: elapsed)
        }
        drawMotes(in: &light, size: size, elapsed: elapsed)
    }

    private static func drawBloom(in context: inout GraphicsContext, size: CGSize, elapsed: Double) {
        let rise = auroraEaseOut(elapsed / 0.35)
        let fall = auroraClamp(1 - (elapsed - 0.3) / 1.7)
        let strength = rise * fall * fall
        guard strength > 0.001 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let reach = max(size.width, size.height) * CGFloat(0.22 + 0.4 * auroraEaseOut(elapsed / 1.6))
        let gradient = Gradient(stops: [
            Gradient.Stop(color: Color.white.opacity(0.5 * strength), location: 0),
            Gradient.Stop(color: AuroraPalette.mint.opacity(0.42 * strength), location: 0.25),
            Gradient.Stop(color: AuroraPalette.violet.opacity(0.2 * strength), location: 0.6),
            Gradient.Stop(color: AuroraPalette.violet.opacity(0), location: 1)
        ])
        context.fill(
            auroraDot(center, reach),
            with: .radialGradient(gradient, center: center, startRadius: 0, endRadius: reach)
        )
    }

    private static func drawRibbon(_ ribbon: AuroraRibbon, in context: inout GraphicsContext, size: CGSize, elapsed: Double) {
        let progress = auroraClamp((elapsed - ribbon.delay) / 1.5)
        guard progress > 0, progress < 1 else { return }
        let head = auroraEaseOut(progress) * 1.5
        let from = CGFloat(auroraClamp(head - 0.65))
        let to = CGFloat(auroraClamp(head))
        guard to > from else { return }
        let envelope = sin(progress * .pi)
        let unit = min(size.width, size.height)
        let start = CGPoint(x: ribbon.start.x * size.width, y: ribbon.start.y * size.height)
        let end = CGPoint(x: ribbon.end.x * size.width, y: ribbon.end.y * size.height)
        let path = auroraWavePath(
            from: start,
            to: end,
            amplitude: ribbon.amplitude * unit,
            waves: ribbon.waves,
            phase: ribbon.phase + elapsed * 1.6
        )
        .trimmedPath(from: from, to: to)
        let shading = GraphicsContext.Shading.linearGradient(
            Gradient(colors: ribbon.colors),
            startPoint: start,
            endPoint: end
        )

        // The soft veil is built from a few nested strokes whose light adds up (plus-lighter)
        // to the profile of a blurred stroke, so no offscreen blur pass runs every frame.
        for layer in glowLayers {
            var veil = context
            veil.opacity = envelope * 0.75 * layer.opacity
            veil.stroke(
                path,
                with: shading,
                style: StrokeStyle(lineWidth: ribbon.width * layer.width, lineCap: .round, lineJoin: .round)
            )
        }

        var core = context
        core.opacity = envelope * 0.8
        core.stroke(
            path,
            with: .color(Color.white.opacity(0.55)),
            style: StrokeStyle(lineWidth: max(1.5, ribbon.width * 0.08), lineCap: .round)
        )
    }

    private static func drawMotes(in context: inout GraphicsContext, size: CGSize, elapsed: Double) {
        let progress = auroraClamp(elapsed / 2.1)
        guard progress < 1 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let reach = min(size.width, size.height) * 0.5
        for index in 0..<28 {
            let angle = auroraRandom(index, 21) * 2 * .pi
            let distance = (0.25 + auroraRandom(index, 22) * 0.75) * auroraEaseOut(progress * 1.2)
            let lift = CGFloat(progress * 40 * auroraRandom(index, 23))
            let point = CGPoint(
                x: center.x + CGFloat(cos(angle) * distance) * reach,
                y: center.y + CGFloat(sin(angle) * distance) * reach - lift
            )
            let fade = (1 - progress) * (0.6 + 0.4 * sin(elapsed * 9 + Double(index)))
            let radius = CGFloat(1 + auroraRandom(index, 24) * 1.8)
            let color = index % 3 == 0 ? AuroraPalette.violet : AuroraPalette.mint
            context.fill(auroraDot(point, radius), with: .color(color.opacity(fade)))
        }
    }
}

/// A gently undulating line from `start` to `end` (sine wobble perpendicular to the chord).
private func auroraWavePath(from start: CGPoint, to end: CGPoint, amplitude: CGFloat, waves: Double, phase: Double) -> Path {
    let dx = end.x - start.x
    let dy = end.y - start.y
    let length = max((dx * dx + dy * dy).squareRoot(), 1)
    let normalX = -dy / length
    let normalY = dx / length
    var path = Path()
    let steps = 48
    for step in 0...steps {
        let u = Double(step) / Double(steps)
        let wobble = amplitude * CGFloat(sin(u * waves * 2 * .pi + phase))
        let point = CGPoint(
            x: start.x + dx * CGFloat(u) + normalX * wobble,
            y: start.y + dy * CGFloat(u) + normalY * wobble
        )
        if step == 0 {
            path.move(to: point)
        } else {
            path.addLine(to: point)
        }
    }
    return path
}

// MARK: - Stationery

/// A frosted glass sheet with a faint aurora glowing along its top edge.
struct AuroraStationery: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.aurora.cornerRadius, style: .continuous)
        ZStack(alignment: .top) {
            shape.fill(.ultraThinMaterial)
            shape.fill(Color(hex: 0x0B1230, opacity: 0.74))
            AuroraSheetCornerGlow()
            AuroraSheetEdgeGlow()
            AuroraSheetSparkles()
        }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(AuroraSheetStyle.stroke, lineWidth: 0.75)
        }
    }
}

private enum AuroraSheetStyle {
    static let stroke = LinearGradient(
        colors: [Color.white.opacity(0.28), Color.white.opacity(0.06), AuroraPalette.mint.opacity(0.12)],
        startPoint: .top,
        endPoint: .bottom
    )

    static let edgeFade = LinearGradient(
        stops: [
            Gradient.Stop(color: Color.white.opacity(0), location: 0),
            Gradient.Stop(color: Color.white, location: 0.18),
            Gradient.Stop(color: Color.white, location: 0.82),
            Gradient.Stop(color: Color.white.opacity(0), location: 1)
        ],
        startPoint: .leading,
        endPoint: .trailing
    )
}

private struct AuroraSheetEdgeGlow: View {
    var body: some View {
        VStack(spacing: 0) {
            ZStack(alignment: .top) {
                MeshGradient(
                    width: 3,
                    height: 2,
                    points: [
                        SIMD2<Float>(0, 0), SIMD2<Float>(0.5, 0), SIMD2<Float>(1, 0),
                        SIMD2<Float>(0, 1), SIMD2<Float>(0.58, 0.82), SIMD2<Float>(1, 1)
                    ],
                    colors: [
                        AuroraPalette.teal.opacity(0.3), AuroraPalette.mint.opacity(0.24), AuroraPalette.violet.opacity(0.28),
                        AuroraPalette.teal.opacity(0), AuroraPalette.mint.opacity(0), AuroraPalette.violet.opacity(0)
                    ]
                )
                .frame(height: 120)
                LinearGradient(
                    colors: [AuroraPalette.teal, AuroraPalette.mint, AuroraPalette.violet],
                    startPoint: .leading,
                    endPoint: .trailing
                )
                .frame(height: 1.5)
                .opacity(0.9)
            }
            .mask {
                AuroraSheetStyle.edgeFade
            }
            Spacer(minLength: 0)
        }
    }
}

private struct AuroraSheetCornerGlow: View {
    var body: some View {
        EllipticalGradient(
            colors: [AuroraPalette.violet.opacity(0.12), AuroraPalette.violet.opacity(0)],
            center: .bottomTrailing,
            startRadiusFraction: 0,
            endRadiusFraction: 0.6
        )
    }
}

/// A few tiny stars caught in the top glow; the reading area stays clean.
private struct AuroraSheetSparkles: View {
    var body: some View {
        Canvas { context, size in
            for index in 0..<9 {
                let point = CGPoint(
                    x: CGFloat(0.08 + auroraRandom(index, 31) * 0.84) * size.width,
                    y: CGFloat(6 + auroraRandom(index, 32) * 44)
                )
                let radius = CGFloat(0.5 + auroraRandom(index, 33) * 0.7)
                let alpha = 0.22 + auroraRandom(index, 34) * 0.33
                context.fill(auroraDot(point, radius), with: .color(Color.white.opacity(alpha)))
            }
        }
    }
}

// MARK: - Preview

#Preview("Aurora") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 32) {
            AuroraSeal(monogram: "BW")
                .frame(width: 160, height: 160)
            HStack(spacing: 20) {
                AuroraSeal(monogram: "高")
                    .frame(width: 40, height: 40)
                AuroraSeal(monogram: "M")
                    .frame(width: 64, height: 64)
            }
            AuroraStationery()
                .frame(height: 260)
                .overlay(alignment: .topLeading) {
                    Text(verbatim: "Dear future me,")
                        .font(Theme.aurora.body(19))
                        .foregroundStyle(Theme.aurora.ink)
                        .padding(28)
                }
                .padding(.horizontal, 24)
        }
    }
    .theme(.aurora)
}

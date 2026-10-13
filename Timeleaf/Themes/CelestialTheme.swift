import SwiftUI

// Celestial 星河 — the Milky Way and a gold astrolabe.
// A deep night sky with twinkling stars, a haze of galaxy light, the Big Dipper (北斗七星)
// turning slowly around Polaris, and now and then a shooting star.

// MARK: - Tokens

extension Theme {
    static let celestial = Theme(
        id: .celestial,
        name: "Celestial",
        nativeName: "星河",
        tagline: String(localized: "Written in the stars, opened in their time."),
        colorScheme: .dark,
        background: Color(hex: 0x05060F),
        surface: Color(hex: 0x0E1431, opacity: 0.88),
        surfaceStroke: Color(hex: 0xD4AF6A, opacity: 0.26),
        ink: Color(hex: 0xF4EFE2),
        inkSecondary: Color(hex: 0xB8B3C6),
        accent: Color(hex: 0xD4AF6A),
        accentInk: Color(hex: 0x15100A),
        glow: Color(hex: 0xF0D59A),
        seal: Color(hex: 0xD4AF6A),
        gradient: [Color(hex: 0x0B1030), Color(hex: 0x27306B), Color(hex: 0xD4AF6A)],
        cornerRadius: 20,
        displayFontName: "Didot",
        bodyFontName: "Cochin",
        fontDesign: .serif,
        usesMaterial: false
    )
}

// MARK: - Palette & math

private enum CelestialPalette {
    static let night = Color(hex: 0x05060F)
    static let gold = Color(hex: 0xD4AF6A)
    static let paleGold = Color(hex: 0xF3DDA6)
    static let deepGold = Color(hex: 0x9A7536)
    static let starlight = Color(hex: 0xF7F3EA)
    static let blueStar = Color(hex: 0xC4D5FF)
    static let engraving = Color(hex: 0x3E2B10)

    static func star(_ tint: Int) -> Color {
        switch tint {
        case 1: blueStar
        case 2: paleGold
        default: starlight
        }
    }
}

/// Deterministic pseudo-random number in 0..<1, stable for a given index and salt.
private func celestialRandom(_ index: Int, _ salt: Double) -> Double {
    let value = sin(Double(index) * 127.1 + salt * 311.7) * 43_758.5453
    return value - value.rounded(.down)
}

private func celestialClamp(_ value: Double) -> Double {
    min(max(value, 0), 1)
}

private func celestialEaseOut(_ value: Double) -> Double {
    let x = celestialClamp(value)
    return 1 - (1 - x) * (1 - x) * (1 - x)
}

private func celestialSmoothstep(_ edge0: Double, _ edge1: Double, _ value: Double) -> Double {
    let x = celestialClamp((value - edge0) / (edge1 - edge0))
    return x * x * (3 - 2 * x)
}

private func celestialCircle(_ center: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
}

private func celestialPolar(_ center: CGPoint, _ angle: Double, _ distance: CGFloat) -> CGPoint {
    CGPoint(x: center.x + CGFloat(cos(angle)) * distance, y: center.y + CGFloat(sin(angle)) * distance)
}

/// A four-pointed sparkle with gently concave sides.
private func celestialSparkle(_ center: CGPoint, _ radius: CGFloat) -> Path {
    let waist = radius * 0.18
    var path = Path()
    path.move(to: CGPoint(x: center.x, y: center.y - radius))
    path.addQuadCurve(to: CGPoint(x: center.x + radius, y: center.y), control: CGPoint(x: center.x + waist, y: center.y - waist))
    path.addQuadCurve(to: CGPoint(x: center.x, y: center.y + radius), control: CGPoint(x: center.x + waist, y: center.y + waist))
    path.addQuadCurve(to: CGPoint(x: center.x - radius, y: center.y), control: CGPoint(x: center.x - waist, y: center.y + waist))
    path.addQuadCurve(to: CGPoint(x: center.x, y: center.y - radius), control: CGPoint(x: center.x - waist, y: center.y - waist))
    path.closeSubpath()
    return path
}

/// Adds a line that stops short of both end points, the way star charts leave stars breathing room.
private func celestialAddGappedLine(_ path: inout Path, from start: CGPoint, to end: CGPoint, gap: CGFloat) {
    let dx = end.x - start.x
    let dy = end.y - start.y
    let length = (dx * dx + dy * dy).squareRoot()
    guard length > gap * 2.5 else { return }
    let ux = dx / length
    let uy = dy / length
    path.move(to: CGPoint(x: start.x + ux * gap, y: start.y + uy * gap))
    path.addLine(to: CGPoint(x: end.x - ux * gap, y: end.y - uy * gap))
}

/// A soft radial glow around a point.
private func celestialHalo(in context: inout GraphicsContext, at center: CGPoint, radius: CGFloat, color: Color, alpha: Double) {
    guard alpha > 0.002, radius > 0 else { return }
    context.fill(
        celestialCircle(center, radius),
        with: .radialGradient(
            Gradient(colors: [color.opacity(alpha), color.opacity(0)]),
            center: center,
            startRadius: 0,
            endRadius: radius
        )
    )
}

// MARK: - Background

/// A twinkling starfield over a faint Milky Way, with the Big Dipper turning around Polaris
/// and a shooting star every nine seconds.
struct CelestialBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            CelestialDepth()
            CelestialMilkyWay()
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
                let time = reduceMotion ? 120 : timeline.date.timeIntervalSinceReferenceDate
                Canvas { context, size in
                    CelestialSkyPainter.draw(in: &context, size: size, time: time, showsMeteor: !reduceMotion)
                }
            }
        }
    }
}

/// Deep-navy depth so the night is never a flat black.
private struct CelestialDepth: View {
    var body: some View {
        ZStack {
            EllipticalGradient(
                colors: [Color(hex: 0x151C48, opacity: 0.8), Color(hex: 0x0A0E26, opacity: 0.45), Color(hex: 0x0A0E26, opacity: 0)],
                center: UnitPoint(x: 0.7, y: 0.12),
                startRadiusFraction: 0,
                endRadiusFraction: 0.9
            )
            EllipticalGradient(
                colors: [Color(hex: 0x2A1838, opacity: 0.32), Color(hex: 0x2A1838, opacity: 0)],
                center: UnitPoint(x: 0.1, y: 0.95),
                startRadiusFraction: 0,
                endRadiusFraction: 0.65
            )
        }
    }
}

/// A diagonal band of galaxy light with a darker dust lane, very faint. Built from elliptical
/// gradients (soft in every direction) so the ambient layer never pays for a large blur.
private struct CelestialMilkyWay: View {
    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let height = proxy.size.height
            let length = (width * width + height * height).squareRoot() * 1.25
            ZStack {
                CelestialMilkyWay.haze
                    .frame(width: length, height: max(height * 0.34, 140))
                CelestialMilkyWay.core
                    .frame(width: length * 0.8, height: max(height * 0.11, 44))
                CelestialMilkyWay.dust
                    .frame(width: length * 0.62, height: max(height * 0.03, 10))
                    .offset(y: height * 0.012)
            }
            .rotationEffect(.degrees(-32))
            .position(x: width * 0.55, y: height * 0.36)
        }
    }

    private static let haze = EllipticalGradient(
        colors: [Color(hex: 0xE8DCC6, opacity: 0.1), Color(hex: 0x9AA4D8, opacity: 0.06), Color(hex: 0x9C8BD0, opacity: 0)],
        center: .center,
        startRadiusFraction: 0,
        endRadiusFraction: 0.5
    )

    private static let core = EllipticalGradient(
        colors: [Color(hex: 0xF1E6CF, opacity: 0.09), Color(hex: 0xF1E6CF, opacity: 0)],
        center: .center,
        startRadiusFraction: 0,
        endRadiusFraction: 0.5
    )

    private static let dust = EllipticalGradient(
        colors: [Color.black.opacity(0.22), Color.black.opacity(0)],
        center: .center,
        startRadiusFraction: 0,
        endRadiusFraction: 0.5
    )
}

private struct CelestialStar {
    /// For band stars: position along the Milky Way (0...1); otherwise unit x.
    let along: Double
    /// For band stars: signed offset across the band (-1...1); otherwise unit y.
    let across: Double
    let onBand: Bool
    let radius: Double
    let brightness: Double
    let speed: Double
    let phase: Double
    let tint: Int
}

private enum CelestialSky {
    /// 96 field stars + 7 Dipper stars + Polaris + 1 meteor = 105 particles.
    static let stars: [CelestialStar] = (0..<96).map { (index: Int) -> CelestialStar in
        let onBand = index < 38
        let sizeRoll = celestialRandom(index, 3)
        let radius = sizeRoll > 0.93
            ? 1.5 + celestialRandom(index, 4) * 0.8
            : 0.45 + celestialRandom(index, 4) * 0.75
        let tintRoll = celestialRandom(index, 8)
        let across = onBand
            ? celestialRandom(index, 2) + celestialRandom(index, 9) - 1
            : celestialRandom(index, 2)
        return CelestialStar(
            along: celestialRandom(index, 1),
            across: across,
            onBand: onBand,
            radius: radius,
            brightness: 0.35 + celestialRandom(index, 5) * 0.6,
            speed: 0.5 + celestialRandom(index, 6) * 1.6,
            phase: celestialRandom(index, 7) * 2 * .pi,
            tint: tintRoll > 0.86 ? 2 : (tintRoll > 0.7 ? 1 : 0)
        )
    }

    /// The Big Dipper in a polar projection around Polaris (degrees from the pole, screen orientation):
    /// Dubhe, Merak, Phecda, Megrez, Alioth, Mizar, Alkaid.
    static let dipper: [CGPoint] = [
        CGPoint(x: -27.4, y: -7.0),
        CGPoint(x: -32.5, y: -8.6),
        CGPoint(x: -36.3, y: -1.1),
        CGPoint(x: -32.9, y: 2.2),
        CGPoint(x: -33.1, y: 8.0),
        CGPoint(x: -32.8, y: 12.4),
        CGPoint(x: -36.3, y: 18.3)
    ]

    static let dipperLinks: [(Int, Int)] = [(6, 5), (5, 4), (4, 3), (3, 2), (2, 1), (1, 0), (0, 3)]
}

private enum CelestialSkyPainter {
    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double, showsMeteor: Bool) {
        guard size.width > 0, size.height > 0 else { return }
        drawStars(in: &context, size: size, time: time)
        drawConstellation(in: &context, size: size, time: time)
        if showsMeteor {
            drawMeteor(in: &context, size: size, time: time)
        }
    }

    private static func drawStars(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let width = Double(size.width)
        let height = Double(size.height)
        let bandAngle = -32.0 * Double.pi / 180
        let dirX = cos(bandAngle)
        let dirY = sin(bandAngle)
        let bandLength = (width * width + height * height).squareRoot() * 0.95
        let bandCenterX = width * 0.55
        let bandCenterY = height * 0.36
        for star in CelestialSky.stars {
            let x: Double
            let y: Double
            if star.onBand {
                let along = (star.along - 0.5) * bandLength
                let across = star.across * height * 0.075
                x = bandCenterX + dirX * along - dirY * across
                y = bandCenterY + dirY * along + dirX * across
            } else {
                x = star.along * width
                y = star.across * height
            }
            let nx = (x / width - 0.5) / 0.5
            let ny = (y / height - 0.5) / 0.42
            let calm = 0.35 + 0.65 * celestialSmoothstep(0.15, 0.95, (nx * nx + ny * ny).squareRoot())
            let twinkle = 0.55 + 0.45 * sin(time * star.speed + star.phase)
            let alpha = star.brightness * twinkle * calm
            let radius = CGFloat(star.radius)
            let center = CGPoint(x: x, y: y)
            let color = CelestialPalette.star(star.tint)
            if radius > 1.3 {
                celestialHalo(in: &context, at: center, radius: radius * 5, color: color, alpha: alpha * 0.32)
            }
            if radius > 1.9 {
                var glint = Path()
                glint.move(to: CGPoint(x: center.x - radius * 5, y: center.y))
                glint.addLine(to: CGPoint(x: center.x + radius * 5, y: center.y))
                glint.move(to: CGPoint(x: center.x, y: center.y - radius * 5))
                glint.addLine(to: CGPoint(x: center.x, y: center.y + radius * 5))
                context.stroke(glint, with: .color(color.opacity(alpha * 0.3)), lineWidth: 0.5)
            }
            context.fill(celestialCircle(center, radius), with: .color(color.opacity(alpha)))
        }
    }

    /// The Big Dipper, in gold hairlines, circling Polaris once every five minutes.
    private static func drawConstellation(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let unit = Double(min(size.width, size.height)) * 0.3 / 36
        let pole = CGPoint(x: size.width * 0.7, y: size.height * 0.17)
        let turns = (time / 300).truncatingRemainder(dividingBy: 1)
        let angle = -turns * 2 * .pi
        let cosA = cos(angle)
        let sinA = sin(angle)
        let points: [CGPoint] = CelestialSky.dipper.map { (star: CGPoint) -> CGPoint in
            let x = Double(star.x) * cosA - Double(star.y) * sinA
            let y = Double(star.x) * sinA + Double(star.y) * cosA
            return CGPoint(x: Double(pole.x) + x * unit, y: Double(pole.y) + y * unit)
        }
        let breathe = 0.8 + 0.2 * sin(time * 2 * .pi / 11)

        var lines = Path()
        for link in CelestialSky.dipperLinks {
            celestialAddGappedLine(&lines, from: points[link.0], to: points[link.1], gap: 4)
        }
        context.stroke(lines, with: .color(CelestialPalette.gold.opacity(0.3 * breathe)), lineWidth: 0.6)

        // The pointer stars lead the eye home, to the North Star.
        var pointer = Path()
        celestialAddGappedLine(&pointer, from: points[0], to: pole, gap: 6)
        context.stroke(
            pointer,
            with: .color(CelestialPalette.gold.opacity(0.14 * breathe)),
            style: StrokeStyle(lineWidth: 0.5, dash: [1.5, 4])
        )

        for (index, point) in points.enumerated() {
            let twinkle = 0.75 + 0.25 * sin(time * 1.3 + Double(index) * 1.9)
            celestialHalo(in: &context, at: point, radius: 6, color: CelestialPalette.paleGold, alpha: 0.28 * twinkle)
            context.fill(celestialCircle(point, 1.3), with: .color(CelestialPalette.paleGold.opacity(0.85 * twinkle)))
        }

        celestialHalo(in: &context, at: pole, radius: 10, color: CelestialPalette.paleGold, alpha: 0.32)
        var polarisGlint = Path()
        polarisGlint.move(to: CGPoint(x: pole.x - 7, y: pole.y))
        polarisGlint.addLine(to: CGPoint(x: pole.x + 7, y: pole.y))
        polarisGlint.move(to: CGPoint(x: pole.x, y: pole.y - 7))
        polarisGlint.addLine(to: CGPoint(x: pole.x, y: pole.y + 7))
        context.stroke(polarisGlint, with: .color(CelestialPalette.paleGold.opacity(0.3)), lineWidth: 0.5)
        context.fill(celestialCircle(pole, 1.7), with: .color(CelestialPalette.starlight.opacity(0.95)))
    }

    /// One shooting star per nine-second cycle, its path seeded by the cycle number.
    private static func drawMeteor(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let period = 9.0
        let duration = 1.3
        let cycle = (time / period).rounded(.down)
        let local = time - cycle * period
        guard local < duration else { return }
        let seed = Int(cycle.truncatingRemainder(dividingBy: 10_000))
        let progress = local / duration
        let start = CGPoint(
            x: (0.25 + celestialRandom(seed, 31) * 0.65) * Double(size.width),
            y: (0.04 + celestialRandom(seed, 32) * 0.26) * Double(size.height)
        )
        let heading = Double.pi * (0.7 + celestialRandom(seed, 33) * 0.12)
        let travel = min(size.width, size.height) * CGFloat(0.38 + celestialRandom(seed, 34) * 0.2)
        let eased = 1 - (1 - progress) * (1 - progress)
        let head = celestialPolar(start, heading, travel * CGFloat(eased))
        let fade = sin(progress * .pi)
        let tail = celestialPolar(head, heading + .pi, CGFloat(60 + 70 * fade))

        var streak = Path()
        streak.move(to: tail)
        streak.addLine(to: head)
        context.stroke(
            streak,
            with: .linearGradient(
                Gradient(colors: [CelestialPalette.starlight.opacity(0), CelestialPalette.starlight.opacity(0.85 * fade)]),
                startPoint: tail,
                endPoint: head
            ),
            style: StrokeStyle(lineWidth: 1.2, lineCap: .round)
        )
        celestialHalo(in: &context, at: head, radius: 6, color: CelestialPalette.starlight, alpha: 0.35 * fade)
        context.fill(celestialCircle(head, 1.3), with: .color(Color.white.opacity(0.95 * fade)))
    }
}

// MARK: - Seal

/// A gold astrolabe medallion: engraved outer ring, navy enamel field, an eight-point
/// compass star and the monogram set in gold.
struct CelestialSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            CelestialMedallion(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
    }
}

private struct CelestialMedallion: View {
    let monogram: String
    let side: CGFloat

    /// Must match `CelestialMedallionPainter`'s threshold (radius ≥ 45).
    private var isDetailed: Bool { side >= 90 }

    var body: some View {
        ZStack {
            aura
            Canvas { context, size in
                CelestialMedallionPainter.draw(in: &context, size: size)
            }
            .shadow(color: Color.black.opacity(0.45), radius: side * 0.03, x: 0, y: side * 0.02)
            glyph
        }
    }

    private var aura: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [CelestialPalette.gold.opacity(0.38), CelestialPalette.gold.opacity(0)],
                    center: .center,
                    startRadius: side * 0.42,
                    endRadius: side * 0.5
                )
            )
    }

    private var glyphSize: CGFloat {
        let isPair = monogram.count > 1
        if isDetailed {
            return side * (isPair ? 0.19 : 0.26)
        }
        return side * (isPair ? 0.21 : 0.29)
    }

    private var glyphFont: Font {
        if isDetailed {
            return Font.custom("Didot", fixedSize: glyphSize).weight(.bold)
        }
        return Font.custom("Cochin", fixedSize: glyphSize).weight(.bold)
    }

    private var glyph: some View {
        Text(monogram)
            .font(glyphFont)
            .foregroundStyle(
                LinearGradient(
                    colors: [Color(hex: 0xFFF1C9), Color(hex: 0xE6C47F), Color(hex: 0xB88F4C)],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: side * (isDetailed ? 0.34 : 0.42))
            .shadow(color: Color.black.opacity(0.55), radius: max(0.5, side * 0.006), x: 0, y: max(0.5, side * 0.005))
    }
}

private enum CelestialMedallionPainter {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let radius = min(size.width, size.height) / 2
        guard radius > 1 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let detailed = radius >= 45
        let rim = radius * 0.94
        drawRim(in: &context, center: center, rim: rim, detailed: detailed)
        drawField(in: &context, center: center, rim: rim, detailed: detailed)
        drawCompass(in: &context, center: center, rim: rim, detailed: detailed)
        drawHub(in: &context, center: center, rim: rim, detailed: detailed)
    }

    /// Polished gold disc with a bevel and an engraved degree scale.
    private static func drawRim(in context: inout GraphicsContext, center: CGPoint, rim: CGFloat, detailed: Bool) {
        let metal = Gradient(stops: [
            Gradient.Stop(color: Color(hex: 0xFFF2CC), location: 0),
            Gradient.Stop(color: Color(hex: 0xE4C483), location: 0.35),
            Gradient.Stop(color: Color(hex: 0xB38B48), location: 0.7),
            Gradient.Stop(color: Color(hex: 0x6E4F22), location: 1)
        ])
        context.fill(
            celestialCircle(center, rim),
            with: .radialGradient(
                metal,
                center: CGPoint(x: center.x - rim * 0.45, y: center.y - rim * 0.5),
                startRadius: 0,
                endRadius: rim * 2.1
            )
        )

        let bevel = rim * 0.035
        context.stroke(
            celestialCircle(center, rim - bevel / 2),
            with: .linearGradient(
                Gradient(colors: [Color(hex: 0xFFF4D6), Color(hex: 0x8C6A30), Color(hex: 0xF0D59A), Color(hex: 0x5C421C)]),
                startPoint: CGPoint(x: center.x - rim, y: center.y - rim),
                endPoint: CGPoint(x: center.x + rim, y: center.y + rim)
            ),
            lineWidth: bevel
        )

        let hairline = max(0.4, rim * 0.008)
        context.stroke(celestialCircle(center, rim * 0.955), with: .color(CelestialPalette.engraving.opacity(0.55)), lineWidth: hairline)
        context.stroke(celestialCircle(center, rim * 0.86), with: .color(CelestialPalette.engraving.opacity(0.55)), lineWidth: hairline)

        let count = detailed ? 72 : 24
        let majorEvery = count / 12
        var minor = Path()
        var major = Path()
        for index in 0..<count {
            let angle = Double(index) / Double(count) * 2 * .pi - .pi / 2
            let isMajor = index % majorEvery == 0
            let inner = celestialPolar(center, angle, rim * (isMajor ? 0.865 : 0.905))
            let outer = celestialPolar(center, angle, rim * 0.95)
            if isMajor {
                major.move(to: inner)
                major.addLine(to: outer)
            } else {
                minor.move(to: inner)
                minor.addLine(to: outer)
            }
        }
        context.stroke(minor, with: .color(CelestialPalette.engraving.opacity(0.6)), lineWidth: hairline)
        context.stroke(major, with: .color(CelestialPalette.engraving.opacity(0.8)), lineWidth: max(0.6, rim * 0.016))
    }

    /// Recessed navy enamel with gold rules, a dotted circle and a scatter of tiny stars.
    private static func drawField(in context: inout GraphicsContext, center: CGPoint, rim: CGFloat, detailed: Bool) {
        let field = rim * 0.82
        context.fill(
            celestialCircle(center, field),
            with: .radialGradient(
                Gradient(colors: [Color(hex: 0x1E2763), Color(hex: 0x0D1236), Color(hex: 0x060920)]),
                center: CGPoint(x: center.x - field * 0.2, y: center.y - field * 0.25),
                startRadius: 0,
                endRadius: field * 1.25
            )
        )
        context.stroke(celestialCircle(center, field - rim * 0.02), with: .color(Color.black.opacity(0.45)), lineWidth: rim * 0.04)
        context.stroke(celestialCircle(center, field), with: .color(CelestialPalette.paleGold.opacity(0.9)), lineWidth: max(0.5, rim * 0.014))
        context.stroke(celestialCircle(center, rim * 0.75), with: .color(CelestialPalette.gold.opacity(0.45)), lineWidth: max(0.35, rim * 0.006))

        guard detailed else { return }
        var dots = Path()
        let dotRadius = max(0.35, rim * 0.007)
        for index in 0..<60 {
            let point = celestialPolar(center, Double(index) / 60 * 2 * .pi, rim * 0.68)
            dots.addEllipse(in: CGRect(x: point.x - dotRadius, y: point.y - dotRadius, width: dotRadius * 2, height: dotRadius * 2))
        }
        context.fill(dots, with: .color(CelestialPalette.gold.opacity(0.5)))

        for index in 0..<14 {
            let angle = celestialRandom(index, 61) * 2 * .pi
            let distance = rim * CGFloat(0.46 + celestialRandom(index, 62) * 0.26)
            let starRadius = rim * CGFloat(0.007 + celestialRandom(index, 63) * 0.008)
            let alpha = 0.35 + celestialRandom(index, 64) * 0.4
            context.fill(
                celestialCircle(celestialPolar(center, angle, distance), starRadius),
                with: .color(CelestialPalette.starlight.opacity(alpha))
            )
        }
    }

    /// An eight-point compass star: faceted gold points, diagonals behind the cardinals.
    private static func drawCompass(in context: inout GraphicsContext, center: CGPoint, rim: CGFloat, detailed: Bool) {
        if detailed {
            var rays = Path()
            for index in 0..<8 {
                let angle = Double(index) * .pi / 4 + .pi / 8 - .pi / 2
                rays.move(to: celestialPolar(center, angle, rim * 0.2))
                rays.addLine(to: celestialPolar(center, angle, rim * 0.62))
            }
            context.stroke(rays, with: .color(CelestialPalette.gold.opacity(0.35)), lineWidth: max(0.35, rim * 0.005))
        }
        for index in 0..<4 {
            let angle = Double(index) * .pi / 2 + .pi / 4 - .pi / 2
            drawPoint(
                in: &context, center: center, angle: angle,
                tip: rim * 0.58, waist: rim * 0.11,
                light: Color(hex: 0xE0C084), dark: Color(hex: 0x8E6A32), outlined: detailed
            )
        }
        for index in 0..<4 {
            let angle = Double(index) * .pi / 2 - .pi / 2
            drawPoint(
                in: &context, center: center, angle: angle,
                tip: rim * 0.72, waist: rim * 0.14,
                light: Color(hex: 0xF7E2AE), dark: Color(hex: 0xB08540), outlined: detailed
            )
        }
    }

    private static func drawPoint(
        in context: inout GraphicsContext,
        center: CGPoint,
        angle: Double,
        tip: CGFloat,
        waist: CGFloat,
        light: Color,
        dark: Color,
        outlined: Bool
    ) {
        let tipPoint = celestialPolar(center, angle, tip)
        let left = celestialPolar(center, angle - .pi / 4, waist)
        let right = celestialPolar(center, angle + .pi / 4, waist)
        var lightHalf = Path()
        lightHalf.move(to: center)
        lightHalf.addLine(to: tipPoint)
        lightHalf.addLine(to: left)
        lightHalf.closeSubpath()
        var darkHalf = Path()
        darkHalf.move(to: center)
        darkHalf.addLine(to: tipPoint)
        darkHalf.addLine(to: right)
        darkHalf.closeSubpath()
        context.fill(lightHalf, with: .color(light))
        context.fill(darkHalf, with: .color(dark))
        guard outlined else { return }
        var outline = Path()
        outline.move(to: left)
        outline.addLine(to: tipPoint)
        outline.addLine(to: right)
        context.stroke(outline, with: .color(Color(hex: 0x3A2A10, opacity: 0.5)), lineWidth: 0.5)
    }

    /// The navy hub that carries the monogram, ringed in gold.
    private static func drawHub(in context: inout GraphicsContext, center: CGPoint, rim: CGFloat, detailed: Bool) {
        let hub = rim * (detailed ? 0.4 : 0.5)
        context.fill(
            celestialCircle(CGPoint(x: center.x, y: center.y + rim * 0.015), hub + rim * 0.012),
            with: .color(Color.black.opacity(0.35))
        )
        context.fill(
            celestialCircle(center, hub),
            with: .radialGradient(
                Gradient(colors: [Color(hex: 0x1C2459), Color(hex: 0x0A0F2E)]),
                center: CGPoint(x: center.x - hub * 0.3, y: center.y - hub * 0.35),
                startRadius: 0,
                endRadius: hub * 1.4
            )
        )
        context.stroke(
            celestialCircle(center, hub),
            with: .linearGradient(
                Gradient(colors: [CelestialPalette.paleGold, CelestialPalette.deepGold, CelestialPalette.paleGold]),
                startPoint: CGPoint(x: center.x - hub, y: center.y - hub),
                endPoint: CGPoint(x: center.x + hub, y: center.y + hub)
            ),
            lineWidth: max(0.75, rim * 0.024)
        )
        if detailed {
            context.stroke(celestialCircle(center, hub * 0.88), with: .color(CelestialPalette.gold.opacity(0.4)), lineWidth: max(0.35, rim * 0.005))
        }
    }
}

// MARK: - Burst

/// Unsealing: a golden flash, a radial starburst, sparkles and four shooting stars flying outward.
struct CelestialBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate: Date?
    @State private var isFinished = false

    var body: some View {
        ZStack {
            Color.clear
            if let startDate, !isFinished {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { timeline in
                    Canvas { context, size in
                        CelestialBurstPainter.draw(
                            in: &context,
                            size: size,
                            elapsed: timeline.date.timeIntervalSince(startDate),
                            flies: !reduceMotion
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
            try? await Task.sleep(for: .seconds(CelestialBurstPainter.duration + 0.15))
            isFinished = true
        }
    }
}

private enum CelestialBurstPainter {
    static let duration: Double = 2.4

    static func draw(in context: inout GraphicsContext, size: CGSize, elapsed: Double, flies: Bool) {
        guard elapsed >= 0, elapsed < duration, size.width > 0, size.height > 0 else { return }
        var light = context
        light.blendMode = .plusLighter
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let reach = (size.width * size.width + size.height * size.height).squareRoot() / 2
        drawFlash(in: &light, center: center, reach: reach, elapsed: elapsed)
        drawShockRing(in: &light, center: center, reach: reach, elapsed: elapsed)
        drawRays(in: &light, center: center, reach: reach, elapsed: elapsed, grows: flies)
        guard flies else { return }
        drawSparkles(in: &light, center: center, reach: reach, elapsed: elapsed)
        drawShootingStars(in: &light, center: center, reach: reach, elapsed: elapsed)
    }

    private static func drawFlash(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let fall = celestialClamp(1 - (elapsed - 0.15) / 1.1)
        let strength = celestialEaseOut(elapsed / 0.18) * fall * fall
        guard strength > 0.001 else { return }
        let radius = reach * CGFloat(0.12 + 0.35 * celestialEaseOut(elapsed / 1.2))
        let gradient = Gradient(stops: [
            Gradient.Stop(color: Color.white.opacity(0.8 * strength), location: 0),
            Gradient.Stop(color: CelestialPalette.paleGold.opacity(0.5 * strength), location: 0.2),
            Gradient.Stop(color: CelestialPalette.gold.opacity(0.18 * strength), location: 0.55),
            Gradient.Stop(color: CelestialPalette.gold.opacity(0), location: 1)
        ])
        context.fill(
            celestialCircle(center, radius),
            with: .radialGradient(gradient, center: center, startRadius: 0, endRadius: radius)
        )
    }

    private static func drawShockRing(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let progress = celestialClamp(elapsed / 1.3)
        guard progress < 1 else { return }
        let radius = reach * 0.6 * CGFloat(celestialEaseOut(progress))
        let alpha = (1 - progress) * (1 - progress) * 0.7
        context.stroke(celestialCircle(center, radius), with: .color(CelestialPalette.paleGold.opacity(alpha)), lineWidth: 1.2)
    }

    private static func drawRays(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double, grows: Bool) {
        let fade = celestialClamp(1 - (elapsed - 0.25) / 1.25)
        guard fade > 0 else { return }
        let grow = grows ? celestialEaseOut(elapsed / 0.6) : 1
        let spin = grows ? elapsed * 0.12 : 0
        for index in 0..<24 {
            let isLong = index % 2 == 0
            let angle = Double(index) / 24 * 2 * .pi + spin
            let jitter = 0.8 + 0.4 * celestialRandom(index, 41)
            let length = reach * (isLong ? 0.5 : 0.28) * CGFloat(grow * jitter)
            guard length > 1 else { continue }
            let halfWidth: CGFloat = isLong ? 2.2 : 1.4
            let tip = celestialPolar(center, angle, length)
            var wedge = Path()
            wedge.move(to: celestialPolar(center, angle + .pi / 2, halfWidth))
            wedge.addLine(to: tip)
            wedge.addLine(to: celestialPolar(center, angle - .pi / 2, halfWidth))
            wedge.closeSubpath()
            context.fill(
                wedge,
                with: .linearGradient(
                    Gradient(colors: [CelestialPalette.paleGold.opacity(0.75 * fade), CelestialPalette.paleGold.opacity(0)]),
                    startPoint: center,
                    endPoint: tip
                )
            )
        }
    }

    private static func drawSparkles(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let progress = celestialClamp(elapsed / 2.1)
        guard progress < 1 else { return }
        for index in 0..<44 {
            let angle = celestialRandom(index, 51) * 2 * .pi
            let speed = 0.18 + celestialRandom(index, 52) * 0.42
            let point = celestialPolar(center, angle, reach * CGFloat(speed * celestialEaseOut(progress * 1.3)))
            let twinkle = 0.55 + 0.45 * sin(elapsed * (7 + celestialRandom(index, 53) * 6) + Double(index))
            let alpha = pow(1 - progress, 1.3) * twinkle
            let extent = CGFloat(1.6 + celestialRandom(index, 54) * 3.4)
            let color = index % 3 == 0 ? CelestialPalette.starlight : CelestialPalette.paleGold
            if extent > 3.4 {
                context.fill(celestialSparkle(point, extent), with: .color(color.opacity(alpha)))
            } else {
                context.fill(celestialCircle(point, extent * 0.45), with: .color(color.opacity(alpha)))
            }
        }
    }

    private static func drawShootingStars(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let headings: [Double] = [-0.62, 0.55, 2.45, 3.75]
        for (index, heading) in headings.enumerated() {
            let delay = 0.12 + Double(index) * 0.11
            let progress = celestialClamp((elapsed - delay) / 1.25)
            guard progress > 0, progress < 1 else { continue }
            let alpha = sin(progress * .pi)
            let head = celestialPolar(center, heading, reach * (0.06 + 0.92 * CGFloat(celestialEaseOut(progress))))
            let tail = celestialPolar(head, heading + .pi, reach * CGFloat(0.12 + 0.16 * alpha))
            var streak = Path()
            streak.move(to: tail)
            streak.addLine(to: head)
            context.stroke(
                streak,
                with: .linearGradient(
                    Gradient(colors: [CelestialPalette.starlight.opacity(0), CelestialPalette.starlight.opacity(0.9 * alpha)]),
                    startPoint: tail,
                    endPoint: head
                ),
                style: StrokeStyle(lineWidth: 1.6, lineCap: .round)
            )
            celestialHalo(in: &context, at: head, radius: 8, color: CelestialPalette.paleGold, alpha: 0.45 * alpha)
            context.fill(celestialCircle(head, 1.8), with: .color(Color.white.opacity(alpha)))
        }
    }
}

// MARK: - Stationery

/// Deep navy paper with a faint gold star chart in one corner, a crescent moon at its pole,
/// and tiny stars scattered only in the margins.
struct CelestialStationery: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.celestial.cornerRadius, style: .continuous)
        ZStack {
            shape
                .fill(
                    LinearGradient(
                        colors: [Color(hex: 0x111A3E), Color(hex: 0x0B112E)],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
                .shadow(color: Color.black.opacity(0.5), radius: 22, x: 0, y: 12)
            Canvas { context, size in
                CelestialChartPainter.draw(in: &context, size: size)
            }
            .clipShape(shape)
        }
        .overlay {
            shape.strokeBorder(CelestialPalette.gold.opacity(0.34), lineWidth: 0.75)
        }
    }
}

private enum CelestialChartPainter {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        guard size.width > 40, size.height > 40 else { return }
        let pole = CGPoint(x: size.width - 34, y: 34)
        drawChart(in: &context, pole: pole)
        drawMoon(in: &context, center: pole, radius: 7)
        drawLowerChart(in: &context, size: size)
        drawFrame(in: &context, size: size)
        drawMarginStars(in: &context, size: size)
    }

    /// Concentric declination circles and meridians radiating from the top-trailing corner,
    /// fading with distance so the reading area stays clean.
    private static func drawChart(in context: inout GraphicsContext, pole: CGPoint) {
        let radii: [CGFloat] = [26, 54, 88, 128, 174, 226]
        let alphas: [Double] = [0.22, 0.18, 0.14, 0.1, 0.07, 0.05]
        for (index, radius) in radii.enumerated() {
            let style = index % 2 == 1
                ? StrokeStyle(lineWidth: 0.5, dash: [2, 5])
                : StrokeStyle(lineWidth: 0.5)
            context.stroke(celestialCircle(pole, radius), with: .color(CelestialPalette.gold.opacity(alphas[index])), style: style)
        }

        var meridians = Path()
        for index in 0..<12 {
            let angle = Double(index) * .pi / 6
            meridians.move(to: celestialPolar(pole, angle, 16))
            meridians.addLine(to: celestialPolar(pole, angle, 236))
        }
        context.stroke(meridians, with: .color(CelestialPalette.gold.opacity(0.06)), lineWidth: 0.5)

        var ticks = Path()
        for degree in stride(from: 90, through: 180, by: 5) {
            let angle = Double(degree) * .pi / 180
            let length: CGFloat = degree % 15 == 0 ? 6 : 3
            ticks.move(to: celestialPolar(pole, angle, 128))
            ticks.addLine(to: celestialPolar(pole, angle, 128 + length))
        }
        context.stroke(ticks, with: .color(CelestialPalette.gold.opacity(0.14)), lineWidth: 0.5)
    }

    private static func drawMoon(in context: inout GraphicsContext, center: CGPoint, radius: CGFloat) {
        celestialHalo(in: &context, at: center, radius: radius * 2.8, color: CelestialPalette.paleGold, alpha: 0.14)
        var crescent = context
        let bite = celestialCircle(CGPoint(x: center.x + radius * 0.45, y: center.y - radius * 0.25), radius * 0.86)
        crescent.clip(to: bite, options: .inverse)
        crescent.fill(celestialCircle(center, radius), with: .color(CelestialPalette.paleGold.opacity(0.8)))
    }

    private static func drawLowerChart(in context: inout GraphicsContext, size: CGSize) {
        let origin = CGPoint(x: 18, y: size.height - 18)
        let radii: [CGFloat] = [22, 44, 66]
        let alphas: [Double] = [0.1, 0.08, 0.06]
        for (index, radius) in radii.enumerated() {
            context.stroke(celestialCircle(origin, radius), with: .color(CelestialPalette.gold.opacity(alphas[index])), lineWidth: 0.5)
        }
    }

    /// A fine inner rule with a single gold star resting on its lower edge.
    private static func drawFrame(in context: inout GraphicsContext, size: CGSize) {
        let inset: CGFloat = 10
        let rect = CGRect(x: inset, y: inset, width: size.width - inset * 2, height: size.height - inset * 2)
        context.stroke(
            Path(roundedRect: rect, cornerRadius: max(2, Theme.celestial.cornerRadius - inset)),
            with: .color(CelestialPalette.gold.opacity(0.16)),
            lineWidth: 0.5
        )
        let ornament = CGPoint(x: size.width / 2, y: size.height - inset)
        context.fill(celestialCircle(ornament, 6), with: .color(Color(hex: 0x0B112E)))
        celestialHalo(in: &context, at: ornament, radius: 9, color: CelestialPalette.paleGold, alpha: 0.18)
        context.fill(celestialSparkle(ornament, 4.5), with: .color(CelestialPalette.gold.opacity(0.75)))
    }

    /// Tiny stars that live only in the outer margin band.
    private static func drawMarginStars(in context: inout GraphicsContext, size: CGSize) {
        for index in 0..<22 {
            let along = CGFloat(0.06 + celestialRandom(index, 71) * 0.88)
            let depth = CGFloat(4 + celestialRandom(index, 72) * 14)
            let point: CGPoint
            switch index % 4 {
            case 0: point = CGPoint(x: along * size.width, y: depth)
            case 1: point = CGPoint(x: size.width - depth, y: along * size.height)
            case 2: point = CGPoint(x: along * size.width, y: size.height - depth)
            default: point = CGPoint(x: depth, y: along * size.height)
            }
            if index % 6 == 0 {
                let extent = CGFloat(2.4 + celestialRandom(index, 73) * 1.2)
                context.fill(celestialSparkle(point, extent), with: .color(CelestialPalette.gold.opacity(0.55)))
            } else {
                let radius = CGFloat(0.5 + celestialRandom(index, 74) * 0.5)
                let alpha = 0.25 + celestialRandom(index, 75) * 0.25
                context.fill(celestialCircle(point, radius), with: .color(CelestialPalette.starlight.opacity(alpha)))
            }
        }
    }
}

// MARK: - Preview

#Preview("Celestial") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 32) {
            CelestialSeal(monogram: "BW")
                .frame(width: 160, height: 160)
            HStack(spacing: 20) {
                CelestialSeal(monogram: "高")
                    .frame(width: 40, height: 40)
                CelestialSeal(monogram: "M")
                    .frame(width: 64, height: 64)
            }
            CelestialStationery()
                .frame(height: 260)
                .overlay(alignment: .topLeading) {
                    Text(verbatim: "Dear future me,")
                        .font(Theme.celestial.body(19))
                        .foregroundStyle(Theme.celestial.ink)
                        .padding(28)
                }
                .padding(.horizontal, 24)
        }
    }
    .theme(.celestial)
}

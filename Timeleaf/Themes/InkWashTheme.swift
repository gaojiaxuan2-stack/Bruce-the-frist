import SwiftUI

// Ink Wash 水墨 — mist over Huangshan, brush and rice paper.
// Layered mountains dissolve into breathing mist; a faint red sun; now and then, two birds.

// MARK: - Tokens

extension Theme {
    static let inkwash = Theme(
        id: .inkwash,
        name: "Ink Wash",
        nativeName: "水墨",
        tagline: String(localized: "Where the brush rests, the mist begins."),
        colorScheme: .light,
        background: Color(hex: 0xF5F1E8),
        surface: Color(hex: 0xFBF8F1, opacity: 0.95),
        surfaceStroke: Color(hex: 0x1C1C1C, opacity: 0.12),
        ink: Color(hex: 0x1C1C1C),
        inkSecondary: Color(hex: 0x5E5A52),
        accent: Color(hex: 0xC23B22),
        accentInk: Color(hex: 0xFFF8F0),
        glow: Color(hex: 0xD9573C),
        seal: Color(hex: 0xC23B22),
        gradient: [Color(hex: 0xF7F3EA), Color(hex: 0xD3CEC3), Color(hex: 0x6F6C66), Color(hex: 0xC23B22)],
        cornerRadius: 6,
        displayFontName: nil,
        bodyFontName: nil,
        fontDesign: .serif,
        usesMaterial: false
    )
}

// MARK: - Background

/// Rice paper with layered misty peaks that drift in slow parallax,
/// a band of mist that breathes, a faint red sun and an occasional pair of birds.
struct InkWashBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init() {}

    var body: some View {
        ZStack {
            InkWashFibreLayer(count: 150)
            scenery
        }
        .allowsHitTesting(false)
    }

    private var scenery: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                InkWashSceneRenderer.draw(
                    in: &context,
                    size: size,
                    time: timeline.date.timeIntervalSinceReferenceDate
                )
            }
        }
    }
}

// MARK: - Seal

/// A square vermilion chop (印章) with the monogram cut in white (阴文).
struct InkWashSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            InkWashChop(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Burst

/// A single drop of ink touches wet paper and blooms outward in soft washes.
struct InkWashBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate = Date.now
    @State private var isFinished = false

    init() {}

    var body: some View {
        ZStack {
            Color.clear
            if !isFinished {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { timeline in
                    Canvas { context, size in
                        InkWashBurstRenderer.draw(
                            in: &context,
                            size: size,
                            time: timeline.date.timeIntervalSince(startDate),
                            reduceMotion: reduceMotion
                        )
                    }
                }
            }
        }
        .allowsHitTesting(false)
        .task {
            try? await Task.sleep(for: .seconds(InkWashBurstRenderer.duration + 0.15))
            isFinished = true
        }
    }
}

// MARK: - Stationery

/// 八行笺 — rice paper framed in vermilion and divided into eight columns,
/// with a tiny chop resting in the lower margin.
struct InkWashStationery: View {
    init() {}

    private var sheet: InkWashDeckleShape {
        InkWashDeckleShape(cornerRadius: Theme.inkwash.cornerRadius, roughness: 0.8)
    }

    var body: some View {
        ZStack {
            paper
            InkWashFibreLayer(count: 90)
                .opacity(0.85)
            InkWashLetterRulesLayer()
            chop
        }
        .clipShape(sheet)
        .overlay(sheet.stroke(InkWashPalette.ink.opacity(0.08), lineWidth: 0.6))
        .shadow(color: InkWashPalette.ink.opacity(0.1), radius: 16, x: 0, y: 8)
        .shadow(color: InkWashPalette.ink.opacity(0.08), radius: 1, x: 0, y: 1)
    }

    private var paper: some View {
        LinearGradient(
            colors: [InkWashPalette.paperLight, InkWashPalette.paper],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    private var chop: some View {
        InkWashSeal(monogram: "笺")
            .frame(width: 19, height: 19)
            .opacity(0.88)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
            .padding(.trailing, 20)
            .padding(.bottom, 9)
    }
}

// MARK: - Palette & helpers

private enum InkWashPalette {
    static let paper = Color(hex: 0xF5F1E8)
    static let paperLight = Color(hex: 0xFAF7F0)
    static let chopPaper = Color(hex: 0xF8F3E8)
    static let ink = Color(hex: 0x1C1C1C)
    static let fibre = Color(hex: 0x8C8578)
    static let vermilion = Color(hex: 0xC23B22)
    static let vermilionBright = Color(hex: 0xD04A2E)
    static let vermilionDeep = Color(hex: 0xA22D19)
}

/// Deterministic pseudo-random value in 0..<1 for an index and a salt.
private func inkWashRandom(_ index: Int, _ salt: Int) -> Double {
    let value = sin(Double(index) * 12.9898 + Double(salt) * 78.233 + 0.417) * 43758.5453
    return value - floor(value)
}

private func inkWashSmoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}

private func inkWashEaseOut(_ x: Double) -> Double {
    let t = min(max(x, 0), 1)
    return 1 - pow(1 - t, 3)
}

private func inkWashCircle(_ x: Double, _ y: Double, _ radius: Double) -> Path {
    Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
}

private func inkWashIsIdeographic(_ text: String) -> Bool {
    text.unicodeScalars.first?.properties.isIdeographic ?? false
}

/// Closed Catmull–Rom spline through the given points.
private func inkWashSmoothPath(_ points: [CGPoint]) -> Path {
    var path = Path()
    let count = points.count
    guard count > 2 else { return path }
    path.move(to: points[0])
    for index in 0..<count {
        let p0 = points[(index - 1 + count) % count]
        let p1 = points[index]
        let p2 = points[(index + 1) % count]
        let p3 = points[(index + 2) % count]
        let c1 = CGPoint(x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6)
        let c2 = CGPoint(x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6)
        path.addCurve(to: p2, control1: c1, control2: c2)
    }
    path.closeSubpath()
    return path
}

/// An organic, slightly irregular round blot.
private func inkWashBlot(cx: Double, cy: Double, radius: Double, seed: Int, wobble: Double) -> Path {
    let count = 22
    var points: [CGPoint] = []
    points.reserveCapacity(count)
    for index in 0..<count {
        let angle = Double(index) / Double(count) * 2 * Double.pi
        let reach = radius * (1 + (inkWashRandom(index + seed * 31, 91) - 0.5) * wobble)
        points.append(CGPoint(x: cx + cos(angle) * reach, y: cy + sin(angle) * reach))
    }
    return inkWashSmoothPath(points)
}

// MARK: - Rice paper fibres

private struct InkWashFibreLayer: View {
    var count: Int

    var body: some View {
        Canvas { context, size in
            InkWashFibreRenderer.draw(in: &context, size: size, count: count)
        }
    }
}

private enum InkWashFibreRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize, count: Int) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        drawClouds(in: &context, width: width, height: height)
        drawFibres(in: &context, width: width, height: height, count: count)
        drawSpecks(in: &context, width: width, height: height, count: count / 2)
    }

    /// Uneven pulp: the paper is a little thicker in places.
    private static func drawClouds(in context: inout GraphicsContext, width: Double, height: Double) {
        let span = max(width, height)
        for index in 0..<6 {
            let x = inkWashRandom(index, 1) * width
            let y = inkWashRandom(index, 2) * height
            let radius = (0.14 + 0.2 * inkWashRandom(index, 3)) * span
            let isLight = index % 2 == 0
            let color = isLight ? Color.white.opacity(0.3) : InkWashPalette.fibre.opacity(0.035)
            let gradient = Gradient(colors: [color, color.opacity(0)])
            context.fill(
                inkWashCircle(x, y, radius),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }

    /// Long, wandering bast fibres of xuan paper.
    private static func drawFibres(in context: inout GraphicsContext, width: Double, height: Double, count: Int) {
        for index in 0..<count {
            let x = inkWashRandom(index, 4) * width
            let y = inkWashRandom(index, 5) * height
            let length = 14 + 40 * inkWashRandom(index, 6)
            let angle = inkWashRandom(index, 7) * Double.pi
            let dx = cos(angle) * length * 0.5
            let dy = sin(angle) * length * 0.5
            let bendA = (inkWashRandom(index, 8) - 0.5) * length * 0.5
            let bendB = (inkWashRandom(index, 9) - 0.5) * length * 0.5
            var path = Path()
            path.move(to: CGPoint(x: x - dx, y: y - dy))
            path.addCurve(
                to: CGPoint(x: x + dx, y: y + dy),
                control1: CGPoint(x: x - dx * 0.33 - sin(angle) * bendA, y: y - dy * 0.33 + cos(angle) * bendA),
                control2: CGPoint(x: x + dx * 0.33 - sin(angle) * bendB, y: y + dy * 0.33 + cos(angle) * bendB)
            )
            let alpha = 0.05 + 0.07 * inkWashRandom(index, 10)
            let lineWidth = 0.35 + 0.35 * inkWashRandom(index, 11)
            context.stroke(path, with: .color(InkWashPalette.fibre.opacity(alpha)), lineWidth: CGFloat(lineWidth))
        }
    }

    private static func drawSpecks(in context: inout GraphicsContext, width: Double, height: Double, count: Int) {
        for index in 0..<count {
            let x = inkWashRandom(index, 12) * width
            let y = inkWashRandom(index, 13) * height
            let radius = 0.3 + 0.5 * inkWashRandom(index, 14)
            let alpha = 0.06 + 0.08 * inkWashRandom(index, 15)
            context.fill(inkWashCircle(x, y, radius), with: .color(InkWashPalette.fibre.opacity(alpha)))
        }
    }
}

// MARK: - Scenery

private enum InkWashSceneRenderer {
    private struct Ridge {
        /// Fraction of the height where the foot of the range sits.
        let baseline: Double
        /// Fraction of the height reached by the tallest peak.
        let rise: Double
        /// Ink opacity at the crest.
        let tone: Double
        /// Horizontal parallax amplitude in points.
        let drift: Double
        /// Seconds for one full parallax swing.
        let period: Double
        /// Peaks per screen width for the main, secondary and envelope waves.
        let f1: Double
        let f2: Double
        let f3: Double
        let phase: Double

        /// 0…1 altitude: sharp karst peaks (1 − |sin|) shaped by a slow envelope.
        func altitude(_ u: Double) -> Double {
            let peaks1 = pow(1 - abs(sin(u * Double.pi * f1 + phase)), 1.6)
            let peaks2 = pow(1 - abs(sin(u * Double.pi * f2 + phase * 2.3)), 2.2)
            let envelope = 0.55 + 0.45 * sin(u * 2 * Double.pi * f3 + phase * 0.7)
            let texture = 0.05 * sin(u * 37 + phase * 3)
            let raw = envelope * (0.72 * peaks1 + 0.28 * peaks2) + texture
            // Never fully flat: valleys stay a little raised so ranges read as continuous.
            return min(1, max(0, 0.2 + 0.8 * raw))
        }
    }

    private static let ridges: [Ridge] = [
        Ridge(baseline: 0.63, rise: 0.21, tone: 0.075, drift: 6, period: 150, f1: 1.6, f2: 4.2, f3: 0.6, phase: 0.4),
        Ridge(baseline: 0.71, rise: 0.19, tone: 0.11, drift: 12, period: 126, f1: 2.1, f2: 5.3, f3: 0.8, phase: 2.1),
        Ridge(baseline: 0.83, rise: 0.18, tone: 0.16, drift: 20, period: 104, f1: 1.4, f2: 3.7, f3: 0.5, phase: 4.0),
        Ridge(baseline: 0.96, rise: 0.17, tone: 0.23, drift: 30, period: 88, f1: 1.9, f2: 4.8, f3: 0.7, phase: 5.3)
    ]

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }

        drawSun(in: &context, width: width, height: height)
        drawBirds(in: &context, width: width, height: height, time: time)
        for (index, ridge) in ridges.enumerated() {
            if index == 2 {
                drawMistBand(in: &context, width: width, height: height, time: time)
            }
            drawRidge(ridge, index: index, in: &context, width: width, height: height, time: time)
        }
        drawWisps(in: &context, width: width, height: height, time: time)
        drawGroundMist(in: &context, width: width, height: height)
    }

    private static func drawSun(in context: inout GraphicsContext, width: Double, height: Double) {
        let radius = min(width, height) * 0.085
        let cx = width * 0.76
        let cy = height * 0.2
        let halo = Gradient(colors: [InkWashPalette.vermilion.opacity(0.07), InkWashPalette.vermilion.opacity(0)])
        context.fill(
            inkWashCircle(cx, cy, radius * 2.6),
            with: .radialGradient(halo, center: CGPoint(x: cx, y: cy), startRadius: CGFloat(radius * 0.8), endRadius: CGFloat(radius * 2.6))
        )
        let disc = Gradient(stops: [
            .init(color: InkWashPalette.vermilion.opacity(0.17), location: 0),
            .init(color: InkWashPalette.vermilion.opacity(0.13), location: 0.85),
            .init(color: InkWashPalette.vermilion.opacity(0), location: 1)
        ])
        context.fill(
            inkWashCircle(cx, cy, radius),
            with: .radialGradient(disc, center: CGPoint(x: cx, y: cy), startRadius: 0, endRadius: CGFloat(radius))
        )
    }

    private static func drawRidge(_ ridge: Ridge, index: Int, in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        let shift = sin(time * 2 * Double.pi / ridge.period + Double(index) * 1.7) * ridge.drift
        let foot = height * ridge.baseline
        let rise = height * ridge.rise
        let step = 4.0
        var fill = Path()
        var crest = Path()
        var top = foot
        var x = -step
        fill.move(to: CGPoint(x: x, y: height + 2))
        while x <= width + step {
            let u = (x + shift) / width
            let y = foot - rise * ridge.altitude(u)
            top = min(top, y)
            fill.addLine(to: CGPoint(x: x, y: y))
            if x < 0 {
                crest.move(to: CGPoint(x: x, y: y))
            } else {
                crest.addLine(to: CGPoint(x: x, y: y))
            }
            x += step
        }
        fill.addLine(to: CGPoint(x: x, y: height + 2))
        fill.closeSubpath()

        let gradient = Gradient(stops: [
            .init(color: InkWashPalette.ink.opacity(ridge.tone), location: 0),
            .init(color: InkWashPalette.ink.opacity(ridge.tone * 0.6), location: 0.45),
            .init(color: InkWashPalette.ink.opacity(0), location: 1)
        ])
        context.fill(
            fill,
            with: .linearGradient(gradient, startPoint: CGPoint(x: 0, y: top), endPoint: CGPoint(x: 0, y: foot - rise * 0.08))
        )
        if index >= 2 {
            context.stroke(crest, with: .color(InkWashPalette.ink.opacity(ridge.tone * 0.45)), lineWidth: 0.8)
        }
    }

    /// The band of cloud between the far and near ranges, slowly breathing.
    private static func drawMistBand(in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        let breath = 0.5 + 0.5 * sin(time * 2 * Double.pi / 16)
        let centerY = height * (0.715 + 0.01 * sin(time * 2 * Double.pi / 23))
        let band = height * (0.12 + 0.03 * breath)
        let alpha = 0.5 + 0.28 * breath
        let gradient = Gradient(stops: [
            .init(color: InkWashPalette.paper.opacity(0), location: 0),
            .init(color: InkWashPalette.paper.opacity(alpha), location: 0.5),
            .init(color: InkWashPalette.paper.opacity(0), location: 1)
        ])
        let rect = CGRect(x: 0, y: centerY - band, width: width, height: band * 2)
        context.fill(
            Path(rect),
            with: .linearGradient(gradient, startPoint: CGPoint(x: 0, y: centerY - band), endPoint: CGPoint(x: 0, y: centerY + band))
        )
    }

    /// Long, soft drifts of cloud that slide across the ranges.
    private static func drawWisps(in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        for index in 0..<3 {
            let period = 64 + 26 * Double(index)
            let drift = sin(time * 2 * Double.pi / period + Double(index) * 2.1) * width * 0.12
            let cx = width * (0.22 + 0.3 * Double(index)) + drift
            let cy = height * (0.66 + 0.09 * Double(index))
            let radius = width * 0.34
            var wisp = context
            wisp.translateBy(x: CGFloat(cx), y: CGFloat(cy))
            wisp.scaleBy(x: 1, y: 0.15)
            let gradient = Gradient(colors: [InkWashPalette.paper.opacity(0.55), InkWashPalette.paper.opacity(0)])
            wisp.fill(
                inkWashCircle(0, 0, radius),
                with: .radialGradient(gradient, center: .zero, startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }

    private static func drawGroundMist(in context: inout GraphicsContext, width: Double, height: Double) {
        let top = height * 0.86
        let gradient = Gradient(colors: [InkWashPalette.paper.opacity(0), InkWashPalette.paper.opacity(0.6)])
        context.fill(
            Path(CGRect(x: 0, y: top, width: width, height: height - top)),
            with: .linearGradient(gradient, startPoint: CGPoint(x: 0, y: top), endPoint: CGPoint(x: 0, y: height))
        )
    }

    /// Two distant birds cross the sky about once every 46 seconds.
    private static func drawBirds(in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        let cycle = 46.0
        let phase = time / cycle - floor(time / cycle)
        let window = 0.42
        guard phase < window else { return }
        let progress = phase / window
        let fade = sin(Double.pi * progress)
        let x = -0.06 * width + progress * 1.12 * width
        let y = height * (0.31 - 0.05 * progress) + sin(progress * 3 * Double.pi) * height * 0.008
        drawBird(in: &context, x: x, y: y, span: 7.5, time: time, alpha: 0.42 * fade)
        drawBird(in: &context, x: x - 26, y: y + 9, span: 5.2, time: time + 0.45, alpha: 0.3 * fade)
    }

    private static func drawBird(in context: inout GraphicsContext, x: Double, y: Double, span: Double, time: Double, alpha: Double) {
        guard alpha > 0.01 else { return }
        let flap = sin(time * 2 * Double.pi / 1.3)
        let glide = 0.5 + 0.5 * sin(time * 2 * Double.pi / 7)
        let lift = span * (0.3 + 0.22 * flap * glide)
        var path = Path()
        path.move(to: CGPoint(x: x - span, y: y - lift))
        path.addQuadCurve(to: CGPoint(x: x, y: y), control: CGPoint(x: x - span * 0.45, y: y - lift * 1.15))
        path.addQuadCurve(to: CGPoint(x: x + span, y: y - lift), control: CGPoint(x: x + span * 0.45, y: y - lift * 1.15))
        let style = StrokeStyle(lineWidth: 1.1, lineCap: .round, lineJoin: .round)
        context.stroke(path, with: .color(InkWashPalette.ink.opacity(alpha)), style: style)
    }
}

// MARK: - Chop

private struct InkWashChop: View {
    let monogram: String
    let side: CGFloat

    var body: some View {
        ZStack {
            stone
            glyphs
            carvingFlaws
        }
        .frame(width: side * 0.86, height: side * 0.86)
        .rotationEffect(.degrees(-2.5))
        .frame(width: side, height: side)
    }

    /// The vermilion impression, with uneven ink and true holes where the paper did not take it.
    private var stone: some View {
        ZStack {
            InkWashChopShape()
                .fill(
                    LinearGradient(
                        colors: [InkWashPalette.vermilionBright, InkWashPalette.vermilion, InkWashPalette.vermilionDeep],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
            Canvas { context, size in
                InkWashChopRenderer.drawTone(in: &context, size: size)
            }
            .clipShape(InkWashChopShape())
            Canvas { context, size in
                InkWashChopRenderer.drawErosion(in: &context, size: size)
            }
            .blendMode(.destinationOut)
        }
        .compositingGroup()
    }

    private var glyphFont: Font {
        if inkWashIsIdeographic(monogram) {
            return .system(size: side * 0.5, weight: .heavy, design: .serif)
        }
        let size = monogram.count > 1 ? side * 0.36 : side * 0.5
        return .system(size: size, weight: .heavy, design: .serif)
    }

    private var glyphs: some View {
        Text(monogram)
            .font(glyphFont)
            .foregroundStyle(InkWashPalette.chopPaper)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .frame(width: side * 0.72, height: side * 0.72)
    }

    /// Tiny specks of red left on the carved strokes.
    private var carvingFlaws: some View {
        Canvas { context, size in
            InkWashChopRenderer.drawFlaws(in: &context, size: size)
        }
        .clipShape(InkWashChopShape())
    }
}

/// A square stone face with a hand-worn, slightly irregular edge.
private struct InkWashChopShape: Shape {
    func path(in rect: CGRect) -> Path {
        let minX = Double(rect.minX)
        let minY = Double(rect.minY)
        let width = Double(rect.width)
        let height = Double(rect.height)
        let unit = min(width, height)
        let segments = 9
        var points: [CGPoint] = []
        points.reserveCapacity(segments * 4)
        for edge in 0..<4 {
            for step in 0..<segments {
                let seed = edge * segments + step
                let t = Double(step) / Double(segments)
                let chip = inkWashRandom(seed, 72) > 0.88 ? unit * 0.02 : 0
                let corner = step == 0 ? unit * 0.012 : 0
                let inward = unit * (0.004 + 0.014 * inkWashRandom(seed, 71)) + chip + corner
                points.append(edgePoint(edge: edge, t: t, inward: inward, minX: minX, minY: minY, width: width, height: height, corner: corner))
            }
        }
        return inkWashSmoothPath(points)
    }

    private func edgePoint(edge: Int, t: Double, inward: Double, minX: Double, minY: Double, width: Double, height: Double, corner: Double) -> CGPoint {
        switch edge {
        case 0:
            return CGPoint(x: minX + t * width + corner, y: minY + inward)
        case 1:
            return CGPoint(x: minX + width - inward, y: minY + t * height + corner)
        case 2:
            return CGPoint(x: minX + width - t * width - corner, y: minY + height - inward)
        default:
            return CGPoint(x: minX + inward, y: minY + height - t * height - corner)
        }
    }
}

private enum InkWashChopRenderer {
    /// Paler clouds where the paste was thin, darker pools where it gathered.
    static func drawTone(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        let unit = min(width, height)
        guard unit > 1 else { return }
        for index in 0..<6 {
            let x = (0.1 + 0.8 * inkWashRandom(index, 81)) * width
            let y = (0.1 + 0.8 * inkWashRandom(index, 82)) * height
            let radius = unit * (0.16 + 0.2 * inkWashRandom(index, 83))
            let isPale = index % 2 == 0
            let color = isPale ? InkWashPalette.chopPaper.opacity(0.16) : InkWashPalette.vermilionDeep.opacity(0.3)
            let gradient = Gradient(colors: [color, color.opacity(0)])
            context.fill(
                inkWashCircle(x, y, radius),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }

    /// Specks and worn edges punched out of the impression (drawn with destinationOut).
    static func drawErosion(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        let unit = min(width, height)
        guard unit > 1 else { return }
        for index in 0..<60 {
            let x = inkWashRandom(index, 84) * width
            let y = inkWashRandom(index, 85) * height
            let radius = unit * (0.003 + 0.011 * pow(inkWashRandom(index, 86), 2))
            let alpha = 0.35 + 0.55 * inkWashRandom(index, 87)
            context.fill(inkWashCircle(x, y, radius), with: .color(Color.black.opacity(alpha)))
        }
        for index in 0..<44 {
            let edge = index % 4
            let along = inkWashRandom(index, 88)
            let depth = unit * 0.05 * pow(inkWashRandom(index, 89), 2)
            let radius = unit * (0.006 + 0.016 * inkWashRandom(index, 90))
            let point: CGPoint
            switch edge {
            case 0: point = CGPoint(x: along * width, y: depth)
            case 1: point = CGPoint(x: width - depth, y: along * height)
            case 2: point = CGPoint(x: along * width, y: height - depth)
            default: point = CGPoint(x: depth, y: along * height)
            }
            context.fill(inkWashCircle(Double(point.x), Double(point.y), radius), with: .color(Color.black.opacity(0.9)))
        }
    }

    /// A few red flecks over the centre, so the white strokes look hand-cut.
    static func drawFlaws(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        let unit = min(width, height)
        guard unit > 1 else { return }
        for index in 0..<34 {
            let x = (0.14 + 0.72 * inkWashRandom(index, 92)) * width
            let y = (0.14 + 0.72 * inkWashRandom(index, 93)) * height
            let radius = unit * (0.003 + 0.008 * inkWashRandom(index, 94))
            context.fill(inkWashCircle(x, y, radius), with: .color(InkWashPalette.vermilion.opacity(0.75)))
        }
    }
}

// MARK: - Burst renderer

private enum InkWashBurstRenderer {
    static let duration: Double = 2.4

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double, reduceMotion: Bool) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1, time >= 0, time <= duration else { return }
        let cx = width / 2
        let cy = height / 2
        let unit = min(width, height)
        if reduceMotion {
            drawStillWash(in: &context, cx: cx, cy: cy, unit: unit, time: time)
            return
        }
        drawWashes(in: &context, cx: cx, cy: cy, unit: unit, time: time)
        drawCore(in: &context, cx: cx, cy: cy, unit: unit, time: time)
        drawSplatter(in: &context, cx: cx, cy: cy, unit: unit, time: time)
    }

    private static func drawStillWash(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let alpha = 0.22 * sin(Double.pi * min(time / duration, 1))
        guard alpha > 0.002 else { return }
        let path = inkWashBlot(cx: cx, cy: cy, radius: unit * 0.24, seed: 2, wobble: 0.2)
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: CGFloat(unit * 0.03)))
            layer.fill(path, with: .color(InkWashPalette.ink.opacity(alpha)))
        }
    }

    /// Concentric washes that spread, soften and pale as the water carries the ink.
    private static func drawWashes(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        for ring in 0..<4 {
            let start = 0.1 + Double(ring) * 0.13
            let local = (time - start) / 1.75
            guard local > 0 else { continue }
            let progress = min(local, 1)
            let grow = inkWashEaseOut(progress)
            let radius = unit * (0.05 + (0.15 + 0.085 * Double(ring)) * grow)
            let alpha = (0.34 - 0.06 * Double(ring)) * min(1, local * 6) * pow(1 - progress, 1.3)
            guard alpha > 0.002 else { continue }
            let path = inkWashBlot(cx: cx, cy: cy, radius: radius, seed: ring, wobble: 0.16 + 0.12 * grow)
            let softness = 1.5 + 9 * progress + Double(ring) * 1.5
            let edgeWidth = 1.2 + 2 * (1 - progress)
            context.drawLayer { layer in
                layer.addFilter(.blur(radius: CGFloat(softness)))
                layer.fill(path, with: .color(InkWashPalette.ink.opacity(alpha * 0.8)))
                layer.stroke(path, with: .color(InkWashPalette.ink.opacity(alpha)), lineWidth: CGFloat(edgeWidth))
            }
        }
    }

    /// The drop itself: lands, darkens, then slowly dissolves.
    private static func drawCore(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let appear = inkWashEaseOut(time / 0.18)
        let spread = inkWashEaseOut(time / 2)
        let alpha = 0.8 * (1 - inkWashSmoothstep(0.9, 2.2, time))
        guard alpha > 0.002 else { return }
        let radius = unit * (0.015 + 0.045 * appear + 0.03 * spread)
        let path = inkWashBlot(cx: cx, cy: cy, radius: radius, seed: 9, wobble: 0.14)
        let gradient = Gradient(colors: [InkWashPalette.ink.opacity(alpha), InkWashPalette.ink.opacity(alpha * 0.65)])
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: CGFloat(0.6 + 4 * spread)))
            layer.fill(
                path,
                with: .radialGradient(gradient, center: CGPoint(x: cx, y: cy), startRadius: 0, endRadius: CGFloat(radius * 1.1))
            )
        }
    }

    /// Fine droplets flung outward, stretched while in flight, then bleeding softly.
    private static func drawSplatter(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let alpha = 0.7 * (1 - inkWashSmoothstep(1.5, 2.3, time))
        guard alpha > 0.002 else { return }
        for index in 0..<14 {
            let launch = 0.12 + 0.08 * inkWashRandom(index, 95)
            let local = (time - launch) / 0.32
            guard local > 0 else { continue }
            let flight = inkWashEaseOut(local)
            let angle = inkWashRandom(index, 96) * 2 * Double.pi
            let reach = unit * (0.2 + 0.24 * inkWashRandom(index, 97))
            let x = cx + cos(angle) * reach * flight
            let y = cy + sin(angle) * reach * flight
            let bleed = 1 + 0.35 * inkWashEaseOut((time - launch) / 1.5)
            let radius = unit * (0.004 + 0.012 * pow(inkWashRandom(index, 98), 1.5)) * bleed
            let stretch = 1 + 1.8 * (1 - flight)
            var drop = context
            drop.translateBy(x: CGFloat(x), y: CGFloat(y))
            drop.rotate(by: .radians(angle))
            drop.scaleBy(x: CGFloat(stretch), y: 1)
            drop.fill(inkWashCircle(0, 0, radius), with: .color(InkWashPalette.ink.opacity(alpha)))
            if index % 3 == 0 {
                let satellite = radius * 0.45
                drop.fill(inkWashCircle(radius * 2.6, 0, satellite), with: .color(InkWashPalette.ink.opacity(alpha * 0.8)))
            }
        }
    }
}

// MARK: - Letter paper pieces

/// A sheet with a softly irregular, fibrous edge.
private struct InkWashDeckleShape: Shape {
    var cornerRadius: CGFloat
    var roughness: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = Double(min(cornerRadius, min(rect.width, rect.height) / 2))
        let minX = Double(rect.minX)
        let minY = Double(rect.minY)
        let maxX = Double(rect.maxX)
        let maxY = Double(rect.maxY)
        let rough = Double(roughness)
        let spacing = 3.5
        var points: [CGPoint] = []

        func appendEdge(from start: CGPoint, to end: CGPoint, normal: CGVector) {
            let dx = Double(end.x - start.x)
            let dy = Double(end.y - start.y)
            let steps = max(1, Int((dx * dx + dy * dy).squareRoot() / spacing))
            for step in 0..<steps {
                let t = Double(step) / Double(steps)
                let wobble = rough * inkWashRandom(points.count, 61)
                points.append(CGPoint(
                    x: Double(start.x) + dx * t + Double(normal.dx) * wobble,
                    y: Double(start.y) + dy * t + Double(normal.dy) * wobble
                ))
            }
        }

        func appendCorner(cx: Double, cy: Double, from startAngle: Double) {
            let steps = max(2, Int(radius * Double.pi / 2 / spacing))
            for step in 0..<steps {
                let angle = startAngle + Double(step) / Double(steps) * Double.pi / 2
                let reach = radius - rough * inkWashRandom(points.count, 61)
                points.append(CGPoint(x: cx + cos(angle) * reach, y: cy + sin(angle) * reach))
            }
        }

        appendEdge(from: CGPoint(x: minX + radius, y: minY), to: CGPoint(x: maxX - radius, y: minY), normal: CGVector(dx: 0, dy: 1))
        appendCorner(cx: maxX - radius, cy: minY + radius, from: -Double.pi / 2)
        appendEdge(from: CGPoint(x: maxX, y: minY + radius), to: CGPoint(x: maxX, y: maxY - radius), normal: CGVector(dx: -1, dy: 0))
        appendCorner(cx: maxX - radius, cy: maxY - radius, from: 0)
        appendEdge(from: CGPoint(x: maxX - radius, y: maxY), to: CGPoint(x: minX + radius, y: maxY), normal: CGVector(dx: 0, dy: -1))
        appendCorner(cx: minX + radius, cy: maxY - radius, from: Double.pi / 2)
        appendEdge(from: CGPoint(x: minX, y: maxY - radius), to: CGPoint(x: minX, y: minY + radius), normal: CGVector(dx: 1, dy: 0))
        appendCorner(cx: minX + radius, cy: minY + radius, from: Double.pi)

        var path = Path()
        guard points.count > 2 else {
            path.addRoundedRect(in: rect, cornerSize: CGSize(width: radius, height: radius), style: .continuous)
            return path
        }
        path.addLines(points)
        path.closeSubpath()
        return path
    }
}

/// The vermilion frame and the eight columns of 八行笺.
private struct InkWashLetterRulesLayer: View {
    var body: some View {
        Canvas { context, size in
            InkWashLetterRulesRenderer.draw(in: &context, size: size)
        }
    }
}

private enum InkWashLetterRulesRenderer {
    static let columns = 8

    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        let left = 16.0
        let right = width - 16
        let top = 36.0
        let bottom = height - 40
        guard right - left > 40, bottom - top > 40 else { return }

        // 天头 and 地脚: a heavier rule paired with a hairline at the head and the foot.
        horizontal(in: &context, y: top - 4, from: left, to: right, width: 1.6, alpha: 0.5)
        horizontal(in: &context, y: top, from: left, to: right, width: 0.6, alpha: 0.42)
        horizontal(in: &context, y: bottom, from: left, to: right, width: 0.6, alpha: 0.42)
        horizontal(in: &context, y: bottom + 4, from: left, to: right, width: 1.6, alpha: 0.5)

        // Eight columns: the two frame sides and the rules between them.
        for index in 0...columns {
            let x = left + (right - left) * Double(index) / Double(columns)
            let isFrame = index == 0 || index == columns
            var rule = Path()
            rule.move(to: CGPoint(x: x, y: top - 4))
            rule.addLine(to: CGPoint(x: x, y: bottom + 4))
            let alpha = isFrame ? 0.45 : 0.3
            let lineWidth = isFrame ? 0.9 : 0.6
            context.stroke(rule, with: .color(InkWashPalette.vermilion.opacity(alpha)), lineWidth: CGFloat(lineWidth))
        }
    }

    private static func horizontal(in context: inout GraphicsContext, y: Double, from left: Double, to right: Double, width: Double, alpha: Double) {
        var rule = Path()
        rule.move(to: CGPoint(x: left, y: y))
        rule.addLine(to: CGPoint(x: right, y: y))
        context.stroke(rule, with: .color(InkWashPalette.vermilion.opacity(alpha)), lineWidth: CGFloat(width))
    }
}

// MARK: - Preview

#Preview("Ink Wash 水墨") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 28) {
            ZStack {
                InkWashBurst()
                InkWashSeal(monogram: "高")
                    .frame(width: 160, height: 160)
            }
            .frame(width: 300, height: 220)
            HStack(spacing: 20) {
                InkWashSeal(monogram: "M").frame(width: 40, height: 40)
                InkWashSeal(monogram: "高").frame(width: 40, height: 40)
                InkWashSeal(monogram: "BW").frame(width: 40, height: 40)
            }
            InkWashStationery()
                .frame(height: 300)
                .padding(.horizontal, 24)
        }
    }
    .theme(.inkwash)
}

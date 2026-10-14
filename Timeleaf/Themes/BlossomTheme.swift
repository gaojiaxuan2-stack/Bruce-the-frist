import SwiftUI

// Blossom 花信 — a spring letter with pressed sakura.
// Blush-to-peach light, petals drifting on a slow diagonal wind, a branch out of focus.

// MARK: - Tokens

extension Theme {
    static let blossom = Theme(
        id: .blossom,
        name: "Blossom",
        nativeName: "花信",
        tagline: String(localized: "News of spring, pressed between pages."),
        colorScheme: .light,
        background: Color(hex: 0xFCEFF1),
        surface: Color(hex: 0xFFFAFA, opacity: 0.84),
        surfaceStroke: Color(hex: 0xE58FA5, opacity: 0.32),
        ink: Color(hex: 0x4A2E36),
        inkSecondary: Color(hex: 0x7D5A64),
        accent: Color(hex: 0xB0446A),
        accentInk: Color(hex: 0xFFF7F8),
        glow: Color(hex: 0xF2A7BB),
        seal: Color(hex: 0xE58FA5),
        gradient: [Color(hex: 0xFDF1F2), Color(hex: 0xFBD9CC), Color(hex: 0xE58FA5)],
        cornerRadius: 22,
        displayFontName: nil,
        bodyFontName: nil,
        fontDesign: .rounded,
        usesMaterial: true
    )
}

// MARK: - Background

/// Blush-to-peach morning light, a blurred blossoming branch in the corner
/// and forty sakura petals drifting down on a slow diagonal wind.
struct BlossomBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init() {}

    var body: some View {
        ZStack {
            sky
            bokeh
            branch
            petals
        }
        .allowsHitTesting(false)
    }

    private var sky: some View {
        ZStack {
            LinearGradient(
                colors: [BlossomPalette.blush, BlossomPalette.blushWarm, BlossomPalette.peach],
                startPoint: .top,
                endPoint: .bottom
            )
            RadialGradient(
                colors: [Color.white.opacity(0.55), Color.white.opacity(0)],
                center: UnitPoint(x: 0.18, y: 0.1),
                startRadius: 0,
                endRadius: 420
            )
            RadialGradient(
                colors: [BlossomPalette.sage.opacity(0.14), BlossomPalette.sage.opacity(0)],
                center: UnitPoint(x: 0, y: 1),
                startRadius: 0,
                endRadius: 360
            )
        }
    }

    private var bokeh: some View {
        Canvas { context, size in
            BlossomBokehRenderer.draw(in: &context, size: size)
        }
    }

    private var branch: some View {
        Canvas { context, size in
            BlossomBranchRenderer.draw(in: &context, size: size)
        }
        .frame(width: 280, height: 230)
        .blur(radius: 2.2)
        .opacity(0.42)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .offset(x: 26, y: -4)
    }

    private var petals: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                BlossomPetalRenderer.draw(
                    in: &context,
                    size: size,
                    time: timeline.date.timeIntervalSinceReferenceDate
                )
            }
        }
    }
}

// MARK: - Seal

/// A pressed five-petal sakura with stamens around a cream centre bearing the monogram.
struct BlossomSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            BlossomSealArt(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Burst

/// Petals swirl outward from the centre in a golden-angle spiral, then drift down and fade.
struct BlossomBurst: View {
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
                        BlossomBurstRenderer.draw(
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
            try? await Task.sleep(for: .seconds(BlossomBurstRenderer.duration + 0.15))
            isFinished = true
        }
    }
}

// MARK: - Stationery

/// A soft white deckled sheet with watercolour washes blooming in two corners
/// and a few pressed petals resting in the margins.
struct BlossomStationery: View {
    init() {}

    private var sheet: BlossomDeckleShape {
        BlossomDeckleShape(cornerRadius: Theme.blossom.cornerRadius, roughness: 0.9)
    }

    var body: some View {
        ZStack {
            paper
            Canvas { context, size in
                BlossomWashRenderer.draw(in: &context, size: size)
            }
            edgeBlush
        }
        .clipShape(sheet)
        .overlay(sheet.stroke(BlossomPalette.rose.opacity(0.22), lineWidth: 0.6))
        .shadow(color: BlossomPalette.roseDeep.opacity(0.12), radius: 22, x: 0, y: 12)
        .shadow(color: BlossomPalette.plum.opacity(0.08), radius: 1.5, x: 0, y: 1)
    }

    private var paper: some View {
        LinearGradient(
            colors: [BlossomPalette.sheet, BlossomPalette.sheetWarm],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }

    private var edgeBlush: some View {
        sheet
            .stroke(BlossomPalette.rose.opacity(0.12), lineWidth: 12)
            .blur(radius: 9)
    }
}

// MARK: - Palette & helpers

private enum BlossomPalette {
    static let blush = Color(hex: 0xFCEFF1)
    static let blushWarm = Color(hex: 0xFDEBE8)
    static let peach = Color(hex: 0xFDE3D6)
    static let peachDeep = Color(hex: 0xF7C3A8)
    static let cream = Color(hex: 0xFFF9F2)
    static let creamShade = Color(hex: 0xFCEDE4)
    static let sheet = Color(hex: 0xFFFDFC)
    static let sheetWarm = Color(hex: 0xFFF7F5)
    static let rose = Color(hex: 0xE58FA5)
    static let roseMid = Color(hex: 0xE27F9B)
    static let roseDeep = Color(hex: 0xC2557A)
    static let petalLight = Color(hex: 0xF6C6D2)
    static let petalPale = Color(hex: 0xFDE6EC)
    static let plum = Color(hex: 0x8C4A5E)
    static let sage = Color(hex: 0xA9BFA0)
    static let stamen = Color(hex: 0xE7B46A)
    static let monogram = Color(hex: 0xA23E62)
}

/// Deterministic pseudo-random value in 0..<1 for an index and a salt.
private func blossomRandom(_ index: Int, _ salt: Int) -> Double {
    let value = sin(Double(index) * 12.9898 + Double(salt) * 78.233 + 0.263) * 43758.5453
    return value - floor(value)
}

private func blossomSmoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}

private func blossomEaseOut(_ x: Double) -> Double {
    let t = min(max(x, 0), 1)
    return 1 - pow(1 - t, 3)
}

private func blossomCircle(_ x: Double, _ y: Double, _ radius: Double) -> Path {
    Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
}

private func blossomIsIdeographic(_ text: String) -> Bool {
    text.unicodeScalars.first?.properties.isIdeographic ?? false
}

/// Closed Catmull–Rom spline through the given points.
private func blossomSmoothPath(_ points: [CGPoint]) -> Path {
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

/// A sakura petal drawn inside `rect`: base at the bottom centre, notched tip at the top.
private func blossomPetalPath(in rect: CGRect) -> Path {
    let width = Double(rect.width)
    let height = Double(rect.height)
    let midX = Double(rect.midX)
    let top = Double(rect.minY)

    func point(_ fx: Double, _ fy: Double) -> CGPoint {
        CGPoint(x: midX + fx * width, y: top + fy * height)
    }

    var path = Path()
    path.move(to: point(0, 1))
    path.addCurve(to: point(-0.24, 0.04), control1: point(-0.62, 0.68), control2: point(-0.56, 0.1))
    path.addQuadCurve(to: point(0, 0.16), control: point(-0.1, 0))
    path.addQuadCurve(to: point(0.24, 0.04), control: point(0.1, 0))
    path.addCurve(to: point(0, 1), control1: point(0.56, 0.1), control2: point(0.62, 0.68))
    path.closeSubpath()
    return path
}

private enum BlossomPetalGeometry {
    /// A petal one unit long centred on the origin: base at y = +0.5, notch at y = −0.5.
    static let unit: Path = blossomPetalPath(in: CGRect(x: -0.36, y: -0.5, width: 0.72, height: 1))

    static let frontColors: [Color] = [BlossomPalette.petalPale, Color(hex: 0xF7BFCC)]
    static let backColors: [Color] = [Color(hex: 0xF9D3DC), Color(hex: 0xEDA2B5)]
}

// MARK: - Background pieces

/// A few large, soft circles of light, as if seen through a lens.
private enum BlossomBokehRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        for index in 0..<7 {
            let x = blossomRandom(index, 51) * width
            let y = blossomRandom(index, 52) * height
            let radius = 24 + 50 * blossomRandom(index, 53)
            let alpha = 0.1 + 0.12 * blossomRandom(index, 54)
            let gradient = Gradient(stops: [
                .init(color: Color.white.opacity(alpha), location: 0),
                .init(color: Color.white.opacity(alpha * 0.8), location: 0.75),
                .init(color: Color.white.opacity(0), location: 1)
            ])
            context.fill(
                blossomCircle(x, y, radius),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }
}

/// A flowering bough reaching in from the top-right corner (drawn sharp, blurred by the view).
private enum BlossomBranchRenderer {
    private static let flowers: [(x: Double, y: Double, radius: Double, turn: Double)] = [
        (0.6, 0.02, 11, 0.2), (0.7, 0.1, 8, 1.1), (0.86, 0.1, 9, 2.8),
        (0.5, 0.78, 11, 0.9), (0.56, 0.6, 8, 2.0), (0.04, 0.4, 10, 0.4),
        (0.13, 0.43, 8, 1.6), (0.3, 0.82, 10, 2.4), (0.37, 0.68, 7, 0.1),
        (0.13, 0.66, 9, 1.2), (0.42, 0.47, 7, 3.0), (0.22, 0.52, 6, 0.7)
    ]

    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        let bark = BlossomPalette.plum

        var bough = Path()
        bough.move(to: CGPoint(x: width + 10, y: height * 0.06))
        bough.addCurve(
            to: CGPoint(x: width * 0.12, y: height * 0.66),
            control1: CGPoint(x: width * 0.7, y: height * 0.1),
            control2: CGPoint(x: width * 0.4, y: height * 0.52)
        )
        let taper: [(from: Double, to: Double, lineWidth: Double)] = [(0, 0.4, 7), (0.35, 0.7, 5), (0.65, 1, 3)]
        for segment in taper {
            context.stroke(
                bough.trimmedPath(from: CGFloat(segment.from), to: CGFloat(segment.to)),
                with: .color(bark),
                style: StrokeStyle(lineWidth: CGFloat(segment.lineWidth), lineCap: .round)
            )
        }

        twig(in: &context, width: width, height: height, from: (0.79, 0.15), control: (0.7, 0.1), to: (0.6, 0.0), lineWidth: 2.4)
        twig(in: &context, width: width, height: height, from: (0.555, 0.32), control: (0.58, 0.55), to: (0.5, 0.78), lineWidth: 2.2)
        twig(in: &context, width: width, height: height, from: (0.333, 0.513), control: (0.18, 0.42), to: (0.04, 0.4), lineWidth: 2)
        twig(in: &context, width: width, height: height, from: (0.45, 0.41), control: (0.42, 0.64), to: (0.3, 0.82), lineWidth: 1.8)

        for flower in flowers {
            drawFlower(in: &context, x: flower.x * width, y: flower.y * height, radius: flower.radius, turn: flower.turn)
        }
    }

    private static func twig(
        in context: inout GraphicsContext,
        width: Double,
        height: Double,
        from start: (Double, Double),
        control: (Double, Double),
        to end: (Double, Double),
        lineWidth: Double
    ) {
        var path = Path()
        path.move(to: CGPoint(x: start.0 * width, y: start.1 * height))
        path.addQuadCurve(
            to: CGPoint(x: end.0 * width, y: end.1 * height),
            control: CGPoint(x: control.0 * width, y: control.1 * height)
        )
        context.stroke(
            path,
            with: .color(BlossomPalette.plum),
            style: StrokeStyle(lineWidth: CGFloat(lineWidth), lineCap: .round)
        )
    }

    private static func drawFlower(in context: inout GraphicsContext, x: Double, y: Double, radius: Double, turn: Double) {
        for index in 0..<5 {
            var petal = context
            petal.translateBy(x: CGFloat(x), y: CGFloat(y))
            petal.rotate(by: .radians(turn + Double(index) * 2 * Double.pi / 5))
            petal.translateBy(x: 0, y: CGFloat(-radius * 0.5))
            petal.scaleBy(x: CGFloat(radius), y: CGFloat(radius))
            petal.fill(BlossomPetalGeometry.unit, with: .color(BlossomPalette.rose))
        }
        context.fill(blossomCircle(x, y, radius * 0.24), with: .color(BlossomPalette.roseDeep))
    }
}

/// Forty petals falling on a slow diagonal wind, swaying and turning over as they go.
private enum BlossomPetalRenderer {
    static let count = 40

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        for index in 0..<count {
            drawPetal(index, in: &context, width: width, height: height, time: time)
        }
    }

    private static func drawPetal(_ index: Int, in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        let depth = blossomRandom(index, 1)
        let fallPeriod = 24 + 16 * (1 - depth) + 6 * blossomRandom(index, 2)
        let fall = time / fallPeriod + blossomRandom(index, 3)
        let progress = fall - floor(fall)
        let y = -40 + progress * (height + 80)

        let swayRate = 0.45 + 0.5 * blossomRandom(index, 4)
        let swayPhase = blossomRandom(index, 5) * 2 * Double.pi
        let sway = sin(time * swayRate + swayPhase) * (10 + 22 * blossomRandom(index, 6))
        let lane = blossomRandom(index, 7) + progress * 0.3
        let x = (lane - floor(lane)) * (width + 100) - 50 + sway

        let length = 7 + 8 * depth
        let direction: Double = blossomRandom(index, 9) > 0.5 ? 1 : -1
        let spin = time * (0.25 + 0.5 * blossomRandom(index, 8)) * direction + blossomRandom(index, 10) * 2 * Double.pi
        let flutter = cos(time * (0.8 + 1.1 * blossomRandom(index, 11)) + blossomRandom(index, 12) * 2 * Double.pi)

        var petal = context
        petal.opacity = 0.45 + 0.4 * depth
        petal.translateBy(x: CGFloat(x), y: CGFloat(y))
        petal.rotate(by: .radians(spin))
        petal.scaleBy(x: CGFloat(max(0.18, abs(flutter)) * length), y: CGFloat(length))
        let colors = flutter >= 0 ? BlossomPetalGeometry.frontColors : BlossomPetalGeometry.backColors
        petal.fill(
            BlossomPetalGeometry.unit,
            with: .linearGradient(Gradient(colors: colors), startPoint: CGPoint(x: 0, y: -0.5), endPoint: CGPoint(x: 0, y: 0.5))
        )
    }
}

// MARK: - Seal art

private struct BlossomSealArt: View {
    let monogram: String
    let side: CGFloat

    var body: some View {
        ZStack {
            petals
            eye
            stamens
            disc
            monogramMark
        }
        .frame(width: side, height: side)
    }

    private var petalGradient: RadialGradient {
        RadialGradient(
            gradient: Gradient(stops: [
                .init(color: BlossomPalette.roseDeep, location: 0),
                .init(color: BlossomPalette.roseMid, location: 0.5),
                .init(color: BlossomPalette.petalLight, location: 0.78),
                .init(color: BlossomPalette.petalPale, location: 1)
            ]),
            center: .bottom,
            startRadius: 0,
            endRadius: side * 0.5
        )
    }

    private var petals: some View {
        ZStack {
            ForEach(0..<5, id: \.self) { index in
                petal(index)
            }
        }
        .frame(width: side, height: side)
        .rotationEffect(.degrees(-12))
        .compositingGroup()
        .shadow(color: BlossomPalette.plum.opacity(0.22), radius: side * 0.025, x: 0, y: side * 0.018)
    }

    private func petal(_ index: Int) -> some View {
        ZStack {
            BlossomPetalShape()
                .fill(petalGradient)
            BlossomPetalShape()
                .stroke(BlossomPalette.roseDeep.opacity(0.28), lineWidth: max(0.4, side * 0.005))
            BlossomVeinShape()
                .stroke(Color.white.opacity(0.42), style: StrokeStyle(lineWidth: max(0.35, side * 0.004), lineCap: .round))
        }
        .frame(width: side * 0.42, height: side * 0.5)
        .scaleEffect(CGFloat(0.93 + 0.07 * blossomRandom(index, 41)), anchor: .bottom)
        .offset(y: -side * 0.25)
        .rotationEffect(.degrees(Double(index) * 72 + (blossomRandom(index, 42) - 0.5) * 8))
    }

    /// The deeper blush where the petals meet.
    private var eye: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [
                        BlossomPalette.roseDeep.opacity(0.85),
                        BlossomPalette.roseDeep.opacity(0.4),
                        BlossomPalette.roseDeep.opacity(0)
                    ],
                    center: .center,
                    startRadius: side * 0.2,
                    endRadius: side * 0.36
                )
            )
            .frame(width: side * 0.72, height: side * 0.72)
    }

    private var stamens: some View {
        Canvas { context, size in
            BlossomStamenRenderer.draw(in: &context, size: size)
        }
        .frame(width: side, height: side)
    }

    private var disc: some View {
        ZStack {
            Circle()
                .fill(
                    RadialGradient(
                        colors: [BlossomPalette.cream, BlossomPalette.creamShade],
                        center: UnitPoint(x: 0.4, y: 0.35),
                        startRadius: 0,
                        endRadius: side * 0.26
                    )
                    .shadow(.inner(color: BlossomPalette.roseDeep.opacity(0.28), radius: side * 0.02, x: 0, y: side * 0.01))
                )
            Circle()
                .stroke(BlossomPalette.roseDeep.opacity(0.32), lineWidth: max(0.5, side * 0.006))
            Circle()
                .stroke(
                    BlossomPalette.rose.opacity(0.55),
                    style: StrokeStyle(lineWidth: max(0.5, side * 0.008), lineCap: .round, dash: [0, side * 0.034])
                )
                .padding(side * 0.022)
        }
        .frame(width: side * 0.46, height: side * 0.46)
        .shadow(color: BlossomPalette.plum.opacity(0.22), radius: side * 0.012, x: 0, y: side * 0.006)
    }

    private var monogramFont: Font {
        if blossomIsIdeographic(monogram) {
            return .system(size: side * 0.22, weight: .semibold, design: .rounded)
        }
        let size = monogram.count > 1 ? side * 0.18 : side * 0.25
        return .system(size: size, weight: .semibold, design: .rounded)
    }

    private var monogramMark: some View {
        Text(monogram)
            .font(monogramFont)
            .foregroundStyle(BlossomPalette.monogram)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: side * 0.36, height: side * 0.36)
    }
}

private struct BlossomPetalShape: Shape {
    func path(in rect: CGRect) -> Path {
        blossomPetalPath(in: rect)
    }
}

/// A central vein with two side veins, drawn in the petal's own frame.
private struct BlossomVeinShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.maxY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.26))
        path.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.64))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.27, y: rect.minY + rect.height * 0.22),
            control: CGPoint(x: rect.minX + rect.width * 0.3, y: rect.minY + rect.height * 0.46)
        )
        path.move(to: CGPoint(x: rect.midX, y: rect.minY + rect.height * 0.64))
        path.addQuadCurve(
            to: CGPoint(x: rect.minX + rect.width * 0.73, y: rect.minY + rect.height * 0.22),
            control: CGPoint(x: rect.minX + rect.width * 0.7, y: rect.minY + rect.height * 0.46)
        )
        return path
    }
}

private enum BlossomStamenRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let unit = Double(min(size.width, size.height))
        guard unit > 1 else { return }
        let cx = Double(size.width) / 2
        let cy = Double(size.height) / 2
        let count = 20
        let filamentWidth = CGFloat(max(0.4, unit * 0.005))
        let antherRadius = max(0.5, unit * 0.012)
        for index in 0..<count {
            let angle = (Double(index) + 0.5 * blossomRandom(index, 21)) / Double(count) * 2 * Double.pi
            let inner = unit * 0.2
            let outer = unit * (0.29 + 0.06 * blossomRandom(index, 22))
            let bend = (blossomRandom(index, 23) - 0.5) * 0.2
            let end = CGPoint(x: cx + cos(angle + bend) * outer, y: cy + sin(angle + bend) * outer)
            var filament = Path()
            filament.move(to: CGPoint(x: cx + cos(angle) * inner, y: cy + sin(angle) * inner))
            filament.addLine(to: end)
            context.stroke(filament, with: .color(BlossomPalette.roseDeep.opacity(0.75)), lineWidth: filamentWidth)
            context.fill(
                blossomCircle(Double(end.x), Double(end.y), antherRadius),
                with: .color(BlossomPalette.stamen)
            )
        }
    }
}

// MARK: - Burst renderer

private enum BlossomBurstRenderer {
    static let duration: Double = 2.4
    private static let petalCount = 36
    private static let goldenAngle = 2.39996

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double, reduceMotion: Bool) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1, time >= 0, time <= duration else { return }
        let cx = width / 2
        let cy = height / 2
        let unit = min(width, height)
        drawBloom(in: &context, cx: cx, cy: cy, unit: unit, time: time, reduceMotion: reduceMotion)
        guard !reduceMotion else { return }
        drawPetals(in: &context, cx: cx, cy: cy, unit: unit, time: time)
    }

    private static func drawBloom(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double, reduceMotion: Bool) {
        let progress = min(time / 1.0, 1)
        let alpha = reduceMotion ? 0.4 * sin(Double.pi * min(time / duration, 1)) : 0.5 * (1 - progress)
        guard alpha > 0.002 else { return }
        let radius = reduceMotion ? unit * 0.4 : unit * (0.1 + 0.45 * blossomEaseOut(progress))
        let gradient = Gradient(colors: [
            BlossomPalette.petalLight.opacity(alpha),
            BlossomPalette.rose.opacity(alpha * 0.3),
            BlossomPalette.rose.opacity(0)
        ])
        context.fill(
            blossomCircle(cx, cy, radius),
            with: .radialGradient(gradient, center: CGPoint(x: cx, y: cy), startRadius: 0, endRadius: CGFloat(radius))
        )
    }

    private static func drawPetals(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let appear = min(1, time / 0.15)
        let fade = 1 - blossomSmoothstep(1.5, 2.3, time)
        let visibility = appear * fade
        guard visibility > 0.002 else { return }
        let swirl = blossomEaseOut(time / 1.3)
        let outward = blossomEaseOut(time / 1.1)
        let settle = max(0, time - 0.8)
        let grow = min(1, time / 0.25)

        for index in 0..<petalCount {
            let reach = unit * (0.06 + (0.2 + 0.24 * blossomRandom(index, 31)) * outward)
            let angle = Double(index) * goldenAngle + 2.2 * swirl
            let drift = unit * 0.16 * settle * settle * (0.6 + 0.8 * blossomRandom(index, 32))
            let sway = sin(time * 3 + Double(index)) * unit * 0.02 * settle
            let x = cx + cos(angle) * reach + sway
            let y = cy + sin(angle) * reach + drift
            let length = unit * (0.05 + 0.035 * blossomRandom(index, 33)) * grow
            guard length > 0.05 else { continue }
            let flutter = cos(time * (3.5 + 3 * blossomRandom(index, 34)) + Double(index))
            let spin = angle + Double.pi / 2 + time * (1.5 + 2 * blossomRandom(index, 35))

            var petal = context
            petal.opacity = visibility
            petal.translateBy(x: CGFloat(x), y: CGFloat(y))
            petal.rotate(by: .radians(spin))
            petal.scaleBy(x: CGFloat(max(0.2, abs(flutter)) * length), y: CGFloat(length))
            let colors = flutter >= 0 ? BlossomPetalGeometry.frontColors : BlossomPetalGeometry.backColors
            petal.fill(
                BlossomPetalGeometry.unit,
                with: .linearGradient(Gradient(colors: colors), startPoint: CGPoint(x: 0, y: -0.5), endPoint: CGPoint(x: 0, y: 0.5))
            )
        }
    }
}

// MARK: - Stationery pieces

/// A rounded sheet whose edge wavers by a fraction of a point, like handmade deckled paper.
private struct BlossomDeckleShape: Shape {
    var cornerRadius: CGFloat
    var roughness: CGFloat

    func path(in rect: CGRect) -> Path {
        let radius = Double(min(cornerRadius, min(rect.width, rect.height) / 2))
        let minX = Double(rect.minX)
        let minY = Double(rect.minY)
        let maxX = Double(rect.maxX)
        let maxY = Double(rect.maxY)
        let rough = Double(roughness)
        let spacing = 4.0
        var points: [CGPoint] = []

        func appendEdge(from start: CGPoint, to end: CGPoint, normal: CGVector) {
            let dx = Double(end.x - start.x)
            let dy = Double(end.y - start.y)
            let steps = max(1, Int((dx * dx + dy * dy).squareRoot() / spacing))
            for step in 0..<steps {
                let t = Double(step) / Double(steps)
                let wobble = rough * blossomRandom(points.count, 61)
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
                let reach = radius - rough * blossomRandom(points.count, 61)
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

/// Watercolour washes pooling in two corners, with darker pigment at their edges,
/// a little granulation, and pressed petals resting where the text never goes.
private enum BlossomWashRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        let unit = min(width, height)
        guard unit > 1 else { return }

        wash(in: &context, cx: width * 0.04, cy: height * 0.02, radius: unit * 0.34, color: BlossomPalette.rose, alpha: 0.2, seed: 1)
        wash(in: &context, cx: width * 0.2, cy: -height * 0.01, radius: unit * 0.22, color: BlossomPalette.peachDeep, alpha: 0.2, seed: 2)
        wash(in: &context, cx: width * 0.97, cy: height * 0.98, radius: unit * 0.36, color: BlossomPalette.sage, alpha: 0.22, seed: 3)
        wash(in: &context, cx: width * 0.8, cy: height * 1.01, radius: unit * 0.22, color: BlossomPalette.peachDeep, alpha: 0.18, seed: 4)

        pressedPetal(in: &context, x: width - 34, y: height - 30, length: 15, turn: 2.3)
        pressedPetal(in: &context, x: width - 58, y: height - 16, length: 11, turn: -0.9)
        pressedPetal(in: &context, x: 16, y: 14, length: 9, turn: 0.7)
    }

    private static func blot(cx: Double, cy: Double, radius: Double, seed: Int) -> Path {
        let count = 24
        var points: [CGPoint] = []
        points.reserveCapacity(count)
        for index in 0..<count {
            let angle = Double(index) / Double(count) * 2 * Double.pi
            let reach = radius * (0.82 + 0.3 * blossomRandom(index + seed * 37, 71))
            points.append(CGPoint(x: cx + cos(angle) * reach, y: cy + sin(angle) * reach))
        }
        return blossomSmoothPath(points)
    }

    private static func wash(in context: inout GraphicsContext, cx: Double, cy: Double, radius: Double, color: Color, alpha: Double, seed: Int) {
        let path = blot(cx: cx, cy: cy, radius: radius, seed: seed)
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: CGFloat(radius * 0.12)))
            layer.fill(path, with: .color(color.opacity(alpha)))
        }
        context.drawLayer { layer in
            layer.addFilter(.blur(radius: 1.6))
            layer.stroke(path, with: .color(color.opacity(alpha * 0.9)), lineWidth: 1.4)
        }
        for index in 0..<18 {
            let angle = blossomRandom(index + seed * 19, 72) * 2 * Double.pi
            let distance = radius * 0.85 * blossomRandom(index + seed * 19, 73).squareRoot()
            let dot = 0.4 + 0.9 * blossomRandom(index + seed * 19, 74)
            context.fill(
                blossomCircle(cx + cos(angle) * distance, cy + sin(angle) * distance, dot),
                with: .color(color.opacity(alpha * 0.8))
            )
        }
    }

    private static func pressedPetal(in context: inout GraphicsContext, x: Double, y: Double, length: Double, turn: Double) {
        var petal = context
        petal.opacity = 0.6
        petal.translateBy(x: CGFloat(x), y: CGFloat(y))
        petal.rotate(by: .radians(turn))
        petal.scaleBy(x: CGFloat(length), y: CGFloat(length))
        petal.fill(
            BlossomPetalGeometry.unit,
            with: .linearGradient(
                Gradient(colors: [BlossomPalette.petalPale, BlossomPalette.rose]),
                startPoint: CGPoint(x: 0, y: -0.5),
                endPoint: CGPoint(x: 0, y: 0.5)
            )
        )
    }
}

// MARK: - Preview

#Preview("Blossom 花信") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 28) {
            ZStack {
                BlossomBurst()
                BlossomSeal(monogram: "BW")
                    .frame(width: 160, height: 160)
            }
            .frame(width: 300, height: 220)
            HStack(spacing: 20) {
                BlossomSeal(monogram: "M").frame(width: 40, height: 40)
                BlossomSeal(monogram: "高").frame(width: 40, height: 40)
                BlossomSeal(monogram: "BW").frame(width: 40, height: 40)
            }
            BlossomStationery()
                .frame(height: 280)
                .padding(.horizontal, 24)
        }
    }
    .theme(.blossom)
}

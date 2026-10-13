import SwiftUI

// Parchment 信笺 — a letter found in grandmother's drawer.
// Cream rag paper, sepia ink, an oxblood wax seal and a little gold dust in the window light.

// MARK: - Tokens

extension Theme {
    static let parchment = Theme(
        id: .parchment,
        name: "Parchment",
        nativeName: "信笺",
        tagline: "Sealed in wax, kept by time.",
        colorScheme: .light,
        background: Color(hex: 0xF3E9D7),
        surface: Color(hex: 0xFBF6EC, opacity: 0.96),
        surfaceStroke: Color(hex: 0xB08D57, opacity: 0.38),
        ink: Color(hex: 0x3B2A1A),
        inkSecondary: Color(hex: 0x6B5440),
        accent: Color(hex: 0x8E1B1B),
        accentInk: Color(hex: 0xFBF3E4),
        glow: Color(hex: 0xC9A15E),
        seal: Color(hex: 0x8E1B1B),
        gradient: [Color(hex: 0xF7EEDF), Color(hex: 0xE4CFA9), Color(hex: 0xB08D57), Color(hex: 0x8E1B1B)],
        cornerRadius: 10,
        displayFontName: "Didot",
        bodyFontName: "Baskerville",
        fontDesign: .serif,
        usesMaterial: false
    )
}

// MARK: - Background

/// Cream rag paper: deterministic grain, warm window light, a faded postmark
/// and a few gold dust motes drifting through the light.
struct ParchmentBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init() {}

    var body: some View {
        ZStack {
            ParchmentGrainLayer(fibres: 280)
            windowLight
            postmark
            vignette
            dust
        }
        .allowsHitTesting(false)
    }

    private var windowLight: some View {
        LinearGradient(
            colors: [Color.white.opacity(0.34), Color.white.opacity(0.08), Color.white.opacity(0)],
            startPoint: .topLeading,
            endPoint: UnitPoint(x: 0.62, y: 0.55)
        )
    }

    private var vignette: some View {
        EllipticalGradient(
            colors: [
                ParchmentPalette.umber.opacity(0),
                ParchmentPalette.umber.opacity(0.05),
                ParchmentPalette.umber.opacity(0.17)
            ],
            center: .center,
            startRadiusFraction: 0.32,
            endRadiusFraction: 0.82
        )
    }

    private var postmark: some View {
        Canvas { context, size in
            ParchmentPostmarkRenderer.draw(in: &context, size: size)
        }
        .frame(width: 230, height: 130)
        .rotationEffect(.degrees(-9))
        .opacity(0.12)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topTrailing)
        .padding(.top, 64)
        .padding(.trailing, -14)
    }

    private var dust: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
            Canvas { context, size in
                ParchmentDustRenderer.draw(
                    in: &context,
                    size: size,
                    time: timeline.date.timeIntervalSinceReferenceDate
                )
            }
        }
    }
}

// MARK: - Seal

/// A hand-poured oxblood wax seal with a pressed, raised monogram.
struct ParchmentSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            ParchmentSealArt(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
        .aspectRatio(1, contentMode: .fit)
    }
}

// MARK: - Burst

/// The seal cracks: wax crumbs scatter and fall while gold dust lifts into the light.
struct ParchmentBurst: View {
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
                        ParchmentBurstRenderer.draw(
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
            try? await Task.sleep(for: .seconds(ParchmentBurstRenderer.duration + 0.15))
            isFinished = true
        }
    }
}

// MARK: - Stationery

/// Cream laid paper with faint ruling, a double oxblood margin rule,
/// a deckled edge, a little foxing and a gold fleuron at the foot.
struct ParchmentStationery: View {
    init() {}

    private var sheet: ParchmentDeckleShape {
        ParchmentDeckleShape(cornerRadius: Theme.parchment.cornerRadius, roughness: 1.1)
    }

    var body: some View {
        ZStack {
            paper
            ParchmentGrainLayer(fibres: 170)
                .opacity(0.8)
            ParchmentFoxingLayer()
            ParchmentRulingLayer()
            edgeShade
        }
        .clipShape(sheet)
        .overlay(sheet.stroke(ParchmentPalette.gold.opacity(0.28), lineWidth: 0.6))
        .shadow(color: ParchmentPalette.umber.opacity(0.16), radius: 18, x: 0, y: 10)
        .shadow(color: ParchmentPalette.umber.opacity(0.12), radius: 1.5, x: 0, y: 1)
    }

    private var paper: some View {
        LinearGradient(
            colors: [ParchmentPalette.paper, ParchmentPalette.paperWarm],
            startPoint: .top,
            endPoint: .bottom
        )
    }

    /// Soft inner shadow that makes the edges look aged and slightly lifted.
    private var edgeShade: some View {
        ZStack {
            sheet
                .stroke(ParchmentPalette.umber.opacity(0.2), lineWidth: 16)
                .blur(radius: 11)
            sheet
                .stroke(ParchmentPalette.umber.opacity(0.13), lineWidth: 2.5)
                .blur(radius: 1.4)
        }
    }
}

// MARK: - Palette & helpers

private enum ParchmentPalette {
    static let paper = Color(hex: 0xFCF6EB)
    static let paperWarm = Color(hex: 0xF6ECDA)
    static let sepia = Color(hex: 0x3B2A1A)
    static let umber = Color(hex: 0x6B4A2B)
    static let foxing = Color(hex: 0xA0743F)
    static let wax = Color(hex: 0x8E1B1B)
    static let waxBright = Color(hex: 0xB3372F)
    static let waxDeep = Color(hex: 0x560C0C)
    static let waxLetterTop = Color(hex: 0xD45B4C)
    static let waxLetterBottom = Color(hex: 0xA42A24)
    static let gold = Color(hex: 0xB08D57)
    static let goldLight = Color(hex: 0xE6C98F)
}

/// Deterministic pseudo-random value in 0..<1 for an index and a salt.
private func parchmentRandom(_ index: Int, _ salt: Int) -> Double {
    let value = sin(Double(index) * 12.9898 + Double(salt) * 78.233 + 0.731) * 43758.5453
    return value - floor(value)
}

private func parchmentSmoothstep(_ edge0: Double, _ edge1: Double, _ x: Double) -> Double {
    let t = min(max((x - edge0) / (edge1 - edge0), 0), 1)
    return t * t * (3 - 2 * t)
}

private func parchmentEaseOut(_ x: Double) -> Double {
    let t = min(max(x, 0), 1)
    return 1 - pow(1 - t, 3)
}

private func parchmentCircle(_ x: Double, _ y: Double, _ radius: Double) -> Path {
    Path(ellipseIn: CGRect(x: x - radius, y: y - radius, width: radius * 2, height: radius * 2))
}

private func parchmentIsIdeographic(_ text: String) -> Bool {
    text.unicodeScalars.first?.properties.isIdeographic ?? false
}

/// Closed Catmull–Rom spline through the given points.
private func parchmentSmoothPath(_ points: [CGPoint]) -> Path {
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

// MARK: - Paper grain

private struct ParchmentGrainLayer: View {
    var fibres: Int

    var body: some View {
        Canvas { context, size in
            ParchmentGrainRenderer.draw(in: &context, size: size, fibres: fibres)
        }
    }
}

private enum ParchmentGrainRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize, fibres: Int) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        drawMottling(in: &context, width: width, height: height)
        drawFibres(in: &context, width: width, height: height, count: fibres)
        drawSpecks(in: &context, width: width, height: height, count: fibres)
    }

    /// Large, barely-there clouds of denser pulp.
    private static func drawMottling(in context: inout GraphicsContext, width: Double, height: Double) {
        let span = max(width, height)
        for index in 0..<7 {
            let x = parchmentRandom(index, 1) * width
            let y = parchmentRandom(index, 2) * height
            let radius = (0.16 + 0.22 * parchmentRandom(index, 3)) * span
            let gradient = Gradient(colors: [
                ParchmentPalette.umber.opacity(0.045),
                ParchmentPalette.umber.opacity(0)
            ])
            context.fill(
                parchmentCircle(x, y, radius),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }

    /// Short, gently curved strands of rag fibre.
    private static func drawFibres(in context: inout GraphicsContext, width: Double, height: Double, count: Int) {
        for index in 0..<count {
            let x = parchmentRandom(index, 4) * width
            let y = parchmentRandom(index, 5) * height
            let length = 5 + 17 * parchmentRandom(index, 6)
            let angle = parchmentRandom(index, 7) * Double.pi
            let bend = (parchmentRandom(index, 8) - 0.5) * length * 0.6
            let dx = cos(angle) * length * 0.5
            let dy = sin(angle) * length * 0.5
            var path = Path()
            path.move(to: CGPoint(x: x - dx, y: y - dy))
            path.addQuadCurve(
                to: CGPoint(x: x + dx, y: y + dy),
                control: CGPoint(x: x - sin(angle) * bend, y: y + cos(angle) * bend)
            )
            let isLight = parchmentRandom(index, 9) > 0.72
            let alpha = 0.045 + 0.06 * parchmentRandom(index, 10)
            let color = isLight ? Color.white.opacity(0.4) : ParchmentPalette.umber.opacity(alpha)
            context.stroke(path, with: .color(color), lineWidth: 0.5)
        }
    }

    /// Tiny inclusions in the pulp.
    private static func drawSpecks(in context: inout GraphicsContext, width: Double, height: Double, count: Int) {
        for index in 0..<count {
            let x = parchmentRandom(index, 11) * width
            let y = parchmentRandom(index, 12) * height
            let radius = 0.25 + 0.6 * parchmentRandom(index, 13)
            let alpha = 0.05 + 0.1 * parchmentRandom(index, 14)
            context.fill(parchmentCircle(x, y, radius), with: .color(ParchmentPalette.umber.opacity(alpha)))
        }
    }
}

// MARK: - Postmark

private enum ParchmentPostmarkRenderer {
    static let legend: [Character] = Array("TIMELEAF · POST · 时笺 · ")

    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        let outer = height * 0.44
        let inner = height * 0.29
        let cx = width - outer - 3
        let cy = height * 0.5
        let ink = ParchmentPalette.sepia

        let worn = StrokeStyle(lineWidth: 1.6, lineCap: .round, dash: [34, 2.5, 11, 1.8])
        context.stroke(parchmentCircle(cx, cy, outer), with: .color(ink), style: worn)
        context.stroke(parchmentCircle(cx, cy, inner), with: .color(ink), style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [20, 1.6]))

        drawLegend(in: &context, cx: cx, cy: cy, radius: (outer + inner) / 2, height: height)
        drawCentre(in: &context, cx: cx, cy: cy, inner: inner)
        drawCancellation(in: &context, endX: cx - outer - 6, cy: cy, height: height)
    }

    private static func drawLegend(in context: inout GraphicsContext, cx: Double, cy: Double, radius: Double, height: Double) {
        let count = legend.count
        guard count > 0 else { return }
        let font = Font.system(size: CGFloat(height * 0.074), weight: .semibold, design: .serif)
        for (index, character) in legend.enumerated() {
            let angle = -Double.pi / 2 + Double(index) / Double(count) * 2 * Double.pi
            var glyph = context
            glyph.translateBy(x: CGFloat(cx + cos(angle) * radius), y: CGFloat(cy + sin(angle) * radius))
            glyph.rotate(by: .radians(angle + Double.pi / 2))
            let text: Text = Text(verbatim: String(character))
                .font(font)
                .foregroundStyle(ParchmentPalette.sepia)
            glyph.draw(text, at: .zero, anchor: .center)
        }
    }

    private static func drawCentre(in context: inout GraphicsContext, cx: Double, cy: Double, inner: Double) {
        let ink = ParchmentPalette.sepia
        for offset in [-0.42, 0.42] {
            var bar = Path()
            bar.move(to: CGPoint(x: cx - inner * 0.55, y: cy + inner * offset))
            bar.addLine(to: CGPoint(x: cx + inner * 0.55, y: cy + inner * offset))
            context.stroke(bar, with: .color(ink), lineWidth: 0.9)
        }
        let text: Text = Text(verbatim: "时笺")
            .font(.system(size: CGFloat(inner * 0.42), weight: .medium, design: .serif))
            .foregroundStyle(ink)
        context.draw(text, at: CGPoint(x: cx, y: cy), anchor: .center)
    }

    /// Wavy cancellation lines running off towards the left.
    private static func drawCancellation(in context: inout GraphicsContext, endX: Double, cy: Double, height: Double) {
        guard endX > 10 else { return }
        for line in 0..<5 {
            let y = cy + (Double(line) - 2) * height * 0.12
            var path = Path()
            var x = 0.0
            path.move(to: CGPoint(x: x, y: y + sin(Double(line) * 0.6) * 2.6))
            while x < endX {
                x += 3
                path.addLine(to: CGPoint(x: x, y: y + sin(x / 9 + Double(line) * 0.6) * 2.6))
            }
            let style = StrokeStyle(lineWidth: 1.3, lineCap: .round, dash: [38, 2.2, 15, 3])
            context.stroke(path, with: .color(ParchmentPalette.sepia), style: style)
        }
    }
}

// MARK: - Dust motes

private enum ParchmentDustRenderer {
    static let count = 44

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        for index in 0..<count {
            drawMote(index, in: &context, width: width, height: height, time: time)
        }
    }

    private static func drawMote(_ index: Int, in context: inout GraphicsContext, width: Double, height: Double, time: Double) {
        let risePeriod = 80 + 70 * parchmentRandom(index, 21)
        let rise = time / risePeriod + parchmentRandom(index, 22)
        let yFraction = 1 - (rise - floor(rise))
        let swayPeriod = 9 + 10 * parchmentRandom(index, 23)
        let swayPhase = parchmentRandom(index, 24) * 2 * Double.pi
        let sway = sin(time * 2 * Double.pi / swayPeriod + swayPhase) * (8 + 18 * parchmentRandom(index, 25))
        let x = parchmentRandom(index, 26) * width + sway
        let y = yFraction * (height + 40) - 20

        let twinkle = 0.55 + 0.45 * sin(time * (0.4 + 0.8 * parchmentRandom(index, 27)) + Double(index))
        let edgeFade = parchmentSmoothstep(0, 0.12, yFraction) * parchmentSmoothstep(1, 0.88, yFraction)
        let inLight = 1 - 0.6 * min(1, (x / width + y / height) * 0.75)
        let alpha = (0.2 + 0.38 * parchmentRandom(index, 28)) * twinkle * edgeFade * inLight
        guard alpha > 0.01 else { return }

        let radius = 0.6 + 1.5 * pow(parchmentRandom(index, 29), 2)
        if radius > 1.3 {
            let halo = radius * 4
            let gradient = Gradient(colors: [
                ParchmentPalette.goldLight.opacity(alpha * 0.5),
                ParchmentPalette.goldLight.opacity(0)
            ])
            context.fill(
                parchmentCircle(x, y, halo),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(halo))
            )
        }
        context.fill(parchmentCircle(x, y, radius), with: .color(ParchmentPalette.gold.opacity(alpha)))
    }
}

// MARK: - Seal art

private struct ParchmentSealArt: View {
    let monogram: String
    let side: CGFloat

    var body: some View {
        ZStack {
            waxBody
            droplets
            pressedDisc
            raisedLip
            rings
            monogramMark
            highlights
        }
        .frame(width: side, height: side)
    }

    private var waxGradient: RadialGradient {
        RadialGradient(
            colors: [ParchmentPalette.waxBright, ParchmentPalette.wax, ParchmentPalette.waxDeep],
            center: UnitPoint(x: 0.36, y: 0.3),
            startRadius: 0,
            endRadius: side * 0.7
        )
    }

    private var waxBody: some View {
        ParchmentWaxShape()
            .fill(
                waxGradient.shadow(
                    .inner(color: ParchmentPalette.waxDeep.opacity(0.85), radius: side * 0.03, x: -side * 0.01, y: -side * 0.014)
                )
            )
            .overlay(edgeSheen)
            .shadow(color: Color.black.opacity(0.28), radius: side * 0.03, x: 0, y: side * 0.022)
            .shadow(color: ParchmentPalette.waxDeep.opacity(0.35), radius: side * 0.004, x: 0, y: side * 0.006)
    }

    /// Light catching the rounded rim of the poured wax.
    private var edgeSheen: some View {
        ParchmentWaxShape()
            .stroke(
                LinearGradient(
                    colors: [Color.white.opacity(0.42), Color.white.opacity(0), Color.black.opacity(0.25)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: max(0.6, side * 0.016)
            )
            .blur(radius: side * 0.006)
            .clipShape(ParchmentWaxShape())
    }

    /// Little drips that escaped the pour.
    private var droplets: some View {
        ZStack {
            Ellipse()
                .fill(waxGradient)
                .frame(width: side * 0.07, height: side * 0.06)
                .offset(x: side * 0.44, y: side * 0.1)
            Circle()
                .fill(waxGradient)
                .frame(width: side * 0.03, height: side * 0.03)
                .offset(x: -side * 0.33, y: side * 0.37)
        }
        .shadow(color: Color.black.opacity(0.25), radius: side * 0.008, x: 0, y: side * 0.008)
    }

    /// The flat area the stamp pushed down into the wax.
    private var pressedDisc: some View {
        Circle()
            .fill(
                RadialGradient(
                    colors: [ParchmentPalette.wax, ParchmentPalette.waxDeep],
                    center: UnitPoint(x: 0.4, y: 0.35),
                    startRadius: 0,
                    endRadius: side * 0.36
                )
                .shadow(.inner(color: Color.black.opacity(0.55), radius: side * 0.018, x: side * 0.008, y: side * 0.012))
                .shadow(.inner(color: Color.white.opacity(0.16), radius: side * 0.01, x: -side * 0.006, y: -side * 0.008))
            )
            .frame(width: side * 0.6, height: side * 0.6)
    }

    /// Wax squeezed up around the stamp.
    private var raisedLip: some View {
        Circle()
            .stroke(
                LinearGradient(
                    colors: [Color.white.opacity(0.32), Color.white.opacity(0.02), Color.black.opacity(0.3)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                ),
                lineWidth: max(0.8, side * 0.022)
            )
            .blur(radius: side * 0.004)
            .frame(width: side * 0.64, height: side * 0.64)
    }

    /// Embossed hairline ring and a beaded border, like a signet.
    private var rings: some View {
        let beadDiameter = side * 0.49
        let gap = beadDiameter * CGFloat.pi / 30
        return ZStack {
            Circle()
                .stroke(ParchmentPalette.waxBright.opacity(0.8), style: StrokeStyle(lineWidth: max(0.7, side * 0.017), lineCap: .round, dash: [0, gap]))
                .frame(width: beadDiameter, height: beadDiameter)
            Circle()
                .stroke(ParchmentPalette.waxBright.opacity(0.55), lineWidth: max(0.5, side * 0.006))
                .frame(width: side * 0.545, height: side * 0.545)
        }
        .shadow(color: Color.black.opacity(0.45), radius: side * 0.002, x: side * 0.003, y: side * 0.004)
    }

    private var monogramFont: Font {
        if parchmentIsIdeographic(monogram) {
            return .system(size: side * 0.27, weight: .semibold, design: .serif)
        }
        let size = monogram.count > 1 ? side * 0.22 : side * 0.31
        return .custom("Baskerville-SemiBoldItalic", fixedSize: size)
    }

    /// Raised letters: lit along their upper-left edges, casting a shadow down-right.
    private var monogramMark: some View {
        Text(monogram)
            .font(monogramFont)
            .foregroundStyle(
                LinearGradient(
                    colors: [ParchmentPalette.waxLetterTop, ParchmentPalette.waxLetterBottom],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .shadow(.inner(color: Color.white.opacity(0.4), radius: side * 0.003, x: side * 0.004, y: side * 0.005))
            )
            .shadow(color: Color.black.opacity(0.55), radius: side * 0.005, x: side * 0.005, y: side * 0.008)
            .lineLimit(1)
            .minimumScaleFactor(0.4)
            .frame(width: side * 0.44, height: side * 0.44)
    }

    private var highlights: some View {
        ZStack {
            Ellipse()
                .fill(
                    RadialGradient(
                        colors: [Color.white.opacity(0.55), Color.white.opacity(0)],
                        center: .center,
                        startRadius: 0,
                        endRadius: side * 0.1
                    )
                )
                .frame(width: side * 0.22, height: side * 0.1)
                .rotationEffect(.degrees(-38))
                .offset(x: -side * 0.21, y: -side * 0.27)
            Circle()
                .fill(Color.white.opacity(0.75))
                .frame(width: side * 0.022, height: side * 0.022)
                .blur(radius: side * 0.003)
                .offset(x: -side * 0.27, y: -side * 0.23)
            Ellipse()
                .fill(Color.white.opacity(0.12))
                .frame(width: side * 0.12, height: side * 0.04)
                .blur(radius: side * 0.01)
                .rotationEffect(.degrees(-40))
                .offset(x: side * 0.25, y: side * 0.27)
        }
    }
}

/// An irregular pool of wax: soft, unevenly squeezed lobes around a slightly lopsided circle.
private struct ParchmentWaxShape: Shape {
    func path(in rect: CGRect) -> Path {
        let cx = Double(rect.midX)
        let cy = Double(rect.midY)
        let radius = Double(min(rect.width, rect.height)) / 2
        let count = 22
        var points: [CGPoint] = []
        points.reserveCapacity(count)
        for index in 0..<count {
            let jitter = (parchmentRandom(index, 31) - 0.5) * 0.5
            let angle = (Double(index) + jitter) / Double(count) * 2 * Double.pi
            let bias: Double = index % 2 == 0 ? 0.025 : -0.025
            let swell = 0.03 * sin(2 * angle + 1.3) + 0.02 * sin(3 * angle + 0.4)
            let reach = 0.83 + 0.07 * parchmentRandom(index, 32) + bias + swell
            points.append(CGPoint(x: cx + cos(angle) * radius * reach, y: cy + sin(angle) * radius * reach))
        }
        return parchmentSmoothPath(points)
    }
}

// MARK: - Burst renderer

private enum ParchmentBurstRenderer {
    static let duration: Double = 2.3
    private static let crumbCount = 24
    private static let moteCount = 48

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double, reduceMotion: Bool) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1, time >= 0, time <= duration else { return }
        let cx = width / 2
        let cy = height / 2
        let unit = min(width, height)
        drawGlow(in: &context, cx: cx, cy: cy, unit: unit, time: time, reduceMotion: reduceMotion)
        guard !reduceMotion else { return }
        drawCrumbs(in: &context, cx: cx, cy: cy, unit: unit, time: time)
        drawMotes(in: &context, cx: cx, cy: cy, unit: unit, time: time)
    }

    private static func drawGlow(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double, reduceMotion: Bool) {
        let progress = min(time / 1.1, 1)
        let alpha = reduceMotion ? 0.4 * sin(Double.pi * min(time / duration, 1)) : 0.45 * (1 - progress)
        guard alpha > 0.002 else { return }
        let radius = reduceMotion ? unit * 0.4 : unit * (0.12 + 0.42 * parchmentEaseOut(progress))
        let gradient = Gradient(colors: [
            ParchmentPalette.goldLight.opacity(alpha),
            ParchmentPalette.goldLight.opacity(alpha * 0.35),
            ParchmentPalette.goldLight.opacity(0)
        ])
        context.fill(
            parchmentCircle(cx, cy, radius),
            with: .radialGradient(gradient, center: CGPoint(x: cx, y: cy), startRadius: 0, endRadius: CGFloat(radius))
        )
        guard !reduceMotion else { return }
        let ring = min(time / 0.65, 1)
        let ringRadius = unit * (0.1 + 0.34 * parchmentEaseOut(ring))
        let ringAlpha = 0.5 * (1 - ring)
        if ringAlpha > 0.002 {
            context.stroke(
                parchmentCircle(cx, cy, ringRadius),
                with: .color(ParchmentPalette.gold.opacity(ringAlpha)),
                lineWidth: CGFloat(0.4 + 1.6 * (1 - ring))
            )
        }
    }

    private static func drawCrumbs(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let gravity = unit * 0.8
        let damping = 2.4
        for index in 0..<crumbCount {
            let fade = 1 - parchmentSmoothstep(1.05, 1.85, time + parchmentRandom(index, 44) * 0.3)
            guard fade > 0.002 else { continue }
            let angle = Double(index) / Double(crumbCount) * 2 * Double.pi + (parchmentRandom(index, 41) - 0.5) * 0.5
            let speed = unit * (0.45 + 0.7 * parchmentRandom(index, 42))
            let travel = unit * 0.07 + speed * (1 - exp(-damping * time)) / damping
            let fall = 0.5 * gravity * time * time * (0.6 + 0.4 * parchmentRandom(index, 43))
            let x = cx + cos(angle) * travel
            let y = cy + sin(angle) * travel + fall
            let size = unit * (0.013 + 0.026 * parchmentRandom(index, 45))
            let spin = (parchmentRandom(index, 46) - 0.5) * 12

            var crumb = context
            crumb.opacity = fade
            crumb.translateBy(x: CGFloat(x), y: CGFloat(y))
            crumb.rotate(by: .radians(spin * time + parchmentRandom(index, 47) * 2 * Double.pi))
            let gradient = Gradient(colors: [ParchmentPalette.waxBright, ParchmentPalette.wax, ParchmentPalette.waxDeep])
            crumb.fill(
                crumbPath(index: index, size: size),
                with: .linearGradient(gradient, startPoint: CGPoint(x: -size, y: -size), endPoint: CGPoint(x: size, y: size))
            )
        }
    }

    private static func crumbPath(index: Int, size: Double) -> Path {
        let corners = 5 + index % 3
        var points: [CGPoint] = []
        for corner in 0..<corners {
            let angle = Double(corner) / Double(corners) * 2 * Double.pi
            let reach = size * (0.55 + 0.45 * parchmentRandom(index * 7 + corner, 48))
            points.append(CGPoint(x: cos(angle) * reach, y: sin(angle) * reach))
        }
        var path = Path()
        path.addLines(points)
        path.closeSubpath()
        return path
    }

    private static func drawMotes(in context: inout GraphicsContext, cx: Double, cy: Double, unit: Double, time: Double) {
        let life = sin(Double.pi * min(time / duration, 1))
        let spread = parchmentEaseOut(time / 1.8)
        for index in 0..<moteCount {
            let angle = parchmentRandom(index, 51) * 2 * Double.pi
            let reach = unit * (0.08 + 0.42 * parchmentRandom(index, 52))
            let x = cx + cos(angle) * reach * spread + sin(time * 2 + Double(index)) * unit * 0.01
            let y = cy + sin(angle) * reach * spread - unit * 0.07 * time
            let twinkle = 0.6 + 0.4 * sin(time * (6 + 5 * parchmentRandom(index, 53)) + Double(index))
            let alpha = life * twinkle * (0.45 + 0.55 * parchmentRandom(index, 54))
            guard alpha > 0.01 else { continue }
            let radius = 0.6 + 1.7 * parchmentRandom(index, 55)
            let color = parchmentRandom(index, 56) > 0.4 ? ParchmentPalette.goldLight : ParchmentPalette.gold
            if radius > 1.5 {
                let halo = radius * 3.5
                let gradient = Gradient(colors: [color.opacity(alpha * 0.45), color.opacity(0)])
                context.fill(
                    parchmentCircle(x, y, halo),
                    with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(halo))
                )
            }
            context.fill(parchmentCircle(x, y, radius), with: .color(color.opacity(alpha)))
        }
    }
}

// MARK: - Stationery pieces

/// A rounded sheet whose edge wavers by a fraction of a point, like deckled rag paper.
private struct ParchmentDeckleShape: Shape {
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
                let wobble = rough * parchmentRandom(points.count, 71)
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
                let wobble = rough * parchmentRandom(points.count, 71)
                let reach = radius - wobble
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

/// Faint horizontal ruling, a double oxblood margin rule and a gold fleuron at the foot.
private struct ParchmentRulingLayer: View {
    var body: some View {
        Canvas { context, size in
            ParchmentRulingRenderer.draw(in: &context, size: size)
        }
    }
}

private enum ParchmentRulingRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 60, height > 60 else { return }

        var y = 72.0
        while y < height - 44 {
            var line = Path()
            line.move(to: CGPoint(x: 26, y: y))
            line.addLine(to: CGPoint(x: width - 18, y: y))
            context.stroke(line, with: .color(ParchmentPalette.umber.opacity(0.085)), lineWidth: 0.6)
            y += 30
        }

        let margins: [(x: Double, alpha: Double)] = [(15, 0.3), (18, 0.16)]
        for margin in margins {
            var rule = Path()
            rule.move(to: CGPoint(x: margin.x, y: 0))
            rule.addLine(to: CGPoint(x: margin.x, y: height))
            context.stroke(rule, with: .color(ParchmentPalette.wax.opacity(margin.alpha)), lineWidth: 0.7)
        }

        drawFleuron(in: &context, cx: width / 2, cy: height - 22)
    }

    private static func drawFleuron(in context: inout GraphicsContext, cx: Double, cy: Double) {
        let gold = ParchmentPalette.gold.opacity(0.55)
        for direction in [-1.0, 1.0] {
            var line = Path()
            line.move(to: CGPoint(x: cx + direction * 9, y: cy))
            line.addLine(to: CGPoint(x: cx + direction * 46, y: cy))
            context.stroke(line, with: .color(gold), lineWidth: 0.6)
            context.fill(parchmentCircle(cx + direction * 51, cy, 1.1), with: .color(gold))
        }
        var diamond = Path()
        diamond.move(to: CGPoint(x: cx, y: cy - 3.6))
        diamond.addLine(to: CGPoint(x: cx + 3.6, y: cy))
        diamond.addLine(to: CGPoint(x: cx, y: cy + 3.6))
        diamond.addLine(to: CGPoint(x: cx - 3.6, y: cy))
        diamond.closeSubpath()
        context.fill(diamond, with: .color(ParchmentPalette.gold.opacity(0.6)))
    }
}

/// Age spots gathered towards the corners, never in the reading area.
private struct ParchmentFoxingLayer: View {
    var body: some View {
        Canvas { context, size in
            ParchmentFoxingRenderer.draw(in: &context, size: size)
        }
    }
}

private enum ParchmentFoxingRenderer {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let width = Double(size.width)
        let height = Double(size.height)
        guard width > 1, height > 1 else { return }
        for index in 0..<16 {
            let corner = index % 4
            let fx = parchmentRandom(index, 61) * 0.2
            let fy = parchmentRandom(index, 62) * 0.16
            let x = (corner % 2 == 0 ? fx : 1 - fx) * width
            let y = (corner < 2 ? fy : 1 - fy) * height
            let radius = 1.2 + 9 * pow(parchmentRandom(index, 63), 2)
            let alpha = 0.05 + 0.08 * parchmentRandom(index, 64)
            let gradient = Gradient(colors: [
                ParchmentPalette.foxing.opacity(alpha * 1.3),
                ParchmentPalette.foxing.opacity(alpha),
                ParchmentPalette.foxing.opacity(0)
            ])
            context.fill(
                parchmentCircle(x, y, radius),
                with: .radialGradient(gradient, center: CGPoint(x: x, y: y), startRadius: 0, endRadius: CGFloat(radius))
            )
        }
    }
}

// MARK: - Preview

#Preview("Parchment 信笺") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 28) {
            ZStack {
                ParchmentBurst()
                ParchmentSeal(monogram: "BW")
                    .frame(width: 160, height: 160)
            }
            .frame(width: 300, height: 220)
            HStack(spacing: 20) {
                ParchmentSeal(monogram: "M").frame(width: 40, height: 40)
                ParchmentSeal(monogram: "高").frame(width: 40, height: 40)
                ParchmentSeal(monogram: "BW").frame(width: 40, height: 40)
            }
            ParchmentStationery()
                .frame(height: 280)
                .padding(.horizontal, 24)
        }
    }
    .theme(.parchment)
}

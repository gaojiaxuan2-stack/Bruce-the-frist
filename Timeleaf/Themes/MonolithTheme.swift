import SwiftUI

// Monolith 极简 — Swiss modernism and the precision of a clock.
// Near-black, white hairlines, and a single signal orange used only where it matters.

// MARK: - Tokens

extension Theme {
    static let monolith = Theme(
        id: .monolith,
        name: "Monolith",
        nativeName: "极简",
        tagline: "Precise as a clock. Quiet as a promise.",
        colorScheme: .dark,
        background: Color(hex: 0x0A0A0A),
        surface: Color(hex: 0x151515),
        surfaceStroke: Color(hex: 0xFFFFFF, opacity: 0.12),
        ink: Color(hex: 0xF4F4F1),
        inkSecondary: Color(hex: 0x9C9C98),
        accent: Color(hex: 0xFF5A1F),
        accentInk: Color(hex: 0x0A0A0A),
        glow: Color(hex: 0xFF5A1F),
        seal: Color(hex: 0xFF5A1F),
        gradient: [Color(hex: 0x0A0A0A), Color(hex: 0x2B2B2B), Color(hex: 0xFF5A1F)],
        cornerRadius: 6,
        displayFontName: "Helvetica Neue",
        bodyFontName: "Helvetica Neue",
        fontDesign: .default,
        usesMaterial: false
    )
}

// MARK: - Palette & math

private enum MonolithPalette {
    static let black = Color(hex: 0x0A0A0A)
    static let sheet = Color(hex: 0x141414)
    static let white = Color(hex: 0xF4F4F1)
    static let signal = Color(hex: 0xFF5A1F)
}

private func monolithClamp(_ value: Double) -> Double {
    min(max(value, 0), 1)
}

private func monolithEaseOut(_ value: Double) -> Double {
    let x = monolithClamp(value)
    return 1 - (1 - x) * (1 - x) * (1 - x)
}

private func monolithCircle(_ center: CGPoint, _ radius: CGFloat) -> Path {
    Path(ellipseIn: CGRect(x: center.x - radius, y: center.y - radius, width: radius * 2, height: radius * 2))
}

private func monolithPolar(_ center: CGPoint, _ angle: Double, _ distance: CGFloat) -> CGPoint {
    CGPoint(x: center.x + CGFloat(cos(angle)) * distance, y: center.y + CGFloat(sin(angle)) * distance)
}

/// Angle in radians for a clock position measured clockwise from twelve o'clock, in degrees.
private func monolithClockAngle(_ degrees: Double) -> Double {
    (degrees - 90) * .pi / 180
}

// MARK: - Background

/// An ultra-fine grid and one large, thin dial ring that steps forward like a second hand,
/// one tick every four seconds.
struct MonolithBackground: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        ZStack {
            Canvas { context, size in
                MonolithGridPainter.draw(in: &context, size: size)
            }
            TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: reduceMotion)) { timeline in
                let time = reduceMotion ? 0 : timeline.date.timeIntervalSinceReferenceDate
                Canvas { context, size in
                    MonolithDialPainter.draw(in: &context, size: size, time: time)
                }
            }
            MonolithShade()
        }
    }
}

/// A 24 pt hairline grid centred on the screen; every fourth line slightly stronger,
/// with small registration crosses where the strong lines meet.
private enum MonolithGridPainter {
    static let spacing: CGFloat = 24

    static func draw(in context: inout GraphicsContext, size: CGSize) {
        guard size.width > 0, size.height > 0 else { return }
        let midX = size.width / 2
        let midY = size.height / 2
        let columns = Int((midX / spacing).rounded(.up))
        let rows = Int((midY / spacing).rounded(.up))
        var minor = Path()
        var major = Path()
        for column in -columns...columns {
            let x = midX + CGFloat(column) * spacing
            if column % 4 == 0 {
                major.move(to: CGPoint(x: x, y: 0))
                major.addLine(to: CGPoint(x: x, y: size.height))
            } else {
                minor.move(to: CGPoint(x: x, y: 0))
                minor.addLine(to: CGPoint(x: x, y: size.height))
            }
        }
        for row in -rows...rows {
            let y = midY + CGFloat(row) * spacing
            if row % 4 == 0 {
                major.move(to: CGPoint(x: 0, y: y))
                major.addLine(to: CGPoint(x: size.width, y: y))
            } else {
                minor.move(to: CGPoint(x: 0, y: y))
                minor.addLine(to: CGPoint(x: size.width, y: y))
            }
        }
        context.stroke(minor, with: .color(Color.white.opacity(0.03)), lineWidth: 0.5)
        context.stroke(major, with: .color(Color.white.opacity(0.05)), lineWidth: 0.5)

        var crosses = Path()
        let arm: CGFloat = 3
        for column in stride(from: -columns, through: columns, by: 1) where column % 4 == 0 {
            for row in stride(from: -rows, through: rows, by: 1) where row % 4 == 0 {
                let x = midX + CGFloat(column) * spacing
                let y = midY + CGFloat(row) * spacing
                crosses.move(to: CGPoint(x: x - arm, y: y))
                crosses.addLine(to: CGPoint(x: x + arm, y: y))
                crosses.move(to: CGPoint(x: x, y: y - arm))
                crosses.addLine(to: CGPoint(x: x, y: y + arm))
            }
        }
        context.stroke(crosses, with: .color(Color.white.opacity(0.1)), lineWidth: 0.6)
    }
}

private enum MonolithDialPainter {
    static let stepInterval: Double = 4

    static func draw(in context: inout GraphicsContext, size: CGSize, time: Double) {
        guard size.width > 0, size.height > 0 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height * 0.42)
        let radius = min(size.width * 0.42, size.height * 0.3)
        guard radius > 20 else { return }

        // A precise step: each tick eases in over 0.9 s, then rests.
        let step = Int((time / stepInterval).rounded(.down))
        let local = time - Double(step) * stepInterval
        let position = Double(step % 60) + monolithEaseOut(local / 0.9)
        let rotation = position * 6

        context.stroke(monolithCircle(center, radius), with: .color(Color.white.opacity(0.09)), lineWidth: 0.6)
        context.stroke(monolithCircle(center, radius * 0.86), with: .color(Color.white.opacity(0.04)), lineWidth: 0.5)

        var minor = Path()
        var major = Path()
        for index in 1..<60 {
            let angle = monolithClockAngle(rotation + Double(index) * 6)
            let isMajor = index % 5 == 0
            let length: CGFloat = isMajor ? 11 : 5
            if isMajor {
                major.move(to: monolithPolar(center, angle, radius - length))
                major.addLine(to: monolithPolar(center, angle, radius))
            } else {
                minor.move(to: monolithPolar(center, angle, radius - length))
                minor.addLine(to: monolithPolar(center, angle, radius))
            }
        }
        context.stroke(minor, with: .color(Color.white.opacity(0.1)), lineWidth: 0.6)
        context.stroke(major, with: .color(Color.white.opacity(0.18)), lineWidth: 0.8)

        // The one signal-orange tick.
        let signalAngle = monolithClockAngle(rotation)
        var signal = Path()
        signal.move(to: monolithPolar(center, signalAngle, radius - 16))
        signal.addLine(to: monolithPolar(center, signalAngle, radius + 4))
        context.stroke(signal, with: .color(MonolithPalette.signal.opacity(0.85)), lineWidth: 1.4)

        drawNumerals(in: &context, center: center, radius: radius - 26, rotation: rotation)
    }

    /// Quarter numerals in small monospaced type; they travel with the ring but stay upright.
    private static func drawNumerals(in context: inout GraphicsContext, center: CGPoint, radius: CGFloat, rotation: Double) {
        let labels = ["00", "15", "30", "45"]
        for (index, label) in labels.enumerated() {
            let angle = monolithClockAngle(rotation + Double(index) * 90)
            var text = context.resolve(
                Text(verbatim: label).font(.system(size: 9, weight: .regular, design: .monospaced))
            )
            text.shading = .color(Color.white.opacity(0.22))
            context.draw(text, at: monolithPolar(center, angle, radius), anchor: .center)
        }
    }
}

/// A whisper of light from above and a soft vignette at the edges.
private struct MonolithShade: View {
    var body: some View {
        ZStack {
            LinearGradient(
                colors: [Color.white.opacity(0.035), Color.white.opacity(0)],
                startPoint: .top,
                endPoint: UnitPoint(x: 0.5, y: 0.35)
            )
            EllipticalGradient(
                colors: [Color.black.opacity(0), Color.black.opacity(0.55)],
                center: .center,
                startRadiusFraction: 0.25,
                endRadiusFraction: 0.85
            )
        }
    }
}

// MARK: - Seal

/// A precise clock face: concentric hairline rings, twelve hour marks, a signal-orange
/// seconds hand and the monogram in Helvetica Neue Light.
struct MonolithSeal: View {
    var monogram: String

    init(monogram: String) {
        self.monogram = monogram
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            MonolithDialFace(monogram: monogram, side: side)
                .frame(width: side, height: side)
                .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
        }
    }
}

private struct MonolithDialFace: View {
    let monogram: String
    let side: CGFloat

    var body: some View {
        ZStack {
            Canvas { context, size in
                MonolithSealPainter.draw(in: &context, size: size)
            }
            .shadow(color: Color.black.opacity(0.5), radius: side * 0.04, x: 0, y: side * 0.02)
            glyph
        }
    }

    private var glyphSize: CGFloat {
        monogram.count > 1 ? side * 0.24 : side * 0.3
    }

    private var glyphWeight: Font.Weight {
        side < 80 ? .regular : .light
    }

    private var glyph: some View {
        Text(monogram)
            .font(Font.custom("Helvetica Neue", fixedSize: glyphSize).weight(glyphWeight))
            .tracking(monogram.count > 1 ? glyphSize * 0.04 : 0)
            .foregroundStyle(MonolithPalette.white)
            .lineLimit(1)
            .minimumScaleFactor(0.5)
            .frame(width: side * 0.52)
    }
}

private enum MonolithSealPainter {
    static func draw(in context: inout GraphicsContext, size: CGSize) {
        let radius = min(size.width, size.height) / 2 * 0.96
        guard radius > 1 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let detailed = radius >= 38
        let hair = max(0.5, radius * 0.012)

        context.fill(
            monolithCircle(center, radius),
            with: .radialGradient(
                Gradient(colors: [Color(hex: 0x1E1E1E), Color(hex: 0x111111), Color(hex: 0x080808)]),
                center: CGPoint(x: center.x, y: center.y - radius * 0.35),
                startRadius: 0,
                endRadius: radius * 1.5
            )
        )
        context.stroke(monolithCircle(center, radius - hair / 2), with: .color(MonolithPalette.white.opacity(0.9)), lineWidth: hair)
        context.stroke(monolithCircle(center, radius * 0.9), with: .color(MonolithPalette.white.opacity(0.25)), lineWidth: hair * 0.7)

        if detailed {
            var minutes = Path()
            for index in 0..<60 where index % 5 != 0 {
                let angle = monolithClockAngle(Double(index) * 6)
                minutes.move(to: monolithPolar(center, angle, radius * 0.9))
                minutes.addLine(to: monolithPolar(center, angle, radius * 0.955))
            }
            context.stroke(minutes, with: .color(MonolithPalette.white.opacity(0.45)), lineWidth: hair * 0.6)
        }

        var hours = Path()
        for index in 0..<12 {
            let angle = monolithClockAngle(Double(index) * 30)
            hours.move(to: monolithPolar(center, angle, radius * 0.78))
            hours.addLine(to: monolithPolar(center, angle, radius * 0.955))
        }
        context.stroke(hours, with: .color(MonolithPalette.white.opacity(0.95)), lineWidth: max(0.75, radius * 0.022))

        context.stroke(monolithCircle(center, radius * 0.64), with: .color(MonolithPalette.white.opacity(0.16)), lineWidth: hair * 0.7)

        // The signal-orange seconds hand rides the chapter ring, clear of the monogram.
        let handAngle = monolithClockAngle(48)
        var hand = Path()
        hand.move(to: monolithPolar(center, handAngle, radius * 0.7))
        hand.addLine(to: monolithPolar(center, handAngle, radius * 0.97))
        context.stroke(
            hand,
            with: .color(MonolithPalette.signal),
            style: StrokeStyle(lineWidth: max(0.9, radius * 0.02), lineCap: .round)
        )
        context.fill(
            monolithCircle(monolithPolar(center, handAngle, radius * 0.84), max(1.2, radius * 0.045)),
            with: .color(MonolithPalette.signal)
        )
    }
}

// MARK: - Burst

/// Unsealing: hairline rings expand outward from the centre — one of them signal orange —
/// while a tick ring advances by a single step and a crosshair draws itself out.
struct MonolithBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var startDate: Date?
    @State private var isFinished = false

    var body: some View {
        ZStack {
            Color.clear
            if let startDate, !isFinished {
                TimelineView(.animation(minimumInterval: 1.0 / 60.0, paused: false)) { timeline in
                    Canvas { context, size in
                        MonolithBurstPainter.draw(
                            in: &context,
                            size: size,
                            elapsed: timeline.date.timeIntervalSince(startDate),
                            expands: !reduceMotion
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
            try? await Task.sleep(for: .seconds(MonolithBurstPainter.duration + 0.15))
            isFinished = true
        }
    }
}

private enum MonolithBurstPainter {
    static let duration: Double = 2.2

    static func draw(in context: inout GraphicsContext, size: CGSize, elapsed: Double, expands: Bool) {
        guard elapsed >= 0, elapsed < duration, size.width > 0, size.height > 0 else { return }
        let center = CGPoint(x: size.width / 2, y: size.height / 2)
        let reach = (size.width * size.width + size.height * size.height).squareRoot() / 2
        drawFlash(in: &context, center: center, elapsed: elapsed)
        if expands {
            drawCrosshair(in: &context, center: center, reach: reach, elapsed: elapsed)
            drawTickRing(in: &context, center: center, reach: reach, elapsed: elapsed)
        }
        drawRings(in: &context, center: center, reach: reach, elapsed: elapsed, expands: expands)
    }

    private static func drawFlash(in context: inout GraphicsContext, center: CGPoint, elapsed: Double) {
        let fade = monolithClamp(1 - elapsed / 0.6)
        guard fade > 0 else { return }
        context.fill(
            monolithCircle(center, 44),
            with: .radialGradient(
                Gradient(colors: [Color.white.opacity(0.35 * fade), Color.white.opacity(0)]),
                center: center,
                startRadius: 0,
                endRadius: 44
            )
        )
        context.fill(monolithCircle(center, 2.5), with: .color(Color.white.opacity(fade)))
    }

    private static func drawRings(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double, expands: Bool) {
        for index in 0..<7 {
            let delay = Double(index) * 0.1
            let progress = monolithClamp((elapsed - delay) / 1.5)
            guard progress > 0, progress < 1 else { continue }
            let radius: CGFloat
            if expands {
                radius = reach * CGFloat(0.04 + 0.9 * monolithEaseOut(progress))
            } else {
                radius = reach * CGFloat(0.1 + 0.11 * Double(index))
            }
            let isSignal = index == 2
            let alpha = isSignal
                ? 0.95 * pow(1 - progress, 1.2)
                : 0.55 * pow(1 - progress, 1.5)
            let color = isSignal ? MonolithPalette.signal : MonolithPalette.white
            context.stroke(monolithCircle(center, radius), with: .color(color.opacity(alpha)), lineWidth: isSignal ? 1.6 : 0.75)
        }
    }

    private static func drawTickRing(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let fade = monolithClamp(1 - elapsed / 1.2)
        guard fade > 0 else { return }
        let radius = reach * 0.16 + CGFloat(30 * monolithEaseOut(elapsed / 1.0))
        let rotation = 6 * monolithEaseOut(elapsed / 0.8)
        var ticks = Path()
        for index in 0..<60 {
            let angle = monolithClockAngle(rotation + Double(index) * 6)
            let length: CGFloat = index % 5 == 0 ? 9 : 5
            ticks.move(to: monolithPolar(center, angle, radius - length))
            ticks.addLine(to: monolithPolar(center, angle, radius))
        }
        context.stroke(ticks, with: .color(Color.white.opacity(0.5 * fade)), lineWidth: 0.6)
    }

    private static func drawCrosshair(in context: inout GraphicsContext, center: CGPoint, reach: CGFloat, elapsed: Double) {
        let fade = monolithClamp(1 - elapsed / 1.4)
        guard fade > 0 else { return }
        let length = reach * CGFloat(monolithEaseOut(elapsed / 0.9))
        guard length > 1 else { return }
        for index in 0..<4 {
            let angle = Double(index) * .pi / 2
            let end = monolithPolar(center, angle, length)
            var line = Path()
            line.move(to: center)
            line.addLine(to: end)
            context.stroke(
                line,
                with: .linearGradient(
                    Gradient(colors: [Color.white.opacity(0.28 * fade), Color.white.opacity(0)]),
                    startPoint: center,
                    endPoint: end
                ),
                lineWidth: 0.5
            )
        }
    }
}

// MARK: - Stationery

/// A plain dark sheet: a hairline grid lives only in the margins, crop marks frame the
/// writing area, a signal-orange fold mark sits at one third, and tiny coordinates rest
/// in the corner.
struct MonolithStationery: View {
    var body: some View {
        let shape = RoundedRectangle(cornerRadius: Theme.monolith.cornerRadius, style: .continuous)
        ZStack {
            shape
                .fill(MonolithPalette.sheet)
                .shadow(color: Color.black.opacity(0.55), radius: 20, x: 0, y: 12)
            Canvas { context, size in
                MonolithSheetPainter.draw(in: &context, size: size)
            }
            .clipShape(shape)
            MonolithSheetStamp()
        }
        .overlay {
            shape.strokeBorder(Color.white.opacity(0.1), lineWidth: 0.5)
        }
    }
}

private struct MonolithSheetStamp: View {
    var body: some View {
        Text(verbatim: "N 00°00′  E 00°00′")
            .font(.system(size: 7, weight: .regular, design: .monospaced))
            .tracking(0.8)
            .foregroundStyle(Color.white.opacity(0.34))
            .lineLimit(1)
            .padding(.horizontal, 4)
            .background(MonolithPalette.sheet)
            .padding(.trailing, MonolithSheetPainter.margin - 4)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .bottomTrailing)
    }
}

private enum MonolithSheetPainter {
    static let margin: CGFloat = 18
    static let cell: CGFloat = 6

    static func draw(in context: inout GraphicsContext, size: CGSize) {
        guard size.width > margin * 3, size.height > margin * 3 else { return }
        let inner = CGRect(x: margin, y: margin, width: size.width - margin * 2, height: size.height - margin * 2)
        drawMarginGrid(in: &context, size: size, inner: inner)
        context.stroke(Path(inner), with: .color(Color.white.opacity(0.09)), lineWidth: 0.5)
        drawCropMarks(in: &context, inner: inner)
        drawFoldMarks(in: &context, size: size)
    }

    /// The grid is anchored to the writing area and divides it exactly, so its lines land on
    /// both edges; it is clipped away from the writing area itself.
    private static func drawMarginGrid(in context: inout GraphicsContext, size: CGSize, inner: CGRect) {
        let columns = max(1, (inner.width / cell).rounded())
        let rows = max(1, (inner.height / cell).rounded())
        let stepX = inner.width / columns
        let stepY = inner.height / rows
        var lines = Path()
        var x = inner.minX - (inner.minX / stepX).rounded(.down) * stepX
        while x <= size.width {
            lines.move(to: CGPoint(x: x, y: 0))
            lines.addLine(to: CGPoint(x: x, y: size.height))
            x += stepX
        }
        var y = inner.minY - (inner.minY / stepY).rounded(.down) * stepY
        while y <= size.height {
            lines.move(to: CGPoint(x: 0, y: y))
            lines.addLine(to: CGPoint(x: size.width, y: y))
            y += stepY
        }
        var grid = context
        grid.clip(to: Path(inner), options: .inverse)
        grid.stroke(lines, with: .color(Color.white.opacity(0.05)), lineWidth: 0.5)
    }

    private static func drawCropMarks(in context: inout GraphicsContext, inner: CGRect) {
        let reach: CGFloat = 8
        var marks = Path()
        let corners: [(CGPoint, CGFloat, CGFloat)] = [
            (CGPoint(x: inner.minX, y: inner.minY), -1, -1),
            (CGPoint(x: inner.maxX, y: inner.minY), 1, -1),
            (CGPoint(x: inner.minX, y: inner.maxY), -1, 1),
            (CGPoint(x: inner.maxX, y: inner.maxY), 1, 1)
        ]
        for (corner, horizontal, vertical) in corners {
            marks.move(to: corner)
            marks.addLine(to: CGPoint(x: corner.x + horizontal * reach, y: corner.y))
            marks.move(to: corner)
            marks.addLine(to: CGPoint(x: corner.x, y: corner.y + vertical * reach))
        }
        context.stroke(marks, with: .color(Color.white.opacity(0.35)), lineWidth: 0.5)
    }

    /// Letter-fold marks in the left margin: the first third in signal orange, the second in grey.
    private static func drawFoldMarks(in context: inout GraphicsContext, size: CGSize) {
        var first = Path()
        first.move(to: CGPoint(x: 4, y: size.height / 3))
        first.addLine(to: CGPoint(x: 12, y: size.height / 3))
        context.stroke(first, with: .color(MonolithPalette.signal.opacity(0.9)), lineWidth: 1)

        var second = Path()
        second.move(to: CGPoint(x: 4, y: size.height * 2 / 3))
        second.addLine(to: CGPoint(x: 12, y: size.height * 2 / 3))
        context.stroke(second, with: .color(Color.white.opacity(0.3)), lineWidth: 0.75)
    }
}

// MARK: - Preview

#Preview("Monolith") {
    ZStack {
        ThemeBackground()
        VStack(spacing: 32) {
            MonolithSeal(monogram: "BW")
                .frame(width: 160, height: 160)
            HStack(spacing: 20) {
                MonolithSeal(monogram: "高")
                    .frame(width: 40, height: 40)
                MonolithSeal(monogram: "M")
                    .frame(width: 64, height: 64)
            }
            MonolithStationery()
                .frame(height: 260)
                .overlay(alignment: .topLeading) {
                    Text(verbatim: "Dear future me,")
                        .font(Theme.monolith.body(19))
                        .foregroundStyle(Theme.monolith.ink)
                        .padding(28)
                }
                .padding(.horizontal, 24)
        }
    }
    .theme(.monolith)
}

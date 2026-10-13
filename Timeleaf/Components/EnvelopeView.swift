import SwiftUI

/// A physical, themed envelope. Animatable on `openProgress`:
/// 0 = closed and sealed, 1 = flap folded back and the letter risen.
///
/// The view's frame is the envelope body (aspect ≈ 1.45 : 1, fills the proposed width).
/// While opening, the flap and the letter rise *above* that frame by up to ~60 % of its
/// height, so leave room above it.
struct EnvelopeView: View, Animatable {
    @Environment(\.theme) private var theme

    var openProgress: Double
    private let monogram: String
    private let showsSeal: Bool

    init(openProgress: Double, monogram: String, showsSeal: Bool = true) {
        self.openProgress = openProgress
        self.monogram = monogram
        self.showsSeal = showsSeal
    }

    var animatableData: Double {
        get { openProgress }
        set { openProgress = newValue }
    }

    var body: some View {
        GeometryReader { proxy in
            PostalScene(
                theme: theme,
                size: proxy.size,
                progress: min(max(openProgress, 0), 1),
                monogram: monogram,
                showsSeal: showsSeal
            )
        }
        .aspectRatio(1.45, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(openProgress >= 0.5 ? Text("Open envelope") : Text("Sealed envelope"))
    }
}

// MARK: - Scene

/// Back to front: back panel · flap lining (once past 90°) · letter · pocket · flap face + seal.
private struct PostalScene: View {
    let theme: Theme
    let size: CGSize
    let progress: Double
    let monogram: String
    let showsSeal: Bool

    // MARK: Motion

    /// The flap travels during the first ~70 % of the progress.
    private var flapFraction: Double { min(progress / 0.72, 1) }
    /// Positive angles lift the flap tip towards the viewer before it folds back over the top edge.
    private var flapDegrees: Double { 168 * flapFraction }
    private var flapIsPastEdge: Bool { flapDegrees > 90 }
    /// 0 when flat, 1 when edge-on: how much the flap turns away from the light.
    private var tilt: Double { sin(flapDegrees * .pi / 180) }
    /// The letter starts to rise once the flap has cleared the opening.
    private var riseFraction: Double { PostalMetrics.smoothstep((progress - 0.4) / 0.6) }
    private var sealOpacity: Double { 1 - PostalMetrics.smoothstep((flapDegrees - 50) / 32) }

    // MARK: Tokens (derived, never switched on the style id)

    private var isDark: Bool { theme.colorScheme == .dark }
    /// Shadows and fold shading: warm ink on paper, true black on night styles.
    private var shade: Color { isDark ? Color.black : theme.ink }
    /// How strongly the signature gradient tints the paper.
    private var tint: Double { (isDark ? 0.2 : 0.1) + (theme.usesMaterial ? 0.06 : 0) }
    /// Specular light on the paper (stronger for glassy styles).
    private var sheen: Double { theme.usesMaterial ? 0.16 : (isDark ? 0.06 : 0.28) }
    private var corner: CGFloat { min(max(theme.cornerRadius * 0.3, 2), 10) }
    private var outline: RoundedRectangle { RoundedRectangle(cornerRadius: corner, style: .continuous) }
    private var sealSize: CGFloat { size.width * 0.26 }
    private var flapShadowOpacity: Double { (isDark ? 0.45 : 0.15) * (1 - flapFraction) }

    /// Glassy styles get an iridescent rim from their gradient; paper styles a quiet hairline.
    private var rimStyle: AnyShapeStyle {
        theme.usesMaterial ? AnyShapeStyle(theme.linearGradient) : AnyShapeStyle(theme.surfaceStroke)
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            backPanel
            flap(lining: true)
                .opacity(flapIsPastEdge ? 1 : 0)
            letter
            pocket
            flap(lining: false)
                .opacity(flapIsPastEdge ? 0 : 1)
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
    }

    // MARK: Back panel – the inside of the envelope

    private var backPanel: some View {
        ZStack {
            outline
                .fill(theme.background)
                .shadow(color: shade.opacity(isDark ? 0.55 : 0.16), radius: 18, x: 0, y: 12)
                .shadow(color: shade.opacity(isDark ? 0.35 : 0.08), radius: 2, x: 0, y: 1)
            outline.fill(theme.surface)
            outline.fill(theme.linearGradient).opacity(tint * 1.6)
            outline.fill(
                LinearGradient(
                    colors: [shade.opacity(isDark ? 0.55 : 0.2), shade.opacity(0)],
                    startPoint: .top,
                    endPoint: UnitPoint(x: 0.5, y: 0.55)
                )
            )
            outline.strokeBorder(rimStyle, lineWidth: 0.75)
        }
        .frame(width: size.width, height: size.height)
    }

    // MARK: Letter

    private var letter: some View {
        let width = size.width * 0.86
        let height = size.height * 0.84
        let sheet = RoundedRectangle(cornerRadius: max(corner * 0.6, 1.5), style: .continuous)
        return ZStack {
            sheet
                .fill(theme.background)
                .shadow(color: shade.opacity(isDark ? 0.45 : 0.14), radius: 4, x: 0, y: 1)
            StationeryView()
                .clipShape(sheet)
            sheet.strokeBorder(theme.surfaceStroke, lineWidth: 0.5)
        }
        .frame(width: width, height: height)
        .offset(
            x: (size.width - width) / 2,
            y: size.height * (0.07 - 0.26 * CGFloat(riseFraction))
        )
    }

    // MARK: Pocket – two side folds under a bottom fold

    private var pocket: some View {
        ZStack {
            sideFold(leading: true)
            sideFold(leading: false)
            bottomFold
        }
        .frame(width: size.width, height: size.height)
        .clipShape(outline)
        .overlay {
            outline.strokeBorder(rimStyle, lineWidth: 0.75)
        }
    }

    private func sideFold(leading: Bool) -> some View {
        let shape = PostalSideFold(leading: leading)
        return ZStack {
            shape
                .fill(theme.background)
                .shadow(color: shade.opacity(isDark ? 0.4 : 0.12), radius: 3, x: 0, y: 1)
            shape.fill(theme.surface)
            shape.fill(theme.linearGradient).opacity(tint)
            shape.fill(
                LinearGradient(
                    colors: [shade.opacity(isDark ? 0.18 : 0.07), shade.opacity(0)],
                    startPoint: leading ? .leading : .trailing,
                    endPoint: .center
                )
            )
            shape.stroke(shade.opacity(isDark ? 0.35 : 0.1), lineWidth: 0.6)
        }
    }

    private var bottomFold: some View {
        let shape = PostalBottomFold()
        return ZStack {
            shape
                .fill(theme.background)
                .shadow(color: shade.opacity(isDark ? 0.45 : 0.13), radius: 3.5, x: 0, y: -1)
            shape.fill(theme.surface)
            shape.fill(theme.linearGradient).opacity(tint)
            shape.fill(
                LinearGradient(
                    colors: [Color.white.opacity(sheen * 0.8), Color.white.opacity(0)],
                    startPoint: UnitPoint(x: 0.5, y: 0.45),
                    endPoint: .bottom
                )
            )
            shape.stroke(shade.opacity(isDark ? 0.35 : 0.1), lineWidth: 0.6)
        }
    }

    // MARK: Flap

    /// The same flap is drawn twice: its face (in front, until edge-on) and its lining
    /// (behind the letter, once it has folded back past 90°).
    private func flap(lining: Bool) -> some View {
        let shape = PostalFlapShape()
        return ZStack(alignment: .topLeading) {
            shape
                .fill(theme.background)
                .shadow(color: shade.opacity(lining ? 0 : flapShadowOpacity), radius: 4, x: 0, y: 2)
            shape.fill(theme.surface)
            shape.fill(theme.linearGradient).opacity(lining ? min(tint * 3.2, 0.6) : tint)
            shape.fill(
                LinearGradient(
                    colors: [Color.white.opacity(sheen), Color.white.opacity(0)],
                    startPoint: .top,
                    endPoint: UnitPoint(x: 0.5, y: 0.6)
                )
            )
            shape.fill(shade).opacity((lining ? 0.22 : 0.16) * tilt)
            if lining {
                shape
                    .scale(0.84)
                    .stroke(Color.white.opacity(isDark ? 0.18 : 0.5), lineWidth: 0.6)
            }
            shape.stroke(shade.opacity(isDark ? 0.4 : 0.12), lineWidth: 0.6)
            if !lining {
                sealLayer
            }
        }
        .frame(width: size.width, height: size.height, alignment: .topLeading)
        .clipShape(outline)
        .rotation3DEffect(
            .degrees(flapDegrees),
            axis: (x: 1, y: 0, z: 0),
            anchor: .top,
            perspective: 0.6
        )
    }

    @ViewBuilder
    private var sealLayer: some View {
        if showsSeal && progress < 0.5 {
            ZStack {
                Ellipse()
                    .fill(shade.opacity(isDark ? 0.5 : 0.2))
                    .frame(width: sealSize * 0.86, height: sealSize * 0.8)
                    .blur(radius: 4)
                    .offset(y: 3)
                SealView(monogram: monogram)
                    .frame(width: sealSize, height: sealSize)
            }
            .opacity(sealOpacity)
            .position(x: size.width / 2, y: size.height * (PostalMetrics.flapDepth - 0.02))
        }
    }
}

// MARK: - Geometry

private enum PostalMetrics {
    /// Where the flap tip rests, as a fraction of the height.
    static let flapDepth: CGFloat = 0.6
    /// Where the side folds meet.
    static let sideTipDepth: CGFloat = 0.55
    /// How far the side folds reach across (slightly past the centre so they overlap).
    static let sideReach: CGFloat = 0.53
    /// The apex of the bottom fold.
    static let bottomApexDepth: CGFloat = 0.47

    static func lerp(_ a: CGPoint, _ b: CGPoint, _ t: CGFloat) -> CGPoint {
        CGPoint(x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t)
    }

    static func smoothstep(_ x: Double) -> Double {
        let t = min(max(x, 0), 1)
        return t * t * (3 - 2 * t)
    }
}

/// The top flap: a softly bellied triangle with a rounded tip.
private struct PostalFlapShape: Shape {
    func path(in rect: CGRect) -> Path {
        let topLeft = CGPoint(x: rect.minX, y: rect.minY)
        let topRight = CGPoint(x: rect.maxX, y: rect.minY)
        let tip = CGPoint(x: rect.midX, y: rect.minY + rect.height * PostalMetrics.flapDepth)
        let rightNear = PostalMetrics.lerp(topRight, tip, 0.88)
        let leftNear = PostalMetrics.lerp(topLeft, tip, 0.88)
        let belly = rect.height * 0.02
        let rightMid = PostalMetrics.lerp(topRight, tip, 0.5)
        let leftMid = PostalMetrics.lerp(topLeft, tip, 0.5)

        var path = Path()
        path.move(to: topLeft)
        path.addLine(to: topRight)
        path.addQuadCurve(to: rightNear, control: CGPoint(x: rightMid.x, y: rightMid.y + belly))
        path.addQuadCurve(to: leftNear, control: tip)
        path.addQuadCurve(to: topLeft, control: CGPoint(x: leftMid.x, y: leftMid.y + belly))
        path.closeSubpath()
        return path
    }
}

/// A side fold running from one vertical edge to just past the centre.
private struct PostalSideFold: Shape {
    let leading: Bool

    func path(in rect: CGRect) -> Path {
        let edgeX = leading ? rect.minX : rect.maxX
        let reach = rect.width * PostalMetrics.sideReach
        let top = CGPoint(x: edgeX, y: rect.minY)
        let bottom = CGPoint(x: edgeX, y: rect.maxY)
        let tip = CGPoint(
            x: leading ? rect.minX + reach : rect.maxX - reach,
            y: rect.minY + rect.height * PostalMetrics.sideTipDepth
        )
        let upper = PostalMetrics.lerp(top, tip, 0.9)
        let lower = PostalMetrics.lerp(bottom, tip, 0.9)

        var path = Path()
        path.move(to: top)
        path.addLine(to: upper)
        path.addQuadCurve(to: lower, control: tip)
        path.addLine(to: bottom)
        path.closeSubpath()
        return path
    }
}

/// The bottom fold, with gently sagging edges and a rounded apex.
private struct PostalBottomFold: Shape {
    func path(in rect: CGRect) -> Path {
        let bottomLeft = CGPoint(x: rect.minX, y: rect.maxY)
        let bottomRight = CGPoint(x: rect.maxX, y: rect.maxY)
        let apex = CGPoint(x: rect.midX, y: rect.minY + rect.height * PostalMetrics.bottomApexDepth)
        let leftNear = PostalMetrics.lerp(bottomLeft, apex, 0.92)
        let rightNear = PostalMetrics.lerp(bottomRight, apex, 0.92)
        let sag = rect.height * 0.04

        var path = Path()
        path.move(to: bottomLeft)
        path.addQuadCurve(
            to: leftNear,
            control: CGPoint(x: rect.minX + rect.width * 0.27, y: rect.minY + rect.height * 0.735 + sag)
        )
        path.addQuadCurve(to: rightNear, control: apex)
        path.addQuadCurve(
            to: bottomRight,
            control: CGPoint(x: rect.maxX - rect.width * 0.27, y: rect.minY + rect.height * 0.735 + sag)
        )
        path.closeSubpath()
        return path
    }
}

// MARK: - Previews

#Preview("Envelope") {
    PostalPreviewStage()
}

private struct PostalPreviewStage: View {
    @State private var progress: Double = 0
    @State private var themeID: ThemeID = .parchment

    var body: some View {
        VStack(spacing: 32) {
            Spacer(minLength: 160)
            EnvelopeView(openProgress: progress, monogram: "BW")
                .padding(.horizontal, 36)
            Spacer()
            Picker("Style", selection: $themeID) {
                ForEach(ThemeID.allCases) { id in
                    Text(id.theme.name).tag(id)
                }
            }
            .pickerStyle(.segmented)
            Slider(value: $progress, in: 0...1)
            Button {
                withAnimation(.spring(duration: 1.6, bounce: 0.12)) {
                    progress = progress < 0.5 ? 1 : 0
                }
            } label: {
                if progress < 0.5 {
                    Text("Open")
                } else {
                    Text("Close")
                }
            }
            .buttonStyle(.themedPrimary)
        }
        .padding(24)
        .background { ThemeBackground() }
        .theme(themeID.theme)
    }
}

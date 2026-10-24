import SwiftUI

/// Lightweight confetti burst drawn with Canvas. No assets, no dependencies.
struct ConfettiView: View {
    private struct Particle {
        let x: Double
        let delay: Double
        let speed: Double
        let size: Double
        let spin: Double
        let drift: Double
        let color: Color
    }

    private static let palette: [Color] = Brand.colors + HabitTheme.sunset.colors + HabitTheme.forest.colors + [.yellow]

    @State private var particles: [Particle] = (0..<90).map { _ in
        Particle(
            x: .random(in: 0...1),
            delay: .random(in: 0...0.5),
            speed: .random(in: 0.45...0.9),
            size: .random(in: 7...12),
            spin: .random(in: 1...4),
            drift: .random(in: -0.08...0.08),
            color: ConfettiView.palette.randomElement() ?? .yellow
        )
    }
    @State private var start = Date.now

    var body: some View {
        TimelineView(.animation) { timeline in
            Canvas { context, size in
                let elapsed = timeline.date.timeIntervalSince(start)
                let width = Double(size.width)
                let height = Double(size.height)
                for particle in particles {
                    let t = elapsed - particle.delay
                    guard t > 0 else { continue }
                    let y: Double = -20 + t * particle.speed * height * 0.7
                    guard y < height + 20 else { continue }
                    let x: Double = (particle.x + particle.drift * t) * width + sin(t * particle.spin * 2) * 14

                    var piece = context
                    piece.translateBy(x: x, y: y)
                    piece.rotate(by: .radians(t * particle.spin * 3))
                    let rect = CGRect(x: -particle.size / 2, y: -particle.size / 4, width: particle.size, height: particle.size / 2)
                    piece.fill(Path(rect), with: .color(particle.color))
                }
            }
        }
        .ignoresSafeArea()
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }
}

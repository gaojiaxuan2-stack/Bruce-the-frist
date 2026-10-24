import SwiftUI

struct ProgressRing: View {
    var progress: Double
    var colors: [Color]
    var lineWidth: CGFloat = 8
    var trackColor: Color = Color.primary.opacity(0.1)

    var body: some View {
        ZStack {
            Circle()
                .stroke(trackColor, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(min(max(progress, 0.001), 1)))
                .stroke(
                    AngularGradient(colors: colors + [colors.first ?? .accentColor], center: .center),
                    style: StrokeStyle(lineWidth: lineWidth, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
                .animation(.easeInOut(duration: 0.6), value: progress)
        }
        .padding(lineWidth / 2)
    }
}

#Preview {
    ProgressRing(progress: 0.65, colors: HabitTheme.sunset.colors, lineWidth: 12)
        .frame(width: 140, height: 140)
}

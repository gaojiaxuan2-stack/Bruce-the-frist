import SwiftUI

/// The night sky with a soft glow in the habit's colors.
struct CelebrationBackground: View {
    let theme: HabitTheme

    /// The bottom color of `Brand.night`, for fades that need to blend into it.
    static let baseColor = Color(hex: 0x24243E)

    var body: some View {
        ZStack {
            Brand.night

            Circle()
                .fill(theme.gradient)
                .frame(width: 420, height: 420)
                .blur(radius: 110)
                .opacity(0.55)
                .offset(y: -180)
        }
        .ignoresSafeArea()
        .accessibilityHidden(true)
    }
}

/// The habit's emoji in a glowing circle, with the milestone's symbol pinned to the corner.
/// Springs in when `isVisible` turns true.
struct CelebrationBadge: View {
    let emoji: String
    let symbol: String
    let theme: HabitTheme
    let isVisible: Bool

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            Text(emoji)
                .font(.system(size: 76))
                .frame(width: 156, height: 156)
                .background(theme.gradient, in: Circle())
                .overlay(Circle().stroke(Color.white.opacity(0.35), lineWidth: 4))
                .shadow(color: theme.accent.opacity(0.6), radius: 30)

            Image(systemName: symbol)
                .font(.title2.weight(.bold))
                .foregroundStyle(theme.gradient)
                .frame(width: 58, height: 58)
                .background(Color.white, in: Circle())
                .shadow(color: .black.opacity(0.25), radius: 8, y: 4)
                .offset(x: 6, y: 6)
        }
        .scaleEffect(isVisible ? 1 : 0.3)
        .rotationEffect(.degrees(isVisible ? 0 : -14))
        .opacity(isVisible ? 1 : 0)
        .accessibilityHidden(true)
    }
}

/// One figure on the celebration screen, e.g. "$84" "Money saved".
struct CelebrationStat: Identifiable {
    let id: String
    let value: String
    /// Already localized.
    let title: String
    let systemImage: String
}

/// Figures side by side, stacked instead at accessibility text sizes.
struct CelebrationStatsRow: View {
    let stats: [CelebrationStat]

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        layout {
            ForEach(stats) { stat in
                CelebrationStatTile(stat: stat)
            }
        }
    }
}

private struct CelebrationStatTile: View {
    let stat: CelebrationStat

    var body: some View {
        VStack(spacing: 6) {
            Image(systemName: stat.systemImage)
                .font(.title3)
                .foregroundStyle(.white.opacity(0.8))
                .accessibilityHidden(true)
            Text(stat.value)
                .font(.title2.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(stat.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(.white.opacity(0.7))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .padding(.horizontal, 10)
        .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
    }
}

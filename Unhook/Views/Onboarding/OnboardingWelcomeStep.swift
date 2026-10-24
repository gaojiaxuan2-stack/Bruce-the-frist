import SwiftUI

/// First screen: the brand, the promise and one button.
struct OnboardingWelcomeStep: View {
    let onStart: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            GeometryReader { proxy in
                ScrollView {
                    VStack(spacing: 28) {
                        WelcomeHero()
                        headline
                    }
                    .frame(maxWidth: .infinity, minHeight: proxy.size.height)
                }
                .scrollBounceBehavior(.basedOnSize)
            }

            VStack(spacing: 14) {
                Button("Get started") {
                    Haptics.tap()
                    onStart()
                }
                .buttonStyle(PrimaryButtonStyle())

                Text("Free · Private · No account needed")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 8)
        }
    }

    private var headline: some View {
        VStack(spacing: 14) {
            Text("Break free from any habit")
                .font(.largeTitle.bold())
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            Text("Smoking, vaping, drinking, doomscrolling, sugar. Unhook helps you quit anything, one day at a time.")
                .foregroundStyle(.white.opacity(0.75))
        }
        .multilineTextAlignment(.center)
        .padding(.horizontal, 32)
    }
}

/// The app icon glowing in the middle of a gentle orbit of the habits people quit with Unhook.
private struct WelcomeHero: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var isFloating = false

    private static let emojis = ["🚬", "💨", "🍺", "📱", "🍭", "🎮"]
    private static let orbitRadius: Double = 118

    var body: some View {
        ZStack {
            Circle()
                .fill(Brand.gradient)
                .frame(width: 220, height: 220)
                .blur(radius: 60)
                .opacity(0.7)

            ForEach(Array(Self.emojis.enumerated()), id: \.offset) { index, emoji in
                Text(emoji)
                    .font(.system(size: 28))
                    .frame(width: 52, height: 52)
                    .background(Color.white.opacity(0.1), in: Circle())
                    .offset(orbitOffset(for: index))
                    .offset(y: floatOffset(for: index))
            }

            Image(AppIconOption.standard.previewImageName)
                .resizable()
                .scaledToFit()
                .frame(width: 120, height: 120)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .shadow(color: Brand.colors[0].opacity(0.6), radius: 24, y: 8)
        }
        .frame(width: 300, height: 300)
        .accessibilityHidden(true)
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 2.4).repeatForever(autoreverses: true)) {
                isFloating = true
            }
        }
    }

    private func orbitOffset(for index: Int) -> CGSize {
        let angle = Double(index) / Double(Self.emojis.count) * 2 * Double.pi - Double.pi / 2
        return CGSize(width: cos(angle) * Self.orbitRadius, height: sin(angle) * Self.orbitRadius)
    }

    /// Neighbours bob in opposite directions so the orbit feels alive without moving as one block.
    private func floatOffset(for index: Int) -> CGFloat {
        guard isFloating else { return 0 }
        return index.isMultiple(of: 2) ? -6 : 6
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingWelcomeStep {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

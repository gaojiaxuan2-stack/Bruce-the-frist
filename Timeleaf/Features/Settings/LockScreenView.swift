import SwiftUI

// MARK: - LockScreenView

/// Shown above everything while `AppLock.isLocked`. A calm, full-screen resting
/// state: the user's seal inside a slowly turning clock ring, and one way back in.
struct LockScreenView: View {
    @Environment(\.theme) private var theme
    @Environment(AppLock.self) private var appLock
    @AppStorage(SettingsKey.userName) private var userName = ""

    @State private var isPresented = false

    var body: some View {
        ZStack {
            ThemeBackground()
            VStack(spacing: 0) {
                Spacer(minLength: 32)
                emblem
                titles
                    .padding(.top, 44)
                Spacer(minLength: 32)
                unlockControls
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 20)
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(.isModal)
        .onAppear {
            withAnimation(.smooth(duration: 1.0)) { isPresented = true }
        }
    }

    // MARK: Pieces

    private var emblem: some View {
        ZStack {
            LockHalo()
                .frame(width: 232, height: 232)
            SealView(monogram: Monogram.make(from: userName))
                .frame(width: 120, height: 120)
                .themedGlow(true)
        }
        .scaleEffect(isPresented ? 1 : 0.94)
        .opacity(isPresented ? 1 : 0)
        .accessibilityHidden(true)
    }

    private var titles: some View {
        VStack(spacing: 12) {
            Text(verbatim: TimePhrase.moment(.now))
                .font(theme.label(12, weight: .semibold))
                .tracking(2.5)
                .textCase(.uppercase)
                .foregroundStyle(theme.inkSecondary)
            Text("Timeleaf is locked")
                .font(theme.display(34))
                .foregroundStyle(theme.ink)
                .accessibilityAddTraits(.isHeader)
            Text("Your letters are resting, safe and unread.")
                .font(theme.body(17))
                .foregroundStyle(theme.inkSecondary)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
        .opacity(isPresented ? 1 : 0)
        .offset(y: isPresented ? 0 : 10)
    }

    private var unlockControls: some View {
        VStack(spacing: 14) {
            Button(action: unlock) {
                HStack(spacing: 10) {
                    if appLock.isAuthenticating {
                        ProgressView()
                            .tint(theme.accentInk)
                    } else {
                        Image(systemName: AppLock.biometrySymbol)
                    }
                    Text("Unlock")
                }
            }
            .buttonStyle(.themedPrimary)
            .disabled(appLock.isAuthenticating)
            .animation(.smooth(duration: 0.3), value: appLock.isAuthenticating)

            Text("Use \(AppLock.biometryLabel) to return to your letters.")
                .font(theme.label(13, weight: .regular))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: 420)
        .opacity(isPresented ? 1 : 0)
    }

    private func unlock() {
        guard !appLock.isAuthenticating else { return }
        Haptics.tap()
        Task { await appLock.unlock() }
    }
}

// MARK: - Private helpers

/// A thin clock-face ring that turns once every few minutes, with a single
/// accent mark travelling like a slow second hand. Still under Reduce Motion.
private struct LockHalo: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var angle: Double = 0

    var body: some View {
        ZStack {
            Circle()
                .strokeBorder(theme.ink.opacity(0.08), lineWidth: 0.75)
                .padding(20)
            LockTicks(tick: theme.ink, mark: theme.accent)
                .rotationEffect(.degrees(angle))
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.linear(duration: 240).repeatForever(autoreverses: false)) {
                angle = 360
            }
        }
    }
}

private struct LockTicks: View {
    let tick: Color
    let mark: Color

    var body: some View {
        Canvas { context, size in
            let center = CGPoint(x: size.width / 2, y: size.height / 2)
            let radius = min(size.width, size.height) / 2 - 4
            for index in 0..<60 {
                let isMajor = index % 5 == 0
                let angle = CGFloat(index) / 60 * 2 * .pi
                let inner = radius - (isMajor ? 9 : 4)
                var path = Path()
                path.move(to: CGPoint(x: center.x + cos(angle) * inner, y: center.y + sin(angle) * inner))
                path.addLine(to: CGPoint(x: center.x + cos(angle) * radius, y: center.y + sin(angle) * radius))
                context.stroke(
                    path,
                    with: .color(tick.opacity(isMajor ? 0.45 : 0.18)),
                    lineWidth: isMajor ? 1.2 : 0.6
                )
            }
            let markAngle = -CGFloat.pi / 2
            let markCenter = CGPoint(
                x: center.x + cos(markAngle) * (radius + 0.5),
                y: center.y + sin(markAngle) * (radius + 0.5)
            )
            let dot = CGRect(x: markCenter.x - 3, y: markCenter.y - 3, width: 6, height: 6)
            context.fill(Path(ellipseIn: dot), with: .color(mark))
        }
    }
}

// MARK: - Preview

#Preview("Locked") {
    LockScreenView()
        .environment(AppLock())
        .screenTheme(.celestial)
}

import SwiftUI

/// The payoff: what a year free gives back, counting up from zero, plus how close the first milestone is.
struct OnboardingProjectionStep: View {
    let answers: OnboardingAnswers
    let onContinue: () -> Void

    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize
    @ScaledMetric(relativeTo: .largeTitle) private var heroFontSize: CGFloat = 52

    /// Share (0...1) of the final numbers currently shown, driven by the count-up.
    @State private var progress: Double = 0
    @State private var now = Date.now

    private static let countUpSteps = 30

    init(answers: OnboardingAnswers, onContinue: @escaping () -> Void) {
        self.answers = answers
        self.onContinue = onContinue
    }

    private var projection: OnboardingProjection { answers.projection }
    private var theme: HabitTheme { answers.theme }
    private var showsMoney: Bool { projection.yearlyMoney >= 1 }
    private var showsHours: Bool { projection.yearlyHours >= 1 }
    private var showsUnits: Bool { projection.yearlyUnits >= 1 && !answers.draft.unitName.isEmpty }

    var body: some View {
        OnboardingStepLayout(
            title: Text("Your first year free"),
            subtitle: Text("Here's what quitting gives back, based on your answers.")
        ) {
            VStack(spacing: 12) {
                if showsMoney {
                    moneyCard
                }
                if showsHours || showsUnits {
                    tiles
                }
                // Also covers tiny inputs that round to nothing, so the screen never shows only the milestone.
                if !showsMoney && !showsHours && !showsUnits {
                    uncountableCard
                }
                milestoneCard
            }
        } footer: {
            Button("Let's do this") {
                Haptics.tap()
                onContinue()
            }
            .buttonStyle(PrimaryButtonStyle(gradient: theme.gradient))
        }
        .task { await countUp() }
    }

    // MARK: Cards

    private var moneyCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("In one year you'll save")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.85))
            Text(MoneyFormatter.rounded(projection.yearlyMoney * progress, code: currencyCode))
                .font(.system(size: heroFontSize, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)
                .contentTransition(.numericText())
                .foregroundStyle(.white)
            Text("That's \(MoneyFormatter.precise(projection.dailyCost, code: currencyCode)) a day back in your pocket.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(theme.gradient, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("In one year you'll save \(MoneyFormatter.rounded(projection.yearlyMoney, code: currencyCode))"))
    }

    private var tiles: some View {
        let layout = dynamicTypeSize.isAccessibilitySize
            ? AnyLayout(VStackLayout(spacing: 12))
            : AnyLayout(HStackLayout(alignment: .top, spacing: 12))
        return layout {
            if showsHours {
                hoursTile
            }
            if showsUnits {
                unitsTile
            }
        }
    }

    private var hoursTile: some View {
        ProjectionTile(
            systemImage: "clock.fill",
            caption: Text("You'll win back"),
            value: (projection.yearlyHours * progress).clampedWholeNumber.formatted(),
            unit: Text("hours"),
            tint: theme.accent,
            accessibilityText: Text("You'll win back \(projection.yearlyHours.clampedWholeNumber) hours")
        )
    }

    private var unitsTile: some View {
        ProjectionTile(
            systemImage: "hand.raised.fill",
            caption: Text("You'll skip"),
            value: (projection.yearlyUnits * progress).clampedWholeNumber.formatted(),
            unit: Text(answers.draft.unitName),
            tint: theme.accent,
            accessibilityText: Text("You'll skip \(projection.yearlyUnits.clampedWholeNumber) \(answers.draft.unitName)")
        )
    }

    private var uncountableCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Some wins can't be counted")
                .font(.headline)
                .foregroundStyle(.white)
            Text("More calm, more control, and proof you can do hard things. Every day free adds up.")
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(20)
        .background(theme.gradient, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .accessibilityElement(children: .combine)
    }

    private var milestoneCard: some View {
        let preview = answers.milestonePreview(now: now)
        return HStack(spacing: 14) {
            Image(systemName: preview?.milestone.symbol ?? "crown.fill")
                .font(.title2)
                .foregroundStyle(.white)
                .frame(width: 52, height: 52)
                .background(theme.gradient, in: Circle())
                .accessibilityHidden(true)
            Text(milestoneText(preview))
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(16)
        .onboardingPanel()
        .accessibilityElement(children: .combine)
    }

    private func milestoneText(_ preview: OnboardingMilestonePreview?) -> String {
        guard let preview else {
            return String(localized: "You've already passed every milestone. That's incredible.")
        }
        let wait = OnboardingCopy.timeUntil(preview.remaining)
        if preview.isFirst {
            return String(localized: "Your first milestone, \(preview.milestone.title), unlocks in \(wait).")
        }
        return String(localized: "You're already on your way. Next up: \(preview.milestone.title), in \(wait).")
    }

    // MARK: Count-up

    /// Rolls the numbers up from zero with an ease-out curve. Reduce Motion shows the totals straight away.
    private func countUp() async {
        guard progress < 1 else { return }
        guard !reduceMotion, showsMoney || showsHours || showsUnits else {
            progress = 1
            return
        }
        do {
            try await Task.sleep(for: .milliseconds(350))
            for index in 1...Self.countUpSteps {
                let linear = Double(index) / Double(Self.countUpSteps)
                withAnimation(.easeOut(duration: 0.1)) {
                    progress = 1 - pow(1 - linear, 3)
                }
                try await Task.sleep(for: .milliseconds(40))
            }
        } catch {
            // The screen went away mid-count; nothing left to animate.
            return
        }
        progress = 1
        Haptics.soft()
    }
}

private struct ProjectionTile: View {
    let systemImage: String
    let caption: Text
    let value: String
    let unit: Text
    let tint: Color
    let accessibilityText: Text

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Image(systemName: systemImage)
                .font(.title3)
                .foregroundStyle(tint)
            caption
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
            Text(value)
                .font(.title.bold())
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
                .contentTransition(.numericText())
                .foregroundStyle(.white)
            unit
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.85))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(16)
        .onboardingPanel()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingProjectionStep(answers: .preview) {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

import SwiftUI

/// "What do you want to quit?": one tap picks a preset and moves on.
struct OnboardingHabitStep: View {
    let selectedPresetID: String?
    let onSelect: (HabitPreset) -> Void

    private let columns = [GridItem(.adaptive(minimum: 100), spacing: 12)]

    var body: some View {
        OnboardingStepLayout(
            title: Text("What do you want to quit?"),
            subtitle: Text("Start with the one that matters most right now.")
        ) {
            LazyVGrid(columns: columns, spacing: 12) {
                ForEach(HabitPreset.all) { preset in
                    tile(for: preset)
                }
            }
        }
    }

    private func tile(for preset: HabitPreset) -> some View {
        let isSelected = preset.id == selectedPresetID
        return Button {
            onSelect(preset)
        } label: {
            OnboardingPresetTile(preset: preset, isSelected: isSelected)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(preset.title)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

private struct OnboardingPresetTile: View {
    let preset: HabitPreset
    let isSelected: Bool

    var body: some View {
        VStack(spacing: 10) {
            Text(preset.emoji)
                .font(.system(size: 36))
            Text(preset.title)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity, minHeight: 112)
        .padding(8)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .onboardingPanel(isHighlighted: isSelected, tint: preset.theme.gradient)
        .overlay(alignment: .bottom) {
            Capsule()
                .fill(preset.theme.gradient)
                .frame(width: 28, height: 4)
                .padding(.bottom, 10)
        }
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingHabitStep(selectedPresetID: "vaping") { _ in }
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

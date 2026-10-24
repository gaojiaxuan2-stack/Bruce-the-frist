import SwiftUI

/// "What did it cost you?": money and time per day, prefilled from the preset.
struct OnboardingCostStep: View {
    @Binding var answers: OnboardingAnswers
    let onContinue: () -> Void

    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @FocusState private var focusedField: Field?

    private enum Field: Hashable {
        case cost, minutes, units
    }

    init(answers: Binding<OnboardingAnswers>, onContinue: @escaping () -> Void) {
        _answers = answers
        self.onContinue = onContinue
    }

    private var tint: LinearGradient { answers.theme.gradient }

    var body: some View {
        OnboardingStepLayout(
            title: Text("What did it cost you?"),
            subtitle: Text("A rough guess is perfect. Unhook turns it into the money and time you win back.")
        ) {
            VStack(alignment: .leading, spacing: 12) {
                numberRow(
                    Text("Money per day"),
                    systemImage: "banknote.fill",
                    text: $answers.draft.costText,
                    prefix: currencySymbol,
                    suffix: nil,
                    field: .cost
                )
                numberRow(
                    Text("Minutes per day"),
                    systemImage: "clock.fill",
                    text: $answers.draft.minutesText,
                    prefix: nil,
                    suffix: Text("min"),
                    field: .minutes
                )
                if !answers.draft.unitName.isEmpty {
                    numberRow(
                        Text("\(answers.draft.unitName.localizedCapitalized) per day"),
                        systemImage: "number",
                        text: $answers.draft.unitsText,
                        prefix: nil,
                        suffix: nil,
                        field: .units
                    )
                }
                Text("Leave a field empty if it doesn't apply. You can change this anytime.")
                    .font(.footnote)
                    .foregroundStyle(.white.opacity(0.6))
                    .padding(.top, 4)
            }
        } footer: {
            Button("Continue") {
                focusedField = nil
                Haptics.tap()
                onContinue()
            }
            .buttonStyle(PrimaryButtonStyle(gradient: tint))
        }
    }

    private func numberRow(
        _ title: Text,
        systemImage: String,
        text: Binding<String>,
        prefix: String?,
        suffix: Text?,
        field: Field
    ) -> some View {
        HStack(spacing: 12) {
            Image(systemName: systemImage)
                .font(.headline)
                .foregroundStyle(tint)
                .frame(width: 28)
                .accessibilityHidden(true)
            title
                .font(.headline)
                .foregroundStyle(.white)
            Spacer(minLength: 8)
            if let prefix {
                Text(prefix)
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityHidden(true)
            }
            TextField("0", text: text)
                .keyboardType(.decimalPad)
                .multilineTextAlignment(.trailing)
                .font(.title3.weight(.semibold).monospacedDigit())
                .foregroundStyle(.white)
                .frame(maxWidth: 90)
                .focused($focusedField, equals: field)
                .accessibilityLabel(title)
            if let suffix {
                suffix
                    .foregroundStyle(.white.opacity(0.6))
                    .accessibilityHidden(true)
            }
        }
        .padding(16)
        .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
        .onTapGesture { focusedField = field }
        .onboardingPanel(isHighlighted: focusedField == field, tint: tint)
    }

    private var currencySymbol: String {
        let formatter = NumberFormatter()
        formatter.numberStyle = .currency
        formatter.currencyCode = currencyCode
        return formatter.currencySymbol ?? currencyCode
    }
}

#Preview {
    ZStack {
        Brand.night.ignoresSafeArea()
        OnboardingCostStep(answers: .constant(.preview)) {}
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

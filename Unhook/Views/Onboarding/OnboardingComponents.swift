import SwiftUI

/// Shared layout for the question screens: a heading, scrollable content and an optional footer for buttons
/// that stays pinned above the keyboard.
struct OnboardingStepLayout<Content: View, Footer: View>: View {
    private let title: Text
    private let subtitle: Text?
    private let content: Content
    private let footer: Footer?

    init(
        title: Text,
        subtitle: Text? = nil,
        @ViewBuilder content: () -> Content,
        @ViewBuilder footer: () -> Footer
    ) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
        self.footer = footer()
    }

    var body: some View {
        VStack(spacing: 0) {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    content
                }
                .padding(.horizontal, 24)
                .padding(.top, 16)
                .padding(.bottom, 24)
            }
            .scrollDismissesKeyboard(.interactively)
            .scrollBounceBehavior(.basedOnSize)

            if let footer {
                VStack(spacing: 12) {
                    footer
                }
                .padding(.horizontal, 24)
                .padding(.top, 12)
                .padding(.bottom, 8)
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            title
                .font(.title.bold())
                .foregroundStyle(.white)
                .accessibilityAddTraits(.isHeader)
            if let subtitle {
                subtitle
                    .foregroundStyle(.white.opacity(0.7))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

extension OnboardingStepLayout where Footer == EmptyView {
    /// A screen without footer buttons (for example, one where tapping an option moves on).
    init(title: Text, subtitle: Text? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.subtitle = subtitle
        self.content = content()
        self.footer = nil
    }
}

/// Back button plus a slim bar showing how far through the questions the user is.
struct OnboardingTopBar: View {
    let questionNumber: Int
    let questionCount: Int
    let tint: LinearGradient
    let onBack: () -> Void

    private var progress: Double {
        guard questionCount > 0 else { return 0 }
        return min(max(Double(questionNumber) / Double(questionCount), 0), 1)
    }

    var body: some View {
        HStack(spacing: 14) {
            Button(action: onBack) {
                Image(systemName: "chevron.left")
                    .font(.headline)
                    .foregroundStyle(.white.opacity(0.85))
                    .frame(width: 40, height: 40)
                    .background(Color.white.opacity(0.12), in: Circle())
            }
            .accessibilityLabel("Back")

            progressBar
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
    }

    private var progressBar: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Capsule()
                    .fill(Color.white.opacity(0.15))
                Capsule()
                    .fill(tint)
                    .frame(width: proxy.size.width * CGFloat(progress))
            }
        }
        .frame(height: 6)
        .animation(.spring(response: 0.5, dampingFraction: 0.85), value: progress)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Text("Question \(questionNumber) of \(questionCount)"))
    }
}

/// A large tappable option with a radio indicator, for single-choice questions.
struct OnboardingChoiceRow: View {
    let title: Text
    let subtitle: Text
    let systemImage: String
    let isSelected: Bool
    let tint: LinearGradient
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                Image(systemName: systemImage)
                    .font(.title3)
                    .frame(width: 32)
                    .accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    title
                        .font(.headline)
                    subtitle
                        .font(.subheadline)
                        .foregroundStyle(.white.opacity(0.65))
                }
                Spacer(minLength: 0)
                Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
                    .font(.title3)
                    .foregroundStyle(.white.opacity(isSelected ? 1 : 0.35))
                    .accessibilityHidden(true)
            }
            .foregroundStyle(.white)
            .padding(16)
            .contentShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
            .onboardingPanel(isHighlighted: isSelected, tint: tint)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }
}

extension View {
    /// The translucent panel used for tiles, rows and inputs on the night background. Highlighted panels get
    /// a brighter fill and a gradient outline.
    func onboardingPanel(
        cornerRadius: CGFloat = 20,
        isHighlighted: Bool = false,
        tint: LinearGradient = Brand.gradient
    ) -> some View {
        modifier(OnboardingPanel(cornerRadius: cornerRadius, isHighlighted: isHighlighted, tint: tint))
    }
}

private struct OnboardingPanel: ViewModifier {
    let cornerRadius: CGFloat
    let isHighlighted: Bool
    let tint: LinearGradient

    func body(content: Content) -> some View {
        content
            .background(
                Color.white.opacity(isHighlighted ? 0.16 : 0.08),
                in: RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(tint, lineWidth: 2)
                    .opacity(isHighlighted ? 1 : 0)
            }
    }
}

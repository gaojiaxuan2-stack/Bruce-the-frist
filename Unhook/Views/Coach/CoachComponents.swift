import SwiftUI

/// "Your Unhook coach" plus a badge saying which engine is answering. Used as the coach sheet's title.
struct CoachTitle: View {
    let usesOnDeviceAI: Bool

    var body: some View {
        HStack(spacing: 6) {
            Text("Your Unhook coach")
                .font(.headline)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            CoachBadge(usesOnDeviceAI: usesOnDeviceAI)
        }
        .accessibilityElement(children: .combine)
    }
}

struct CoachBadge: View {
    let usesOnDeviceAI: Bool

    var body: some View {
        label
            .font(.caption2.weight(.bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(Brand.gradient, in: Capsule())
    }

    @ViewBuilder private var label: some View {
        if usesOnDeviceAI {
            Text("On-device AI")
        } else {
            Text("Coach")
        }
    }
}

/// The privacy promise, always visible under the title.
struct CoachPrivacyStrip: View {
    var body: some View {
        Label("Private: nothing leaves your iPhone", systemImage: "lock.fill")
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
            .padding(.horizontal)
            .padding(.vertical, 6)
            .background(.bar)
    }
}

/// Shown after a crisis message: how to reach real help right now. Never paywalled.
struct CoachCrisisBanner: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("You don't have to face this alone", systemImage: "heart.fill")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(Color.pink)
            Text("If you're in danger or thinking about hurting yourself, call your local emergency number now or contact a crisis line.")
                .font(.footnote)
                .fixedSize(horizontal: false, vertical: true)
            if let url = CoachSafety.helplineURL {
                Link(destination: url) {
                    Label("Find a free helpline", systemImage: "phone.fill")
                        .font(.footnote.weight(.semibold))
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Color.pink.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .accessibilityElement(children: .contain)
    }
}

/// The coach's round gradient avatar.
struct CoachAvatar: View {
    var body: some View {
        Image(systemName: "sparkles")
            .font(.caption.weight(.semibold))
            .foregroundStyle(.white)
            .frame(width: 28, height: 28)
            .background(Brand.gradient, in: Circle())
            .accessibilityHidden(true)
    }
}

/// One chat bubble: the user on the right in the brand gradient, the coach on the left.
struct CoachMessageBubble: View {
    let message: CoachMessage

    private var isUser: Bool { message.role == .user }

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            if isUser {
                Spacer(minLength: 48)
            } else {
                CoachAvatar()
            }
            bubble
            if !isUser {
                Spacer(minLength: 32)
            }
        }
        .frame(maxWidth: .infinity, alignment: isUser ? .trailing : .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityText)
    }

    private var bubble: some View {
        Text(message.text)
            .font(.body)
            .foregroundStyle(isUser ? Color.white : Color.primary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .background(bubbleStyle, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .textSelection(.enabled)
    }

    private var bubbleStyle: AnyShapeStyle {
        isUser ? AnyShapeStyle(Brand.gradient) : AnyShapeStyle(Color(.secondarySystemGroupedBackground))
    }

    private var accessibilityText: String {
        isUser ? String(localized: "You: \(message.text)") : String(localized: "Coach: \(message.text)")
    }
}

/// Three pulsing dots while the coach is "typing".
struct CoachTypingIndicator: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    private static let step: TimeInterval = 0.35

    var body: some View {
        HStack(alignment: .bottom, spacing: 8) {
            CoachAvatar()
            TimelineView(.periodic(from: .now, by: Self.step)) { timeline in
                dots(active: activeDot(at: timeline.date))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Coach is typing")
    }

    private func activeDot(at date: Date) -> Int {
        guard !reduceMotion else { return -1 }
        return (date.timeIntervalSinceReferenceDate / Self.step).clampedWholeNumber % 3
    }

    private func dots(active: Int) -> some View {
        HStack(spacing: 5) {
            ForEach(0..<3, id: \.self) { index in
                Circle()
                    .fill(Color.secondary)
                    .frame(width: 8, height: 8)
                    .opacity(index == active ? 1 : 0.35)
                    .scaleEffect(index == active ? 1.2 : 1)
            }
        }
        .animation(.easeInOut(duration: 0.25), value: active)
    }
}

/// A suggested message the user can send with one tap.
struct CoachQuickReplyChip: View {
    let text: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Text(text)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.primary)
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .background(Color(.secondarySystemGroupedBackground), in: Capsule())
                .overlay(Capsule().stroke(Color.primary.opacity(0.08), lineWidth: 1))
        }
        .buttonStyle(.plain)
    }
}

#Preview {
    VStack(spacing: 12) {
        CoachCrisisBanner()
        CoachMessageBubble(message: CoachMessage(role: .coach, text: "Hey — 12 days free from Smoking. That's huge. What's going on right now?"))
        CoachMessageBubble(message: CoachMessage(role: .user, text: "I'm at a party"))
        CoachTypingIndicator()
    }
    .padding()
    .background(Color(.systemGroupedBackground))
    .previewEnvironment()
}

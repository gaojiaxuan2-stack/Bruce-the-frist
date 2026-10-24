import SwiftUI
import SwiftData
import UIKit

/// A private chat that talks the user through a craving. Present it in a sheet.
/// Uses Apple's on-device model when available, otherwise the scripted coach. Conversations are never stored.
struct CoachView: View {
    /// The habit the craving is about, or nil to use the habit with the longest current streak.
    let habit: Habit?

    @Environment(\.dismiss) private var dismiss
    @Query(sort: \Habit.sortIndex) private var habits: [Habit]

    @State private var coach: (any CravingCoach)?
    @State private var context = CoachContext.generic
    @State private var messages: [CoachMessage] = []
    @State private var draft = ""
    @State private var isAwaitingReply = false
    @State private var showsCrisisResources = false
    @FocusState private var isInputFocused: Bool

    private static let bottomID = "coach.bottom"
    /// Scripted replies are instant; a short pause makes the conversation feel less mechanical.
    private static let minimumTypingDelay: Duration = .milliseconds(900)

    private var usesOnDeviceAI: Bool {
        coach?.usesOnDeviceModel ?? false
    }

    private var userMessageCount: Int {
        messages.filter { $0.role == .user }.count
    }

    private var showsQuickReplies: Bool {
        !isAwaitingReply && !showsCrisisResources && userMessageCount < 2
    }

    private var canSend: Bool {
        !isAwaitingReply && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                CoachPrivacyStrip()
                if showsCrisisResources {
                    CoachCrisisBanner()
                        .padding(.horizontal)
                        .padding(.top, 8)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
                messageList
                if showsQuickReplies {
                    quickReplyBar
                        .transition(.opacity)
                }
                inputBar
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Coach")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .principal) {
                    CoachTitle(usesOnDeviceAI: usesOnDeviceAI)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") { dismiss() }
                }
            }
            .onAppear(perform: startConversation)
        }
    }

    // MARK: Messages

    private var messageList: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(messages) { message in
                        CoachMessageBubble(message: message)
                            .id(message.id)
                    }
                    if isAwaitingReply {
                        CoachTypingIndicator()
                            .transition(.opacity)
                    }
                    Color.clear
                        .frame(height: 1)
                        .id(Self.bottomID)
                }
                .padding(.horizontal)
                .padding(.vertical, 12)
            }
            .scrollDismissesKeyboard(.interactively)
            .onChange(of: messages.count) {
                scrollToBottom(proxy)
            }
            .onChange(of: isAwaitingReply) {
                scrollToBottom(proxy)
            }
            .onChange(of: isInputFocused) {
                scrollToBottom(proxy)
            }
        }
    }

    private func scrollToBottom(_ proxy: ScrollViewProxy) {
        withAnimation(.easeOut(duration: 0.25)) {
            proxy.scrollTo(Self.bottomID, anchor: .bottom)
        }
    }

    // MARK: Input

    private var quickReplyBar: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(ScriptedCoach.quickReplies, id: \.self) { reply in
                    CoachQuickReplyChip(text: reply) {
                        send(reply)
                    }
                }
            }
            .padding(.horizontal)
            .padding(.vertical, 8)
        }
        .scrollIndicators(.hidden)
    }

    private var inputBar: some View {
        HStack(alignment: .bottom, spacing: 10) {
            TextField("Message your coach", text: $draft, axis: .vertical)
                .lineLimit(1...5)
                .focused($isInputFocused)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .background(
                    Color(.secondarySystemGroupedBackground),
                    in: RoundedRectangle(cornerRadius: 20, style: .continuous)
                )

            Button {
                send(draft)
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.largeTitle)
                    .foregroundStyle(Brand.gradient)
            }
            .disabled(!canSend)
            .opacity(canSend ? 1 : 0.4)
            .accessibilityLabel("Send")
        }
        .padding(.horizontal)
        .padding(.vertical, 8)
        .background(.bar)
    }

    // MARK: Actions

    private func startConversation() {
        guard coach == nil else { return }
        let newContext = CoachContext.make(habit: habit, allHabits: habits)
        let newCoach = CoachProvider.makeCoach()
        let opening = CoachMessage(role: .coach, text: ScriptedCoach.openingMessage(for: newContext))

        context = newContext
        coach = newCoach
        messages = [opening]
        newCoach.prepare(context: newContext, history: [opening])
    }

    private func send(_ rawText: String) {
        let text = rawText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty, !isAwaitingReply else { return }

        Haptics.selection()
        let history = messages
        draft = ""
        withAnimation(.easeOut(duration: 0.2)) {
            messages.append(CoachMessage(role: .user, text: text))
        }

        // Safety first: a crisis never reaches a model, and real help is always one tap away.
        if CoachSafety.isCrisis(text) {
            withAnimation(.easeOut(duration: 0.25)) {
                showsCrisisResources = true
                messages.append(CoachMessage(role: .coach, text: CoachSafety.crisisReply))
            }
            Self.announce(CoachSafety.crisisReply)
            return
        }

        let activeCoach: any CravingCoach = coach ?? ScriptedCoach()
        let currentContext = context
        withAnimation(.easeOut(duration: 0.2)) {
            isAwaitingReply = true
        }

        Task {
            let started = ContinuousClock.now
            let reply = await activeCoach.reply(to: text, history: history, context: currentContext)
            let elapsed = ContinuousClock.now - started
            if elapsed < Self.minimumTypingDelay {
                try? await Task.sleep(for: Self.minimumTypingDelay - elapsed)
            }
            withAnimation(.easeOut(duration: 0.25)) {
                messages.append(CoachMessage(role: .coach, text: reply))
                isAwaitingReply = false
            }
            Self.announce(reply)
        }
    }
}

extension CoachView {
    /// Reads new coach messages aloud for VoiceOver users, who otherwise wouldn't know a reply arrived.
    fileprivate static func announce(_ text: String) {
        guard UIAccessibility.isVoiceOverRunning else { return }
        UIAccessibility.post(notification: .announcement, argument: text)
    }
}

#Preview {
    CoachView(habit: PreviewData.sampleHabit)
        .previewEnvironment()
}

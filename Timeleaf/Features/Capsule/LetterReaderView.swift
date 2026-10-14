import SwiftUI
import SwiftData

// MARK: - CapsuleReaderScreen

/// An opened letter, laid out like a well-set page: a broken seal, when it was
/// written, the title and mood, the question it answered, the letter itself on
/// the style's stationery, the memories kept inside, and room to write back.
struct CapsuleReaderScreen: View {
    let capsule: TimeCapsule
    let onDelete: () -> Void

    @Environment(\.theme) private var theme
    @Environment(\.modelContext) private var modelContext
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var draft: String
    @State private var isEditingReply: Bool
    @State private var confirmsDelete = false
    @State private var revealed = false
    @State private var isLeaving = false
    @FocusState private var replyFocused: Bool

    init(capsule: TimeCapsule, onDelete: @escaping () -> Void) {
        self.capsule = capsule
        self.onDelete = onDelete
        _draft = State(initialValue: capsule.replyText)
        _isEditingReply = State(initialValue: capsule.replyText.isEmpty)
    }

    var body: some View {
        ScrollView {
            sections
                .padding(.top, 76)
                .padding(.bottom, 56)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .overlay(alignment: .topTrailing) {
            // Mirrors the close button: a 38 pt face inside a 44 pt touch target.
            menu
                .padding(.trailing, 17)
                .padding(.top, 5)
        }
        .modifier(
            CapsuleScreenDeleteDialog(
                isPresented: $confirmsDelete,
                message: "The letter, its memories and your reply will be gone for good.",
                onDelete: delete
            )
        )
        .onAppear {
            revealed = true
        }
        .onDisappear {
            saveReply()
        }
        .task(id: draft) {
            await debounceSave()
        }
    }

    private var sections: some View {
        VStack(spacing: 40) {
            header
                .modifier(CapsuleReaderReveal(step: 0, visible: revealed, reduceMotion: reduceMotion))
            if !capsule.prompt.isEmpty {
                promptCard
                    .modifier(CapsuleReaderReveal(step: 1, visible: revealed, reduceMotion: reduceMotion))
            }
            letter
                .modifier(CapsuleReaderReveal(step: 2, visible: revealed, reduceMotion: reduceMotion))
            if !capsule.media.isEmpty {
                gallery
                    .modifier(CapsuleReaderReveal(step: 3, visible: revealed, reduceMotion: reduceMotion))
            }
            replySection
                .modifier(CapsuleReaderReveal(step: 4, visible: revealed, reduceMotion: reduceMotion))
            footer
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(spacing: 16) {
            CapsuleScreenSealHalves(monogram: capsule.monogram, split: 0.32)
                .frame(width: 58, height: 58)
                .padding(.bottom, 4)
            Text("Written \(TimePhrase.duration(from: capsule.createdAt, to: .now)) ago — on \(TimePhrase.moment(capsule.createdAt))")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
            title
            if !capsule.mood.isEmpty {
                Text(capsule.mood)
                    .font(.system(size: 54))
                    .accessibilityLabel(Text("Mood \(capsule.mood)"))
            }
            Text("To \(capsule.displayRecipient) · From \(capsule.displaySender)")
                .font(theme.body(15).italic())
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 28)
    }

    @ViewBuilder
    private var title: some View {
        if capsule.title.isEmpty {
            Text("A letter across time")
                .font(theme.display(34))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
        } else {
            Text(capsule.title)
                .font(theme.display(34))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Prompt

    private var promptCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            CapsuleScreenEyebrow("The question you answered")
            Text(capsule.prompt)
                .font(theme.body(19).italic())
                .foregroundStyle(theme.ink)
                .lineSpacing(4)
                .multilineTextAlignment(.leading)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 18)
        .overlay(alignment: .leading) {
            Capsule()
                .fill(theme.accent)
                .frame(width: 2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themedCard(padding: 22)
        .padding(.horizontal, 20)
    }

    // MARK: Letter

    private var letter: some View {
        VStack(alignment: .leading, spacing: 24) {
            Text(TimePhrase.longDate(capsule.createdAt))
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .trailing)
            letterBody
            Text("— \(capsule.displaySender)")
                .font(theme.display(21))
                .foregroundStyle(theme.ink.opacity(0.85))
                .frame(maxWidth: .infinity, alignment: .trailing)
        }
        .padding(CapsuleReaderPaper.insets(for: theme.id))
        .background {
            StationeryView()
        }
        .clipShape(RoundedRectangle(cornerRadius: max(theme.cornerRadius, 4), style: .continuous))
        .shadow(color: Color.black.opacity(theme.colorScheme == .dark ? 0.4 : 0.12), radius: 22, y: 12)
        .padding(.horizontal, 16)
    }

    @ViewBuilder
    private var letterBody: some View {
        if capsule.message.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            Text("No words this time — only what was kept inside.")
                .font(theme.body(18).italic())
                .foregroundStyle(theme.inkSecondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            Text(capsule.message)
                .font(theme.body(18))
                .lineSpacing(8)
                .foregroundStyle(theme.ink)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Media

    private var gallery: some View {
        VStack(alignment: .leading, spacing: 18) {
            CapsuleScreenEyebrow("Kept inside")
                .padding(.horizontal, 24)
            CapsuleMediaGallery(capsule: capsule)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: Reply

    private var replyTitle: LocalizedStringKey {
        if capsule.isIncoming {
            return "Write back to \(capsule.displaySender)"
        }
        return "Write back to your past self"
    }

    private var replyPlaceholder: LocalizedStringKey {
        if capsule.isIncoming {
            return "Dear \(capsule.displaySender)…"
        }
        return "Dear past me…"
    }

    private var trimmedDraft: String {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var replySection: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(replyTitle)
                    .font(theme.display(24))
                    .foregroundStyle(theme.ink)
                Text("A few words back across the years. They stay here, with the letter.")
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if isEditingReply {
                replyEditor
                    .transition(.opacity)
            } else {
                replyCard
                    .transition(.opacity)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.horizontal, 20)
    }

    private var replyEditor: some View {
        VStack(alignment: .trailing, spacing: 12) {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $draft)
                    .font(theme.body(17))
                    .foregroundStyle(theme.ink)
                    .scrollContentBackground(.hidden)
                    .focused($replyFocused)
                    .frame(minHeight: 150)
                if draft.isEmpty {
                    Text(replyPlaceholder)
                        .font(theme.body(17).italic())
                        .foregroundStyle(theme.inkSecondary.opacity(0.75))
                        .padding(.top, 8)
                        .padding(.leading, 5)
                        .allowsHitTesting(false)
                }
            }
            .themedField()
            if !trimmedDraft.isEmpty {
                Button("Keep this reply", action: commitReply)
                    .buttonStyle(.themedGhost)
                    .fixedSize()
            }
        }
    }

    private var replyCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text(capsule.replyText)
                .font(theme.body(17).italic())
                .foregroundStyle(theme.ink)
                .lineSpacing(6)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .fixedSize(horizontal: false, vertical: true)
            HStack {
                Spacer()
                Button(action: editReply) {
                    Label("Edit", systemImage: "pencil")
                        .font(theme.label(13, weight: .semibold))
                        .foregroundStyle(theme.accent)
                }
                .buttonStyle(.plain)
            }
        }
        .themedCard(padding: 22)
    }

    // MARK: Footer & chrome

    private var footer: some View {
        VStack(spacing: 12) {
            CapsuleScreenOrnament()
            Text("Opened \(TimePhrase.longDate(capsule.openedAt ?? .now))")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
            Text(verbatim: "时笺 · TIMELEAF")
                .font(theme.label(10, weight: .semibold))
                .tracking(2.4)
                .foregroundStyle(theme.inkSecondary.opacity(0.6))
        }
        .padding(.top, 8)
    }

    private var menu: some View {
        Menu {
            Button(role: .destructive) {
                confirmsDelete = true
            } label: {
                Label("Delete letter", systemImage: "trash")
            }
        } label: {
            CapsuleScreenChromeIcon(systemName: "ellipsis")
        }
        .accessibilityLabel(Text("More"))
    }

    // MARK: Actions

    private func commitReply() {
        replyFocused = false
        saveReply()
        Haptics.soft()
        if !trimmedDraft.isEmpty {
            withAnimation(.smooth(duration: 0.4)) {
                isEditingReply = false
            }
        }
    }

    private func editReply() {
        withAnimation(.smooth(duration: 0.4)) {
            isEditingReply = true
        }
        Task {
            try? await Task.sleep(for: .milliseconds(350))
            replyFocused = true
        }
    }

    private func debounceSave() async {
        guard trimmedDraft != capsule.replyText else { return }
        try? await Task.sleep(for: .seconds(0.9))
        guard !Task.isCancelled else { return }
        saveReply()
    }

    private func saveReply() {
        guard !isLeaving, capsule.modelContext != nil else { return }
        let text = trimmedDraft
        guard text != capsule.replyText else { return }
        capsule.replyText = text
        try? modelContext.save()
    }

    private func delete() {
        isLeaving = true
        onDelete()
    }
}

// MARK: - Private pieces

/// The reading area of each style's stationery: the date, the words and the
/// signature always sit inside it, clear of the ornaments the paper prints in its
/// margins — Ink Wash's head and foot rules (y 32–36, H−40…H−36) and its chop,
/// Celestial's crescent moon and first chart ring at the top-trailing pole
/// (W−34, 34), Parchment's fleuron at the foot, Blossom's pressed petals in the
/// lower-trailing corner.
private enum CapsuleReaderPaper {
    static func insets(for id: ThemeID) -> EdgeInsets {
        switch id {
        case .inkwash:
            return EdgeInsets(top: 52, leading: 28, bottom: 58, trailing: 28)
        case .celestial:
            return EdgeInsets(top: 64, leading: 28, bottom: 36, trailing: 28)
        case .parchment:
            return EdgeInsets(top: 28, leading: 28, bottom: 44, trailing: 28)
        case .blossom:
            return EdgeInsets(top: 28, leading: 28, bottom: 56, trailing: 28)
        case .aurora, .monolith:
            return EdgeInsets(top: 28, leading: 28, bottom: 28, trailing: 28)
        }
    }
}

/// Sections drift up and fade in one after another when the letter opens.
private struct CapsuleReaderReveal: ViewModifier {
    let step: Int
    let visible: Bool
    let reduceMotion: Bool

    func body(content: Content) -> some View {
        content
            .opacity(visible ? 1 : 0)
            .offset(y: visible || reduceMotion ? 0 : 18)
            .animation(.smooth(duration: 0.9).delay(0.12 * Double(step)), value: visible)
    }
}

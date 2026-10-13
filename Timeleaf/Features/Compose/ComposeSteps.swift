import SwiftUI
import PhotosUI
import UIKit

// The five writing pages of `ComposeFlowView`. Only the flow uses these views.

// MARK: - 0 · To whom?

struct ComposeRecipientStep: View {
    @Bindable var draft: ComposeDraft

    @Environment(\.theme) private var theme
    @FocusState private var focusedField: ComposeRecipientField?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 30) {
                ComposeStepHeader(
                    title: "To whom?",
                    subtitle: "Every letter needs someone waiting at the other end of time."
                )
                recipientCards
                addressBlock
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focusedField = nil }
            }
        }
    }

    private var recipientCards: some View {
        VStack(spacing: 14) {
            ComposeRecipientCard(
                symbol: "hourglass",
                title: "Future Me",
                caption: "A letter to the person you are becoming.",
                isSelected: draft.recipientKind == .myself
            ) {
                select(.myself)
            }
            ComposeRecipientCard(
                symbol: "heart",
                title: "Someone dear",
                caption: "For a friend, a love, a child — opened only on the day you choose.",
                isSelected: draft.recipientKind == .someone
            ) {
                select(.someone)
            }
        }
    }

    private var addressBlock: some View {
        VStack(alignment: .leading, spacing: 4) {
            if draft.recipientKind == .someone {
                ComposeLineField("To") {
                    TextField("Their name", text: $draft.recipientName, prompt: fieldPrompt("Their name"))
                        .font(theme.display(24))
                        .foregroundStyle(theme.ink)
                        .textContentType(.name)
                        .submitLabel(.next)
                        .focused($focusedField, equals: .recipient)
                        .onSubmit { focusedField = .sender }
                }
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
            ComposeLineField("From") {
                TextField("Your name", text: $draft.senderName, prompt: fieldPrompt("Your name"))
                    .font(theme.display(24))
                    .foregroundStyle(theme.ink)
                    .textContentType(.name)
                    .submitLabel(.done)
                    .focused($focusedField, equals: .sender)
                    .onSubmit { focusedField = nil }
            }
            Text("This is how your letter will be signed.")
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .padding(.top, 10)
        }
    }

    private func fieldPrompt(_ key: LocalizedStringKey) -> Text {
        Text(key).foregroundStyle(theme.inkSecondary.opacity(0.6))
    }

    private func select(_ kind: RecipientKind) {
        guard draft.recipientKind != kind else { return }
        Haptics.tap()
        withAnimation(.smooth(duration: 0.4)) {
            draft.recipientKind = kind
        }
        if kind == .someone, draft.trimmedRecipientName.isEmpty {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(380))
                focusedField = .recipient
            }
        }
    }
}

private enum ComposeRecipientField: Hashable {
    case recipient
    case sender
}

private struct ComposeRecipientCard: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let title: LocalizedStringKey
    let caption: LocalizedStringKey
    let isSelected: Bool
    let action: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: theme.cornerRadius, style: .continuous)
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 18) {
                badge
                VStack(alignment: .leading, spacing: 6) {
                    Text(title)
                        .font(theme.display(24))
                        .foregroundStyle(theme.ink)
                    Text(caption)
                        .font(theme.body(15))
                        .foregroundStyle(theme.inkSecondary)
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                checkmark
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .themedCard(padding: 22)
            .overlay {
                shape.strokeBorder(theme.accent, lineWidth: isSelected ? 1.5 : 0)
            }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .scaleEffect(isSelected ? 1 : 0.98)
        .opacity(isSelected ? 1 : 0.8)
        .animation(.spring(response: 0.4, dampingFraction: 0.78), value: isSelected)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var badge: some View {
        Image(systemName: symbol)
            .font(.system(size: 20, weight: .light))
            .foregroundStyle(isSelected ? theme.accentInk : theme.accent)
            .symbolEffect(.bounce, value: isSelected)
            .frame(width: 50, height: 50)
            .background {
                Circle().fill(isSelected ? theme.accent : theme.accent.opacity(0.12))
            }
    }

    private var checkmark: some View {
        ZStack {
            Circle().strokeBorder(theme.ink.opacity(0.2), lineWidth: 1)
            if isSelected {
                Circle().fill(theme.accent)
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                    .foregroundStyle(theme.accentInk)
            }
        }
        .frame(width: 24, height: 24)
    }
}

// MARK: - 1 · Write

struct ComposeWriteStep: View {
    @Bindable var draft: ComposeDraft
    /// True while the letter itself has keyboard focus: the page clears away
    /// everything else and the flow hides its bottom bar.
    @Binding var isEditingLetter: Bool

    @Environment(\.theme) private var theme
    @FocusState private var focus: ComposeWriteField?
    @State private var promptIndex = Int.random(in: 0..<ComposeSpark.prompts.count)

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 26) {
                    if !isEditingLetter {
                        preamble
                            .transition(.opacity.combined(with: .offset(y: -12)))
                    }
                    letterPaper(height: paperHeight(available: proxy.size.height))
                }
                .padding(.horizontal, 24)
                .padding(.top, isEditingLetter ? 4 : 14)
                .padding(.bottom, isEditingLetter ? 8 : 32)
            }
            .scrollIndicators(.hidden)
            // While writing, the paper exactly fills the page, so only the editor scrolls.
            // (`scrollDisabled` would propagate to the TextEditor as well.)
            .scrollBounceBehavior(.basedOnSize)
            .scrollDismissesKeyboard(.interactively)
        }
        .animation(.smooth(duration: 0.4), value: isEditingLetter)
        .onChange(of: focus) { _, newValue in
            isEditingLetter = newValue == .letter
        }
        .onAppear {
            // Coming back to this page: show the prompt that was kept, not a new one.
            if let kept = ComposeSpark.prompts.firstIndex(of: draft.prompt) {
                promptIndex = kept
            }
        }
        .onDisappear {
            isEditingLetter = false
        }
        .toolbar {
            ToolbarItemGroup(placement: .keyboard) {
                Spacer()
                Button("Done") { focus = nil }
            }
        }
    }

    private var preamble: some View {
        VStack(alignment: .leading, spacing: 26) {
            ComposeStepHeader(
                title: "Write",
                subtitle: "Take your time. The future is a patient reader."
            )
            titleField
            moodRow
            sparkCard
        }
    }

    // MARK: Title

    private var titleField: some View {
        VStack(alignment: .leading, spacing: 10) {
            TextField(
                "Title",
                text: $draft.title,
                prompt: Text("Give this letter a name").foregroundStyle(theme.inkSecondary.opacity(0.6))
            )
            .font(theme.display(26))
            .foregroundStyle(theme.ink)
            .submitLabel(.next)
            .focused($focus, equals: .title)
            .onSubmit { focus = .letter }
            Rectangle()
                .fill(focus == .title ? theme.accent : theme.ink.opacity(0.16))
                .frame(height: focus == .title ? 1.2 : 0.75)
                .animation(.smooth(duration: 0.25), value: focus)
        }
    }

    // MARK: Mood

    private var moodRow: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 0) {
                ForEach(ComposeMood.all) { mood in
                    moodButton(mood)
                        .frame(maxWidth: .infinity)
                }
            }
            Text(moodCaption)
                .font(theme.body(14))
                .italic()
                .foregroundStyle(theme.inkSecondary)
                .contentTransition(.opacity)
                .animation(.smooth(duration: 0.3), value: draft.mood)
        }
    }

    private var moodCaption: LocalizedStringKey {
        ComposeMood.all.first(where: { $0.emoji == draft.mood })?.caption ?? "How does today feel?"
    }

    private func moodButton(_ mood: ComposeMood) -> some View {
        let isSelected = draft.mood == mood.emoji
        let isDimmed = !draft.mood.isEmpty && !isSelected
        return Button {
            Haptics.tap()
            withAnimation(.spring(response: 0.32, dampingFraction: 0.62)) {
                draft.mood = isSelected ? "" : mood.emoji
            }
        } label: {
            Text(mood.emoji)
                .font(.system(size: 19))
                .frame(width: 38, height: 38)
                .background {
                    Circle().fill(isSelected ? theme.accent.opacity(0.2) : theme.surface)
                }
                .overlay {
                    Circle().strokeBorder(
                        isSelected ? theme.accent : theme.surfaceStroke,
                        lineWidth: isSelected ? 1.5 : 0.5
                    )
                }
                .scaleEffect(isSelected ? 1.12 : 1)
                .opacity(isDimmed ? 0.5 : 1)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(mood.caption))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    // MARK: Spark

    private var currentPrompt: String {
        let prompts = ComposeSpark.prompts
        return prompts[promptIndex % prompts.count]
    }

    private var sparkCard: some View {
        let isKept = !draft.prompt.isEmpty && draft.prompt == currentPrompt
        return VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
                ComposeOverline("Need a spark?")
                Spacer(minLength: 8)
                shuffleButton
            }
            ZStack(alignment: .topLeading) {
                Text(currentPrompt)
                    .font(theme.body(19))
                    .italic()
                    .foregroundStyle(theme.ink)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .id(promptIndex)
                    .transition(.opacity.combined(with: .offset(y: 8)))
            }
            HStack(spacing: 10) {
                ComposeSparkAction(
                    title: "Begin with it",
                    symbol: "text.quote",
                    isActive: false,
                    action: beginWithPrompt
                )
                ComposeSparkAction(
                    title: isKept ? "Kept as prompt" : "Keep as prompt",
                    symbol: isKept ? "bookmark.fill" : "bookmark",
                    isActive: isKept,
                    action: keepPrompt
                )
            }
        }
        .themedCard(padding: 18)
    }

    private var shuffleButton: some View {
        Button(action: shufflePrompt) {
            Image(systemName: "shuffle")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.ink)
                .symbolEffect(.bounce, value: promptIndex)
                .frame(width: 34, height: 34)
                .background { Circle().fill(theme.ink.opacity(0.06)) }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Another prompt"))
    }

    private func shufflePrompt() {
        Haptics.soft()
        withAnimation(.smooth(duration: 0.45)) {
            // A stride coprime with the number of prompts visits every one before repeating.
            promptIndex = (promptIndex + ComposeSpark.stride) % ComposeSpark.prompts.count
        }
    }

    /// Places the prompt as a quotation at the top of the letter and starts writing.
    private func beginWithPrompt() {
        let prompt = currentPrompt
        let quote = "“\(prompt)”"
        if !draft.message.hasPrefix(quote) {
            draft.message = draft.message.isEmpty ? quote + "\n\n" : quote + "\n\n" + draft.message
        }
        draft.prompt = prompt
        Haptics.tap()
        focus = .letter
    }

    /// Keeps the prompt with the letter (shown to the reader) without quoting it.
    private func keepPrompt() {
        let prompt = currentPrompt
        Haptics.tap()
        withAnimation(.smooth(duration: 0.3)) {
            draft.prompt = draft.prompt == prompt ? "" : prompt
        }
    }

    // MARK: Letter

    private func paperHeight(available: CGFloat) -> CGFloat {
        if isEditingLetter {
            return max(available - 12, 200)
        }
        return max(available * 0.78, 400)
    }

    private var letterPlaceholder: LocalizedStringKey {
        if draft.recipientKind == .someone {
            return "Dear \(draft.displayRecipient),"
        }
        return "Dear future me,"
    }

    private func letterPaper(height: CGFloat) -> some View {
        let shape = RoundedRectangle(cornerRadius: max(theme.cornerRadius, 14), style: .continuous)
        return ZStack(alignment: .topLeading) {
            StationeryView()
            if draft.message.isEmpty {
                Text(letterPlaceholder)
                    .font(theme.body(18))
                    .foregroundStyle(theme.inkSecondary.opacity(0.75))
                    .padding(.horizontal, 33)
                    .padding(.top, 36)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
            TextEditor(text: $draft.message)
                .font(theme.body(18))
                .lineSpacing(9)
                .foregroundStyle(theme.ink)
                .scrollContentBackground(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .focused($focus, equals: .letter)
                .padding(.horizontal, 28)
                .padding(.top, 28)
                .padding(.bottom, 36)
                .accessibilityLabel(Text("Letter"))
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(theme.surfaceStroke, lineWidth: 0.5)
        }
        .overlay(alignment: .bottomTrailing) {
            wordCountLabel
        }
        .shadow(color: Color.black.opacity(0.14), radius: 22, y: 12)
    }

    @ViewBuilder
    private var wordCountLabel: some View {
        let count = wordCount
        if count > 0 {
            Text("^[\(count) word](inflect: true)")
                .font(theme.label(11))
                .monospacedDigit()
                .foregroundStyle(theme.inkSecondary)
                .padding(.horizontal, 16)
                .padding(.vertical, 12)
                .allowsHitTesting(false)
        }
    }

    /// Word-aware for every language (CJK text is segmented by the system).
    private var wordCount: Int {
        let text = draft.message
        var count = 0
        text.enumerateSubstrings(
            in: text.startIndex..<text.endIndex,
            options: [.byWords, .substringNotRequired]
        ) { _, _, _, _ in
            count += 1
        }
        return count
    }
}

private enum ComposeWriteField: Hashable {
    case title
    case letter
}

private struct ComposeMood: Identifiable {
    let emoji: String
    let caption: LocalizedStringKey

    var id: String { emoji }

    static var all: [ComposeMood] {
        [
            ComposeMood(emoji: "😌", caption: "Feeling calm"),
            ComposeMood(emoji: "🥹", caption: "Feeling tender"),
            ComposeMood(emoji: "😊", caption: "Feeling happy"),
            ComposeMood(emoji: "🥰", caption: "Feeling loved"),
            ComposeMood(emoji: "🌧️", caption: "Feeling wistful"),
            ComposeMood(emoji: "✨", caption: "Feeling hopeful"),
            ComposeMood(emoji: "🍵", caption: "Feeling cosy"),
            ComposeMood(emoji: "🌙", caption: "Feeling dreamy"),
        ]
    }
}

private enum ComposeSpark {
    /// Coprime with `prompts.count` (24), so shuffling walks through every prompt.
    static let stride = 7

    static let prompts: [String] = [
        String(localized: "What do you hope hasn't changed?"),
        String(localized: "Describe the view from where you are sitting right now."),
        String(localized: "What are you afraid of, and what would you tell that fear?"),
        String(localized: "Which song is on repeat these days?"),
        String(localized: "What small thing made you smile today?"),
        String(localized: "What do you want to forgive yourself for?"),
        String(localized: "Who do you miss right now, and why?"),
        String(localized: "What does an ordinary Tuesday look like for you?"),
        String(localized: "What are you proud of that nobody noticed?"),
        String(localized: "Which promise do you want your future self to keep?"),
        String(localized: "What would you like to ask the one reading this?"),
        String(localized: "What smells like home to you right now?"),
        String(localized: "What are you learning, slowly?"),
        String(localized: "If today had a colour, which would it be?"),
        String(localized: "What would you tell the you of one year ago?"),
        String(localized: "What do you hope you will have let go of?"),
        String(localized: "Who made your life lighter this month?"),
        String(localized: "What is the weather like — outside, and inside?"),
        String(localized: "Which dream are you quietly carrying?"),
        String(localized: "What do you want to remember about the people around you?"),
        String(localized: "What would you do with one completely free day?"),
        String(localized: "What do you believe now that you hope you still believe?"),
        String(localized: "Describe your room as if to a stranger, a hundred years from now."),
        String(localized: "Looking back at today, what will you be grateful for?"),
    ]
}

private struct ComposeSparkAction: View {
    @Environment(\.theme) private var theme
    let title: LocalizedStringKey
    let symbol: String
    let isActive: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: symbol)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .font(theme.label(12, weight: .medium))
            }
            .foregroundStyle(isActive ? theme.accentInk : theme.ink)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background {
                Capsule().fill(isActive ? theme.accent : theme.ink.opacity(0.06))
            }
            .overlay {
                Capsule().strokeBorder(theme.surfaceStroke, lineWidth: isActive ? 0 : 0.75)
            }
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
    }
}

// MARK: - 2 · Memories

struct ComposeMemoriesStep: View {
    let draft: ComposeDraft

    @Environment(\.theme) private var theme
    @State private var pickerItems: [PhotosPickerItem] = []
    @State private var showsCamera = false
    @State private var showsVoiceNote = false

    private let columns = [
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
        GridItem(.flexible(), spacing: 10),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                ComposeStepHeader(
                    title: "Memories",
                    subtitle: "Tuck in what words can't hold — today's light, a song you love, your voice saying hello."
                )
                sources
                gallery
            }
            .padding(.horizontal, 24)
            .padding(.top, 14)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
        .onChange(of: pickerItems) { _, items in
            guard !items.isEmpty else { return }
            Haptics.soft()
            draft.importPickerItems(items)
            pickerItems = []
        }
        .fullScreenCover(isPresented: $showsCamera) {
            cameraPicker
        }
        .sheet(isPresented: $showsVoiceNote) {
            ComposeVoiceNoteSheet { url in
                draft.addVoiceNote(at: url)
            }
            .screenTheme(theme)
        }
    }

    private var sources: some View {
        HStack(spacing: 12) {
            PhotosPicker(
                selection: $pickerItems,
                maxSelectionCount: 12,
                matching: .any(of: [.images, .videos])
            ) {
                ComposeSourceTile(symbol: "photo.on.rectangle.angled", title: "Photos & videos")
            }
            .buttonStyle(.plain)

            if CameraPicker.isAvailable {
                Button {
                    showsCamera = true
                } label: {
                    ComposeSourceTile(symbol: "camera", title: "Camera")
                }
                .buttonStyle(.plain)
            }

            Button {
                showsVoiceNote = true
            } label: {
                ComposeSourceTile(symbol: "waveform", title: "Voice note")
            }
            .buttonStyle(.plain)
        }
    }

    private var cameraPicker: some View {
        CameraPicker { output in
            showsCamera = false
            guard let output else { return }
            switch output {
            case .photo(let image):
                draft.addCameraPhoto(image)
            case .video(let url):
                draft.addMovie(at: url)
            }
        }
        .ignoresSafeArea()
    }

    private var gallery: some View {
        VStack(alignment: .leading, spacing: 14) {
            if draft.media.isEmpty {
                emptyGallery
                    .transition(.opacity)
            } else {
                galleryHeader
                LazyVGrid(columns: columns, spacing: 10) {
                    ForEach(draft.media) { item in
                        ComposeMediaTile(item: item, url: draft.fileURL(for: item)) {
                            remove(item)
                        }
                        .transition(.scale(scale: 0.85).combined(with: .opacity))
                    }
                }
            }
            if draft.importFailures > 0 {
                HStack(spacing: 6) {
                    Image(systemName: "exclamationmark.circle")
                    Text("Some memories couldn't be added.")
                }
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
                .transition(.opacity)
            }
        }
        .animation(.smooth(duration: 0.35), value: draft.media)
        .animation(.smooth(duration: 0.3), value: draft.importFailures)
    }

    private var galleryHeader: some View {
        HStack(alignment: .firstTextBaseline) {
            Text("^[\(draft.media.count) memory](inflect: true)")
                .font(theme.label(11, weight: .semibold))
                .tracking(2)
                .textCase(.uppercase)
                .foregroundStyle(theme.inkSecondary)
            Spacer()
            if draft.isImportingMedia {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                        .tint(theme.accent)
                    Text("Gathering…")
                        .font(theme.label(11))
                        .foregroundStyle(theme.inkSecondary)
                }
                .transition(.opacity)
            }
        }
    }

    private var emptyGallery: some View {
        VStack(spacing: 10) {
            Image(systemName: "photo.stack")
                .font(.system(size: 28, weight: .ultraLight))
                .foregroundStyle(theme.inkSecondary)
            Text("Nothing tucked in yet")
                .font(theme.display(20))
                .foregroundStyle(theme.ink)
            Text("Memories are optional — a letter can travel alone.")
                .font(theme.body(14))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 20)
        .background {
            RoundedRectangle(cornerRadius: theme.cornerRadius, style: .continuous)
                .strokeBorder(theme.ink.opacity(0.18), style: StrokeStyle(lineWidth: 1, dash: [5, 6]))
        }
    }

    private func remove(_ item: ComposeMediaItem) {
        Haptics.soft()
        withAnimation(.smooth(duration: 0.35)) {
            draft.removeMedia(item)
        }
    }
}

private struct ComposeSourceTile: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let title: LocalizedStringKey

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 22, weight: .light))
                .foregroundStyle(theme.accent)
                .frame(height: 28)
            Text(title)
                .font(theme.label(12, weight: .medium))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
                .lineLimit(2)
                .minimumScaleFactor(0.85)
        }
        .frame(maxWidth: .infinity, minHeight: 84)
        .themedCard(padding: 12)
        .contentShape(Rectangle())
    }
}

private struct ComposeMediaTile: View {
    @Environment(\.theme) private var theme
    let item: ComposeMediaItem
    let url: URL?
    let onRemove: () -> Void

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
    }

    var body: some View {
        Color.clear
            .aspectRatio(1, contentMode: .fit)
            .overlay { content }
            .clipShape(shape)
            .overlay { shape.strokeBorder(theme.surfaceStroke, lineWidth: 0.5) }
            .overlay(alignment: .bottomLeading) { durationBadge }
            .overlay(alignment: .topTrailing) { removeButton }
    }

    @ViewBuilder
    private var content: some View {
        if let url {
            MediaThumbnailView(url: url, kind: item.kind)
                .transition(.opacity)
        } else {
            ComposeLoadingTile(symbol: item.kind.symbolName)
        }
    }

    @ViewBuilder
    private var durationBadge: some View {
        if url != nil, item.kind != .photo, item.duration > 0 {
            Text(ComposeClock.string(from: item.duration))
                .font(.system(size: 10, weight: .semibold).monospacedDigit())
                .foregroundStyle(Color.white)
                .padding(.horizontal, 6)
                .padding(.vertical, 3)
                .background { Capsule().fill(Color.black.opacity(0.45)) }
                .padding(6)
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var removeButton: some View {
        if url != nil {
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.system(size: 9, weight: .bold))
                    .foregroundStyle(Color.white)
                    .frame(width: 22, height: 22)
                    .background { Circle().fill(Color.black.opacity(0.5)) }
                    .padding(6)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(Text("Remove"))
        }
    }
}

private struct ComposeLoadingTile: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let symbol: String
    @State private var glows = false

    var body: some View {
        ZStack {
            theme.surface
            theme.accent.opacity(glows ? 0.14 : 0.03)
            VStack(spacing: 8) {
                Image(systemName: symbol)
                    .font(.system(size: 16, weight: .light))
                    .foregroundStyle(theme.inkSecondary)
                ProgressView()
                    .controlSize(.small)
                    .tint(theme.accent)
            }
        }
        .onAppear {
            guard !reduceMotion else { return }
            withAnimation(.easeInOut(duration: 1.1).repeatForever(autoreverses: true)) {
                glows = true
            }
        }
        .accessibilityLabel(Text("Loading"))
    }
}

private enum ComposeClock {
    /// 83 → "1:23"
    static func string(from seconds: Double) -> String {
        let total = max(0, Int(seconds.rounded()))
        return String(format: "%d:%02d", total / 60, total % 60)
    }
}

// MARK: Voice note

private struct ComposeVoiceNoteSheet: View {
    let onSave: (URL) -> Void

    @Environment(\.dismiss) private var dismiss
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var recorder = VoiceRecorder()
    @State private var playback = AudioPlayback()
    @State private var recordedURL: URL?
    @State private var recordedDuration: TimeInterval = 0
    @State private var didSave = false

    var body: some View {
        ZStack {
            ThemeBackground()
            VStack(spacing: 0) {
                topRow
                header
                    .padding(.top, 4)
                Spacer(minLength: 20)
                clock
                ComposeWaveform(levels: recorder.levels, isLive: recorder.isRecording)
                    .frame(height: 110)
                    .padding(.top, 24)
                Spacer(minLength: 20)
                controls
                    .frame(minHeight: 190, alignment: .top)
            }
            .padding(.horizontal, 28)
            .padding(.top, 20)
            .padding(.bottom, 16)
        }
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
        .interactiveDismissDisabled(recorder.isRecording)
        .onChange(of: recorder.isRecording) { wasRecording, isRecording in
            // The recorder may stop on its own (e.g. at its maximum duration).
            if wasRecording, !isRecording, recordedURL == nil {
                collectRecording()
            }
        }
        .onChange(of: recorder.elapsed) { _, elapsed in
            if recorder.isRecording, elapsed >= recorder.maxDuration {
                collectRecording()
            }
        }
        .onDisappear(perform: cleanUp)
    }

    private var topRow: some View {
        HStack {
            Spacer()
            Button {
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(theme.ink)
                    .frame(width: 36, height: 36)
                    .background { Circle().fill(theme.ink.opacity(0.07)) }
                    .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .disabled(recorder.isRecording)
            .opacity(recorder.isRecording ? 0.3 : 1)
            .accessibilityLabel(Text("Close"))
        }
    }

    private var header: some View {
        VStack(spacing: 10) {
            Text("Voice note")
                .font(theme.display(30))
                .foregroundStyle(theme.ink)
            Text("Say hello to whoever opens this — a laugh, a song, the rain outside.")
                .font(theme.body(15))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var displayedSeconds: Double {
        recordedURL == nil ? recorder.elapsed : recordedDuration
    }

    private var clock: some View {
        VStack(spacing: 6) {
            Text(ComposeClock.string(from: displayedSeconds))
                .font(theme.display(56, weight: .light))
                .monospacedDigit()
                .foregroundStyle(theme.ink)
                .contentTransition(.numericText())
                .animation(.smooth(duration: 0.2), value: Int(displayedSeconds))
            clockCaption
                .font(theme.label(12))
                .foregroundStyle(theme.inkSecondary)
        }
    }

    private var clockCaption: Text {
        if recordedURL != nil {
            return Text("Ready to tuck in")
        }
        if recorder.isRecording {
            let limit = ComposeClock.string(from: recorder.maxDuration)
            return Text("of \(limit)")
        }
        return Text("Up to five minutes")
    }

    @ViewBuilder
    private var controls: some View {
        if recordedURL != nil {
            reviewControls
                .transition(.opacity.combined(with: .offset(y: 12)))
        } else {
            VStack(spacing: 16) {
                recordButton
                recordCaption
                    .font(theme.label(13))
                    .foregroundStyle(theme.inkSecondary)
                if recorder.permissionDenied {
                    permissionNote
                }
            }
            .transition(.opacity)
        }
    }

    private var recordCaption: Text {
        recorder.isRecording ? Text("Tap to finish") : Text("Tap to record")
    }

    private var recordButton: some View {
        Button(action: toggleRecording) {
            ZStack {
                if recorder.isRecording && !reduceMotion {
                    ComposeRecordingPulse(color: theme.seal)
                }
                Circle()
                    .strokeBorder(theme.ink.opacity(0.22), lineWidth: 2)
                RoundedRectangle(cornerRadius: recorder.isRecording ? 9 : 33, style: .continuous)
                    .fill(theme.seal)
                    .frame(
                        width: recorder.isRecording ? 30 : 66,
                        height: recorder.isRecording ? 30 : 66
                    )
            }
            .frame(width: 86, height: 86)
            .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .animation(.spring(response: 0.35, dampingFraction: 0.7), value: recorder.isRecording)
        .accessibilityLabel(recorder.isRecording ? Text("Stop recording") : Text("Start recording"))
    }

    private var permissionNote: some View {
        VStack(spacing: 8) {
            Text("Timeleaf needs the microphone to keep your voice.")
                .font(theme.body(14))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
            if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                Link("Open Settings", destination: settingsURL)
                    .font(theme.label(13, weight: .semibold))
                    .foregroundStyle(theme.accent)
            }
        }
        .padding(.top, 4)
    }

    private var reviewControls: some View {
        VStack(spacing: 20) {
            Button {
                playback.toggle()
            } label: {
                ZStack {
                    Circle()
                        .strokeBorder(theme.ink.opacity(0.14), lineWidth: 2)
                    Circle()
                        .trim(from: 0, to: playback.progress)
                        .stroke(theme.accent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                        .rotationEffect(.degrees(-90))
                        .padding(1)
                    Image(systemName: playback.isPlaying ? "pause.fill" : "play.fill")
                        .font(.system(size: 22))
                        .foregroundStyle(theme.ink)
                        .offset(x: playback.isPlaying ? 0 : 2)
                }
                .frame(width: 72, height: 72)
                .contentShape(Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(playback.isPlaying ? Text("Pause") : Text("Listen"))

            HStack(spacing: 12) {
                Button("Discard", action: discardRecording)
                    .buttonStyle(.themedSecondary)
                Button("Save", action: saveRecording)
                    .buttonStyle(.themedPrimary)
            }
        }
    }

    private func toggleRecording() {
        if recorder.isRecording {
            collectRecording()
        } else {
            Haptics.rigid()
            Task { await recorder.start() }
        }
    }

    private func collectRecording() {
        guard recordedURL == nil else { return }
        let duration = recorder.elapsed
        guard let url = recorder.stop() else { return }
        Haptics.soft()
        recordedDuration = duration
        playback.load(url)
        withAnimation(.smooth(duration: 0.4)) {
            recordedURL = url
        }
    }

    private func discardRecording() {
        playback.stop()
        if let url = recordedURL {
            try? FileManager.default.removeItem(at: url)
        }
        Haptics.soft()
        withAnimation(.smooth(duration: 0.4)) {
            recordedURL = nil
            recordedDuration = 0
        }
    }

    private func saveRecording() {
        guard let url = recordedURL else { return }
        playback.stop()
        didSave = true
        onSave(url)
        Haptics.success()
        dismiss()
    }

    private func cleanUp() {
        playback.stop()
        if recorder.isRecording {
            recorder.cancel()
        }
        if !didSave, let url = recordedURL {
            try? FileManager.default.removeItem(at: url)
        }
    }
}

/// A live waveform: the newest level on the right, older ones fading to the left.
private struct ComposeWaveform: View {
    @Environment(\.theme) private var theme
    let levels: [CGFloat]
    let isLive: Bool

    private static let barCount = 48

    var body: some View {
        let values = samples
        GeometryReader { proxy in
            HStack(alignment: .center, spacing: 3) {
                ForEach(0..<Self.barCount, id: \.self) { index in
                    Capsule()
                        .fill(theme.accent.opacity(barOpacity(at: index)))
                        .frame(height: barHeight(values[index], index: index, maxHeight: proxy.size.height))
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
        }
        .animation(.easeOut(duration: 0.12), value: levels)
        .accessibilityHidden(true)
    }

    private var samples: [CGFloat] {
        let recent = Array(levels.suffix(Self.barCount))
        let padding = Array(repeating: CGFloat(0), count: Self.barCount - recent.count)
        return padding + recent
    }

    private func barHeight(_ level: CGFloat, index: Int, maxHeight: CGFloat) -> CGFloat {
        // A softly undulating resting line, so silence still looks alive.
        let resting = CGFloat(0.04 + 0.03 * (1 + sin(Double(index) * 0.6)))
        let value = max(min(level, 1), resting)
        return max(3, value * maxHeight)
    }

    private func barOpacity(at index: Int) -> Double {
        let position = Double(index) / Double(Self.barCount - 1)
        return isLive ? 0.35 + 0.65 * position : 0.2 + 0.35 * position
    }
}

private struct ComposeRecordingPulse: View {
    let color: Color
    @State private var expanded = false

    var body: some View {
        Circle()
            .stroke(color, lineWidth: 1.5)
            .scaleEffect(expanded ? 1.4 : 1)
            .opacity(expanded ? 0 : 0.7)
            .onAppear {
                withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) {
                    expanded = true
                }
            }
            .allowsHitTesting(false)
    }
}

// MARK: - 3 · When

struct ComposeWhenStep: View {
    @Bindable var draft: ComposeDraft

    @Environment(\.theme) private var theme

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ComposeStepHeader(
                    title: "When should it arrive?",
                    subtitle: "Choose the day these words find their way back."
                )
                .padding(.horizontal, 24)
                presetRow
                journeyCard
                    .padding(.horizontal, 24)
                calendarCard
                    .padding(.horizontal, 24)
            }
            .padding(.top, 14)
            .padding(.bottom, 32)
        }
        .scrollIndicators(.hidden)
    }

    private var presetRow: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                ForEach(ComposeArrivalPreset.allCases) { preset in
                    presetChip(preset)
                }
            }
        }
        .contentMargins(.horizontal, 24, for: .scrollContent)
        .scrollIndicators(.hidden)
    }

    private func presetChip(_ preset: ComposeArrivalPreset) -> some View {
        let target = preset.date(from: .now, keepingTimeOf: draft.unlockDate)
        let isSelected = Calendar.current.isDate(target, inSameDayAs: draft.unlockDate)
        return Button {
            choose(target)
        } label: {
            Text(preset.title)
                .font(theme.label(14, weight: isSelected ? .semibold : .medium))
                .foregroundStyle(isSelected ? theme.accentInk : theme.ink)
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background {
                    Capsule().fill(isSelected ? theme.accent : theme.surface)
                }
                .overlay {
                    Capsule().strokeBorder(isSelected ? Color.clear : theme.surfaceStroke, lineWidth: 0.75)
                }
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var journeyCard: some View {
        let arrival = draft.unlockDate
        let duration = TimePhrase.duration(from: .now, to: arrival)
        let longDate = TimePhrase.longDate(arrival)
        let moment = TimePhrase.moment(arrival)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 8) {
                Image(systemName: "hourglass")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(theme.accent)
                ComposeOverline("The journey")
            }
            Text(moment)
                .font(theme.display(26))
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
            Text("This letter will travel for \(duration) — arriving on \(longDate).")
                .font(theme.body(16))
                .foregroundStyle(theme.inkSecondary)
                .lineSpacing(4)
                .fixedSize(horizontal: false, vertical: true)
                .contentTransition(.opacity)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .themedCard(padding: 22)
        .animation(.smooth(duration: 0.35), value: arrival)
    }

    private var calendarCard: some View {
        VStack(spacing: 6) {
            DatePicker(
                "Arrival date",
                selection: $draft.unlockDate,
                in: ComposeDraft.earliestUnlockDate...,
                displayedComponents: .date
            )
            .datePickerStyle(.graphical)

            Rectangle()
                .fill(theme.surfaceStroke)
                .frame(height: 0.5)

            HStack {
                Label("Arrives at", systemImage: "clock")
                    .font(theme.label(15))
                    .foregroundStyle(theme.ink)
                Spacer()
                DatePicker(
                    "Arrival time",
                    selection: $draft.unlockDate,
                    in: ComposeDraft.earliestUnlockDate...,
                    displayedComponents: .hourAndMinute
                )
                .labelsHidden()
            }
            .padding(.horizontal, 6)
            .padding(.vertical, 8)
        }
        .themedCard(padding: 12)
    }

    private func choose(_ date: Date) {
        Haptics.tap()
        withAnimation(.smooth(duration: 0.4)) {
            draft.unlockDate = max(date, ComposeDraft.earliestUnlockDate)
        }
    }
}

private enum ComposeArrivalPreset: CaseIterable, Identifiable {
    case oneMonth
    case sixMonths
    case oneYear
    case threeYears
    case fiveYears
    case tenYears
    case newYear

    var id: Self { self }

    var title: LocalizedStringKey {
        switch self {
        case .oneMonth: "1 month"
        case .sixMonths: "6 months"
        case .oneYear: "1 year"
        case .threeYears: "3 years"
        case .fiveYears: "5 years"
        case .tenYears: "10 years"
        case .newYear: "Next New Year's Day"
        }
    }

    /// The preset day, keeping the time of day already chosen
    /// (New Year's Day arrives at the very first moment of the year).
    func date(from now: Date, keepingTimeOf reference: Date) -> Date {
        let calendar = Calendar.current
        let today = calendar.startOfDay(for: now)
        let day: Date
        switch self {
        case .oneMonth: day = today.adding(.month, 1)
        case .sixMonths: day = today.adding(.month, 6)
        case .oneYear: day = today.adding(.year, 1)
        case .threeYears: day = today.adding(.year, 3)
        case .fiveYears: day = today.adding(.year, 5)
        case .tenYears: day = today.adding(.year, 10)
        case .newYear:
            let nextYear = calendar.component(.year, from: now) + 1
            let components = DateComponents(year: nextYear, month: 1, day: 1)
            return calendar.date(from: components) ?? today.adding(.year, 1)
        }
        let time = calendar.dateComponents([.hour, .minute], from: reference)
        return calendar.date(
            bySettingHour: time.hour ?? 9,
            minute: time.minute ?? 0,
            second: 0,
            of: day
        ) ?? day
    }
}

// MARK: - 4 · Style

struct ComposeStyleStep: View {
    let draft: ComposeDraft

    @Environment(\.theme) private var theme
    @State private var focusedStyle: ThemeID?

    init(draft: ComposeDraft) {
        self.draft = draft
        _focusedStyle = State(initialValue: draft.themeID)
    }

    var body: some View {
        GeometryReader { proxy in
            VStack(alignment: .leading, spacing: 0) {
                ComposeStepHeader(
                    title: "Choose its stationery",
                    subtitle: "Every letter is dressed for its journey. Swipe to find the one that feels like you."
                )
                .padding(.horizontal, 24)
                .padding(.top, 14)
                Spacer(minLength: 16)
                carousel(in: proxy.size)
                Spacer(minLength: 16)
                pageDots
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 12)
            }
        }
        .task(id: focusedStyle) {
            await commit(focusedStyle)
        }
        .onDisappear {
            // Leaving the page cancels the settle delay above; the style the carousel
            // rests on is still the one the letter is sealed with.
            if let focusedStyle, focusedStyle != draft.themeID {
                withAnimation(.smooth(duration: 0.8)) {
                    draft.themeID = focusedStyle
                }
            }
        }
    }

    private func carousel(in size: CGSize) -> some View {
        let cardWidth = max(min(size.width - 96, 320), 200)
        let cardHeight = max(min(size.height - 240, 470), 280)
        return ScrollViewReader { reader in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 16) {
                    ForEach(ThemeID.allCases, id: \.self) { styleID in
                        ComposeStylePreviewCard(
                            themeID: styleID,
                            monogram: draft.monogram,
                            isSelected: styleID == draft.themeID
                        )
                        .frame(width: cardWidth, height: cardHeight)
                        .onTapGesture { choose(styleID) }
                        .scrollTransition { content, phase in
                            content
                                .scaleEffect(phase.isIdentity ? 1 : 0.9)
                                .opacity(phase.isIdentity ? 1 : 0.55)
                        }
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, max((size.width - cardWidth) / 2, 0), for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollPosition(id: $focusedStyle)
            .scrollIndicators(.hidden)
            .frame(height: cardHeight + 24)
            .onAppear {
                // Start on the letter's current stationery, even deep inside the lazy stack.
                reader.scrollTo(draft.themeID, anchor: .center)
            }
        }
    }

    private var pageDots: some View {
        HStack(spacing: 7) {
            ForEach(ThemeID.allCases, id: \.self) { styleID in
                Capsule()
                    .fill(styleID == focusedStyle ? theme.accent : theme.ink.opacity(0.2))
                    .frame(width: styleID == focusedStyle ? 18 : 6, height: 6)
            }
        }
        .animation(.smooth(duration: 0.3), value: focusedStyle)
        .accessibilityHidden(true)
    }

    private func choose(_ styleID: ThemeID) {
        withAnimation(.smooth(duration: 0.5)) {
            focusedStyle = styleID
        }
    }

    /// Re-dresses the whole flow once the carousel settles on a style.
    private func commit(_ styleID: ThemeID?) async {
        guard let styleID, styleID != draft.themeID else { return }
        do {
            try await Task.sleep(for: .milliseconds(260))
        } catch {
            return
        }
        Haptics.soft()
        withAnimation(.smooth(duration: 0.8)) {
            draft.themeID = styleID
        }
    }
}

private struct ComposeStylePreviewCard: View {
    let themeID: ThemeID
    let monogram: String
    let isSelected: Bool

    var body: some View {
        ComposeStylePreviewFace(monogram: monogram, isSelected: isSelected)
            .theme(themeID.theme)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(isSelected ? [.isButton, .isSelected] : .isButton)
    }
}

private struct ComposeStylePreviewFace: View {
    @Environment(\.theme) private var theme
    let monogram: String
    let isSelected: Bool

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 30, style: .continuous)
    }

    var body: some View {
        ZStack {
            ThemeBackground()
            VStack(spacing: 0) {
                Spacer(minLength: 16)
                EnvelopeView(openProgress: 0, monogram: monogram)
                    .padding(.horizontal, 30)
                Spacer(minLength: 16)
                caption
            }
            .padding(.vertical, 28)
        }
        .clipShape(shape)
        .overlay {
            shape.strokeBorder(
                isSelected ? theme.accent : theme.surfaceStroke,
                lineWidth: isSelected ? 1.5 : 0.75
            )
        }
        .overlay(alignment: .topTrailing) {
            selectedMark
        }
        .shadow(color: Color.black.opacity(0.2), radius: 22, y: 12)
        .contentShape(shape)
    }

    private var caption: some View {
        VStack(spacing: 6) {
            Text(theme.nativeName)
                .font(theme.label(12, weight: .medium))
                .tracking(5)
                .foregroundStyle(theme.inkSecondary)
            Text(theme.name)
                .font(theme.display(32))
                .foregroundStyle(theme.ink)
            Text(theme.tagline)
                .font(theme.body(14))
                .italic()
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .lineLimit(3)
                .padding(.top, 2)
        }
        .padding(.horizontal, 22)
    }

    @ViewBuilder
    private var selectedMark: some View {
        if isSelected {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(theme.accentInk)
                .frame(width: 26, height: 26)
                .background { Circle().fill(theme.accent) }
                .padding(16)
                .transition(.scale.combined(with: .opacity))
        }
    }
}

// MARK: - Shared pieces

private struct ComposeStepHeader: View {
    @Environment(\.theme) private var theme
    let title: LocalizedStringKey
    let subtitle: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .font(theme.display(34))
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(theme.body(16))
                .foregroundStyle(theme.inkSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

private struct ComposeOverline: View {
    @Environment(\.theme) private var theme
    private let text: LocalizedStringKey

    init(_ text: LocalizedStringKey) {
        self.text = text
    }

    var body: some View {
        Text(text)
            .font(theme.label(11, weight: .semibold))
            .tracking(2)
            .textCase(.uppercase)
            .foregroundStyle(theme.inkSecondary)
    }
}

/// An envelope-style address line: a small-caps label and a hairline underline.
private struct ComposeLineField<Field: View>: View {
    @Environment(\.theme) private var theme
    private let label: LocalizedStringKey
    private let field: Field

    init(_ label: LocalizedStringKey, @ViewBuilder field: () -> Field) {
        self.label = label
        self.field = field()
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(label)
                .font(theme.label(11, weight: .semibold))
                .tracking(2)
                .textCase(.uppercase)
                .foregroundStyle(theme.inkSecondary)
                .frame(width: 52, alignment: .leading)
            field
        }
        .padding(.vertical, 12)
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.ink.opacity(0.18))
                .frame(height: 0.75)
        }
    }
}

// MARK: - Previews

#Preview("To whom") {
    NavigationStack {
        ComposeRecipientStep(draft: ComposeDraft(themeID: .parchment, senderName: "Bruce"))
            .background(ThemeBackground())
    }
    .screenTheme(ThemeID.parchment.theme)
}

#Preview("Write") {
    NavigationStack {
        ComposeWriteStep(
            draft: ComposeDraft(themeID: .inkwash, senderName: "Bruce"),
            isEditingLetter: .constant(false)
        )
        .background(ThemeBackground())
    }
    .screenTheme(ThemeID.inkwash.theme)
}

#Preview("Memories") {
    ComposeMemoriesStep(draft: ComposeDraft(themeID: .aurora, senderName: "Bruce"))
        .background(ThemeBackground())
        .screenTheme(ThemeID.aurora.theme)
}

#Preview("When") {
    ComposeWhenStep(draft: ComposeDraft(themeID: .celestial, senderName: "Bruce"))
        .background(ThemeBackground())
        .screenTheme(ThemeID.celestial.theme)
}

#Preview("Style") {
    ComposeStyleStep(draft: ComposeDraft(themeID: .blossom, senderName: "Bruce"))
        .background(ThemeBackground())
        .screenTheme(ThemeID.blossom.theme)
}

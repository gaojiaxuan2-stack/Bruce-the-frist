import SwiftUI
import SwiftData
import PhotosUI
import UniformTypeIdentifiers
import Observation
import UIKit

// MARK: - ComposeFlowView

/// The full-screen journey of writing a letter to the future:
/// To whom → Write → Memories → When → Style → Seal.
///
/// The whole flow is dressed in the stationery the author picks, so changing the
/// style on step five re-dresses every page with a gentle cross-fade.
/// Inserts and seals the capsule itself; calls `onFinish(nil)` when cancelled.
struct ComposeFlowView: View {
    private let onFinish: (TimeCapsule?) -> Void

    @State private var draft: ComposeDraft
    @State private var step: ComposeFlowStep = .recipient
    @State private var isMovingForward = true
    @State private var isEditingLetter = false
    @State private var showsDiscardDialog = false

    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    init(onFinish: @escaping (TimeCapsule?) -> Void) {
        self.onFinish = onFinish
        // The same store `@AppStorage(SettingsKey.theme / .userName)` reads from:
        // the letter starts in the app's style, signed with the author's name.
        let defaults = UserDefaults.standard
        let themeID = defaults.string(forKey: SettingsKey.theme).flatMap(ThemeID.init(rawValue:)) ?? .aurora
        let senderName = defaults.string(forKey: SettingsKey.userName) ?? ""
        _draft = State(initialValue: ComposeDraft(themeID: themeID, senderName: senderName))
    }

    private var theme: Theme { draft.themeID.theme }

    var body: some View {
        NavigationStack {
            ZStack {
                ThemeBackground()
                VStack(spacing: 0) {
                    if showsTopBar {
                        topBar
                            .transition(.opacity)
                    }
                    stepContainer
                    if showsBottomBar {
                        bottomBar
                            .transition(.opacity.combined(with: .move(edge: .bottom)))
                    }
                }
            }
            .animation(.smooth(duration: 0.4), value: showsTopBar)
            .animation(.smooth(duration: 0.3), value: showsBottomBar)
            .toolbar(.hidden, for: .navigationBar)
            .confirmationDialog(
                "Discard this letter?",
                isPresented: $showsDiscardDialog,
                titleVisibility: .visible
            ) {
                Button("Discard", role: .destructive) { discardAndClose() }
                Button("Keep writing", role: .cancel) {}
            } message: {
                Text("Your words and the memories you added will be erased.")
            }
        }
        .screenTheme(theme)
    }

    // MARK: Chrome

    private var showsTopBar: Bool {
        !draft.isSealing && draft.sealedCapsule == nil
    }

    private var showsBottomBar: Bool {
        showsTopBar && !isEditingLetter
    }

    private var topBar: some View {
        HStack(alignment: .center, spacing: 18) {
            ComposeFlowIconButton(symbol: "xmark", label: "Close", action: requestClose)
            ComposeFlowStepIndicator(
                index: step.rawValue,
                count: ComposeFlowStep.allCases.count,
                title: step.title
            )
        }
        .padding(.horizontal, 20)
        .padding(.top, 8)
        .padding(.bottom, 10)
    }

    private var bottomBar: some View {
        HStack(spacing: 14) {
            if step != .recipient {
                ComposeFlowIconButton(symbol: "chevron.left", label: "Back", size: 54, action: goBack)
                    .transition(.opacity.combined(with: .scale(scale: 0.85)))
            }
            if step == .seal {
                Spacer(minLength: 0)
            } else {
                continueButton
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 10)
        .padding(.bottom, 12)
        .animation(.smooth(duration: 0.3), value: step)
    }

    private var continueButton: some View {
        Button(action: goForward) {
            HStack(spacing: 10) {
                Text(continueTitle)
                Image(systemName: "arrow.right")
                    .font(.system(size: 14, weight: .semibold))
            }
        }
        .buttonStyle(.themedPrimary)
        .disabled(!canContinue)
        .opacity(canContinue ? 1 : 0.5)
        .animation(.smooth(duration: 0.25), value: canContinue)
    }

    private var continueTitle: LocalizedStringKey {
        switch step {
        case .memories:
            if draft.isImportingMedia { return "Gathering…" }
            if draft.media.isEmpty { return "Skip for now" }
            return "Continue"
        case .style:
            return "Ready to seal"
        default:
            return "Continue"
        }
    }

    private var canContinue: Bool {
        switch step {
        case .recipient: return draft.isRecipientComplete
        case .write: return draft.hasWords
        case .memories: return !draft.isImportingMedia
        case .when: return draft.unlockDate > Date.now
        case .style: return true
        case .seal: return false
        }
    }

    // MARK: Steps

    private var stepContainer: some View {
        ZStack {
            stepView(for: step)
                .id(step)
                .transition(stepTransition)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private func stepView(for step: ComposeFlowStep) -> some View {
        switch step {
        case .recipient:
            ComposeRecipientStep(draft: draft)
        case .write:
            ComposeWriteStep(draft: draft, isEditingLetter: $isEditingLetter)
        case .memories:
            ComposeMemoriesStep(draft: draft)
        case .when:
            ComposeWhenStep(draft: draft)
        case .style:
            ComposeStyleStep(draft: draft)
        case .seal:
            ComposeSealCeremonyView(draft: draft) { capsule in
                finish(with: capsule)
            }
        }
    }

    /// An asymmetric push: the new page drifts in from the direction of travel
    /// while the old one drifts away, both fading.
    private var stepTransition: AnyTransition {
        let distance: CGFloat = reduceMotion ? 0 : 56
        let direction: CGFloat = isMovingForward ? 1 : -1
        return .asymmetric(
            insertion: .offset(x: distance * direction).combined(with: .opacity),
            removal: .offset(x: -distance * direction).combined(with: .opacity)
        )
    }

    private var stepAnimation: Animation {
        reduceMotion ? .easeInOut(duration: 0.25) : .smooth(duration: 0.55)
    }

    // MARK: Navigation

    private func goForward() {
        guard canContinue, let next = ComposeFlowStep(rawValue: step.rawValue + 1) else { return }
        Haptics.tap()
        move(to: next)
    }

    private func goBack() {
        guard let previous = ComposeFlowStep(rawValue: step.rawValue - 1) else { return }
        Haptics.soft()
        move(to: previous)
    }

    private func move(to target: ComposeFlowStep) {
        guard target != step else { return }
        let forward = target.rawValue > step.rawValue
        if forward == isMovingForward {
            withAnimation(stepAnimation) { step = target }
        } else {
            // The outgoing page keeps the transition it was last rendered with,
            // so flip the direction first and move on the next frame.
            isMovingForward = forward
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(24))
                withAnimation(stepAnimation) { step = target }
            }
        }
    }

    private func requestClose() {
        if draft.hasContent {
            Haptics.soft()
            showsDiscardDialog = true
        } else {
            discardAndClose()
        }
    }

    private func discardAndClose() {
        draft.discard()
        onFinish(nil)
        dismiss()
    }

    private func finish(with capsule: TimeCapsule) {
        onFinish(capsule)
        dismiss()
    }
}

// MARK: - Flow steps

private enum ComposeFlowStep: Int, CaseIterable, Hashable {
    case recipient
    case write
    case memories
    case when
    case style
    case seal

    var title: LocalizedStringKey {
        switch self {
        case .recipient: "Recipient"
        case .write: "Write"
        case .memories: "Memories"
        case .when: "Arrival"
        case .style: "Stationery"
        case .seal: "Seal"
        }
    }
}

// MARK: - Chrome pieces

/// A thin segmented line with the step's name — quiet, like a page number.
private struct ComposeFlowStepIndicator: View {
    @Environment(\.theme) private var theme
    let index: Int
    let count: Int
    let title: LocalizedStringKey

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(alignment: .firstTextBaseline) {
                Text(title)
                    .font(theme.label(11, weight: .semibold))
                    .tracking(2.4)
                    .textCase(.uppercase)
                    .foregroundStyle(theme.ink)
                    .contentTransition(.opacity)
                Spacer(minLength: 8)
                Text("\(index + 1) of \(count)")
                    .font(theme.label(11))
                    .monospacedDigit()
                    .foregroundStyle(theme.inkSecondary)
                    .contentTransition(.numericText())
            }
            segments
        }
        .animation(.smooth(duration: 0.45), value: index)
        .accessibilityElement(children: .combine)
    }

    private var segments: some View {
        HStack(spacing: 5) {
            ForEach(0..<count, id: \.self) { position in
                Capsule()
                    .fill(position <= index ? theme.accent : theme.ink.opacity(0.14))
                    .frame(height: position == index ? 3 : 2)
            }
        }
        .frame(height: 3)
    }
}

/// A round, hairline-bordered icon button used for Close and Back.
private struct ComposeFlowIconButton: View {
    @Environment(\.theme) private var theme
    let symbol: String
    let label: LocalizedStringKey
    var size: CGFloat = 40
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: symbol)
                .font(.system(size: size * 0.34, weight: .semibold))
                .foregroundStyle(theme.ink)
                .frame(width: size, height: size)
                .background { circleFill }
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text(label))
    }

    private var circleFill: some View {
        ZStack {
            if theme.usesMaterial {
                Circle().fill(.ultraThinMaterial)
            }
            Circle().fill(theme.surface)
            Circle().strokeBorder(theme.surfaceStroke, lineWidth: 0.75)
        }
    }
}

// MARK: - Draft model

/// One memory being tucked into the letter. `fileName == nil` while it is still loading.
struct ComposeMediaItem: Identifiable, Equatable {
    let id: UUID
    let kind: MediaKind
    var fileName: String?
    var duration: Double

    var isReady: Bool { fileName != nil }
}

private enum ComposeImportError: Error {
    case unreadable
}

/// Everything the author has written so far. Media files are saved immediately under
/// the pre-generated capsule id, so sealing only has to create the model objects.
@MainActor
@Observable
final class ComposeDraft {
    /// The future capsule's id; media live in `MediaStore.directory(for: id)`.
    let id: UUID
    let createdAt: Date

    var recipientKind: RecipientKind = .myself
    var recipientName = ""
    var senderName: String
    var title = ""
    var message = ""
    var mood = ""
    var prompt = ""
    var unlockDate: Date
    var themeID: ThemeID
    var media: [ComposeMediaItem] = []
    /// Number of memories that could not be added in the latest import.
    var importFailures = 0

    /// True from the moment the seal is stamped (chrome hides, cancel is no longer possible).
    var isSealing = false
    /// The inserted capsule, once sealed.
    var sealedCapsule: TimeCapsule?

    private(set) var isDiscarded = false

    init(id: UUID = UUID(), themeID: ThemeID = .aurora, senderName: String = "", now: Date = .now) {
        self.id = id
        self.createdAt = now
        self.themeID = themeID
        self.senderName = senderName
        self.unlockDate = ComposeDraft.defaultUnlockDate(from: now)
    }

    // MARK: Dates

    /// A year from today, in the soft light of nine in the morning.
    static func defaultUnlockDate(from now: Date) -> Date {
        let calendar = Calendar.current
        let day = calendar.startOfDay(for: now).adding(.year, 1)
        return calendar.date(bySettingHour: 9, minute: 0, second: 0, of: day) ?? day
    }

    /// Letters may arrive tomorrow at the earliest.
    static var earliestUnlockDate: Date {
        Calendar.current.startOfDay(for: .now).adding(.day, 1)
    }

    // MARK: Derived text

    var trimmedTitle: String { title.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedMessage: String { message.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedRecipientName: String { recipientName.trimmingCharacters(in: .whitespacesAndNewlines) }
    var trimmedSenderName: String { senderName.trimmingCharacters(in: .whitespacesAndNewlines) }

    /// "To …" — mirrors `TimeCapsule.displayRecipient`.
    var displayRecipient: String {
        switch recipientKind {
        case .myself:
            return String(localized: "Future Me")
        case .someone:
            let name = trimmedRecipientName
            return name.isEmpty ? String(localized: "Someone dear") : name
        }
    }

    /// The title the capsule will carry; never empty.
    var resolvedTitle: String {
        let title = trimmedTitle
        if !title.isEmpty { return title }
        let recipient = displayRecipient
        return String(localized: "A letter to \(recipient)")
    }

    /// Mirrors `TimeCapsule.monogram` for an outgoing letter.
    var monogram: String {
        Monogram.make(from: recipientKind == .myself ? senderName : recipientName)
    }

    // MARK: Validation

    var isRecipientComplete: Bool {
        recipientKind == .myself || !trimmedRecipientName.isEmpty
    }

    var hasWords: Bool {
        !trimmedTitle.isEmpty || !trimmedMessage.isEmpty
    }

    var isImportingMedia: Bool {
        media.contains { !$0.isReady }
    }

    /// Whether closing should ask before throwing the letter away.
    var hasContent: Bool {
        hasWords || !mood.isEmpty || !prompt.isEmpty || !media.isEmpty || !trimmedRecipientName.isEmpty
    }

    // MARK: Media

    func fileURL(for item: ComposeMediaItem) -> URL? {
        guard let fileName = item.fileName else { return nil }
        return MediaStore.url(capsuleID: id, fileName: fileName)
    }

    /// Photos and videos chosen in the PhotosPicker, kept in the order they were picked.
    func importPickerItems(_ items: [PhotosPickerItem]) {
        importFailures = 0
        for item in items {
            let isMovie = item.supportedContentTypes.contains { $0.conforms(to: .movie) }
            let placeholder = appendPlaceholder(kind: isMovie ? .video : .photo)
            Task {
                if isMovie {
                    await self.loadMovie(from: item, placeholder: placeholder)
                } else {
                    await self.loadPhoto(from: item, placeholder: placeholder)
                }
            }
        }
    }

    func addCameraPhoto(_ image: UIImage) {
        importFailures = 0
        let placeholder = appendPlaceholder(kind: .photo)
        let capsuleID = id
        Task {
            do {
                let fileName = try await Task.detached(priority: .userInitiated) { () throws -> String in
                    guard let jpeg = MediaStore.jpegData(from: image) else { throw ComposeImportError.unreadable }
                    return try MediaStore.save(jpeg, capsuleID: capsuleID, fileExtension: "jpg")
                }.value
                self.completeImport(placeholder, fileName: fileName, duration: 0)
            } catch {
                self.failImport(placeholder)
            }
        }
    }

    /// A video file owned by the caller (e.g. from the camera); it is moved into the capsule.
    func addMovie(at url: URL) {
        importFailures = 0
        let placeholder = appendPlaceholder(kind: .video)
        Task { await self.storeFile(at: url, placeholder: placeholder) }
    }

    /// A finished voice recording; the temp file is moved into the capsule.
    func addVoiceNote(at url: URL) {
        importFailures = 0
        let placeholder = appendPlaceholder(kind: .audio)
        Task { await self.storeFile(at: url, placeholder: placeholder) }
    }

    func removeMedia(_ item: ComposeMediaItem) {
        guard let fileName = item.fileName else { return }
        MediaStore.delete(fileName: fileName, capsuleID: id)
        media.removeAll { $0.id == item.id }
    }

    /// Cancelled: forget everything, including files already saved.
    func discard() {
        isDiscarded = true
        media.removeAll()
        MediaStore.deleteAll(for: id)
    }

    private func appendPlaceholder(kind: MediaKind) -> UUID {
        let item = ComposeMediaItem(id: UUID(), kind: kind, fileName: nil, duration: 0)
        withAnimation(.smooth(duration: 0.35)) {
            media.append(item)
        }
        return item.id
    }

    private func loadPhoto(from item: PhotosPickerItem, placeholder: UUID) async {
        do {
            guard let data = try await item.loadTransferable(type: Data.self) else {
                failImport(placeholder)
                return
            }
            let fileName = try await ComposeDraft.storeImageData(data, capsuleID: id)
            completeImport(placeholder, fileName: fileName, duration: 0)
        } catch {
            failImport(placeholder)
        }
    }

    private func loadMovie(from item: PhotosPickerItem, placeholder: UUID) async {
        do {
            guard let movie = try await item.loadTransferable(type: PickedMovie.self) else {
                failImport(placeholder)
                return
            }
            await storeFile(at: movie.url, placeholder: placeholder)
        } catch {
            failImport(placeholder)
        }
    }

    private func storeFile(at url: URL, placeholder: UUID) async {
        do {
            let fileName = try MediaStore.moveFile(at: url, capsuleID: id)
            let duration = await MediaStore.duration(of: MediaStore.url(capsuleID: id, fileName: fileName))
            completeImport(placeholder, fileName: fileName, duration: duration)
        } catch {
            failImport(placeholder)
        }
    }

    /// Decodes, orients, downsizes and saves a photo off the main thread.
    private static func storeImageData(_ data: Data, capsuleID: UUID) async throws -> String {
        try await Task.detached(priority: .userInitiated) { () throws -> String in
            guard let image = UIImage(data: data),
                  let jpeg = MediaStore.jpegData(from: image) else {
                throw ComposeImportError.unreadable
            }
            return try MediaStore.save(jpeg, capsuleID: capsuleID, fileExtension: "jpg")
        }.value
    }

    private func completeImport(_ placeholder: UUID, fileName: String, duration: Double) {
        guard !isDiscarded,
              sealedCapsule == nil,
              let index = media.firstIndex(where: { $0.id == placeholder }) else {
            // The letter was let go while this memory was still on its way.
            MediaStore.delete(fileName: fileName, capsuleID: id)
            return
        }
        withAnimation(.smooth(duration: 0.4)) {
            media[index].fileName = fileName
            media[index].duration = duration
        }
    }

    private func failImport(_ placeholder: UUID) {
        withAnimation(.smooth(duration: 0.3)) {
            media.removeAll { $0.id == placeholder }
        }
        if !isDiscarded {
            importFailures += 1
        }
    }

    // MARK: Sealing

    /// Creates the capsule and its media entries and inserts them into `context`
    /// (not saved — `CapsuleActions.seal` saves and schedules the notification).
    func insertCapsule(into context: ModelContext) -> TimeCapsule {
        let capsule = TimeCapsule(
            id: id,
            title: resolvedTitle,
            message: trimmedMessage,
            createdAt: createdAt,
            unlockDate: unlockDate,
            theme: themeID,
            recipientKind: recipientKind,
            recipientName: recipientKind == .someone ? trimmedRecipientName : "",
            senderName: trimmedSenderName,
            mood: mood,
            prompt: prompt
        )
        context.insert(capsule)

        var sortIndex = 0
        for item in media {
            guard let fileName = item.fileName else { continue }
            let entry = CapsuleMedia(kind: item.kind, fileName: fileName, sortIndex: sortIndex, duration: item.duration)
            context.insert(entry)
            entry.capsule = capsule
            sortIndex += 1
        }

        sealedCapsule = capsule
        return capsule
    }
}

// MARK: - Preview

#Preview("Compose") {
    ComposeFlowView { _ in }
        .modelContainer(PreviewData.container)
        .environment(AppRouter())
}

import SwiftUI
import SwiftData

// MARK: - ShareCapsuleSheet

/// Sends a sealed letter to someone dear as an encrypted `.timeleaf` file.
/// Optional secret word + hint → `CapsulePackage.export` → `ShareLink`.
/// Rendered in the capsule's own stationery; presents itself at the `.large` detent.
struct ShareCapsuleSheet: View {
    let capsule: TimeCapsule

    init(capsule: TimeCapsule) {
        self.capsule = capsule
    }

    var body: some View {
        // The content reads its fonts from the environment, where `screenTheme` has
        // scaled the capsule's style for the current Dynamic Type size.
        ShareCapsuleSheetContent(capsule: capsule)
            .screenTheme(capsule.theme.theme)
            .presentationDetents([.large])
            .presentationDragIndicator(.visible)
    }
}

// MARK: - Content

private struct ShareCapsuleSheetContent: View {
    let capsule: TimeCapsule

    @Environment(\.theme) private var theme
    @Environment(\.dismiss) private var dismiss
    @State private var usesSecretWord = false
    @State private var secretWord = ""
    @State private var hint = ""
    @State private var preparedURL: URL?
    @State private var isPreparing = false
    @State private var errorMessage: String?
    /// Bumped whenever the choices change, so an export that was started with
    /// older choices (e.g. before a secret word was added) is never offered.
    @State private var exportGeneration = 0
    /// The export in flight; cancelled when the choices change or the sheet closes.
    @State private var exportTask: Task<Void, Never>?
    @FocusState private var focusedField: ShareCapsuleField?

    var body: some View {
        ZStack(alignment: .topTrailing) {
            ThemeBackground()
            ScrollView {
                VStack(spacing: 30) {
                    header
                    envelopePreview
                    explanation
                    secretWordCard
                    actionArea
                    footnote
                }
                .padding(.horizontal, 24)
                .padding(.top, 52)
                .padding(.bottom, 36)
                .frame(maxWidth: 640)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            // The drawn circle sits 16 pt from the corner; its 44 pt target reaches a little further.
            closeButton
                .padding(.top, 11)
                .padding(.trailing, 11)
        }
        .animation(.smooth(duration: 0.35), value: usesSecretWord)
        .animation(.smooth(duration: 0.35), value: preparedURL)
        .animation(.smooth(duration: 0.3), value: errorMessage)
        .onChange(of: usesSecretWord) { invalidate() }
        .onChange(of: secretWord) { invalidate() }
        .onChange(of: hint) { invalidate() }
        .onDisappear {
            // The share sheet has closed with this one: stop any export still being packed,
            // and the temporary file is no longer needed.
            exportGeneration += 1
            cancelExport()
            discardPreparedFile()
        }
    }

    // MARK: Sections

    private var header: some View {
        VStack(spacing: 10) {
            Text("Send it through time")
                .font(theme.label(11, weight: .semibold))
                .tracking(2.4)
                .textCase(.uppercase)
                .foregroundStyle(theme.accent)
            Text(capsule.title)
                .font(theme.display(30))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
    }

    private var envelopePreview: some View {
        VStack(spacing: 16) {
            EnvelopeView(openProgress: 0, monogram: capsule.monogram)
                .frame(maxWidth: 300)
                .shadow(color: Color.black.opacity(0.2), radius: 24, y: 14)
                .accessibilityHidden(true)
            HStack(spacing: 8) {
                Text("To \(capsule.displayRecipient)")
                Text(verbatim: "·")
                    .accessibilityHidden(true)
                Text("From \(capsule.displaySender)")
            }
            .font(theme.label(12, weight: .medium))
            .foregroundStyle(theme.inkSecondary)
        }
        .padding(.horizontal, 12)
    }

    private var explanation: some View {
        let recipient = capsule.displayRecipient
        let date = TimePhrase.longDate(capsule.unlockDate)
        return Text("\(recipient) will receive a sealed letter that can only be opened on \(date).")
            .font(theme.body(18))
            .foregroundStyle(theme.ink)
            .multilineTextAlignment(.center)
            .lineSpacing(4)
            .fixedSize(horizontal: false, vertical: true)
    }

    private var secretWordCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Toggle(isOn: $usesSecretWord) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Add a secret word")
                        .font(theme.body(17))
                        .foregroundStyle(theme.ink)
                    Text("Only someone who knows it can open the letter.")
                        .font(theme.label(12))
                        .foregroundStyle(theme.inkSecondary)
                }
            }
            .tint(theme.accent)

            if usesSecretWord {
                secretFields
                    .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .themedCard(padding: 20)
    }

    private var secretFields: some View {
        VStack(alignment: .leading, spacing: 12) {
            SecureField(
                "Secret word",
                text: $secretWord,
                prompt: Text("Secret word").foregroundStyle(theme.inkSecondary.opacity(0.7))
            )
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.next)
            .focused($focusedField, equals: .secret)
            .onSubmit { focusedField = .hint }
            .themedField()

            TextField(
                "Hint",
                text: $hint,
                prompt: Text("A hint only they would understand").foregroundStyle(theme.inkSecondary.opacity(0.7))
            )
            .submitLabel(.done)
            .focused($focusedField, equals: .hint)
            .onSubmit { focusedField = nil }
            .themedField()

            Label {
                Text("Tell them the word your own way. It isn't case-sensitive, and it can't be recovered if forgotten.")
            } icon: {
                Image(systemName: "key")
            }
            .font(theme.label(12))
            .foregroundStyle(theme.inkSecondary)
            .fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder
    private var actionArea: some View {
        VStack(spacing: 12) {
            if let url = preparedURL {
                ShareLink(
                    item: url,
                    preview: SharePreview(capsule.title, image: Image(systemName: "envelope.fill"))
                ) {
                    Label("Send the letter", systemImage: "paperplane.fill")
                }
                .buttonStyle(.themedPrimary)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))

                Text("Ready. Send it by Messages, Mail or AirDrop — or keep it in Files.")
                    .font(theme.label(12))
                    .foregroundStyle(theme.inkSecondary)
                    .multilineTextAlignment(.center)
                    .transition(.opacity)
            } else {
                Button(action: prepare) {
                    HStack(spacing: 10) {
                        if isPreparing {
                            ProgressView()
                                .tint(theme.accentInk)
                            Text("Preparing…")
                        } else {
                            Image(systemName: "envelope.badge")
                            Text("Prepare letter")
                        }
                    }
                }
                .buttonStyle(.themedPrimary)
                // Stays fully visible while preparing; `prepare()` ignores repeated taps.
                .disabled(!canPrepare)
                .transition(.opacity)
            }

            if let errorMessage {
                Label {
                    Text(errorMessage)
                } icon: {
                    Image(systemName: "exclamationmark.circle")
                }
                .font(theme.label(13))
                .foregroundStyle(errorColor)
                .multilineTextAlignment(.center)
                .transition(.opacity)
            }
        }
    }

    /// Legible in every style: the deep accent on light paper, the seal's glow on dark.
    private var errorColor: Color {
        theme.colorScheme == .light ? theme.accent : theme.seal
    }

    private var footnote: some View {
        Label {
            footnoteText
        } icon: {
            Image(systemName: usesSecretWord ? "lock.fill" : "lock.open")
        }
        .font(theme.label(12))
        .foregroundStyle(theme.inkSecondary)
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    /// Honest about what keeps the letter closed: without a secret word the file carries
    /// its own key, so it is Timeleaf (not the encryption) that holds it until the day.
    private var footnoteText: Text {
        if usesSecretWord {
            let date = TimePhrase.longDate(capsule.unlockDate)
            return Text("Locked with your secret word: only someone who knows it can open the letter, and Timeleaf keeps it closed until \(date).")
        }
        return Text("Without a secret word, it's Timeleaf — not the encryption — that keeps the date. Add one to lock it for real.")
    }

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
            Image(systemName: "xmark")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(theme.ink)
                .frame(width: 34, height: 34)
                .background { Circle().fill(theme.surface) }
                .overlay { Circle().strokeBorder(theme.surfaceStroke, lineWidth: 0.75) }
                .frame(width: 44, height: 44)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(Text("Close"))
    }

    // MARK: Actions

    private var trimmedSecret: String {
        secretWord.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var canPrepare: Bool {
        !usesSecretWord || !trimmedSecret.isEmpty
    }

    private func invalidate() {
        exportGeneration += 1
        cancelExport()
        discardPreparedFile()
        errorMessage = nil
    }

    /// Stops the export in flight (it deletes its own partial file) and frees the button
    /// at once; a new export queues behind it until it has wound down.
    private func cancelExport() {
        exportTask?.cancel()
        exportTask = nil
        isPreparing = false
    }

    private func discardPreparedFile() {
        guard let url = preparedURL else { return }
        preparedURL = nil
        ShareCapsuleExportFiles.remove(url)
    }

    private func prepare() {
        guard canPrepare, !isPreparing else { return }
        focusedField = nil
        errorMessage = nil
        isPreparing = true
        let passphrase: String? = usesSecretWord ? trimmedSecret : nil
        let hintText = usesSecretWord ? hint.trimmingCharacters(in: .whitespacesAndNewlines) : ""
        let generation = exportGeneration
        let capsule = capsule
        exportTask = ShareCapsuleExportQueue.enqueue {
            // The key derivation, sealing and writing run off the main thread inside `export`,
            // so the sheet stays responsive (and dismissible) while a long video is packed.
            do {
                let url = try await CapsulePackage.export(capsule, passphrase: passphrase, hint: hintText)
                if generation == exportGeneration && !Task.isCancelled {
                    preparedURL = url
                    Haptics.success()
                } else {
                    // The choices changed while sealing; never offer a file made with old ones.
                    ShareCapsuleExportFiles.remove(url)
                }
            } catch is CancellationError {
                // Cancelled because the choices changed or the sheet closed; nothing to say.
            } catch CapsulePackageError.tooLarge {
                // Media can't be removed from a sealed letter, so don't suggest it.
                showError(String(localized: "This letter is too large to send as a file. It stays safe in your vault."), generation: generation)
            } catch {
                showError(error.localizedDescription, generation: generation)
            }
            // A newer export (after the choices changed) owns the button now.
            guard generation == exportGeneration else { return }
            isPreparing = false
            exportTask = nil
        }
    }

    private func showError(_ message: String, generation: Int) {
        guard generation == exportGeneration else { return }
        errorMessage = message
        Haptics.warning()
    }
}

/// Packs one letter at a time. An export someone walked away from is cancelled, and the next
/// one (from this sheet or a reopened one) waits for it to wind down first, so two copies of a
/// large letter are never held in memory together.
@MainActor
private enum ShareCapsuleExportQueue {
    private static var tail: Task<Void, Never>?

    static func enqueue(_ work: @escaping @MainActor () async -> Void) -> Task<Void, Never> {
        let previous = tail
        let task = Task { @MainActor in
            await previous?.value
            // Cancelled while waiting its turn: whoever cancelled it has already reset the sheet.
            guard !Task.isCancelled else { return }
            await work()
        }
        tail = task
        return task
    }
}

/// `CapsulePackage.export` writes each file into its own folder under `tmp/TimeleafExports`.
private enum ShareCapsuleExportFiles {
    static func remove(_ fileURL: URL) {
        let folder = fileURL.deletingLastPathComponent()
        let isExportFolder = folder.deletingLastPathComponent().lastPathComponent == "TimeleafExports"
        try? FileManager.default.removeItem(at: isExportFolder ? folder : fileURL)
    }
}

private enum ShareCapsuleField: Hashable {
    case secret
    case hint
}

// MARK: - Preview

#Preview {
    let container = PreviewData.container
    let capsule = TimeCapsule(
        title: "Open on your 30th birthday",
        message: "Happy birthday, old friend.",
        sealedAt: .now,
        unlockDate: Date.now.adding(.year, 3),
        theme: .celestial,
        recipientKind: .someone,
        recipientName: "Mei",
        senderName: "Bruce"
    )
    container.mainContext.insert(capsule)
    return Color.clear
        .sheet(isPresented: .constant(true)) {
            ShareCapsuleSheet(capsule: capsule)
        }
        .modelContainer(container)
}

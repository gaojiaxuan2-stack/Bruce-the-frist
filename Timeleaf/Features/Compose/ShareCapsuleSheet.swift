import SwiftUI
import SwiftData

// MARK: - ShareCapsuleSheet

/// Sends a sealed letter to someone dear as an encrypted `.timeleaf` file.
/// Optional secret word + hint → `CapsulePackage.export` → `ShareLink`.
/// Rendered in the capsule's own stationery; presents itself at the `.large` detent.
struct ShareCapsuleSheet: View {
    let capsule: TimeCapsule

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
    @FocusState private var focusedField: ShareCapsuleField?

    init(capsule: TimeCapsule) {
        self.capsule = capsule
    }

    private var theme: Theme { capsule.theme.theme }

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
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            closeButton
                .padding(.top, 16)
                .padding(.trailing, 16)
        }
        .animation(.smooth(duration: 0.35), value: usesSecretWord)
        .animation(.smooth(duration: 0.35), value: preparedURL)
        .animation(.smooth(duration: 0.3), value: errorMessage)
        .onChange(of: usesSecretWord) { invalidate() }
        .onChange(of: secretWord) { invalidate() }
        .onChange(of: hint) { invalidate() }
        .onDisappear {
            // The share sheet has closed with this one; the temporary file is no longer needed.
            exportGeneration += 1
            discardPreparedFile()
        }
        .screenTheme(theme)
        .presentationDetents([.large])
        .presentationDragIndicator(.visible)
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
                .foregroundStyle(theme.seal)
                .multilineTextAlignment(.center)
                .transition(.opacity)
            }
        }
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
                .contentShape(Circle())
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
        discardPreparedFile()
        errorMessage = nil
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
        Task { @MainActor in
            // Let the button show its progress before the key derivation runs.
            try? await Task.sleep(for: .milliseconds(120))
            do {
                let url = try CapsulePackage.export(capsule, passphrase: passphrase, hint: hintText)
                if generation == exportGeneration {
                    preparedURL = url
                    Haptics.success()
                } else {
                    // The choices changed while sealing; never offer a file made with old ones.
                    ShareCapsuleExportFiles.remove(url)
                }
            } catch {
                if generation == exportGeneration {
                    errorMessage = error.localizedDescription
                    Haptics.warning()
                }
            }
            isPreparing = false
        }
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

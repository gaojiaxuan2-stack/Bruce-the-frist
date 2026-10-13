import SwiftUI
import SwiftData

// MARK: - VaultView

/// The heart of Timeleaf. A quiet greeting, then — in order of emotional weight —
/// letters that have arrived, the next arrival, everything still in transit,
/// letters received from others, and the archive of letters already opened.
struct VaultView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.modelContext) private var modelContext
    @Environment(\.theme) private var theme

    @AppStorage(SettingsKey.userName) private var userName = ""
    @Query(sort: \TimeCapsule.unlockDate) private var capsules: [TimeCapsule]

    @State private var pendingDeletion: TimeCapsule?
    @State private var showsAllTravelling = false
    @State private var showsAllOpened = false

    var body: some View {
        TimelineView(.periodic(from: .now, by: 30)) { context in
            vault(at: context.date)
        }
        .confirmationDialog(
            "Delete this letter?",
            isPresented: deletionBinding,
            titleVisibility: .visible,
            presenting: pendingDeletion
        ) { capsule in
            Button("Delete Forever", role: .destructive) {
                delete(capsule)
            }
            Button("Keep It", role: .cancel) {}
        } message: { capsule in
            Text("“\(vaultTitle(capsule))” and everything sealed inside it will be gone. This cannot be undone.")
        }
    }

    // MARK: Layout

    private func vault(at now: Date) -> some View {
        let sections = VaultSections(capsules: capsules, now: now)
        return ScrollView {
            // Lazy all the way down: with a hundred letters only the cards on screen are built.
            LazyVStack(alignment: .leading, spacing: 36) {
                VaultGreeting(
                    now: now,
                    userName: userName,
                    readyCount: sections.ready.count,
                    isTravelling: sections.next != nil,
                    isEmpty: sections.isEmpty
                )
                if sections.isEmpty {
                    VaultEmptyState(userName: userName, onWrite: startWriting)
                } else {
                    sectionStack(sections, now: now)
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 32)
            .frame(maxWidth: 640)
            .frame(maxWidth: .infinity)
            .animation(.smooth(duration: 0.5), value: sections.signature)
        }
        .scrollIndicators(.hidden)
        .onChange(of: sections.ready.count) { oldValue, newValue in
            // A letter crossed its date while the vault was open.
            if newValue > oldValue { Haptics.heartbeat() }
        }
    }

    @ViewBuilder
    private func sectionStack(_ sections: VaultSections, now: Date) -> some View {
        if !sections.ready.isEmpty {
            readySection(sections.ready, now: now)
        }
        if let next = sections.next {
            card(for: next) {
                VaultNextArrivalCard(capsule: next, now: now)
            }
        }
        if !sections.travelling.isEmpty {
            listSection(
                sections.travelling,
                now: now,
                title: "In transit",
                subtitle: "Still on their way — soonest first.",
                previewCount: VaultLayout.travellingPreviewCount,
                showsAll: $showsAllTravelling
            )
        }
        if !sections.received.isEmpty {
            listSection(
                sections.received,
                now: now,
                title: "Received",
                subtitle: "Sent to you by someone dear."
            )
        }
        if !sections.opened.isEmpty {
            listSection(
                sections.opened,
                now: now,
                title: "Opened",
                subtitle: "Read, remembered, kept.",
                previewCount: VaultLayout.openedPreviewCount,
                showsAll: $showsAllOpened
            )
        }
        VaultFooter()
    }

    private func readySection(_ capsules: [TimeCapsule], now: Date) -> some View {
        LazyVStack(alignment: .leading, spacing: 16) {
            SectionHeader("Ready to open", subtitle: "The wait is over.")
            ForEach(capsules) { capsule in
                card(for: capsule) {
                    VaultArrivalCard(capsule: capsule, now: now)
                }
            }
        }
    }

    /// A chapter of plain cards. With `showsAll`, only the first `previewCount`
    /// are shown until the reader asks for the rest, so one long chapter never
    /// buries the ones below it.
    private func listSection(
        _ capsules: [TimeCapsule],
        now: Date,
        title: LocalizedStringKey,
        subtitle: LocalizedStringKey,
        previewCount: Int = Int.max,
        showsAll: Binding<Bool>? = nil
    ) -> some View {
        let isTruncatable = showsAll != nil && capsules.count > previewCount
        let isExpanded = showsAll?.wrappedValue ?? true
        let visible = isTruncatable && !isExpanded ? Array(capsules.prefix(previewCount)) : capsules
        return LazyVStack(alignment: .leading, spacing: 14) {
            SectionHeader(title, subtitle: subtitle)
            ForEach(visible) { capsule in
                card(for: capsule) {
                    CapsuleCard(capsule: capsule, now: now)
                }
            }
            if isTruncatable, let showsAll {
                Button {
                    withAnimation(.smooth(duration: 0.45)) { showsAll.wrappedValue.toggle() }
                } label: {
                    toggleLabel(isExpanded: isExpanded, total: capsules.count)
                }
                .buttonStyle(.themedGhost)
                .frame(maxWidth: .infinity)
            }
        }
    }

    private func toggleLabel(isExpanded: Bool, total: Int) -> Text {
        isExpanded ? Text("Show fewer") : Text("Show all \(total)")
    }

    /// Wraps a card in a tappable, pressable button with a delete context menu
    /// and a gentle entrance as it scrolls into view.
    private func card<Content: View>(
        for capsule: TimeCapsule,
        @ViewBuilder content: () -> Content
    ) -> some View {
        let cardContent = content()
        return Button {
            present(capsule)
        } label: {
            cardContent
        }
        .buttonStyle(VaultPressStyle())
        .contentShape(
            .contextMenuPreview,
            RoundedRectangle(cornerRadius: theme.cornerRadius, style: .continuous)
        )
        .contextMenu {
            Button(role: .destructive) {
                pendingDeletion = capsule
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .scrollTransition { effect, phase in
            effect
                .opacity(phase.isIdentity ? 1 : 0.55)
                .scaleEffect(phase.isIdentity ? 1 : 0.96)
        }
    }

    // MARK: Actions

    private var deletionBinding: Binding<Bool> {
        Binding(
            get: { pendingDeletion != nil },
            set: { isPresented in
                if !isPresented { pendingDeletion = nil }
            }
        )
    }

    private func present(_ capsule: TimeCapsule) {
        Haptics.tap()
        router.presentedCapsuleID = capsule.id
    }

    private func startWriting() {
        Haptics.soft()
        router.isComposing = true
    }

    private func delete(_ capsule: TimeCapsule) {
        Haptics.rigid()
        pendingDeletion = nil
        CapsuleActions.delete(capsule, in: modelContext)
    }
}

// MARK: - Sections model

private enum VaultLayout {
    static let travellingPreviewCount = 5
    static let openedPreviewCount = 3
}

/// Splits the vault into its emotional chapters at a given moment.
private struct VaultSections {
    var ready: [TimeCapsule] = []
    var next: TimeCapsule?
    var travelling: [TimeCapsule] = []
    var received: [TimeCapsule] = []
    var opened: [TimeCapsule] = []

    init(capsules: [TimeCapsule], now: Date) {
        var sealed: [TimeCapsule] = []
        for capsule in capsules {
            switch capsule.state(at: now) {
            case .ready:
                ready.append(capsule)
            case .sealed:
                sealed.append(capsule)
            case .opened:
                opened.append(capsule)
            case .draft:
                break
            }
        }
        ready.sort { $0.unlockDate < $1.unlockDate }
        sealed.sort { $0.unlockDate < $1.unlockDate }
        opened.sort { ($0.openedAt ?? $0.unlockDate) > ($1.openedAt ?? $1.unlockDate) }

        next = sealed.first
        for capsule in sealed.dropFirst() {
            if capsule.isIncoming {
                received.append(capsule)
            } else {
                travelling.append(capsule)
            }
        }
    }

    var isEmpty: Bool {
        ready.isEmpty && next == nil && opened.isEmpty
    }

    /// Changes whenever a letter moves between chapters, driving a soft re-layout.
    var signature: [String] {
        var keys = ready.map { "r" + $0.id.uuidString }
        if let next { keys.append("n" + next.id.uuidString) }
        keys += travelling.map { "t" + $0.id.uuidString }
        keys += received.map { "i" + $0.id.uuidString }
        keys += opened.map { "o" + $0.id.uuidString }
        return keys
    }
}

private func vaultTitle(_ capsule: TimeCapsule) -> String {
    let trimmed = capsule.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? String(localized: "Untitled letter") : trimmed
}

// MARK: - Greeting

private struct VaultGreeting: View {
    @Environment(\.theme) private var theme

    let now: Date
    let userName: String
    let readyCount: Int
    let isTravelling: Bool
    let isEmpty: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(TimePhrase.longDate(now))
                .font(theme.label(12, weight: .semibold))
                .tracking(1.6)
                .textCase(.uppercase)
                .foregroundStyle(theme.accent)
            greeting
                .font(theme.display(36))
                .foregroundStyle(theme.ink)
                .fixedSize(horizontal: false, vertical: true)
            subtitle
                .font(theme.body(17))
                .foregroundStyle(theme.inkSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.top, 28)
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    private var greeting: Text {
        let name = userName.trimmingCharacters(in: .whitespacesAndNewlines)
        let hour = Calendar.current.component(.hour, from: now)
        switch hour {
        case 5..<12:
            return name.isEmpty ? Text("Good morning") : Text("Good morning, \(name)")
        case 12..<18:
            return name.isEmpty ? Text("Good afternoon") : Text("Good afternoon, \(name)")
        case 18..<23:
            return name.isEmpty ? Text("Good evening") : Text("Good evening, \(name)")
        default:
            return name.isEmpty ? Text("Still awake?") : Text("Still awake, \(name)?")
        }
    }

    private var subtitle: Text {
        if isEmpty {
            return Text("Every letter is a small act of faith in tomorrow.")
        }
        if readyCount == 1 {
            return Text("A letter has found its way back to you.")
        }
        if readyCount > 1 {
            return Text("\(readyCount) letters have found their way back to you.")
        }
        if isTravelling {
            return Text("Your words are travelling quietly through time.")
        }
        return Text("Every letter has come home. Perhaps it is time to write another.")
    }
}

// MARK: - Ready to open

/// The emotional peak: a letter whose day has come. Glows, breathes, invites.
private struct VaultArrivalCard: View {
    @Environment(\.theme) private var theme

    let capsule: TimeCapsule
    let now: Date

    var body: some View {
        VStack(spacing: 22) {
            arrivedLabel
            VaultGlowingSeal(monogram: capsule.monogram, sealTheme: capsule.theme.theme)
            texts
            callToAction
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 30)
        .padding(.horizontal, 22)
        .background { wash }
        .themedCard(padding: 0)
        .themedGlow(true)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Opens the letter"))
    }

    /// A whisper of the letter's own stationery colours.
    private var wash: some View {
        RoundedRectangle(cornerRadius: theme.cornerRadius, style: .continuous)
            .fill(capsule.theme.theme.linearGradient)
            .opacity(0.16)
    }

    private var arrivedLabel: some View {
        HStack(spacing: 6) {
            Image(systemName: "sparkle")
            Text("Arrived \(TimePhrase.relative(capsule.unlockDate, now: now))")
        }
        .font(theme.label(11, weight: .semibold))
        .tracking(1.6)
        .textCase(.uppercase)
        .foregroundStyle(theme.accent)
    }

    private var texts: some View {
        VStack(spacing: 8) {
            Text(vaultTitle(capsule))
                .font(theme.display(25))
                .foregroundStyle(theme.ink)
                .lineLimit(3)
            provenance
                .font(theme.body(15))
                .foregroundStyle(theme.inkSecondary)
        }
        .multilineTextAlignment(.center)
        .fixedSize(horizontal: false, vertical: true)
    }

    private var provenance: Text {
        let written = TimePhrase.duration(from: capsule.sealedAt ?? capsule.createdAt, to: now)
        if capsule.isIncoming {
            return Text("From \(capsule.displaySender) · sealed \(written) ago")
        }
        if capsule.recipientKind == .myself {
            return Text("From your past self · sealed \(written) ago")
        }
        return Text("For \(capsule.displayRecipient) · sealed \(written) ago")
    }

    private var callToAction: some View {
        HStack(spacing: 8) {
            Text("Open your letter")
            Image(systemName: "arrow.right")
        }
        .font(theme.label(15, weight: .semibold))
        .foregroundStyle(theme.accentInk)
        .padding(.horizontal, 24)
        .padding(.vertical, 12)
        .background(theme.accent, in: Capsule(style: .continuous))
        .shadow(color: theme.accent.opacity(0.35), radius: 10, x: 0, y: 4)
    }
}

private struct VaultGlowingSeal: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let monogram: String
    let sealTheme: Theme

    var body: some View {
        ZStack {
            halo
            SealView(monogram: monogram)
                .theme(sealTheme)
                .frame(width: 100, height: 100)
                .shadow(color: Color.black.opacity(0.25), radius: 10, x: 0, y: 6)
        }
        .frame(width: 120, height: 120)
    }

    @ViewBuilder
    private var halo: some View {
        let glow = Circle()
            .fill(
                RadialGradient(
                    colors: [theme.glow.opacity(0.6), theme.glow.opacity(0)],
                    center: .center,
                    startRadius: 0,
                    endRadius: 85
                )
            )
            .frame(width: 170, height: 170)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
        if reduceMotion {
            glow
        } else {
            glow.phaseAnimator([false, true]) { content, isBright in
                content
                    .scaleEffect(isBright ? 1.08 : 0.86)
                    .opacity(isBright ? 1 : 0.55)
            } animation: { _ in
                Animation.easeInOut(duration: 2.2)
            }
        }
    }
}

// MARK: - Next arrival

private struct VaultNextArrivalCard: View {
    @Environment(\.theme) private var theme

    let capsule: TimeCapsule
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            heading
            CountdownView(to: capsule.unlockDate, style: .hero)
                .frame(maxWidth: .infinity)
            journey
        }
        .themedCard(padding: 24)
        .accessibilityElement(children: .combine)
        .accessibilityHint(Text("Shows the sealed letter"))
    }

    private var heading: some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                Text("Next arrival")
                    .font(theme.label(11, weight: .semibold))
                    .tracking(1.8)
                    .textCase(.uppercase)
                    .foregroundStyle(theme.accent)
                Text(vaultTitle(capsule))
                    .font(theme.display(26))
                    .foregroundStyle(theme.ink)
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
                addressee
                    .font(theme.body(15))
                    .foregroundStyle(theme.inkSecondary)
            }
            Spacer(minLength: 8)
            sealOnItsJourney
        }
    }

    private var addressee: Text {
        if capsule.isIncoming {
            return Text("from \(capsule.displaySender)")
        }
        return Text("for \(capsule.displayRecipient)")
    }

    /// The seal, circled by how far the letter has already travelled.
    private var sealOnItsJourney: some View {
        ZStack {
            ProgressRing(progress: capsule.progress(at: now), lineWidth: 2.5)
            SealView(monogram: capsule.monogram)
                .theme(capsule.theme.theme)
                .padding(9)
        }
        .frame(width: 76, height: 76)
    }

    /// A ticket stub: perforation, then when it opens and when it was sealed.
    private var journey: some View {
        VStack(spacing: 14) {
            VaultPerforation()
                .stroke(
                    theme.inkSecondary.opacity(0.4),
                    style: StrokeStyle(lineWidth: 1, lineCap: .round, dash: [2, 5])
                )
                .frame(height: 1)
            HStack(alignment: .top) {
                stub(label: "Opens", value: TimePhrase.longDate(capsule.unlockDate), alignment: .leading)
                Spacer(minLength: 12)
                stub(
                    label: "Sealed",
                    value: TimePhrase.relative(capsule.sealedAt ?? capsule.createdAt, now: now),
                    alignment: .trailing
                )
            }
        }
    }

    private func stub(label: LocalizedStringKey, value: String, alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 3) {
            Text(label)
                .font(theme.label(10, weight: .semibold))
                .tracking(1.4)
                .textCase(.uppercase)
                .foregroundStyle(theme.inkSecondary)
            Text(value)
                .font(theme.label(13))
                .foregroundStyle(theme.ink)
                .multilineTextAlignment(alignment == .trailing ? .trailing : .leading)
        }
    }
}

private struct VaultPerforation: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}

// MARK: - Empty state

private struct VaultEmptyState: View {
    @Environment(\.theme) private var theme

    let userName: String
    let onWrite: () -> Void

    var body: some View {
        VStack(spacing: 30) {
            VaultFloatingEnvelope(monogram: Monogram.make(from: userName))
                .frame(width: 210)
                .padding(.top, 28)
            VStack(spacing: 10) {
                Text("Your vault is quiet.")
                    .font(theme.display(30))
                    .foregroundStyle(theme.ink)
                Text("Write your first letter to the future.")
                    .font(theme.body(17))
                    .foregroundStyle(theme.inkSecondary)
            }
            .multilineTextAlignment(.center)
            .fixedSize(horizontal: false, vertical: true)
            Button(action: onWrite) {
                Label("Write your first letter", systemImage: "pencil.line")
            }
            .buttonStyle(.themedPrimary)
            Text("Seal a voice, a photo, a few honest lines — and choose the day they may be opened.")
                .font(theme.label(13))
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 16)
        }
        .frame(maxWidth: .infinity)
    }
}

/// A sealed envelope drifting gently, waiting for its first words.
private struct VaultFloatingEnvelope: View {
    @Environment(\.theme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    let monogram: String

    var body: some View {
        envelope
            .background {
                Ellipse()
                    .fill(theme.glow.opacity(0.28))
                    .blur(radius: 36)
                    .scaleEffect(1.3)
            }
            .accessibilityHidden(true)
    }

    @ViewBuilder
    private var envelope: some View {
        let base = EnvelopeView(openProgress: 0, monogram: monogram)
            .aspectRatio(1.45, contentMode: .fit)
            .shadow(color: Color.black.opacity(0.2), radius: 22, x: 0, y: 14)
        if reduceMotion {
            base
        } else {
            base.phaseAnimator([false, true]) { content, isLifted in
                content
                    .offset(y: isLifted ? -7 : 5)
                    .rotationEffect(.degrees(isLifted ? -1.5 : 1.5))
            } animation: { _ in
                Animation.easeInOut(duration: 3.4)
            }
        }
    }
}

// MARK: - Footer & styles

private struct VaultFooter: View {
    @Environment(\.theme) private var theme

    var body: some View {
        VStack(spacing: 12) {
            HStack(spacing: 10) {
                rule
                Image(systemName: "sparkle")
                    .font(.system(size: 9, weight: .regular))
                    .foregroundStyle(theme.accent.opacity(0.8))
                rule
            }
            .accessibilityHidden(true)
            Text("What you seal today, you will open as someone new.")
                .font(theme.body(14).italic())
                .foregroundStyle(theme.inkSecondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity)
        .padding(.top, 8)
    }

    private var rule: some View {
        Rectangle()
            .fill(theme.inkSecondary.opacity(0.3))
            .frame(width: 28, height: 0.5)
    }
}

private struct VaultPressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .opacity(configuration.isPressed ? 0.92 : 1)
            .animation(.snappy(duration: 0.22), value: configuration.isPressed)
    }
}

// MARK: - Previews

#Preview("Vault · Celestial") {
    ZStack {
        ThemeBackground()
        VaultView()
    }
    .modelContainer(PreviewData.container)
    .environment(AppRouter())
    .environment(AppLock())
    .theme(.celestial)
}

#Preview("Vault · Parchment") {
    ZStack {
        ThemeBackground()
        VaultView()
    }
    .modelContainer(PreviewData.container)
    .environment(AppRouter())
    .environment(AppLock())
    .theme(.parchment)
}

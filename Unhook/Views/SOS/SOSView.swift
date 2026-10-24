import SwiftUI
import SwiftData

/// The craving emergency button: ~60 seconds of guided breathing with the user's own reasons,
/// then a choice to log the win or get more ideas.
struct SOSView: View {
    /// The habit the craving is about, or nil when opened from the home screen.
    let habit: Habit?

    @Environment(\.dismiss) private var dismiss
    @Environment(\.modelContext) private var context
    @Query(sort: \Habit.sortIndex) private var allHabits: [Habit]
    @Query private var urges: [Urge]

    private enum Phase { case breathing, finished, celebrating }

    private enum BreathStep: String {
        case inhale = "Breathe in"
        case hold = "Hold"
        case exhale = "Breathe out"
    }

    private static let totalCycles = 4
    private static let restingScale: CGFloat = 0.55

    private static let fallbackReasons = [
        "Cravings peak and fade within minutes.",
        "You are stronger than this moment.",
        "Future you is already proud of you.",
    ]

    private static let allDistractions = [
        "Drink a big glass of cold water",
        "Go for a five-minute walk",
        "Text or call a friend",
        "Do 15 push-ups or squats",
        "Splash cold water on your face",
        "Chew gum or eat something crunchy",
        "Put on your favorite song",
        "Write down how you feel right now",
        "Brush your teeth",
        "Step outside and take ten deep breaths",
    ]

    @State private var phase: Phase = .breathing
    @State private var step: BreathStep = .inhale
    @State private var circleScale: CGFloat = SOSView.restingScale
    @State private var cycle = 1
    @State private var reasonIndex = 0
    @State private var runID = UUID()
    @State private var beatenCount = 0
    @State private var distractions = Array(SOSView.allDistractions.shuffled().prefix(3))
    /// After "I beat this craving": the quick "what set it off / how strong" step before the celebration.
    @State private var isTaggingCraving = false
    @State private var selectedTrigger: CravingTrigger?
    /// 1 (mild) … 5 (overwhelming), or 0 when not rated.
    @State private var intensity = 0
    /// Stops a double tap on Close from logging the craving twice while the screen slides away.
    @State private var didLogOnClose = false
    @State private var showingCoach = false

    private var theme: HabitTheme { habit?.theme ?? .grape }

    private var reasons: [String] {
        let source = habit.map { [$0] } ?? allHabits
        let all = source.flatMap(\.reasons)
        return all.isEmpty ? Self.fallbackReasons : all
    }

    var body: some View {
        ZStack {
            Brand.night
                .ignoresSafeArea()

            switch phase {
            case .breathing:
                breathingContent
                    .transition(.opacity)
            case .finished:
                finishedContent
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
            case .celebrating:
                celebrationContent
                    .transition(.opacity)
            }

            if phase == .celebrating {
                ConfettiView()
            }
        }
        .overlay(alignment: .topTrailing) {
            closeButton
        }
        .environment(\.colorScheme, .dark)
        .sheet(isPresented: $showingCoach) {
            CoachView(habit: habit)
        }
        .task(id: runID) {
            await runBreathing()
        }
    }

    // MARK: Breathing

    private var breathingContent: some View {
        VStack(spacing: 36) {
            Spacer()
            Text("Cycle \(cycle) of \(Self.totalCycles)")
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white.opacity(0.7))
                .contentTransition(.numericText())

            ZStack {
                Circle()
                    .fill(theme.gradient)
                    .opacity(0.35)
                    .scaleEffect(circleScale * 1.25)
                    .blur(radius: 24)
                Circle()
                    .fill(theme.gradient)
                    .scaleEffect(circleScale)
                    .shadow(color: theme.accent.opacity(0.6), radius: 30)
                Text(step.rawValue)
                    .font(.title.bold())
                    .foregroundStyle(.white)
                    .id(step)
                    .transition(.opacity)
            }
            .frame(width: 280, height: 280)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(step.rawValue)

            VStack(spacing: 8) {
                Text("REMEMBER WHY")
                    .font(.caption.weight(.heavy))
                    .tracking(2)
                    .foregroundStyle(.white.opacity(0.6))
                Text(reasons[reasonIndex % reasons.count])
                    .font(.title3.weight(.semibold))
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.white)
                    .id(reasonIndex)
                    .transition(.opacity)
            }
            .frame(minHeight: 90)
            .padding(.horizontal, 32)

            Spacer()

            Button("Skip") {
                withAnimation(.easeInOut(duration: 0.4)) { phase = .finished }
            }
            .font(.subheadline.weight(.semibold))
            .foregroundStyle(.white.opacity(0.6))
            .padding(.bottom, 12)
        }
    }

    private func runBreathing() async {
        guard phase == .breathing else { return }

        for current in 1...Self.totalCycles {
            cycle = current

            withAnimation(.easeInOut(duration: 0.4)) { step = .inhale }
            Haptics.soft()
            withAnimation(.easeInOut(duration: 4)) { circleScale = 1 }
            guard await keepBreathing(after: 4) else { return }

            withAnimation(.easeInOut(duration: 0.4)) { step = .hold }
            Haptics.soft()
            guard await keepBreathing(after: 4) else { return }

            withAnimation(.easeInOut(duration: 0.4)) { step = .exhale }
            Haptics.soft()
            withAnimation(.easeInOut(duration: 6)) { circleScale = Self.restingScale }
            guard await keepBreathing(after: 6) else { return }

            withAnimation(.easeInOut(duration: 0.6)) { reasonIndex += 1 }
        }

        Haptics.success()
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { phase = .finished }
    }

    /// Sleeps for `seconds`; returns false if the screen was closed or the user skipped ahead meanwhile.
    private func keepBreathing(after seconds: Double) async -> Bool {
        do {
            try await Task.sleep(for: .seconds(seconds))
        } catch {
            return false
        }
        return phase == .breathing
    }

    // MARK: After breathing

    private var finishedContent: some View {
        ScrollView {
            VStack(spacing: 24) {
                Image(systemName: "water.waves")
                    .font(.system(size: 56))
                    .foregroundStyle(theme.gradient)
                    .padding(.top, isTaggingCraving ? 40 : 64)
                    .accessibilityHidden(true)

                VStack(spacing: 10) {
                    Text("You rode the wave")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    if !isTaggingCraving {
                        Text("Cravings peak and pass within minutes. You just proved you can outlast one.")
                            .multilineTextAlignment(.center)
                            .foregroundStyle(.white.opacity(0.75))
                    }
                }

                if isTaggingCraving {
                    cravingDetails
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                } else {
                    Button(action: startTagging) {
                        Label("I beat this craving", systemImage: "hand.thumbsup.fill")
                    }
                    .buttonStyle(PrimaryButtonStyle(gradient: theme.gradient))

                    distractionList

                    Button {
                        Haptics.tap()
                        showingCoach = true
                    } label: {
                        Label("Talk it through with your coach", systemImage: "sparkles")
                    }
                    .buttonStyle(SecondaryButtonStyle())

                    Button(action: restart) {
                        Label("Breathe again", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(24)
        }
    }

    // MARK: What set it off

    /// One quick, optional step: tag the trigger and the strength, then save or skip. Both log the win.
    private var cravingDetails: some View {
        VStack(alignment: .leading, spacing: 24) {
            VStack(alignment: .leading, spacing: 12) {
                Text("What set it off?")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                CravingTriggerPicker(selection: $selectedTrigger, tint: theme.gradient)
            }

            VStack(alignment: .leading, spacing: 12) {
                Text("How strong was it?")
                    .font(.headline)
                    .accessibilityAddTraits(.isHeader)
                intensityPicker
            }

            HStack(spacing: 12) {
                Button("Skip") {
                    logResisted(trigger: nil, intensity: 0)
                }
                .buttonStyle(SecondaryButtonStyle())
                .accessibilityHint("Logs the win without these details")

                Button("Save") {
                    logResisted(trigger: selectedTrigger, intensity: intensity)
                }
                .buttonStyle(PrimaryButtonStyle(gradient: theme.gradient))
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var intensityPicker: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                ForEach(1...5, id: \.self) { level in
                    intensityButton(level)
                }
            }
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: intensity)

            Text(Self.intensityDescription(intensity))
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.7))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Strength")
        .accessibilityValue(intensity == 0 ? String(localized: "Not rated") : Self.intensityDescription(intensity))
        .accessibilityAdjustableAction { direction in
            switch direction {
            case .increment:
                intensity = min(intensity + 1, 5)
            case .decrement:
                intensity = max(intensity - 1, 0)
            default:
                break
            }
        }
    }

    /// Circles that grow with the level, filled up to the chosen one. Tapping the chosen level clears it.
    private func intensityButton(_ level: Int) -> some View {
        let isFilled = level <= intensity
        let diameter = CGFloat(16 + level * 4)
        return Button {
            intensity = intensity == level ? 0 : level
            Haptics.selection()
        } label: {
            Circle()
                .fill(isFilled ? AnyShapeStyle(theme.gradient) : AnyShapeStyle(Color.white.opacity(0.18)))
                .frame(width: diameter, height: diameter)
                .frame(width: 48, height: 48)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private static func intensityDescription(_ level: Int) -> String {
        switch level {
        case 1: String(localized: "Mild")
        case 2: String(localized: "Manageable")
        case 3: String(localized: "Strong")
        case 4: String(localized: "Intense")
        case 5: String(localized: "Overwhelming")
        default: String(localized: "Tap a circle to rate it")
        }
    }

    private var distractionList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Still craving? Try one of these:")
                .font(.headline)
            ForEach(distractions, id: \.self) { idea in
                Label(idea, systemImage: "sparkle")
                    .font(.subheadline)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(Color.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var celebrationContent: some View {
        VStack(spacing: 16) {
            Text("💪")
                .font(.system(size: 90))
            Text("Craving crushed!")
                .font(.largeTitle.bold())
                .foregroundStyle(.white)
            Text(beatenCount == 1
                 ? "Your first one. Every craving you ride out proves you can do it."
                 : "That's \(beatenCount) cravings beaten. Every one you ride out proves you can do it.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(32)
    }

    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.headline)
                .foregroundStyle(.white.opacity(0.8))
                .frame(width: 40, height: 40)
                .background(Color.white.opacity(0.12), in: Circle())
        }
        .padding()
        .accessibilityLabel("Close")
    }

    // MARK: Actions

    private func startTagging() {
        Haptics.tap()
        withAnimation(.spring(response: 0.45, dampingFraction: 0.85)) { isTaggingCraving = true }
    }

    private func logResisted(trigger: CravingTrigger?, intensity level: Int) {
        // A quick double tap (or a tap while Close is dismissing the screen) must not log the same craving twice.
        guard phase == .finished, !didLogOnClose else { return }
        beatenCount = urges.filter(\.resisted).count + 1
        saveResistedUrge(trigger: trigger, intensity: level)

        Haptics.success()
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { phase = .celebrating }
        Task {
            try? await Task.sleep(for: .seconds(2.8))
            dismiss()
        }
    }

    private func saveResistedUrge(trigger: CravingTrigger?, intensity level: Int) {
        let urge = Urge(resisted: true, trigger: trigger, intensity: level)
        context.insert(urge)
        if let target = habit ?? (allHabits.count == 1 ? allHabits.first : nil) {
            target.urges.append(urge)
        }
        // Counts toward the App Store review prompt, which is only shown later at a calm high point.
        ReviewPrompter.standard.recordPositiveMoment()
    }

    /// Closing from the "what set it off" step still counts the craving the user just said they beat.
    private func close() {
        if isTaggingCraving, phase == .finished, !didLogOnClose {
            didLogOnClose = true
            saveResistedUrge(trigger: selectedTrigger, intensity: intensity)
        }
        dismiss()
    }

    private func restart() {
        circleScale = Self.restingScale
        step = .inhale
        cycle = 1
        distractions = Array(Self.allDistractions.shuffled().prefix(3))
        isTaggingCraving = false
        selectedTrigger = nil
        intensity = 0
        withAnimation(.easeInOut(duration: 0.4)) { phase = .breathing }
        runID = UUID()
    }
}

#Preview {
    SOSView(habit: nil)
        .previewEnvironment()
}

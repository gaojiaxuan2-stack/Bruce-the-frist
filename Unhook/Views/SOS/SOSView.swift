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
                    .padding(.top, 64)

                VStack(spacing: 10) {
                    Text("You rode the wave")
                        .font(.largeTitle.bold())
                        .foregroundStyle(.white)
                    Text("Cravings peak and pass within minutes. You just proved you can outlast one.")
                        .multilineTextAlignment(.center)
                        .foregroundStyle(.white.opacity(0.75))
                }

                Button(action: logResisted) {
                    Label("I beat this craving", systemImage: "hand.thumbsup.fill")
                }
                .buttonStyle(PrimaryButtonStyle(gradient: theme.gradient))

                distractionList

                Button(action: restart) {
                    Label("Breathe again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(SecondaryButtonStyle())
            }
            .padding(24)
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
                 ? "Your first one. Each craving you beat makes the next one weaker."
                 : "That's \(beatenCount) cravings beaten. Each one makes the next one weaker.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.white.opacity(0.8))
        }
        .padding(32)
    }

    private var closeButton: some View {
        Button {
            dismiss()
        } label: {
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

    private func logResisted() {
        beatenCount = urges.filter(\.resisted).count + 1
        let urge = Urge(resisted: true)
        context.insert(urge)
        if let target = habit ?? (allHabits.count == 1 ? allHabits.first : nil) {
            target.urges.append(urge)
        }

        Haptics.success()
        withAnimation(.spring(response: 0.5, dampingFraction: 0.8)) { phase = .celebrating }
        Task {
            try? await Task.sleep(for: .seconds(2.8))
            dismiss()
        }
    }

    private func restart() {
        circleScale = Self.restingScale
        step = .inhale
        cycle = 1
        distractions = Array(Self.allDistractions.shuffled().prefix(3))
        withAnimation(.easeInOut(duration: 0.4)) { phase = .breathing }
        runID = UUID()
    }
}

#Preview {
    SOSView(habit: nil)
        .modelContainer(PreviewData.container)
}

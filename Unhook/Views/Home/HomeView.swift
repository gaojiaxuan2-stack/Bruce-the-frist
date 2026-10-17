import SwiftUI
import SwiftData

struct HomeView: View {
    @Query(sort: \Habit.sortIndex) private var habits: [Habit]
    @Query(sort: \Pledge.day, order: .reverse) private var pledges: [Pledge]
    @AppStorage(AppSettings.Keys.currencyCode) private var currencyCode = AppSettings.defaultCurrencyCode
    @AppStorage(AppSettings.Keys.didPromptFirstHabit) private var didPromptFirstHabit = false

    @State private var showingAddHabit = false
    @State private var showingSOS = false
    @State private var showingPledge = false

    private var pledgedToday: Bool {
        guard let latest = pledges.first else { return false }
        return Calendar.current.isDateInToday(latest.day)
    }

    private var pledgeStreak: Int {
        StreakCalculator.consecutiveDays(pledges.map(\.day))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    greeting
                    if habits.isEmpty {
                        EmptyHomeView { showingAddHabit = true }
                    } else {
                        SavingsBanner(habits: habits, currencyCode: currencyCode)
                        PledgeCard(pledgedToday: pledgedToday, streak: pledgeStreak) {
                            if !pledgedToday { showingPledge = true }
                        }
                        habitList
                    }
                }
                .padding(.horizontal)
                .padding(.bottom, 24)
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle("Today")
            .navigationDestination(for: Habit.self) { habit in
                HabitDetailView(habit: habit)
            }
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button {
                        showingAddHabit = true
                    } label: {
                        Image(systemName: "plus.circle.fill")
                            .font(.title3)
                    }
                    .accessibilityLabel("Add habit")
                }
            }
            .safeAreaInset(edge: .bottom) {
                if !habits.isEmpty {
                    SOSButton {
                        Haptics.tap()
                        showingSOS = true
                    }
                    .padding(.horizontal)
                    .padding(.bottom, 8)
                }
            }
            .sheet(isPresented: $showingAddHabit) {
                AddHabitView()
            }
            .sheet(isPresented: $showingPledge) {
                PledgeSheet()
                    .presentationDetents([.medium])
            }
            .fullScreenCover(isPresented: $showingSOS) {
                SOSView(habit: nil)
            }
            .onAppear {
                if habits.isEmpty && !didPromptFirstHabit {
                    didPromptFirstHabit = true
                    showingAddHabit = true
                }
            }
        }
    }

    private var greeting: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(Date.now.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            Text(greetingText)
                .font(.title3.weight(.semibold))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var greetingText: String {
        switch Calendar.current.component(.hour, from: .now) {
        case 5..<12: "Good morning. One day at a time."
        case 12..<17: "Good afternoon. You've got this."
        case 17..<22: "Good evening. Stay strong tonight."
        default: "Up late? Cravings pass. You'll stay free."
        }
    }

    private var habitList: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Your streaks")
                .font(.headline)
                .padding(.top, 4)
            ForEach(habits) { habit in
                NavigationLink(value: habit) {
                    HabitCard(habit: habit)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

struct SOSButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Label("Craving? Tap for SOS", systemImage: "wind")
        }
        .buttonStyle(PrimaryButtonStyle(gradient: HabitTheme.fire.gradient))
        .shadow(color: HabitTheme.fire.accent.opacity(0.35), radius: 12, y: 6)
    }
}

private struct EmptyHomeView: View {
    let addAction: () -> Void

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: "link.badge.plus")
                .font(.system(size: 56))
                .foregroundStyle(Brand.gradient)
            Text("What do you want to quit?")
                .font(.title2.bold())
                .multilineTextAlignment(.center)
            Text("Pick a habit to break. Unhook tracks every second, dollar and hour you win back.")
                .multilineTextAlignment(.center)
                .foregroundStyle(.secondary)
            Button("Start my first streak", action: addAction)
                .buttonStyle(PrimaryButtonStyle())
        }
        .padding(28)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .padding(.top, 24)
    }
}

#Preview {
    HomeView()
        .modelContainer(PreviewData.container)
}

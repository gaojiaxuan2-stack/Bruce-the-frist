import Foundation

/// One checkpoint on a habit's recovery timeline: what tends to happen in body and mind after `offset` clean.
struct RecoveryStep: Identifiable, Hashable {
    /// Clean time since the streak started at which this step is reached.
    let offset: TimeInterval
    let title: String
    let detail: String
    let symbol: String

    var id: TimeInterval { offset }
}

/// "What's happening in your body and mind" for each preset habit.
///
/// Smoking follows the widely published WHO, CDC and NHS quit timeline. Every other timeline sticks to
/// conservative, commonly reported experiences (sleep, mood, focus, energy, money, cravings easing) and never
/// makes precise clinical promises. Every list is sorted ascending with unique offsets.
enum RecoveryTimeline {
    private static let minute: TimeInterval = 60
    private static let hour: TimeInterval = 3_600
    private static let day: TimeInterval = 86_400
    private static let week: TimeInterval = 7 * day
    private static let month: TimeInterval = 30 * day
    private static let year: TimeInterval = 365 * day

    /// The recovery steps for a `HabitPreset.id`, sorted ascending by offset. Never empty: unknown and custom
    /// ids get the generic timeline.
    static func steps(for presetID: String) -> [RecoveryStep] {
        switch presetID {
        case "smoking": smoking
        case "vaping": vaping
        case "alcohol": alcohol
        case "social": socialMedia
        case "porn": porn
        case "sugar": sugar
        case "junkfood": junkFood
        case "caffeine": caffeine
        case "cannabis": cannabis
        case "gambling": gambling
        case "gaming": gaming
        case "shopping": shopping
        case "nailbiting": nailBiting
        default: generic
        }
    }

    /// Where the steps come from, when they follow published health guidance.
    static func sourceNote(for presetID: String) -> String? {
        guard presetID == "smoking" else { return nil }
        return String(localized: "Based on guidance from the WHO, the CDC and the NHS.")
    }

    /// Where `elapsed` clean time sits on `steps`.
    /// - Returns: how many steps are reached (a step is reached once `elapsed >= offset`), the first step not yet
    ///   reached, and progress in 0...1 from the previous reached step (or the start) toward it. Once every step
    ///   is reached, `next` is nil and `fractionToNext` is 1.
    static func progress(
        elapsed: TimeInterval,
        steps: [RecoveryStep]
    ) -> (reached: Int, next: RecoveryStep?, fractionToNext: Double) {
        let elapsed = elapsed.isNaN ? 0 : elapsed
        var reached = 0
        var previousOffset: TimeInterval = 0
        var next: RecoveryStep?
        for step in steps {
            if step.offset <= elapsed {
                reached += 1
                previousOffset = max(previousOffset, step.offset)
            } else if step.offset < (next?.offset ?? .infinity) {
                next = step
            }
        }
        guard let next else { return (reached, nil, 1) }
        let span = next.offset - previousOffset
        guard span > 0 else { return (reached, next, 0) }
        let fraction = min(max((elapsed - previousOffset) / span, 0), 1)
        return (reached, next, fraction)
    }

    /// The single whole calendar unit that best describes an offset: 20 minutes, 12 hours, 3 days, 2 weeks,
    /// 6 months, 1 year. Months count as 30 days and years as 365 days, matching how the steps are written.
    static func offsetComponents(_ offset: TimeInterval) -> DateComponents {
        let seconds = offset.clampedWholeNumber
        let minute = 60
        let hour = 3_600
        let day = 86_400
        let week = 7 * day
        let month = 30 * day
        let year = 365 * day
        if seconds >= year, seconds % year == 0 { return DateComponents(year: seconds / year) }
        if seconds >= month, seconds % month == 0 { return DateComponents(month: seconds / month) }
        if seconds >= week, seconds % week == 0 { return DateComponents(weekOfMonth: seconds / week) }
        if seconds >= day, seconds % day == 0 { return DateComponents(day: seconds / day) }
        if seconds >= hour, seconds % hour == 0 { return DateComponents(hour: seconds / hour) }
        return DateComponents(minute: seconds / minute)
    }

    /// A localized, correctly pluralized label for a step's offset, e.g. "20 minutes" or "2 weeks".
    static func offsetLabel(_ offset: TimeInterval) -> String {
        let formatter = DateComponentsFormatter()
        formatter.unitsStyle = .full
        formatter.allowedUnits = [.year, .month, .weekOfMonth, .day, .hour, .minute]
        formatter.maximumUnitCount = 1
        // Month and year components are measured from a reference date. Pin it mid-month (2001-01-15, noon UTC)
        // so labels never depend on today's date (from Jan 31, "1 month" would otherwise land on Feb 28).
        formatter.referenceDate = Date(timeIntervalSinceReferenceDate: 14 * day + 12 * hour)
        return formatter.string(from: offsetComponents(offset)) ?? DurationFormatter.compact(offset)
    }
}

// MARK: - Timelines

private extension RecoveryTimeline {
    static let smoking: [RecoveryStep] = [
        RecoveryStep(
            offset: 20 * minute,
            title: String(localized: "Heart rate drops"),
            detail: String(localized: "Within about 20 minutes, your heart rate and blood pressure start to come down."),
            symbol: "heart.fill"
        ),
        RecoveryStep(
            offset: 12 * hour,
            title: String(localized: "Carbon monoxide falls"),
            detail: String(localized: "Over 8 to 12 hours, the carbon monoxide level in your blood falls and oxygen levels recover."),
            symbol: "aqi.low"
        ),
        RecoveryStep(
            offset: 2 * day,
            title: String(localized: "Taste and smell improve"),
            detail: String(localized: "Around two days in, your senses of taste and smell begin to improve, and your lungs start clearing out mucus."),
            symbol: "fork.knife"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Breathing feels easier"),
            detail: String(localized: "After about three days, your airways begin to relax, breathing feels easier and energy often picks up."),
            symbol: "lungs.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Circulation improves"),
            detail: String(localized: "Between 2 and 12 weeks, your circulation and lung function improve, so walking and exercise get easier."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Less coughing"),
            detail: String(localized: "Over 1 to 9 months, coughing and shortness of breath decrease as your lungs recover."),
            symbol: "wind"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "Heart risk halved"),
            detail: String(localized: "After a year, your added risk of coronary heart disease is about half that of someone who still smokes."),
            symbol: "waveform.path.ecg"
        ),
        RecoveryStep(
            offset: 5 * year,
            title: String(localized: "Stroke risk falls"),
            detail: String(localized: "Between 5 and 15 years after quitting, your risk of stroke falls to about that of a non-smoker."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: 10 * year,
            title: String(localized: "Lung cancer risk halved"),
            detail: String(localized: "After 10 years, your risk of dying from lung cancer is about half that of someone who still smokes."),
            symbol: "shield.lefthalf.filled"
        ),
        RecoveryStep(
            offset: 15 * year,
            title: String(localized: "A non-smoker's heart"),
            detail: String(localized: "After 15 years, your risk of coronary heart disease is about the same as a non-smoker's."),
            symbol: "heart.circle.fill"
        ),
    ]

    static let vaping: [RecoveryStep] = [
        RecoveryStep(
            offset: hour,
            title: String(localized: "Nicotine starts to fall"),
            detail: String(localized: "Nicotine levels in your blood begin to drop. Every craving you ride out from here counts."),
            symbol: "drop.fill"
        ),
        RecoveryStep(
            offset: day,
            title: String(localized: "First day done"),
            detail: String(localized: "The first day is often the hardest. Cravings come in waves and usually pass within minutes."),
            symbol: "sun.max.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Nicotine clears"),
            detail: String(localized: "Most of the nicotine has left your body. Cravings can peak around now, then start to ease."),
            symbol: "sparkles"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "The habit loosens"),
            detail: String(localized: "The hand-to-mouth habit starts to loosen as new routines take its place."),
            symbol: "hand.raised.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Easier breathing"),
            detail: String(localized: "Many people notice less throat irritation and find exercise a little easier."),
            symbol: "lungs.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Calmer days"),
            detail: String(localized: "For most people, withdrawal feelings like irritability and restlessness have faded by now."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Steadier energy"),
            detail: String(localized: "Energy and focus often feel steadier without nicotine's ups and downs."),
            symbol: "bolt.heart.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Money back in your pocket"),
            detail: String(localized: "Six months without pods or liquid adds up. Put it toward something you love."),
            symbol: "banknote.fill"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year nicotine-free"),
            detail: String(localized: "A full year without nicotine. Cravings are rare now, and you know how to handle them."),
            symbol: "crown.fill"
        ),
    ]

    static let alcohol: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "A clearer start"),
            detail: String(localized: "Your body has cleared the alcohol. If you used to drink heavily every day, please talk to a doctor, as stopping suddenly can need medical support."),
            symbol: "sunrise.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Better hydrated"),
            detail: String(localized: "Without alcohol's drying effect, many people wake up feeling fresher, with fewer headaches."),
            symbol: "drop.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Better sleep"),
            detail: String(localized: "Sleep often becomes deeper and more restful once alcohol stops disrupting it."),
            symbol: "bed.double.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "More energy"),
            detail: String(localized: "With better sleep and hydration, many people have more energy and fewer slumps."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Steadier mood"),
            detail: String(localized: "Mood and anxiety often feel more stable, and the money you've kept starts to show."),
            symbol: "face.smiling"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "New routines stick"),
            detail: String(localized: "Your body has had a real break, and alcohol-free evenings and weekends feel more natural."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Sharper focus"),
            detail: String(localized: "Concentration and memory often feel sharper, and you're fully present for the people around you."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year of clear mornings"),
            detail: String(localized: "A full year alcohol-free: more time, more money and a clearer head."),
            symbol: "crown.fill"
        ),
    ]

    static let socialMedia: [RecoveryStep] = [
        RecoveryStep(
            offset: hour,
            title: String(localized: "Attention settles"),
            detail: String(localized: "Without the constant pull of notifications, your attention starts to settle."),
            symbol: "bell.slash.fill"
        ),
        RecoveryStep(
            offset: day,
            title: String(localized: "Noticing the reflex"),
            detail: String(localized: "Reaching for your phone can feel automatic. Noticing it is the first step to breaking it."),
            symbol: "hand.raised.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Better sleep"),
            detail: String(localized: "Less late-night scrolling can mean falling asleep sooner and sleeping more soundly."),
            symbol: "moon.zzz.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "More present"),
            detail: String(localized: "Conversations, meals and walks feel richer when you're fully in them."),
            symbol: "person.2.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Less comparison"),
            detail: String(localized: "Many people find they compare themselves to others less and feel more content."),
            symbol: "heart.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Deeper focus"),
            detail: String(localized: "Long stretches of focused work or reading come more easily."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Hours reclaimed"),
            detail: String(localized: "You've won back serious time, with room for hobbies, friends and rest."),
            symbol: "clock.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "A calmer mind"),
            detail: String(localized: "Your phone feels like a tool you choose to use, not something that pulls at you."),
            symbol: "leaf.fill"
        ),
    ]

    static let porn: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "First step taken"),
            detail: String(localized: "You chose differently today. Urges come in waves, and they always pass."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Riding the waves"),
            detail: String(localized: "Urges can feel strong in the first days. Moving your body, a shower or a call with a friend helps them pass."),
            symbol: "water.waves"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "More energy"),
            detail: String(localized: "Many people notice more energy and motivation for the rest of their life."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "A clearer head"),
            detail: String(localized: "Focus often improves as your mind spends less time on the habit."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Steadier mood"),
            detail: String(localized: "Mood often feels more stable, with less guilt and more self-respect."),
            symbol: "face.smiling"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Real connection"),
            detail: String(localized: "Being present with people gets easier, and relationships can feel more meaningful."),
            symbol: "person.2.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "New habits stick"),
            detail: String(localized: "Healthier routines feel natural, and urges tend to be rarer and easier to handle."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "In control"),
            detail: String(localized: "You've built real confidence that you're in charge of your choices."),
            symbol: "shield.lefthalf.filled"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year of freedom"),
            detail: String(localized: "A full year. Take a moment to look back at how far you've come."),
            symbol: "crown.fill"
        ),
    ]

    static let sugar: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "First day done"),
            detail: String(localized: "Your body begins adjusting to fewer sugar highs and crashes."),
            symbol: "sun.max.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Cravings may peak"),
            detail: String(localized: "Sugar cravings and irritability can be strongest in the first few days. Water, protein and fruit help."),
            symbol: "flame.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Steadier energy"),
            detail: String(localized: "Without the spikes and crashes, energy through the day often feels more even."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Taste resets"),
            detail: String(localized: "Many people find naturally sweet foods like fruit start to taste sweeter."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Fewer cravings"),
            detail: String(localized: "Cravings for sweets usually come less often and are easier to let pass."),
            symbol: "hand.thumbsup.fill"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Feeling good in your body"),
            detail: String(localized: "Steadier eating often shows up as better mood, sleep and energy."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "A healthier default"),
            detail: String(localized: "Choosing less sugar has become a habit, not a fight."),
            symbol: "heart.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Long-term gains"),
            detail: String(localized: "Six months of less sugar is a real investment in your teeth, energy and long-term health."),
            symbol: "star.fill"
        ),
    ]

    static let junkFood: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "A fresh start"),
            detail: String(localized: "Every meal you choose well is a win for your energy and your wallet."),
            symbol: "sunrise.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Lighter after meals"),
            detail: String(localized: "Many people feel less sluggish after meals when they swap fast food for simpler options."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Steadier energy"),
            detail: String(localized: "Balanced meals help your energy stay more even through the day."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Taste adjusts"),
            detail: String(localized: "Fresh, less salty food starts to taste better as your palate adapts."),
            symbol: "fork.knife"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Money saved"),
            detail: String(localized: "A month without takeaways and snacks adds up. Notice what you've kept."),
            symbol: "banknote.fill"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Feeling stronger"),
            detail: String(localized: "Better fuel often means better workouts, sleep and mood."),
            symbol: "figure.run"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Your new normal"),
            detail: String(localized: "Choosing better food feels like the default, not a sacrifice."),
            symbol: "checkmark.seal.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Long-term health"),
            detail: String(localized: "Half a year of better eating is a real investment in your heart and long-term health."),
            symbol: "heart.fill"
        ),
    ]

    static let caffeine: [RecoveryStep] = [
        RecoveryStep(
            offset: 12 * hour,
            title: String(localized: "Caffeine wears off"),
            detail: String(localized: "Some people notice a headache or tiredness as caffeine wears off. Water and rest help."),
            symbol: "drop.fill"
        ),
        RecoveryStep(
            offset: 2 * day,
            title: String(localized: "The hardest stretch"),
            detail: String(localized: "Headaches and low energy usually peak in the first couple of days. Be kind to yourself."),
            symbol: "cloud.sun.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Through the worst"),
            detail: String(localized: "For most people, withdrawal symptoms fade within about a week."),
            symbol: "sun.max.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Deeper sleep"),
            detail: String(localized: "Falling asleep and sleeping deeply often gets easier without caffeine in your system."),
            symbol: "bed.double.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Natural energy"),
            detail: String(localized: "Energy feels steadier through the day, without the afternoon crash."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Calmer days"),
            detail: String(localized: "Many people feel less jittery and on edge without regular caffeine."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Mornings on your terms"),
            detail: String(localized: "Your mornings no longer depend on a cup, and the savings add up."),
            symbol: "cup.and.saucer.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Your own rhythm"),
            detail: String(localized: "Rest, water and daylight keep you going. Your body runs on its own rhythm now."),
            symbol: "sunrise.fill"
        ),
    ]

    static let cannabis: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "First day done"),
            detail: String(localized: "Choosing a clear head today is a real win."),
            symbol: "sun.max.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Withdrawal may peak"),
            detail: String(localized: "Irritability, restlessness and trouble sleeping are common in the first week. They pass."),
            symbol: "cloud.sun.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Dreams return"),
            detail: String(localized: "Many people notice vivid dreams as their sleep finds a new balance."),
            symbol: "moon.stars.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Clearer mornings"),
            detail: String(localized: "Most withdrawal feelings have usually eased, and mornings feel less foggy."),
            symbol: "sunrise.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Sleep settles"),
            detail: String(localized: "Winding down and falling asleep usually feel natural again."),
            symbol: "bed.double.fill"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Sharper memory"),
            detail: String(localized: "Memory and concentration often feel noticeably sharper."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Motivation returns"),
            detail: String(localized: "Energy and drive for goals and hobbies often come back."),
            symbol: "flag.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Feeling like yourself"),
            detail: String(localized: "Many people say they feel more like themselves: clearer, calmer and more present."),
            symbol: "person.fill"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year clear"),
            detail: String(localized: "A full year of choosing yourself. Look how far you've come."),
            symbol: "crown.fill"
        ),
    ]

    static let gambling: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "Your money stays yours"),
            detail: String(localized: "Every bet you don't place is money that stays in your pocket."),
            symbol: "banknote.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Urges come and go"),
            detail: String(localized: "Urges can feel intense, but they rise and fall like waves. Ride them out."),
            symbol: "water.waves"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Better sleep"),
            detail: String(localized: "Less late-night betting and worrying often means more rest."),
            symbol: "bed.double.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "A calmer mind"),
            detail: String(localized: "Without the highs and lows of wins and losses, many people feel less anxious."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Clearer finances"),
            detail: String(localized: "A month without gambling makes room to plan, budget and start tackling debt."),
            symbol: "chart.line.uptrend.xyaxis"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Rebuilding trust"),
            detail: String(localized: "Consistency builds trust, with the people you love and with yourself."),
            symbol: "person.2.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "New ways to unwind"),
            detail: String(localized: "Hobbies and time with people start filling the space gambling used to take."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Real security"),
            detail: String(localized: "Half a year of not chasing losses adds up to real peace of mind."),
            symbol: "lock.shield.fill"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year free"),
            detail: String(localized: "A full year of protecting your money, your time and your relationships."),
            symbol: "crown.fill"
        ),
    ]

    static let gaming: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "Time reclaimed"),
            detail: String(localized: "Today's hours are yours for something new."),
            symbol: "clock.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Better sleep"),
            detail: String(localized: "Going to bed on time gets easier without \"one more match\"."),
            symbol: "moon.zzz.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Restlessness eases"),
            detail: String(localized: "Boredom and restlessness are normal early on. They usually fade as new routines form."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "More focus"),
            detail: String(localized: "Work, study and reading often feel easier to settle into."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Room for new hobbies"),
            detail: String(localized: "With hours back every day, there's room to learn, create or move."),
            symbol: "paintpalette.fill"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Real-world connection"),
            detail: String(localized: "Time with friends and family in person often feels more rewarding."),
            symbol: "person.2.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "In charge of your time"),
            detail: String(localized: "You decide when and whether to play, and what's worth your evenings."),
            symbol: "checkmark.seal.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Goals in reach"),
            detail: String(localized: "Half a year of reclaimed time is real progress toward the things you care about."),
            symbol: "flag.checkered"
        ),
    ]

    static let shopping: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "Pause and save"),
            detail: String(localized: "Every purchase you skip is money that stays yours."),
            symbol: "banknote.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Urges pass"),
            detail: String(localized: "When an urge hits, waiting a day often makes it fade on its own."),
            symbol: "hourglass"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Less clutter"),
            detail: String(localized: "Fewer packages and less stuff can make your space feel calmer."),
            symbol: "shippingbox.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Clearer priorities"),
            detail: String(localized: "You start to notice what you actually need versus what you want in the moment."),
            symbol: "lightbulb.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Savings growing"),
            detail: String(localized: "A month of mindful spending makes a real difference. Put it toward a goal."),
            symbol: "chart.line.uptrend.xyaxis"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Less money worry"),
            detail: String(localized: "Many people feel calmer about money once their balance stops surprising them."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Mindful by default"),
            detail: String(localized: "Pausing to think before you buy has become a habit."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Real progress"),
            detail: String(localized: "Half a year of mindful spending can mean less debt and more freedom."),
            symbol: "star.fill"
        ),
    ]

    static let nailBiting: [RecoveryStep] = [
        RecoveryStep(
            offset: day,
            title: String(localized: "Awareness grows"),
            detail: String(localized: "Noticing when your hands drift to your mouth is the first big step."),
            symbol: "eye.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Busy hands"),
            detail: String(localized: "Keeping your hands busy with a fidget toy or stress ball helps urges pass."),
            symbol: "hand.raised.fill"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "Skin starts healing"),
            detail: String(localized: "The skin around your nails starts to recover and feel less sore."),
            symbol: "bandage.fill"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "Visible growth"),
            detail: String(localized: "Your nails are starting to grow out."),
            symbol: "sparkles"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "Less autopilot"),
            detail: String(localized: "Biting without noticing happens less and less."),
            symbol: "brain.head.profile"
        ),
        RecoveryStep(
            offset: 2 * month,
            title: String(localized: "Healthier nails"),
            detail: String(localized: "Your nails look and feel stronger and healthier."),
            symbol: "hand.thumbsup.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Confident hands"),
            detail: String(localized: "Many people feel more confident showing their hands."),
            symbol: "star.fill"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "A full regrowth"),
            detail: String(localized: "Fingernails usually take around four to six months to grow out fully. A fresh start, right to the tips."),
            symbol: "crown.fill"
        ),
    ]

    static let generic: [RecoveryStep] = [
        RecoveryStep(
            offset: hour,
            title: String(localized: "The first hour"),
            detail: String(localized: "You've started. Every urge you ride out makes the next one easier."),
            symbol: "hourglass"
        ),
        RecoveryStep(
            offset: day,
            title: String(localized: "One full day"),
            detail: String(localized: "The first day is often the hardest. Be proud of it."),
            symbol: "sun.max.fill"
        ),
        RecoveryStep(
            offset: 3 * day,
            title: String(localized: "Riding the waves"),
            detail: String(localized: "The first few days are often the toughest. Cravings come in waves, and they pass."),
            symbol: "water.waves"
        ),
        RecoveryStep(
            offset: week,
            title: String(localized: "New patterns"),
            detail: String(localized: "Your days start to take shape around new routines."),
            symbol: "calendar"
        ),
        RecoveryStep(
            offset: 2 * week,
            title: String(localized: "More energy"),
            detail: String(localized: "Many people notice more energy and a clearer mind."),
            symbol: "bolt.fill"
        ),
        RecoveryStep(
            offset: month,
            title: String(localized: "The habit loosens"),
            detail: String(localized: "Urges usually come less often and are easier to manage."),
            symbol: "leaf.fill"
        ),
        RecoveryStep(
            offset: 3 * month,
            title: String(localized: "Your new normal"),
            detail: String(localized: "Life without the habit feels more natural every day."),
            symbol: "figure.walk"
        ),
        RecoveryStep(
            offset: 6 * month,
            title: String(localized: "Lasting change"),
            detail: String(localized: "Six months shows real, lasting commitment to yourself."),
            symbol: "star.fill"
        ),
        RecoveryStep(
            offset: year,
            title: String(localized: "A year free"),
            detail: String(localized: "A full year. Take a moment to look back at how far you've come."),
            symbol: "crown.fill"
        ),
    ]
}

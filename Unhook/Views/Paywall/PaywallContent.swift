import Foundation

/// A subscription or offer length, kept free of StoreKit so it can be formatted and unit tested.
struct PaywallPeriod: Equatable {
    enum Unit: Equatable {
        case day, week, month, year
    }

    let unit: Unit
    /// How many units, clamped to 1...10,000 so arithmetic on it can never overflow.
    let value: Int

    init(unit: Unit, value: Int) {
        self.unit = unit
        self.value = min(max(value, 1), 10_000)
    }

    /// This period repeated `count` times, for offers that last several periods.
    func repeated(_ count: Int) -> PaywallPeriod {
        PaywallPeriod(unit: unit, value: value * min(max(count, 1), 10_000))
    }

    /// Whole months covered, for showing a per-month price. Nil for periods shorter than a month.
    var months: Int? {
        switch unit {
        case .month: value
        case .year: value * 12
        case .day, .week: nil
        }
    }

    /// "7-day free trial", "1-month free trial".
    var freeTrialText: String {
        switch unit {
        case .day: String(localized: "\(value)-day free trial")
        case .week: String(localized: "\(value * 7)-day free trial")
        case .month: String(localized: "\(value)-month free trial")
        case .year: String(localized: "\(value)-year free trial")
        }
    }

    /// How often a subscription renews: "per year", "every 3 months".
    var renewalText: String {
        if value == 1 {
            switch unit {
            case .day: return String(localized: "per day")
            case .week: return String(localized: "per week")
            case .month: return String(localized: "per month")
            case .year: return String(localized: "per year")
            }
        }
        switch unit {
        case .day: return String(localized: "every \(value) days")
        case .week: return String(localized: "every \(value) weeks")
        case .month: return String(localized: "every \(value) months")
        case .year: return String(localized: "every \(value) years")
        }
    }
}

/// Price math for the plan cards.
enum PaywallPricing {
    /// The price spread over each month of `period` (a yearly price divided by 12). Nil unless the period
    /// covers more than one month, where a per-month figure would just repeat the price.
    static func monthlyEquivalent(of price: Decimal, period: PaywallPeriod) -> Decimal? {
        guard let months = period.months, months > 1, price > 0 else { return nil }
        return price / Decimal(months)
    }

    /// Share (0...1) saved by paying `price` for `period` instead of `monthlyPrice` every month.
    /// Nil when there's nothing worth calling a saving (under 5%), or the comparison doesn't apply.
    static func savingsFraction(price: Decimal, period: PaywallPeriod, comparedToMonthly monthlyPrice: Decimal) -> Double? {
        guard let months = period.months, months > 1, price > 0, monthlyPrice > 0 else { return nil }
        let fullPrice = monthlyPrice * Decimal(months)
        guard fullPrice > price else { return nil }
        let fraction = NSDecimalNumber(decimal: (fullPrice - price) / fullPrice).doubleValue
        guard fraction.isFinite, fraction >= 0.05 else { return nil }
        return min(fraction, 1)
    }

    /// "49%". Rounded down so the saving is never overstated.
    static func savingsText(_ fraction: Double) -> String {
        fraction.formatted(.percent.precision(.fractionLength(0)).rounded(rule: .down))
    }
}

/// Words on the paywall that depend on why it was opened or on the selected plan.
enum PaywallCopy {
    static func headline(for reason: PaywallReason) -> String {
        switch reason {
        case .onboarding: String(localized: "Make it stick with Unhook Pro")
        case .moreHabits: String(localized: "Quit more than one habit")
        case .moreGoals: String(localized: "Save for every dream")
        case .insights: String(localized: "See what really drives your cravings")
        case .appIcons: String(localized: "Make Unhook yours")
        case .settings: String(localized: "Unlock everything")
        }
    }

    static func subtitle(for reason: PaywallReason) -> String {
        switch reason {
        case .onboarding:
            String(localized: "Everything you need to stay unhooked, for good.")
        case .moreHabits:
            String(localized: "Track every habit you want to break, side by side, each with its own streak.")
        case .moreGoals:
            String(localized: "Plan for every reward you're saving toward, not just one.")
        case .insights:
            String(localized: "See when your cravings peak and everything that sets them off, so you can get ahead of them.")
        case .appIcons:
            String(localized: "Pick an exclusive app icon and unlock every Pro feature.")
        case .settings:
            String(localized: "Every Pro feature, and a big thank-you from an independent developer.")
        }
    }

    /// Short card title for a known product; nil for anything else (use the Store's display name).
    static func planTitle(for productID: String) -> String? {
        switch productID {
        case Store.ProductID.yearly: String(localized: "Yearly")
        case Store.ProductID.monthly: String(localized: "Monthly")
        case Store.ProductID.lifetime: String(localized: "Lifetime")
        default: nil
        }
    }

    /// The line under the purchase button spelling out exactly what will be charged and when.
    /// `renewal` is nil for one-time purchases.
    static func purchaseSummary(price: String, renewal: PaywallPeriod?, freeTrial: PaywallPeriod?) -> String {
        guard let renewal else {
            return String(localized: "Pay \(price) once. Yours forever, no subscription.")
        }
        if let freeTrial {
            return String(localized: "\(freeTrial.freeTrialText), then \(price) \(renewal.renewalText). Cancel anytime.")
        }
        return String(localized: "\(price) \(renewal.renewalText). Renews automatically, cancel anytime.")
    }
}

/// What Unhook Pro adds, in the order the paywall lists it.
enum PaywallBenefit: CaseIterable, Identifiable {
    case unlimitedHabits, insights, unlimitedGoals, appIcons, supportDeveloper

    var id: Self { self }

    var systemImage: String {
        switch self {
        case .unlimitedHabits: "infinity"
        case .insights: "brain.head.profile"
        case .unlimitedGoals: "gift.fill"
        case .appIcons: "apps.iphone"
        case .supportDeveloper: "heart.fill"
        }
    }

    var title: String {
        switch self {
        case .unlimitedHabits: String(localized: "Unlimited habits")
        case .insights: String(localized: "Full craving & trigger insights")
        case .unlimitedGoals: String(localized: "Unlimited savings goals")
        case .appIcons: String(localized: "Exclusive app icons")
        case .supportDeveloper: String(localized: "Support an independent developer")
        }
    }

    var detail: String {
        switch self {
        case .unlimitedHabits: String(localized: "Track everything you're quitting, all at once.")
        case .insights: String(localized: "Learn when cravings peak and what sets them off.")
        case .unlimitedGoals: String(localized: "Turn the money you save into rewards you'll love.")
        case .appIcons: String(localized: "Midnight, Sunrise and Forest for your Home Screen.")
        case .supportDeveloper: String(localized: "Keep Unhook private, ad-free and getting better.")
        }
    }

    /// The perk the user was reaching for when the paywall opened, if any.
    static func featured(for reason: PaywallReason) -> PaywallBenefit? {
        switch reason {
        case .moreHabits: .unlimitedHabits
        case .moreGoals: .unlimitedGoals
        case .insights: .insights
        case .appIcons: .appIcons
        case .onboarding, .settings: nil
        }
    }

    /// Every benefit, with the one the user was reaching for first.
    static func ordered(for reason: PaywallReason) -> [PaywallBenefit] {
        guard let first = featured(for: reason) else { return allCases }
        return [first] + allCases.filter { $0 != first }
    }
}

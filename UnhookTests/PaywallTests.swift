import Foundation
import Testing
@testable import Unhook

struct PaywallTests {
    private static let yearlyPrice = Decimal(2999) / 100
    private static let monthlyPrice = Decimal(499) / 100

    private static func double(_ value: Decimal?) -> Double? {
        value.map { NSDecimalNumber(decimal: $0).doubleValue }
    }

    // MARK: Periods

    @Test func weeklyTrialReadsAsDays() {
        #expect(PaywallPeriod(unit: .week, value: 1).freeTrialText == "7-day free trial")
        #expect(PaywallPeriod(unit: .week, value: 2).freeTrialText == "14-day free trial")
        #expect(PaywallPeriod(unit: .day, value: 3).freeTrialText == "3-day free trial")
    }

    @Test func longerTrialsKeepTheirUnit() {
        #expect(PaywallPeriod(unit: .month, value: 1).freeTrialText == "1-month free trial")
        #expect(PaywallPeriod(unit: .year, value: 1).freeTrialText == "1-year free trial")
    }

    @Test func repeatedPeriodMultipliesTheValue() {
        #expect(PaywallPeriod(unit: .day, value: 7).repeated(2) == PaywallPeriod(unit: .day, value: 14))
        #expect(PaywallPeriod(unit: .month, value: 1).repeated(0) == PaywallPeriod(unit: .month, value: 1))
    }

    @Test func valueIsClampedSoMathNeverOverflows() {
        #expect(PaywallPeriod(unit: .day, value: 0).value == 1)
        #expect(PaywallPeriod(unit: .day, value: -5).value == 1)
        #expect(PaywallPeriod(unit: .year, value: .max).value == 10_000)
        #expect(PaywallPeriod(unit: .year, value: .max).repeated(.max).months == 120_000)
    }

    @Test func monthsCoveredOnlyForMonthsAndYears() {
        #expect(PaywallPeriod(unit: .year, value: 1).months == 12)
        #expect(PaywallPeriod(unit: .month, value: 3).months == 3)
        #expect(PaywallPeriod(unit: .week, value: 1).months == nil)
        #expect(PaywallPeriod(unit: .day, value: 30).months == nil)
    }

    @Test func renewalText() {
        #expect(PaywallPeriod(unit: .year, value: 1).renewalText == "per year")
        #expect(PaywallPeriod(unit: .month, value: 1).renewalText == "per month")
        #expect(PaywallPeriod(unit: .week, value: 1).renewalText == "per week")
        #expect(PaywallPeriod(unit: .month, value: 3).renewalText == "every 3 months")
    }

    // MARK: Pricing

    @Test func yearlyPriceSpreadOverTwelveMonths() throws {
        let perMonth = try #require(PaywallPricing.monthlyEquivalent(of: Self.yearlyPrice, period: PaywallPeriod(unit: .year, value: 1)))
        #expect(perMonth == Self.yearlyPrice / 12)
        let approx = try #require(Self.double(perMonth))
        #expect(abs(approx - 2.499_166) < 0.000_01)
    }

    @Test func noMonthlyEquivalentForMonthlyOrShorterPlans() {
        #expect(PaywallPricing.monthlyEquivalent(of: Self.monthlyPrice, period: PaywallPeriod(unit: .month, value: 1)) == nil)
        #expect(PaywallPricing.monthlyEquivalent(of: Self.monthlyPrice, period: PaywallPeriod(unit: .week, value: 1)) == nil)
        #expect(PaywallPricing.monthlyEquivalent(of: 0, period: PaywallPeriod(unit: .year, value: 1)) == nil)
    }

    @Test func savingsComparedWithPayingMonthly() throws {
        let fraction = try #require(PaywallPricing.savingsFraction(
            price: Self.yearlyPrice,
            period: PaywallPeriod(unit: .year, value: 1),
            comparedToMonthly: Self.monthlyPrice
        ))
        // 12 × 4.99 = 59.88, so 29.99 saves 29.89 / 59.88 ≈ 49.9%.
        #expect(abs(fraction - 0.499_165) < 0.000_01)
        let text = PaywallPricing.savingsText(fraction)
        #expect(text.contains("49"))
        #expect(!text.contains("50"))
    }

    @Test func noSavingsWhenThereIsNothingToSave() {
        let year = PaywallPeriod(unit: .year, value: 1)
        // Dearer than paying monthly.
        #expect(PaywallPricing.savingsFraction(price: 70, period: year, comparedToMonthly: Self.monthlyPrice) == nil)
        // Under 5% isn't worth calling a saving.
        #expect(PaywallPricing.savingsFraction(price: 58, period: year, comparedToMonthly: Self.monthlyPrice) == nil)
        // Comparing the monthly plan with itself.
        #expect(PaywallPricing.savingsFraction(
            price: Self.monthlyPrice,
            period: PaywallPeriod(unit: .month, value: 1),
            comparedToMonthly: Self.monthlyPrice
        ) == nil)
        #expect(PaywallPricing.savingsFraction(price: Self.yearlyPrice, period: year, comparedToMonthly: 0) == nil)
    }

    // MARK: Copy

    @Test func headlineMatchesWhyThePaywallOpened() {
        #expect(PaywallCopy.headline(for: .onboarding) == "Make it stick with Unhook Pro")
        #expect(PaywallCopy.headline(for: .moreHabits) == "Quit more than one habit")
        #expect(PaywallCopy.headline(for: .moreGoals) == "Save for every dream")
        #expect(PaywallCopy.headline(for: .insights) == "See what really drives your cravings")
        #expect(PaywallCopy.headline(for: .appIcons) == "Make Unhook yours")
        #expect(PaywallCopy.headline(for: .settings) == "Unlock everything")
    }

    @Test func planTitlesForKnownProducts() {
        #expect(PaywallCopy.planTitle(for: "unhook.pro.yearly") == "Yearly")
        #expect(PaywallCopy.planTitle(for: "unhook.pro.monthly") == "Monthly")
        #expect(PaywallCopy.planTitle(for: "unhook.pro.lifetime") == "Lifetime")
        #expect(PaywallCopy.planTitle(for: "unhook.pro.weekly") == nil)
    }

    @Test func purchaseSummarySpellsOutWhatIsCharged() {
        let year = PaywallPeriod(unit: .year, value: 1)
        let week = PaywallPeriod(unit: .week, value: 1)
        #expect(
            PaywallCopy.purchaseSummary(price: "$29.99", renewal: year, freeTrial: week)
                == "7-day free trial, then $29.99 per year. Cancel anytime."
        )
        #expect(
            PaywallCopy.purchaseSummary(price: "$4.99", renewal: PaywallPeriod(unit: .month, value: 1), freeTrial: nil)
                == "$4.99 per month. Renews automatically, cancel anytime."
        )
        #expect(
            PaywallCopy.purchaseSummary(price: "$49.99", renewal: nil, freeTrial: nil)
                == "Pay $49.99 once. Yours forever, no subscription."
        )
    }

    // MARK: Benefits

    @Test func featuredBenefitComesFirst() {
        #expect(PaywallBenefit.ordered(for: .moreHabits).first == .unlimitedHabits)
        #expect(PaywallBenefit.ordered(for: .moreGoals).first == .unlimitedGoals)
        #expect(PaywallBenefit.ordered(for: .insights).first == .insights)
        #expect(PaywallBenefit.ordered(for: .appIcons).first == .appIcons)
    }

    @Test func everyBenefitIsListedExactlyOnce() {
        for reason in [PaywallReason.onboarding, .moreHabits, .moreGoals, .insights, .appIcons, .settings] {
            let benefits = PaywallBenefit.ordered(for: reason)
            #expect(benefits.count == PaywallBenefit.allCases.count)
            #expect(Set(benefits).count == benefits.count)
        }
        #expect(PaywallBenefit.ordered(for: .settings) == PaywallBenefit.allCases)
    }
}

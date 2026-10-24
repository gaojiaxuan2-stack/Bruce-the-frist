import StoreKit
import SwiftUI

/// Unhook Pro paywall. Presented as a sheet from `AppRouter.paywallReason`, and embedded as the last step of
/// onboarding. Shows what Pro adds, one card per product, and everything App Review asks a subscription
/// screen to show: the billed price and period, what a trial turns into, Restore, Terms and Privacy.
struct PaywallView: View {
    let reason: PaywallReason
    let onClose: (() -> Void)?

    @Environment(Store.self) private var store
    @Environment(\.dismiss) private var dismiss

    @State private var selectedProductID = Store.ProductID.yearly
    /// Free trials this Apple ID can still start, by product ID.
    @State private var freeTrials: [String: PaywallPeriod] = [:]
    @State private var isRestoring = false
    @State private var isRetrying = false
    @State private var showingNothingToRestore = false
    @State private var showingPrivacyPolicy = false
    @State private var showingManageSubscriptions = false
    /// Set while the purchase confetti is showing.
    @State private var celebrationID: UUID?
    @State private var hasClosed = false

    private static let termsOfUseURL = URL(string: "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/")!
    /// Keeps cards and text a readable width on iPad.
    private static let maxContentWidth: CGFloat = 560

    init(reason: PaywallReason, onClose: (() -> Void)? = nil) {
        self.reason = reason
        self.onClose = onClose
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color(.systemGroupedBackground)
                .ignoresSafeArea()

            VStack(spacing: 0) {
                scrollContent
                footer
            }

            closeButton
        }
        .overlay {
            if let celebrationID {
                ConfettiView()
                    .id(celebrationID)
            }
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: store.isPro)
        .animation(.spring(response: 0.4, dampingFraction: 0.85), value: store.hasLoadedProducts)
        .task(id: store.products.map(\.id)) {
            await loadFreeTrials()
        }
        .onAppear {
            // Errors from before the paywall opened (a failed product load at launch) aren't actionable here;
            // the "not available" state already explains a missing product list.
            store.lastErrorMessage = nil
        }
        .alert("Something went wrong", isPresented: errorIsPresented) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(store.lastErrorMessage ?? "")
        }
        .sheet(isPresented: $showingPrivacyPolicy) {
            PrivacyPolicySheet()
        }
        .manageSubscriptionsSheet(isPresented: $showingManageSubscriptions)
    }

    // MARK: Layout

    private var scrollContent: some View {
        ScrollView {
            VStack(spacing: 24) {
                PaywallHero(headline: headline, subtitle: subtitle)
                if store.isPro {
                    proThanks
                } else {
                    benefits
                    plans
                    legalText
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 12)
            .padding(.bottom, 24)
            .frame(maxWidth: Self.maxContentWidth)
            .frame(maxWidth: .infinity)
        }
        .scrollBounceBehavior(.basedOnSize)
        .alert("No purchases found", isPresented: $showingNothingToRestore) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("We couldn't find an earlier Unhook Pro purchase for this Apple ID. Purchases are restored for the Apple ID you're signed in with.")
        }
    }

    private var closeButton: some View {
        Button(action: close) {
            Image(systemName: "xmark")
                .font(.subheadline.weight(.bold))
                .foregroundStyle(.secondary)
                .frame(width: 32, height: 32)
                .background(.ultraThinMaterial, in: Circle())
                .frame(width: 44, height: 44)
                .contentShape(Circle())
        }
        .buttonStyle(.plain)
        .padding(.top, 14)
        .padding(.trailing, 22)
        .accessibilityLabel("Close")
    }

    private var headline: String {
        store.isPro ? String(localized: "You're Pro — thank you! 💜") : PaywallCopy.headline(for: reason)
    }

    private var subtitle: String {
        store.isPro
            ? String(localized: "Every Pro feature is unlocked. Thank you for supporting Unhook.")
            : PaywallCopy.subtitle(for: reason)
    }

    // MARK: Benefits

    private var benefits: some View {
        Card {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(PaywallBenefit.ordered(for: reason)) { benefit in
                    PaywallBenefitRow(benefit: benefit)
                }
                Divider()
                Label {
                    Text("SOS and your streaks are always free.")
                } icon: {
                    Image(systemName: "lifepreserver.fill")
                        .foregroundStyle(.green)
                }
                .font(.subheadline)
                .foregroundStyle(.secondary)
            }
        }
    }

    private var proThanks: some View {
        Card(title: String(localized: "Everything is unlocked"), systemImage: "checkmark.seal.fill", tint: .green) {
            VStack(alignment: .leading, spacing: 16) {
                ForEach(PaywallBenefit.allCases) { benefit in
                    PaywallBenefitRow(benefit: benefit)
                }
            }
        }
    }

    // MARK: Plans

    @ViewBuilder
    private var plans: some View {
        if !store.hasLoadedProducts {
            placeholderPlans
        } else if store.products.isEmpty {
            unavailableState
        } else {
            VStack(spacing: 12) {
                ForEach(store.products) { product in
                    PaywallPlanCard(plan: plan(for: product), isSelected: product.id == selectedProduct?.id) {
                        select(product)
                    }
                }
            }
        }
    }

    private var placeholderPlans: some View {
        VStack(spacing: 12) {
            ForEach(PaywallPlan.placeholders) { plan in
                PaywallPlanCard(plan: plan, isSelected: plan.isBestValue) {}
            }
        }
        .redacted(reason: .placeholder)
        .disabled(true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Loading plans")
    }

    private var unavailableState: some View {
        VStack(spacing: 12) {
            Image(systemName: "wifi.exclamationmark")
                .font(.largeTitle)
                .foregroundStyle(Brand.gradient)
                .accessibilityHidden(true)
            Text("Purchases aren't available right now")
                .font(.headline)
                .multilineTextAlignment(.center)
            Text("Check your connection and try again in a moment. Everything you've set up is safe, and SOS and your streaks are always free.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
            Button {
                Task { await retryLoadingProducts() }
            } label: {
                if isRetrying {
                    ProgressView()
                } else {
                    Text("Try again")
                }
            }
            .buttonStyle(.bordered)
            .disabled(isRetrying)
            .padding(.top, 4)
        }
        .frame(maxWidth: .infinity)
        .padding(24)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }

    private var legalText: some View {
        Text("Payment is charged to your Apple ID. Subscriptions renew automatically unless cancelled at least 24 hours before the end of the current period. Manage or cancel anytime in Settings.")
            .font(.caption)
            .foregroundStyle(.secondary)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity)
    }

    // MARK: Footer

    private var footer: some View {
        VStack(spacing: 10) {
            if store.isPro {
                proFooter
            } else {
                purchaseFooter
            }
        }
        .padding(.horizontal, 20)
        .padding(.top, 12)
        .padding(.bottom, 8)
        .frame(maxWidth: Self.maxContentWidth)
        .frame(maxWidth: .infinity)
        .background(.bar)
    }

    @ViewBuilder
    private var proFooter: some View {
        Button("Done", action: close)
            .buttonStyle(PrimaryButtonStyle())
        if hasActiveSubscription {
            Button("Manage subscription") {
                showingManageSubscriptions = true
            }
            .font(.footnote.weight(.semibold))
        }
    }

    @ViewBuilder
    private var purchaseFooter: some View {
        if !store.hasLoadedProducts || !store.products.isEmpty {
            purchaseButton
            if let purchaseSummary {
                Text(purchaseSummary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        footerLinks
    }

    private var purchaseButton: some View {
        Button {
            Task { await purchaseSelected() }
        } label: {
            ZStack {
                purchaseButtonTitle
                    .opacity(store.isPurchasing ? 0 : 1)
                if store.isPurchasing {
                    ProgressView()
                        .tint(.white)
                }
            }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(selectedProduct == nil || store.isPurchasing || isRestoring)
    }

    @ViewBuilder
    private var purchaseButtonTitle: some View {
        if isTrialSelected {
            Text("Start free trial")
        } else {
            Text("Continue")
        }
    }

    /// Restore, Terms and Privacy side by side, stacked when large text doesn't fit on one line.
    private var footerLinks: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: 18) {
                footerLinkItems
            }
            VStack(spacing: 8) {
                footerLinkItems
            }
        }
        .font(.footnote.weight(.medium))
        .padding(.top, 2)
    }

    @ViewBuilder
    private var footerLinkItems: some View {
        Button {
            Task { await restore() }
        } label: {
            Group {
                if isRestoring {
                    Text("Restoring…")
                } else {
                    Text("Restore purchases")
                }
            }
            .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
        .disabled(isRestoring || store.isPurchasing)

        Link(destination: Self.termsOfUseURL) {
            Text("Terms of Use")
                .foregroundStyle(.secondary)
        }

        Button {
            showingPrivacyPolicy = true
        } label: {
            Text("Privacy Policy")
                .foregroundStyle(.secondary)
        }
        .buttonStyle(.plain)
    }

    // MARK: Derived state

    /// The chosen product, falling back to the first one if the default (yearly) isn't on sale.
    private var selectedProduct: Product? {
        store.product(id: selectedProductID) ?? store.products.first
    }

    private var isTrialSelected: Bool {
        guard let selectedProduct else { return false }
        return freeTrials[selectedProduct.id] != nil
    }

    private var purchaseSummary: String? {
        guard let selectedProduct else { return nil }
        return PaywallCopy.purchaseSummary(
            price: selectedProduct.displayPrice,
            renewal: renewalPeriod(of: selectedProduct),
            freeTrial: freeTrials[selectedProduct.id]
        )
    }

    private var hasActiveSubscription: Bool {
        store.purchasedProductIDs.contains(Store.ProductID.yearly)
            || store.purchasedProductIDs.contains(Store.ProductID.monthly)
    }

    private var errorIsPresented: Binding<Bool> {
        Binding(
            get: { store.lastErrorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    store.lastErrorMessage = nil
                }
            }
        )
    }

    private func renewalPeriod(of product: Product) -> PaywallPeriod? {
        guard let subscription = product.subscription else { return nil }
        return PaywallPeriod(subscription.subscriptionPeriod)
    }

    private func plan(for product: Product) -> PaywallPlan {
        let renewal = renewalPeriod(of: product)
        var monthlyPrice: String?
        var savings: String?
        if let renewal, let perMonth = PaywallPricing.monthlyEquivalent(of: product.price, period: renewal) {
            monthlyPrice = perMonth.formatted(product.priceFormatStyle)
            if let monthly = store.product(id: Store.ProductID.monthly),
               let fraction = PaywallPricing.savingsFraction(price: product.price, period: renewal, comparedToMonthly: monthly.price) {
                savings = PaywallPricing.savingsText(fraction)
            }
        }
        return PaywallPlan(
            id: product.id,
            title: PaywallCopy.planTitle(for: product.id) ?? product.displayName,
            price: product.displayPrice,
            renewal: renewal,
            monthlyPrice: monthlyPrice,
            savings: savings,
            freeTrial: freeTrials[product.id],
            isBestValue: product.id == Store.ProductID.yearly
        )
    }

    // MARK: Actions

    private func select(_ product: Product) {
        guard product.id != selectedProduct?.id else { return }
        Haptics.selection()
        withAnimation(.spring(response: 0.3, dampingFraction: 0.8)) {
            selectedProductID = product.id
        }
    }

    /// Checks which products still offer this Apple ID a free trial (the introductory offer is once per
    /// subscription group).
    private func loadFreeTrials() async {
        var trials: [String: PaywallPeriod] = [:]
        for product in store.products {
            guard let subscription = product.subscription,
                  let offer = subscription.introductoryOffer,
                  offer.paymentMode == .freeTrial,
                  let period = PaywallPeriod(offer.period) else { continue }
            let isEligible = await subscription.isEligibleForIntroOffer
            if isEligible {
                trials[product.id] = period.repeated(offer.periodCount)
            }
        }
        freeTrials = trials
    }

    private func purchaseSelected() async {
        guard let product = selectedProduct, !store.isPurchasing else { return }
        Haptics.tap()
        let didPurchase = await store.purchase(product)
        guard didPurchase else { return }
        Haptics.success()
        celebrationID = UUID()
        // A moment of confetti, then out of the way.
        try? await Task.sleep(for: .seconds(1.8))
        close()
    }

    private func restore() async {
        guard !isRestoring else { return }
        Haptics.tap()
        isRestoring = true
        await store.restorePurchases()
        isRestoring = false
        if store.isPro {
            Haptics.success()
            close()
        } else if store.lastErrorMessage == nil {
            showingNothingToRestore = true
        }
    }

    private func retryLoadingProducts() async {
        guard !isRetrying else { return }
        isRetrying = true
        await store.loadProducts()
        isRetrying = false
    }

    private func close() {
        guard !hasClosed else { return }
        hasClosed = true
        if let onClose {
            onClose()
        } else {
            dismiss()
        }
    }
}

// MARK: - Plan model

/// Everything a plan card shows, already formatted.
struct PaywallPlan: Identifiable {
    let id: String
    let title: String
    /// The billed amount, e.g. "$29.99".
    let price: String
    /// How often it renews; nil for a one-time purchase.
    let renewal: PaywallPeriod?
    /// "$2.50" for plans longer than a month.
    let monthlyPrice: String?
    /// "49%" saved compared with paying monthly.
    let savings: String?
    /// The free trial this Apple ID can still start.
    let freeTrial: PaywallPeriod?
    let isBestValue: Bool

    /// Stand-ins drawn redacted while the App Store loads the real products.
    static let placeholders: [PaywallPlan] = [
        PaywallPlan(
            id: "placeholder.yearly", title: "Yearly plan", price: "$00.00",
            renewal: PaywallPeriod(unit: .year, value: 1), monthlyPrice: "$0.00", savings: nil,
            freeTrial: PaywallPeriod(unit: .week, value: 1), isBestValue: true
        ),
        PaywallPlan(
            id: "placeholder.monthly", title: "Monthly", price: "$0.00",
            renewal: PaywallPeriod(unit: .month, value: 1), monthlyPrice: nil, savings: nil,
            freeTrial: nil, isBestValue: false
        ),
        PaywallPlan(
            id: "placeholder.lifetime", title: "Lifetime", price: "$00.00",
            renewal: nil, monthlyPrice: nil, savings: nil,
            freeTrial: nil, isBestValue: false
        ),
    ]
}

extension PaywallPeriod {
    /// Converts a StoreKit period. Nil for a unit this version doesn't know.
    init?(_ period: Product.SubscriptionPeriod) {
        let unit: Unit
        if period.unit == .day {
            unit = .day
        } else if period.unit == .week {
            unit = .week
        } else if period.unit == .month {
            unit = .month
        } else if period.unit == .year {
            unit = .year
        } else {
            return nil
        }
        self.init(unit: unit, value: period.value)
    }
}

// MARK: - Subviews

/// Gradient header with a crown and the headline.
private struct PaywallHero: View {
    let headline: String
    let subtitle: String

    @ScaledMetric(relativeTo: .largeTitle) private var crownSize: CGFloat = 76

    var body: some View {
        VStack(spacing: 14) {
            crown
            Text(headline)
                .font(.title.bold())
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityAddTraits(.isHeader)
            Text(subtitle)
                .font(.subheadline)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(0.92)
        }
        .foregroundStyle(.white)
        .padding(.horizontal, 24)
        .padding(.top, 40)
        .padding(.bottom, 28)
        .frame(maxWidth: .infinity)
        .background {
            RoundedRectangle(cornerRadius: 28, style: .continuous)
                .fill(Brand.gradient)
                .overlay {
                    // Deepens the lower half so white text stays readable over the cyan end of the gradient.
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .fill(LinearGradient(colors: [.clear, .black.opacity(0.22)], startPoint: .top, endPoint: .bottom))
                }
        }
        .overlay(alignment: .topLeading) {
            Image(systemName: "sparkles")
                .font(.title2)
                .foregroundStyle(.white.opacity(0.55))
                .padding(20)
                .accessibilityHidden(true)
        }
        .accessibilityElement(children: .combine)
    }

    private var crown: some View {
        Image(systemName: "crown.fill")
            .font(.system(size: crownSize * 0.46, weight: .semibold))
            .foregroundStyle(Brand.gradient)
            .frame(width: crownSize, height: crownSize)
            .background(Color.white, in: Circle())
            .shadow(color: .black.opacity(0.18), radius: 12, y: 6)
            .accessibilityHidden(true)
    }
}

/// One Pro perk with its icon.
private struct PaywallBenefitRow: View {
    let benefit: PaywallBenefit

    @ScaledMetric(relativeTo: .headline) private var iconSize: CGFloat = 34

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: benefit.systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(.white)
                .frame(width: iconSize, height: iconSize)
                .background(Brand.gradient, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(benefit.title)
                    .font(.headline)
                Text(benefit.detail)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .accessibilityElement(children: .combine)
    }
}

/// A selectable plan: radio, name and trial on the left, the billed price on the right.
private struct PaywallPlanCard: View {
    let plan: PaywallPlan
    let isSelected: Bool
    let action: () -> Void

    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    private var shape: RoundedRectangle {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
    }

    var body: some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                radio
                details
                    .layoutPriority(1)
                Spacer(minLength: 8)
                if !dynamicTypeSize.isAccessibilitySize {
                    priceColumn(alignment: .trailing)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: shape)
            .overlay {
                shape
                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                    .opacity(isSelected ? 0 : 1)
            }
            .overlay {
                shape
                    .strokeBorder(Brand.gradient, lineWidth: 2)
                    .opacity(isSelected ? 1 : 0)
            }
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var radio: some View {
        Image(systemName: isSelected ? "checkmark.circle.fill" : "circle")
            .font(.title3)
            .foregroundStyle(isSelected ? AnyShapeStyle(Brand.gradient) : AnyShapeStyle(Color.secondary.opacity(0.6)))
            .accessibilityHidden(true)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 4) {
            titleRow
            if let freeTrial = plan.freeTrial {
                Text(freeTrial.freeTrialText)
                    .font(.subheadline.weight(.semibold))
                    .foregroundStyle(Brand.gradient)
            } else {
                Text(detailText)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            }
            if let monthlyPrice = plan.monthlyPrice {
                monthlyLine(monthlyPrice)
            }
            if dynamicTypeSize.isAccessibilitySize {
                priceColumn(alignment: .leading)
                    .padding(.top, 4)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder
    private var titleRow: some View {
        if dynamicTypeSize.isAccessibilitySize {
            VStack(alignment: .leading, spacing: 4) {
                Text(plan.title)
                    .font(.headline)
                if plan.isBestValue {
                    PaywallBestValueBadge()
                }
            }
        } else {
            HStack(spacing: 8) {
                Text(plan.title)
                    .font(.headline)
                if plan.isBestValue {
                    PaywallBestValueBadge()
                }
            }
        }
    }

    @ViewBuilder
    private func monthlyLine(_ monthlyPrice: String) -> some View {
        Group {
            if let savings = plan.savings {
                Text("Only \(monthlyPrice) a month · save \(savings)")
            } else {
                Text("Only \(monthlyPrice) a month")
            }
        }
        .font(.footnote)
        .foregroundStyle(.secondary)
    }

    private var detailText: String {
        guard plan.renewal != nil else { return String(localized: "One-time purchase") }
        return String(localized: "Cancel anytime")
    }

    private func priceColumn(alignment: HorizontalAlignment) -> some View {
        VStack(alignment: alignment, spacing: 2) {
            Text(plan.price)
                .font(.headline)
                .monospacedDigit()
            if let renewal = plan.renewal {
                Text(renewal.renewalText)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .fixedSize()
    }
}

/// "Best value" capsule on the yearly plan.
private struct PaywallBestValueBadge: View {
    var body: some View {
        Text("Best value")
            .font(.caption2.weight(.bold))
            .textCase(.uppercase)
            .foregroundStyle(.white)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(Brand.gradient, in: Capsule())
            .fixedSize()
    }
}

#Preview("Sheet") {
    PaywallView(reason: .insights)
        .previewEnvironment()
}

#Preview("Onboarding") {
    ZStack {
        Brand.night.ignoresSafeArea()
        PaywallView(reason: .onboarding, onClose: {})
    }
    .environment(\.colorScheme, .dark)
    .previewEnvironment()
}

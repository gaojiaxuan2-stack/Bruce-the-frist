import Foundation
import Observation
import StoreKit

/// Unhook Pro purchases, using StoreKit 2.
///
/// Products are configured in App Store Connect with the IDs below. For local testing, the shared
/// scheme points at `Unhook.storekit` in the repository root, so purchases work in the Simulator without an account.
@MainActor
@Observable
final class Store {
    static let shared = Store()

    enum ProductID {
        static let yearly = "unhook.pro.yearly"
        static let monthly = "unhook.pro.monthly"
        static let lifetime = "unhook.pro.lifetime"
        /// Display order on the paywall.
        static let all = [yearly, monthly, lifetime]
    }

    private(set) var products: [Product] = []
    private(set) var purchasedProductIDs: Set<String> = []
    private(set) var hasLoadedProducts = false
    private(set) var isPurchasing = false
    var lastErrorMessage: String?

    var isPro: Bool { !purchasedProductIDs.isEmpty }

    @ObservationIgnored private var updatesTask: Task<Void, Never>?

    /// Loads products and current entitlements, and keeps listening for purchases made elsewhere
    /// (renewals, Family Sharing, refunds, purchases on another device).
    func start() {
        guard updatesTask == nil else { return }
        updatesTask = Task { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let transaction) = update {
                    await transaction.finish()
                }
                await self?.refreshEntitlements()
            }
        }
        Task {
            await refreshEntitlements()
            await loadProducts()
        }
    }

    func loadProducts() async {
        do {
            let loaded = try await Product.products(for: ProductID.all)
            products = loaded.sorted { lhs, rhs in
                (ProductID.all.firstIndex(of: lhs.id) ?? .max) < (ProductID.all.firstIndex(of: rhs.id) ?? .max)
            }
        } catch {
            lastErrorMessage = error.localizedDescription
        }
        hasLoadedProducts = true
    }

    func refreshEntitlements() async {
        var owned: Set<String> = []
        for await result in Transaction.currentEntitlements {
            guard case .verified(let transaction) = result, transaction.revocationDate == nil else { continue }
            owned.insert(transaction.productID)
        }
        purchasedProductIDs = owned
    }

    /// Buys `product`. Returns true when the purchase went through (not cancelled or awaiting approval).
    @discardableResult
    func purchase(_ product: Product) async -> Bool {
        isPurchasing = true
        defer { isPurchasing = false }
        do {
            switch try await product.purchase() {
            case .success(let verification):
                guard case .verified(let transaction) = verification else {
                    lastErrorMessage = String(localized: "The purchase couldn't be verified.")
                    return false
                }
                await transaction.finish()
                await refreshEntitlements()
                return true
            case .pending, .userCancelled:
                return false
            @unknown default:
                return false
            }
        } catch {
            lastErrorMessage = error.localizedDescription
            return false
        }
    }

    func restorePurchases() async {
        do {
            try await AppStore.sync()
        } catch StoreKitError.userCancelled {
            // Dismissing the Apple ID prompt isn't an error worth showing.
        } catch {
            lastErrorMessage = error.localizedDescription
        }
        await refreshEntitlements()
    }

    func product(id: String) -> Product? {
        products.first { $0.id == id }
    }
}

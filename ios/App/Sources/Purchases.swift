// StoreKit 2 for the one-time unlock (PLAN.md P4.2). Used only when the trial switch is on (Info.plist QBeamTrial).
// There's no server: StoreKit verifies the signed transactions on the device, and the result is cached in Trial so the
// unlock keeps working offline.
import QBeamKit
import StoreKit

@MainActor
final class Purchases {
    private var product: Product?
    private var updates: Task<Void, Never>?
    private let onOwned: (Bool) -> Void
    private(set) var price: String?

    init(onOwned: @escaping (Bool) -> Void) { self.onOwned = onOwned }

    /// Loads the product and the current entitlement, and listens for purchases made elsewhere (Ask to Buy, refunds).
    func start() async {
        updates = Task { [weak self] in
            for await update in Transaction.updates {
                if case .verified(let t) = update { await t.finish() }
                await self?.refresh()
            }
        }
        product = try? await Product.products(for: [Trial.productID]).first
        price = product?.displayPrice
        await refresh()
    }

    /// Re-reads the verified entitlement; offline or unknown leaves the cached state alone.
    func refresh() async {
        var owned = false
        for await result in Transaction.currentEntitlements {
            if case .verified(let t) = result, t.productID == Trial.productID, t.revocationDate == nil { owned = true }
        }
        onOwned(owned)
    }

    /// Returns a message to show when the purchase didn't go through, or nil.
    func buy() async -> String? {
        guard let product else { return "The App Store isn't reachable right now. Try again in a moment." }
        do {
            switch try await product.purchase() {
            case .success(.verified(let t)):
                await t.finish()
                await refresh()
                return nil
            case .success(.unverified):
                return "The App Store couldn't verify the purchase."
            case .pending:
                return "The purchase is waiting for approval."
            case .userCancelled:
                return nil
            @unknown default:
                return nil
            }
        } catch {
            return "Couldn't complete the purchase: \(error.localizedDescription)"
        }
    }

    /// "Restore purchase": asks the App Store to resync (may prompt for the Apple Account password).
    func restore() async {
        try? await AppStore.sync()
        await refresh()
    }
}

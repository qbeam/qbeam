// The free trial: 10 completed transfers, then a one-time unlock. Platform-free so it's unit-tested;
// mirrors android/core Trial.kt. The app supplies storage and the store purchase.
import Foundation

public protocol TrialStore: AnyObject {
    func integer(forKey key: String) -> Int
    func set(_ value: Int, forKey key: String)
    func bool(forKey key: String) -> Bool
    func set(_ value: Bool, forKey key: String)
}

extension UserDefaults: TrialStore {}

public final class Trial {
    public static let freeTransfers = 10
    public static let showCounterFrom = 5
    public static let productID = "dev.qbeam.unlock"
    static let completedKey = "trial.completed", purchasedKey = "trial.purchased", betaKey = "trial.betaTester"

    let store: TrialStore
    /// The build switch: false in beta builds (no limit; installs are remembered as beta testers).
    public let enabled: Bool

    public init(store: TrialStore, enabled: Bool) {
        self.store = store
        self.enabled = enabled
        // Anyone who ran a beta build keeps a free unlock when the store version (enabled) replaces it.
        if !enabled { store.set(true, forKey: Self.betaKey) }
    }

    public var completed: Int { store.integer(forKey: Self.completedKey) }
    public var betaTester: Bool { store.bool(forKey: Self.betaKey) }
    /// Cached so the unlock works offline; refreshed from the store's transactions when they're available.
    public var purchased: Bool { store.bool(forKey: Self.purchasedKey) }
    public var unlocked: Bool { !enabled || purchased || betaTester }
    public var remaining: Int { max(0, Self.freeTransfers - completed) }

    /// Whether a new transfer may start. A transfer already under way always finishes, so call this only when a new
    /// session would begin.
    public func canStart(sessionInProgress: Bool) -> Bool {
        unlocked || sessionInProgress || completed < Self.freeTransfers
    }

    /// Call after a transfer is saved (complete and checksum-verified): only those count.
    public func onSaved() { store.set(completed + 1, forKey: Self.completedKey) }

    /// "5 of 10 free transfers used", from the 5th on; nil when there's nothing to show.
    public func counterText() -> String? {
        guard !unlocked, completed >= Self.showCounterFrom else { return nil }
        return "\(min(completed, Self.freeTransfers)) of \(Self.freeTransfers) free transfers used"
    }

    /// The store reported (or no longer reports) the unlock; also used by "Restore purchase".
    public func setPurchased(_ owned: Bool) { store.set(owned, forKey: Self.purchasedKey) }
}

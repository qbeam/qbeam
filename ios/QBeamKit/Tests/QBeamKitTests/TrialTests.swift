// Mirrors android/core TrialTest.kt.
import Testing
@testable import QBeamKit

final class MemoryStore: TrialStore {
    var ints: [String: Int] = [:], bools: [String: Bool] = [:]
    func integer(forKey key: String) -> Int { ints[key] ?? 0 }
    func set(_ value: Int, forKey key: String) { ints[key] = value }
    func bool(forKey key: String) -> Bool { bools[key] ?? false }
    func set(_ value: Bool, forKey key: String) { bools[key] = value }
}

@Test func tenFreeThenBlockedButAnInProgressTransferFinishes() {
    let t = Trial(store: MemoryStore(), enabled: true)
    for _ in 0..<9 { #expect(t.canStart(sessionInProgress: false)); t.onSaved() }
    #expect(t.canStart(sessionInProgress: false))       // the 10th may start
    t.onSaved()
    #expect(t.remaining == 0)
    #expect(!t.canStart(sessionInProgress: false))      // the 11th may not
    #expect(t.canStart(sessionInProgress: true))        // but one already under way finishes
}

@Test func counterShowsFromTheFifth() {
    let t = Trial(store: MemoryStore(), enabled: true)
    for _ in 0..<4 { t.onSaved() }
    #expect(t.counterText() == nil)
    t.onSaved()
    #expect(t.counterText() == "5 of 10 free transfers used")
    for _ in 0..<7 { t.onSaved() }
    #expect(t.counterText() == "10 of 10 free transfers used")
}

@Test func purchaseUnlocksAndCanBeRevoked() {
    let t = Trial(store: MemoryStore(), enabled: true)
    for _ in 0..<10 { t.onSaved() }
    t.setPurchased(true)
    #expect(t.canStart(sessionInProgress: false) && t.counterText() == nil)
    t.setPurchased(false)                                // refunded: the store no longer reports it
    #expect(!t.canStart(sessionInProgress: false))
}

@Test func betaInstallsAreUnlimitedAndKeepAFreeUnlock() {
    let store = MemoryStore()
    let beta = Trial(store: store, enabled: false)
    for _ in 0..<30 { #expect(beta.canStart(sessionInProgress: false)); beta.onSaved() }
    #expect(beta.counterText() == nil)
    let release = Trial(store: store, enabled: true)     // the store version installed over the beta
    #expect(release.betaTester && release.unlocked && release.canStart(sessionInProgress: false))
    #expect(!Trial(store: MemoryStore(), enabled: true).betaTester)   // a fresh store install isn't
}

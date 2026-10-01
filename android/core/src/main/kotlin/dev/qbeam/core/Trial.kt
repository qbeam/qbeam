// The free trial: 10 completed transfers, then a one-time unlock (PLAN.md P3.7). Platform-free so it's unit-tested;
// mirrors ios/QBeamKit Trial.swift. The apps supply storage and the store purchase.
package dev.qbeam.core

class Trial(
    private val store: Store,
    /** The build switch: false in beta builds (no limit; installs are remembered as beta testers). */
    val enabled: Boolean,
) {
    /** Where the counters live (SharedPreferences / UserDefaults in the apps). */
    interface Store {
        fun getInt(key: String): Int
        fun putInt(key: String, value: Int)
        fun getBoolean(key: String): Boolean
        fun putBoolean(key: String, value: Boolean)
    }

    companion object {
        const val FREE_TRANSFERS = 10
        const val SHOW_COUNTER_FROM = 5
        const val PRODUCT_ID = "dev.qbeam.unlock"
        private const val COMPLETED = "trial.completed"
        private const val PURCHASED = "trial.purchased"
        private const val BETA = "trial.betaTester"
    }

    init {
        // Anyone who ran a beta build keeps a free unlock when the store version (enabled = true) replaces it.
        if (!enabled) store.putBoolean(BETA, true)
    }

    val completed get() = store.getInt(COMPLETED)
    val betaTester get() = store.getBoolean(BETA)
    /** Cached so the unlock works offline; refreshed from the store's purchase records when it's reachable. */
    val purchased get() = store.getBoolean(PURCHASED)
    val unlocked get() = !enabled || purchased || betaTester
    val remaining get() = maxOf(0, FREE_TRANSFERS - completed)

    /**
     * Whether a new transfer may start. A transfer already under way always finishes (its codes keep flowing), so
     * call this only when a new session would begin.
     */
    fun canStart(sessionInProgress: Boolean) = unlocked || sessionInProgress || completed < FREE_TRANSFERS

    /** Call after a transfer is saved (complete and checksum-verified): only those count. */
    fun onSaved() = store.putInt(COMPLETED, completed + 1)

    /** "5 of 10 free transfers used", from the 5th on; null when there's nothing to show. */
    fun counterText(): String? =
        if (unlocked || completed < SHOW_COUNTER_FROM) null
        else "${minOf(completed, FREE_TRANSFERS)} of $FREE_TRANSFERS free transfers used"

    /** The store reported (or no longer reports) the unlock; also used by "Restore purchase". */
    fun setPurchased(owned: Boolean) = store.putBoolean(PURCHASED, owned)
}

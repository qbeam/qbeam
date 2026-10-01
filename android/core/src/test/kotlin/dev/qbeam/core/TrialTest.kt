package dev.qbeam.core

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertFalse
import org.junit.jupiter.api.Assertions.assertNull
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

class TrialTest {
    private class MemoryStore : Trial.Store {
        val ints = HashMap<String, Int>(); val bools = HashMap<String, Boolean>()
        override fun getInt(key: String) = ints[key] ?: 0
        override fun putInt(key: String, value: Int) { ints[key] = value }
        override fun getBoolean(key: String) = bools[key] ?: false
        override fun putBoolean(key: String, value: Boolean) { bools[key] = value }
    }

    @Test fun tenFreeThenBlockedButAnInProgressTransferFinishes() {
        val t = Trial(MemoryStore(), enabled = true)
        repeat(9) { assertTrue(t.canStart(false)); t.onSaved() }
        assertTrue(t.canStart(false))           // the 10th may start
        t.onSaved()
        assertEquals(0, t.remaining)
        assertFalse(t.canStart(false))          // the 11th may not
        assertTrue(t.canStart(true))            // but one already under way finishes
    }

    @Test fun counterShowsFromTheFifth() {
        val t = Trial(MemoryStore(), enabled = true)
        repeat(4) { t.onSaved() }
        assertNull(t.counterText())
        t.onSaved()
        assertEquals("5 of 10 free transfers used", t.counterText())
        repeat(7) { t.onSaved() }
        assertEquals("10 of 10 free transfers used", t.counterText())
    }

    @Test fun purchaseUnlocksAndCanBeRevoked() {
        val t = Trial(MemoryStore(), enabled = true)
        repeat(10) { t.onSaved() }
        t.setPurchased(true)
        assertTrue(t.canStart(false)); assertNull(t.counterText())
        t.setPurchased(false)                   // refunded: the store no longer reports it
        assertFalse(t.canStart(false))
    }

    @Test fun betaInstallsAreUnlimitedAndKeepAFreeUnlock() {
        val store = MemoryStore()
        val beta = Trial(store, enabled = false)
        repeat(30) { assertTrue(beta.canStart(false)); beta.onSaved() }
        assertNull(beta.counterText())
        val release = Trial(store, enabled = true) // the store version installed over the beta
        assertTrue(release.betaTester); assertTrue(release.unlocked); assertTrue(release.canStart(false))
        assertFalse(Trial(MemoryStore(), enabled = true).betaTester) // a fresh store install isn't
    }
}

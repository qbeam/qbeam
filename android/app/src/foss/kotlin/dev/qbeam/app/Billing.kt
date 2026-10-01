// The foss flavour has no store and no Google libraries: the trial is off (BuildConfig.TRIAL = false), so this is
// never constructed. It exists so the shared code compiles; the real one is in src/play.
package dev.qbeam.app

import android.app.Activity
import android.content.Context

@Suppress("UNUSED_PARAMETER")
class Billing(context: Context, onOwned: (Boolean) -> Unit, onPrice: (String) -> Unit, private val onError: (String) -> Unit) {
    fun connect() {}
    fun refresh() {}
    fun buy(activity: Activity) = onError("Purchases aren't available in this build.")
    fun close() {}
}

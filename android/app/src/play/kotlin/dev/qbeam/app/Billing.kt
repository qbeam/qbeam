// Google Play Billing for the one-time unlock. Used only when the trial switch is on (BuildConfig.TRIAL).
// There's no server: the app trusts Play's purchase records on the device and caches the result in Trial, so the
// unlock keeps working offline. Play Billing talks to the Play Store app over IPC; the app still has no internet access.
package dev.qbeam.app

import android.app.Activity
import android.content.Context
import com.android.billingclient.api.AcknowledgePurchaseParams
import com.android.billingclient.api.BillingClient
import com.android.billingclient.api.BillingClientStateListener
import com.android.billingclient.api.BillingFlowParams
import com.android.billingclient.api.BillingResult
import com.android.billingclient.api.PendingPurchasesParams
import com.android.billingclient.api.ProductDetails
import com.android.billingclient.api.Purchase
import com.android.billingclient.api.QueryProductDetailsParams
import com.android.billingclient.api.QueryPurchasesParams
import dev.qbeam.core.Trial

class Billing(
    context: Context,
    /** Called (on a Billing thread) with whether the unlock is owned, after a refresh or a purchase. */
    private val onOwned: (Boolean) -> Unit,
    /** Called with the store's localised price once known, e.g. "₹599.00". */
    private val onPrice: (String) -> Unit,
    /** Called with a short message when a purchase can't go ahead. */
    private val onError: (String) -> Unit,
) {
    private var product: ProductDetails? = null
    private val client = BillingClient.newBuilder(context)
        .setListener { result, purchases -> if (result.responseCode == BillingClient.BillingResponseCode.OK) handle(purchases.orEmpty()) }
        .enablePendingPurchases(PendingPurchasesParams.newBuilder().enableOneTimeProducts().build())
        .enableAutoServiceReconnection()
        .build()

    fun connect() = client.startConnection(object : BillingClientStateListener {
        override fun onBillingSetupFinished(result: BillingResult) {
            if (result.responseCode != BillingClient.BillingResponseCode.OK) return // offline: the cached state stands
            refresh()
            val q = QueryProductDetailsParams.Product.newBuilder()
                .setProductId(Trial.PRODUCT_ID).setProductType(BillingClient.ProductType.INAPP).build()
            client.queryProductDetailsAsync(QueryProductDetailsParams.newBuilder().setProductList(listOf(q)).build()) { _, res ->
                product = res.productDetailsList.firstOrNull()
                product?.oneTimePurchaseOfferDetails?.formattedPrice?.let(onPrice)
            }
        }
        override fun onBillingServiceDisconnected() {} // enableAutoServiceReconnection retries on the next call
    })

    /** Re-reads what Play says the user owns ("Restore purchase", and at start). */
    fun refresh() {
        val params = QueryPurchasesParams.newBuilder().setProductType(BillingClient.ProductType.INAPP).build()
        client.queryPurchasesAsync(params) { result, purchases ->
            if (result.responseCode == BillingClient.BillingResponseCode.OK) {
                val owned = handle(purchases)
                if (!owned) onOwned(false) // refunded or never bought; an error leaves the cached state alone
            }
        }
    }

    fun buy(activity: Activity) {
        val p = product ?: return onError("The store isn't reachable right now. Try again in a moment.")
        val params = BillingFlowParams.newBuilder()
            .setProductDetailsParamsList(listOf(BillingFlowParams.ProductDetailsParams.newBuilder().setProductDetails(p).build()))
            .build()
        val r = client.launchBillingFlow(activity, params)
        if (r.responseCode != BillingClient.BillingResponseCode.OK) onError("Couldn't start the purchase (${r.debugMessage}).")
    }

    /** Grants owned purchases (acknowledging new ones, or Play refunds them after 3 days); returns whether owned. */
    private fun handle(purchases: List<Purchase>): Boolean {
        val owned = purchases.filter { Trial.PRODUCT_ID in it.products && it.purchaseState == Purchase.PurchaseState.PURCHASED }
        for (p in owned.filter { !it.isAcknowledged }) {
            client.acknowledgePurchase(AcknowledgePurchaseParams.newBuilder().setPurchaseToken(p.purchaseToken).build()) {}
        }
        if (owned.isNotEmpty()) onOwned(true)
        return owned.isNotEmpty()
    }

    fun close() = client.endConnection()
}

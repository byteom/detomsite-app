package com.detomsite.adminapp

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.SharedPreferences
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.view.View
import android.widget.Button
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import com.detomsite.adminapp.databinding.ActivityMainBinding
import java.util.concurrent.TimeUnit

/* ─── Data models ─── */

/** One order sitting in the admin's confirmation queue. */
data class PendingOrder(
    val orderId: String,
    val notificationId: String,
    val token: String,
    val shopName: String,
    val studentName: String,
    val items: String,
    val total: Int,
    val paymentMethod: String,
    val status: String,
    val deliveryLocation: String,
    val createdAt: String,
)

/** A row in the recent-orders list. */
data class OrderRow(
    val id: String,
    val token: String,
    val shopName: String,
    val studentName: String,
    val items: String,
    val total: Int,
    val paymentMethod: String,
    val status: String,
    val createdAt: String,
)

/** The dashboard headline numbers. */
data class Stats(
    val todayOrders: Int,
    val totalRevenue: Int,
    val totalShops: Int,
    val pendingApprovals: Int,
)

/** What a confirm call reported back, so the UI can say something honest. */
data class ConfirmResult(
    val message: String,
    val alreadyConfirmed: Boolean,
    val whatsappSent: Boolean,
    val whatsappQueued: Boolean,
    val newStatus: String,
)

/**
 * Result of an API call.
 *
 * [SessionExpired] is its own case so every caller can sign the admin out
 * instead of showing "network error" — a rejected token is not a flaky network,
 * and pretending otherwise is what leaves people staring at a dead screen.
 */
sealed class ApiResult<out T> {
    data class Ok<T>(val value: T) : ApiResult<T>()
    data class Failure(val message: String, val code: Int = 0) : ApiResult<Nothing>()
    object SessionExpired : ApiResult<Nothing>()
}

/* ─── Session (base URL + bearer token) ─── */

object Session {
    private const val PREFS = "admin"

    private fun prefs(ctx: Context): SharedPreferences =
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun baseUrl(ctx: Context): String = prefs(ctx).getString("base_url", "").orEmpty()
    fun token(ctx: Context): String = prefs(ctx).getString("token", "").orEmpty()
    fun userName(ctx: Context): String = prefs(ctx).getString("user_name", "Admin").orEmpty()
    fun isSignedIn(ctx: Context): Boolean = token(ctx).isNotBlank()

    fun save(ctx: Context, baseUrl: String, token: String, username: String, name: String) {
        prefs(ctx).edit()
            .putString("base_url", baseUrl)
            .putString("token", token)
            .putString("username", username)
            .putString("user_name", name)
            .apply()
    }

    fun clear(ctx: Context) {
        prefs(ctx).edit().clear().apply()
    }
}

/**
 * The app's single HTTP entry point.
 *
 * Every screen, the foreground poller and the notification's Confirm button all
 * go through here, so the bearer token, the base URL and the error mapping are
 * defined exactly once. Every call has a hard timeout — a request that never
 * answers used to hang a screen forever, which is what left admins staring at a
 * permanent spinner instead of a real "could not reach the server" message.
 */
object ApiClient {

    private val http = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(20, TimeUnit.SECONDS)
        .callTimeout(30, TimeUnit.SECONDS)  // covers connect + write + read
        .retryOnConnectionFailure(true)
        .build()

    private val jsonMedia = "application/json; charset=utf-8".toMediaType()
    private const val UNREACHABLE = "Could not reach the server — check the API URL and your internet."

    private fun url(ctx: Context, path: String): String =
        "${Session.baseUrl(ctx).trimEnd('/')}/api/v1$path"

    private fun auth(ctx: Context) = Request.Builder()
        .header("Authorization", "Bearer ${Session.token(ctx)}")

    /** Pull the server's own error text out of a failed response, when it has one. */
    private fun detailOf(body: String?, fallback: String): String {
        if (body.isNullOrBlank()) return fallback
        return try {
            val detail = JSONObject(body).opt("detail")
            when {
                detail is String && detail.isNotBlank() -> detail
                detail is JSONArray && detail.length() > 0 ->
                    detail.optJSONObject(0)?.optString("msg")?.takeIf { it.isNotBlank() } ?: fallback
                else -> fallback
            }
        } catch (_: Exception) {
            fallback
        }
    }

    private suspend inline fun <T> get(
        ctx: Context,
        path: String,
        crossinline parse: (String) -> T,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        try {
            http.newCall(auth(ctx).url(url(ctx, path)).get().build()).execute().use { resp ->
                val body = resp.body?.string().orEmpty()
                when {
                    resp.code == 401 || resp.code == 403 -> ApiResult.SessionExpired
                    resp.code !in 200..299 ->
                        ApiResult.Failure(detailOf(body, "Server error (HTTP ${resp.code})"), resp.code)
                    else -> ApiResult.Ok(parse(body))
                }
            }
        } catch (e: Exception) {
            ApiResult.Failure(UNREACHABLE)
        }
    }

    private suspend inline fun <T> post(
        ctx: Context,
        path: String,
        body: String,
        crossinline parse: (String) -> T,
    ): ApiResult<T> = withContext(Dispatchers.IO) {
        try {
            val request = auth(ctx).url(url(ctx, path)).post(body.toRequestBody(jsonMedia)).build()
            http.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                when {
                    resp.code == 401 || resp.code == 403 -> ApiResult.SessionExpired
                    resp.code !in 200..299 ->
                        ApiResult.Failure(detailOf(text, "Request failed (HTTP ${resp.code})"), resp.code)
                    else -> ApiResult.Ok(parse(text))
                }
            }
        } catch (e: Exception) {
            ApiResult.Failure(UNREACHABLE)
        }
    }

    /* ── Endpoints ── */

    suspend fun login(
        baseUrl: String, username: String, password: String,
    ): ApiResult<Pair<String, String>> = withContext(Dispatchers.IO) {
        val body = JSONObject().put("username", username).put("password", password).toString()
        try {
            val request = Request.Builder()
                .url("${baseUrl.trimEnd('/')}/api/v1/admin/login")
                .post(body.toRequestBody(jsonMedia))
                .build()
            http.newCall(request).execute().use { resp ->
                val text = resp.body?.string().orEmpty()
                if (resp.code !in 200..299) {
                    return@withContext ApiResult.Failure(
                        detailOf(text, "Sign-in failed (HTTP ${resp.code})"), resp.code
                    )
                }
                val json = JSONObject(text)
                val token = json.optString("access_token")
                if (token.isBlank()) {
                    ApiResult.Failure("Sign-in succeeded but no token came back.")
                } else {
                    val name = json.optJSONObject("user")?.optString("name")
                        ?.takeIf { it.isNotBlank() } ?: username
                    ApiResult.Ok(token to name)
                }
            }
        } catch (e: Exception) {
            ApiResult.Failure(UNREACHABLE)
        }
    }

    /** The orders still waiting for the admin to press Confirm. */
    suspend fun pendingConfirmations(ctx: Context): ApiResult<List<PendingOrder>> =
        get(ctx, "/admin/order-confirmations") { body ->
            val arr = JSONArray(body)
            (0 until arr.length()).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                val orderId = o.optString("order_id")
                if (orderId.isBlank()) return@mapNotNull null
                PendingOrder(
                    orderId = orderId,
                    notificationId = o.optString("notification_id"),
                    token = o.opt("token").toString(),
                    shopName = o.optString("shop_name"),
                    studentName = o.optString("student_name"),
                    items = o.optString("items"),
                    total = o.optInt("total", 0),
                    paymentMethod = o.optString("payment_method", "UPI"),
                    status = o.optString("status"),
                    deliveryLocation = o.optString("delivery_location"),
                    createdAt = o.optString("created_at"),
                )
            }
        }

    /**
     * Confirm one order. The backend marks it Confirmed, WhatsApps the shop
     * automatically and settles the queue row — so this single tap is the whole
     * approval, and the student can then download their payment QR.
     */
    suspend fun confirmOrder(
        ctx: Context, orderId: String, notificationId: String,
    ): ApiResult<ConfirmResult> = post(
        ctx, "/admin/orders/$orderId/confirm",
        JSONObject().put("notification_id", notificationId).toString(),
    ) { body ->
        val json = JSONObject(body)
        ConfirmResult(
            message = json.optString("message").ifBlank { "Order confirmed" },
            alreadyConfirmed = json.optBoolean("already_confirmed", false),
            whatsappSent = json.optBoolean("whatsapp_sent", false),
            whatsappQueued = json.optBoolean("whatsapp_queued", false),
            newStatus = json.optJSONObject("order")?.optString("status").orEmpty()
                .ifBlank { "Confirmed" },
        )
    }

    /** "Not now" — hide the row from the queue without touching the order. */
    suspend fun dismissConfirmation(ctx: Context, notificationId: String): ApiResult<Unit> =
        post(ctx, "/admin/order-confirmations/$notificationId/dismiss", "{}") { }

    /** The newest orders, for the Orders tab. */
    suspend fun recentOrders(ctx: Context): ApiResult<List<OrderRow>> =
        get(ctx, "/admin/orders") { body ->
            val arr = JSONArray(body)
            (0 until minOf(arr.length(), 60)).mapNotNull { i ->
                val o = arr.optJSONObject(i) ?: return@mapNotNull null
                OrderRow(
                    id = o.optString("id"),
                    token = o.opt("token").toString(),
                    shopName = o.optString("shop_name"),
                    studentName = o.optString("student_name"),
                    items = o.optString("items"),
                    total = o.optInt("total", 0),
                    paymentMethod = o.optString("payment_method", "UPI"),
                    status = o.optString("status"),
                    createdAt = o.optString("created_at"),
                )
            }
        }

    suspend fun stats(ctx: Context): ApiResult<Stats> =
        get(ctx, "/admin/dashboard") { body ->
            val s = JSONObject(body).optJSONObject("stats") ?: JSONObject()
            Stats(
                todayOrders = s.optInt("today_orders", 0),
                totalRevenue = s.optInt("total_revenue", 0),
                totalShops = s.optInt("total_shops", 0),
                pendingApprovals = s.optInt("pending_approvals", 0),
            )
        }
}


/**
 * The admin's home screen.
 *
 * Three tabs, one job each:
 *   • Approvals — every order waiting for a Confirm tap (the queue the
 *     notification bell and the Android notification both drive).
 *   • Orders    — the newest orders, also confirmable in place.
 *   • Stats     — today's numbers.
 *
 * Confirming marks the order Confirmed, WhatsApps the shop automatically and
 * lets the student download their payment QR — so one tap clears a whole order.
 *
 * The screen refreshes itself on a timer, but ONLY while it is actually on
 * screen: the old version polled behind a locked phone and also stacked a new
 * request on top of a slow one, which is what made the app feel like it kept
 * reloading. [refreshJob] is cancelled in onStop, and [refreshing] stops a tick
 * from starting while the previous one is still in flight.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main)
    private var refreshJob: Job? = null
    private var currentTab = TAB_APPROVALS
    @Volatile private var refreshing = false

    private val pendingAdapter = PendingOrderAdapter(
        onConfirm = { row -> confirm(row.orderId, row.notificationId, row) },
        onDismiss = { row -> dismiss(row) },
    )
    private val ordersAdapter = OrderRowAdapter(
        onConfirm = { row -> confirm(row.id, "", null) },
    )

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        if (!Session.isSignedIn(this)) {
            goToLogin()
            return
        }

        binding.tvGreeting.text = "Signed in as ${Session.userName(this)}"
        binding.rvPending.adapter = pendingAdapter
        binding.rvOrders.adapter = ordersAdapter

        // The notification toggle decides whether the foreground poller (and the
        // order notification WITH its inline Confirm button) runs at all.
        binding.swNotif.isChecked = getSharedPreferences("admin", Context.MODE_PRIVATE)
            .getBoolean("notif_enabled", false)
        binding.btnGrantNotif.visibility = if (hasNotifPermission()) View.GONE else View.VISIBLE
        binding.swNotif.setOnCheckedChangeListener { _, checked ->
            getSharedPreferences("admin", Context.MODE_PRIVATE).edit()
                .putBoolean("notif_enabled", checked).apply()
            if (checked) AdminNotificationService.start(this) else AdminNotificationService.stop(this)
        }
        binding.btnGrantNotif.setOnClickListener { requestNotifPermission() }

        binding.btnTabApprovals.setOnClickListener { showTab(TAB_APPROVALS) }
        binding.btnTabOrders.setOnClickListener { showTab(TAB_ORDERS) }
        binding.btnTabStats.setOnClickListener { showTab(TAB_STATS) }
        binding.btnRefresh.setOnClickListener { refreshNow() }
        binding.btnLogout.setOnClickListener {
            AdminNotificationService.stop(this)
            Session.clear(this)
            goToLogin()
        }

        showTab(TAB_APPROVALS)
        refreshNow()
    }

    /* ─── Tabs ─── */

    private fun showTab(tab: Int) {
        currentTab = tab
        binding.layoutApprovals.visibility = if (tab == TAB_APPROVALS) View.VISIBLE else View.GONE
        binding.layoutOrders.visibility = if (tab == TAB_ORDERS) View.VISIBLE else View.GONE
        binding.layoutStats.visibility = if (tab == TAB_STATS) View.VISIBLE else View.GONE
        styleTab(binding.btnTabApprovals, tab == TAB_APPROVALS)
        styleTab(binding.btnTabOrders, tab == TAB_ORDERS)
        styleTab(binding.btnTabStats, tab == TAB_STATS)
    }

    private fun styleTab(button: Button, active: Boolean) {
        button.setBackgroundColor(if (active) GOLD else CARD)
        button.setTextColor(if (active) INK else CREAM)
    }

    /* ─── Loading ─── */

    /** Fire one refresh of whatever the visible tab needs. */
    private fun refreshNow() {
        // Never stack a second refresh on top of a slow one — that is what made
        // the app crawl on a weak campus connection.
        if (refreshing) return
        refreshing = true
        binding.btnRefresh.isEnabled = false
        scope.launch {
            var expired = false
            var error: String? = null

            when (val r = ApiClient.pendingConfirmations(this@MainActivity)) {
                is ApiResult.Ok -> {
                    pendingAdapter.submit(r.value)
                    val n = r.value.size
                    binding.tvPendingCount.text = if (n == 0) "" else "$n waiting"
                    binding.btnTabApprovals.text = if (n == 0) "Approvals" else "Approvals ($n)"
                }
                is ApiResult.Failure -> error = r.message
                ApiResult.SessionExpired -> expired = true
            }

            if (currentTab == TAB_ORDERS && !expired) {
                when (val r = ApiClient.recentOrders(this@MainActivity)) {
                    is ApiResult.Ok -> ordersAdapter.submit(r.value)
                    is ApiResult.Failure -> error = r.message
                    ApiResult.SessionExpired -> expired = true
                }
            }

            if (currentTab == TAB_STATS && !expired) {
                when (val r = ApiClient.stats(this@MainActivity)) {
                    is ApiResult.Ok -> showStats(r.value)
                    is ApiResult.Failure -> error = r.message
                    ApiResult.SessionExpired -> expired = true
                }
            }

            binding.tvMessage.visibility = if (expired || error != null) View.VISIBLE else View.GONE
            binding.tvMessage.text = when {
                expired -> "Your session expired — please sign in again."
                error != null -> error!!
                else -> ""
            }
            if (expired) goToLogin()

            refreshing = false
            binding.btnRefresh.isEnabled = true
        }
    }

    private fun showStats(s: Stats) {
        binding.tvStatOrders.text = s.todayOrders.toString()
        binding.tvStatRevenue.text = "₹${s.totalRevenue}"
        binding.tvStatShops.text = s.totalShops.toString()
        binding.tvStatApprovals.text = s.pendingApprovals.toString()
    }

    /* ─── Actions ─── */

    private fun confirm(orderId: String, notificationId: String, pendingRow: PendingOrder?) {
        scope.launch {
            binding.btnRefresh.isEnabled = false
            when (val r = ApiClient.confirmOrder(this@MainActivity, orderId, notificationId)) {
                is ApiResult.Ok -> {
                    val res = r.value
                    val wa = when {
                        res.whatsappSent -> " The shop was notified on WhatsApp."
                        res.whatsappQueued -> " The WhatsApp confirmation is queued in the admin portal."
                        else -> ""
                    }
                    val note = if (res.alreadyConfirmed) "It was already confirmed." else ""
                    toast("${res.message}.$note$wa")
                    // Drop it from the queue immediately, then reconcile with the
                    // server — the list must never sit there offering a button for
                    // something that is already done.
                    pendingRow?.let { row ->
                        pendingAdapter.remove(row.orderId)
                        val left = pendingAdapter.count()
                        binding.tvPendingCount.text = if (left == 0) "" else "$left waiting"
                        binding.btnTabApprovals.text = if (left == 0) "Approvals" else "Approvals ($left)"
                    }
                    refreshNow()
                }
                is ApiResult.Failure -> toast(r.message)
                ApiResult.SessionExpired -> {
                    toast("Your session expired — please sign in again.")
                    goToLogin()
                }
            }
            binding.btnRefresh.isEnabled = true
        }
    }

    private fun dismiss(row: PendingOrder) {
        if (row.notificationId.isBlank()) return
        scope.launch {
            when (val r = ApiClient.dismissConfirmation(this@MainActivity, row.notificationId)) {
                is ApiResult.Ok -> {
                    pendingAdapter.remove(row.orderId)
                    toast("Removed from the queue — the order itself is unchanged.")
                    refreshNow()
                }
                is ApiResult.Failure -> toast(r.message)
                ApiResult.SessionExpired -> goToLogin()
            }
        }
    }

    /* ─── Lifecycle ─── */

    override fun onStart() {
        super.onStart()
        // Poll only while the screen is actually in front of the admin.
        refreshJob?.cancel()
        refreshJob = scope.launch {
            while (isActive) {
                delay(20_000L)
                refreshNow()
            }
        }
    }

    override fun onStop() {
        super.onStop()
        // Backgrounded: stop pulling the whole order list from a locked phone.
        refreshJob?.cancel()
        refreshJob = null
    }

    override fun onDestroy() {
        super.onDestroy()
        scope.cancel()
    }

    /* ─── Helpers ─── */

    private fun hasNotifPermission(): Boolean =
        ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED

    private fun requestNotifPermission() {
        if (Build.VERSION.SDK_INT >= 33) {
            ActivityCompat.requestPermissions(
                this, arrayOf(Manifest.permission.POST_NOTIFICATIONS), REQ_NOTIF
            )
        }
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_LONG).show()

    private fun goToLogin() {
        startActivity(Intent(this, LoginActivity::class.java))
        finish()
    }

    companion object {
        private const val TAB_APPROVALS = 0
        private const val TAB_ORDERS = 1
        private const val TAB_STATS = 2
        private const val REQ_NOTIF = 100

        private val GOLD = Color.parseColor("#F4B400")
        private val CARD = Color.parseColor("#134E4A")
        private val CREAM = Color.parseColor("#D1FAE5")
        private val INK = Color.parseColor("#06251F")
    }
}
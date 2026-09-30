package com.detomsite.adminapp

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch

/**
 * Foreground poller that turns a new order into a notification the admin can act
 * on **without opening the app**.
 *
 * It watches the confirmation queue (`/admin/order-confirmations`) — the same
 * queue the portal's bell and the Approvals tab read — and for each order it has
 * not announced yet it posts a notification carrying a **"Confirm order"**
 * action button. Tapping it fires [ConfirmReceiver], which confirms the order
 * server-side; the shop is WhatsAppped automatically and the student can then
 * download their payment QR.
 *
 * Two things it deliberately does NOT do:
 *  - spam the admin on first run: the first non-empty poll only records a
 *    baseline, so orders placed before the toggle was switched on stay silent;
 *  - re-announce an order it already announced: ids are remembered, so a poll
 *    that finds nothing new stays silent.
 */
class AdminNotificationService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var poller: Job? = null

    companion object {
        const val CHANNEL_ORDERS = "admin_orders"
        const val CHANNEL_RUNNING = "admin_running"

        private const val POLL_MS = 20_000L
        private const val MAX_ANNOUNCE = 5
        private const val PREFS = "admin"

        fun start(context: Context) {
            val i = Intent(context, AdminNotificationService::class.java)
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(i)
            } else {
                context.startService(i)
            }
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, AdminNotificationService::class.java))
        }

        /** Orders already announced — kept as a comma-joined id list. */
        fun seenIds(context: Context): Set<String> =
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
                .getString("announced_ids", "")
                .orEmpty()
                .split(',')
                .filter { it.isNotBlank() }
                .toSet()

        fun rememberSeen(context: Context, ids: Set<String>) {
            // Cap the memory so a long-running service can't grow it forever;
            // 200 ids is far more than a service's worth of orders.
            val trimmed = ids.toList().takeLast(200)
            context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("announced_ids", trimmed.joinToString(","))
                .apply()
        }
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_RUNNING, "Order monitor", NotificationManager.IMPORTANCE_LOW
                )
            )
            val orders = NotificationChannel(
                CHANNEL_ORDERS, "New orders", NotificationManager.IMPORTANCE_HIGH
            )
            orders.enableVibration(true)
            orders.setSound(android.provider.Settings.System.DEFAULT_NOTIFICATION_URI, null)
            // The Confirm button is the whole point — the order must be
            // approvable from the lock screen, so show it on the lockscreen.
            orders.lockscreenVisibility = Notification.VISIBILITY_PUBLIC
            nm.createNotificationChannel(orders)
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForegroundCompat()
        if (poller?.isActive != true) poller = scope.launch { pollLoop() }
        return START_STICKY
    }

    override fun onDestroy() {
        poller?.cancel()
        scope.cancel()
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val n = NotificationCompat.Builder(this, CHANNEL_RUNNING)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("DETOMSITE Admin is on")
            .setContentText("You'll be notified the moment an order needs approving")
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(
            this, 42, n,
            if (Build.VERSION.SDK_INT >= 29) ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC else 0,
        )
    }

    private suspend fun pollLoop() {
        // `scope.isActive` (not a bare `isActive`): pollLoop has no CoroutineScope
        // receiver of its own, so the service's own scope is what says whether
        // the loop should keep going.
        while (scope.isActive) {
            try {
                if (isEnabled()) poll()
            } catch (e: Exception) {
                // A transient network blip is fine — the next tick retries.
            }
            delay(POLL_MS)
        }
    }

    private fun isEnabled(): Boolean {
        val p = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        return p.getBoolean("notif_enabled", false) && Session.isSignedIn(this)
    }

    private suspend fun poll() {
        val pending = when (val r = ApiClient.pendingConfirmations(this)) {
            is ApiResult.Ok -> r.value
            ApiResult.SessionExpired -> {
                // The token was rejected — turn the poller off rather than
                // logging 401s against the server for the rest of the day.
                getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                    .putBoolean("notif_enabled", false).apply()
                stopSelf()
                return
            }
            is ApiResult.Failure -> return
        }

        if (pending.isEmpty()) return
        val prefs = getSharedPreferences(PREFS, Context.MODE_PRIVATE)
        if (!prefs.getBoolean("notif_primed", false)) {
            // First run with a non-empty queue: baseline only, so orders placed
            // before the admin turned this on don't all fire at once.
            rememberSeen(this, seenIds(this) + pending.map { it.orderId }.toSet())
            prefs.edit().putBoolean("notif_primed", true).apply()
            return
        }

        val seen = seenIds(this)
        val fresh = pending.filter { it.orderId !in seen }.take(MAX_ANNOUNCE)
        if (fresh.isEmpty()) return

        // Remember BEFORE notifying: if posting throws we would rather miss a
        // repeat than re-announce the same order on every tick.
        rememberSeen(this, seen + fresh.map { it.orderId }.toSet())
        fresh.forEach { announce(it) }
    }

    /**
     * Post the order notification WITH the inline Confirm action.
     *
     * The action is a broadcast to [ConfirmReceiver], not an Activity intent, so
     * the order can be approved straight from the lock screen with no app launch.
     */
    private fun announce(row: PendingOrder) {
        val content = buildString {
            append("₹${row.total} · ${row.shopName.ifBlank { "Shop" }} · ")
            append(row.studentName.ifBlank { "A student" })
            if (row.items.isNotBlank()) append("\n${row.items}")
        }

        val open = PendingIntent.getActivity(
            this, row.orderId.hashCode(),
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val confirm = PendingIntent.getBroadcast(
            this, row.orderId.hashCode() + 1,
            Intent(this, ConfirmReceiver::class.java).apply {
                action = ConfirmReceiver.ACTION_CONFIRM
                putExtra(ConfirmReceiver.EXTRA_ORDER_ID, row.orderId)
                putExtra(ConfirmReceiver.EXTRA_NOTIFICATION_ID, row.notificationId)
                putExtra(ConfirmReceiver.EXTRA_TOKEN, row.token)
            },
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )

        val n = NotificationCompat.Builder(this, CHANNEL_ORDERS)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle("New order #${row.token} — confirm")
            .setContentText(content.lineSequence().first())
            .setStyle(NotificationCompat.BigTextStyle().bigText(content))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            .setContentIntent(open)
            .addAction(0, "Confirm order", confirm)
            .build()

        try {
            NotificationManagerCompat.from(this).notify(row.orderId.hashCode(), n)
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted — nothing to do here.
        }
    }
}

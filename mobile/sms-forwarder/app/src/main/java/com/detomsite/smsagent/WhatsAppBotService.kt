package com.detomsite.smsagent

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.Uri
import android.os.Build
import android.os.IBinder
import android.provider.Settings
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
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
import java.util.concurrent.TimeUnit

/**
 * Detomsite WhatsApp bot (phone-side).
 *
 * Guarantee: a WhatsApp message reaches the shopkeeper with **no tap from the
 * human** — the moment the backend says an order is ready to deliver (COD placed
 * or UPI payment verified), this foreground service:
 *
 *   1. Polls ``GET /api/v1/local/whatsapp/pending`` (holding the same agent
 *      key as the SMS forwarding).
 *   2. Opens WhatsApp with the order message pre-filled for the shop's number.
 *   3. [WhatsAppAccessibilityService] verifies the pre-filled text is on screen
 *      and taps Send; this service then confirms delivery via
 *      ``POST /whatsapp/{id}/mark-sent`` so the admin centre reflects it.
 *
 * Messages still labelled "awaiting payment" are skipped by the backend
 * intentionally — the bot waits for the verified "paid ✓" version.
 */
class WhatsAppBotService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)

    /**
     * ONE shared HTTP client for the whole service.
     *
     * A new [OkHttpClient] was previously built on every poll and every
     * mark-sent. Each one owns its own connection pool AND its own dispatcher
     * thread pool, which are only torn down when the client is garbage
     * collected — so a bot left running overnight quietly accumulated dozens of
     * idle threads and sockets. On a cheap phone that shows up as the bot
     * getting slower, then hanging, then needing a force-stop.
     *
     * Reused clients are the intended usage: OkHttp pools connections and
     * reuses threads, which is exactly what a 20-second poll loop wants.
     */
    private val http: OkHttpClient by lazy {
        OkHttpClient.Builder()
            // BUG FIX (bot never sees a message). These were 10 s, but the
            // backend is a Vercel serverless function that boots PER REQUEST and
            // measures 7.5–14 s cold in production. So on a cold instance the
            // queue poll was aborted client-side before the server replied, the
            // bot logged "pending → ?" and moved on — and since every later poll
            // in that window also hit a cold or busy instance, the shop could go
            // hours without its order. This is the single most likely reason
            // "the bot does nothing".
            //
            // A poll that takes 20 s is still only one message per cycle, so
            // throughput is unchanged; it just stops discarding the answer.
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(25, TimeUnit.SECONDS)
            .build()
    }
    private var poller: Job? = null

    /** id → when we last launched WhatsApp, so a stuck send retries. */
    private val inFlight = HashMap<String, Long>()

    /** ids already auto-sent on this device — never opened for a second time
     * even if the mark-sent confirmation POST failed (a duplicate WhatsApp to
     * the shop is worse than a Pending row the admin can clear).
     *
     * BOUNDED. This set only ever grows, so a bot left running for weeks on a
     * shopkeeper's phone accumulated an entry for every order ever sent — a slow
     * memory leak. Only the RECENT ids are needed: the server now durably
     * claims each message (status 'Sending'), so a re-offer after a restart is
     * already blocked server-side and this set is only a fast local guard for
     * the last few messages. */
    private val delivered = LinkedHashSet<String>()

    /**
     * Load the persisted delivery ledger at service start.
     *
     * BUG FIX (duplicate WhatsApp after a restart). `delivered` was in-memory
     * only, so every restart forgot which messages had already gone out. The
     * server's claim only holds a row for 5 minutes; a bot restarted after that
     * (Android kills a foreground service under memory pressure all the time)
     * would be handed the SAME row again and message the shop a second time.
     * The server cannot fix this alone — it cannot tell "never sent" from
     * "sent, but the mark-sent POST never landed".
     */
    private fun loadDelivered() {
        val raw = getSharedPreferences("agent", Context.MODE_PRIVATE)
            .getString("wa_delivered", "").orEmpty()
        synchronized(delivered) {
            delivered.clear()
            raw.split(',').filter { it.isNotBlank() }.forEach { delivered.add(it) }
        }
        if (delivered.isNotEmpty()) Log.i(TAG, "restored ${delivered.size} delivered ids")
    }

    /** Remember a delivery, dropping the oldest once the set is full. */
    private fun rememberDelivered(id: String) {
        synchronized(delivered) {
            delivered.add(id)
            while (delivered.size > DELIVERED_MEMORY) {
                val oldest = delivered.iterator().next()
                delivered.remove(oldest)
            }
            persistDelivered()
        }
    }

    /**
     * Persist immediately rather than on a timer.
     *
     * The previous behaviour kept the ledger in memory and only the in-flight
     * map in the process, so a crash between the WhatsApp send and the next poll
     * lost the fact entirely. This is written on every send (a handful per day),
     * so the write cost is irrelevant next to losing the guarantee.
     */
    private fun persistDelivered() {
        val snapshot = synchronized(delivered) { delivered.joinToString(",") }
        getSharedPreferences("agent", Context.MODE_PRIVATE)
            .edit().putString("wa_delivered", snapshot).apply()
    }

    private fun alreadyDelivered(id: String): Boolean = synchronized(delivered) { id in delivered }

    /** Last time a guidance notification was shown (throttled to 5 min). */
    private var lastGuidanceAt = 0L

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        if (instance == null) instance = this
        startForegroundCompat()
        if (poller?.isActive != true) {
            loadDelivered()
            poller = scope.launch { pollLoop() }
        }
        return START_STICKY
    }

    override fun onDestroy() {
        poller?.cancel()
        if (instance === this) instance = null
        super.onDestroy()
    }

    private fun startForegroundCompat() {
        val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            nm.createNotificationChannel(
                NotificationChannel(CHANNEL, "WhatsApp bot", NotificationManager.IMPORTANCE_LOW)
            )
        }
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle("WhatsApp bot is on")
            .setContentText("Orders are auto-sent to shops on WhatsApp")
            .setOngoing(true)
            .build()
        ServiceCompat.startForeground(this, 42, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    }

    private suspend fun pollLoop() {
        while (scope.isActive) {
            val started = System.currentTimeMillis()
            try {
                if (isEnabled()) awaitOutbox()
            } catch (e: Exception) {
                Log.w(TAG, "poll error: ${e.message}")
            }
            // Sleep the REMAINDER of the interval, not the whole interval.
            //
            // BUG FIX (messages arrive very late). A cold poll can take ~14 s on
            // its own, and the loop then slept a further 20 s, so a cycle was
            // ~34 s. A three-shop order needs three cycles, and each shop's
            // message therefore arrived half a minute or more after the one
            // before it — the queue crawled. Measuring from the start of the
            // work keeps the cadence at a steady 20 s however slow the call was.
            val elapsed = System.currentTimeMillis() - started
            delay((POLL_INTERVAL_MS - elapsed).coerceAtLeast(1_000L))
        }
    }
    private fun isEnabled(): Boolean {
        val p = getSharedPreferences("agent", Context.MODE_PRIVATE)
        return p.getBoolean("wa_bot_enabled", false) &&
                p.getString("agent_key", null) != null
    }

    private fun baseUrl(): String {
        val p = getSharedPreferences("agent", Context.MODE_PRIVATE)
        // Normalised for the same reason as the SMS path: a value saved before
        // normalisation (or typed without https://) would otherwise make the
        // WhatsApp queue poll fail forever with no visible error.
        return normalizeBackendUrl(p.getString("base_url", "").orEmpty())
    }

    private suspend fun awaitOutbox() {
        val root = baseUrl()
        val key = getSharedPreferences("agent", Context.MODE_PRIVATE)
            .getString("agent_key", "").orEmpty()
        if (root.isEmpty() || key.isEmpty()) return
        if (!whatsAppInstalled()) {
            notifyGuidance("WhatsApp is not installed — install it to auto-send.")
            return
        }

        // BUG FIX (stuck outbox = "no WhatsApp ever arrives"). This poll used to
        // run even while a send was still pending, so it could claim a SECOND
        // message and overwrite the single outbox slot that
        // WhatsAppAccessibilityService is waiting on. The first message's tap
        // then either fired against the wrong chat or never fired at all, and
        // because the new id had replaced it, the first message was never
        // confirmed — so it stayed 'Sending' server-side and eventually came
        // back around. Waiting for the current send to settle is what makes
        // "one message at a time" actually true on the phone.
        //
        // REGRESSION FIX (messages arriving very late). This guard was first
        // written with the 8-minute RETRY_WINDOW_MS, which meant one stuck send
        // blocked the ENTIRE queue for 8 minutes — every other shop's order
        // waited behind it. A send that is going to work completes in seconds
        // (the accessibility tap follows the message within ~1.3 s), so the
        // guard only needs to outlast a normal send, not the retry window. On
        // expiry the stuck send is abandoned WITHOUT being marked delivered, so
        // the server still re-offers it and the other shops are not held up.
        if (AutoSendState.id != null) {
            val launched = System.currentTimeMillis() - AutoSendState.launchedAt
            if (launched < OUTBOX_BUSY_MS) return
            Log.w(TAG, "outbox occupied ${launched}ms without completing — abandoning")
            // Deliberately NOT inFlight.remove()/rememberDelivered(): the send
            // did not happen, so this id must stay eligible on the server.
            inFlight.remove(AutoSendState.id)
            AutoSendState.clear()
        }

        val pending = fetchPending(root, key) ?: return
        // ONE message per poll cycle. The outbox is a single slot shared with
        // the accessibility service — firing several WhatsApp intents back to
        // back overwrote it, so only the LAST shop's message ever reached the
        // screen (multi-shop orders then retried the same last-shop message on
        // every later cycle). Sending one, waiting for Send, then polling again
        // delivers every shop its own message.
        val item = (0 until pending.length())
            .map { pending.getJSONObject(it) }
            .firstOrNull { entry ->
                val id = entry.optString("id")
                id.isNotBlank() && !alreadyDelivered(id) && !isRecentlyLaunched(id) &&
                    normalizePhone(entry.optString("phone")).isNotEmpty()
            } ?: return
        val id = item.optString("id")
        val now = System.currentTimeMillis()
        if (!canStartFromBackground()) {
            notifyGuidance("Allow “Display over other apps” so the bot can auto-open WhatsApp.")
            return
        }
        if (inFlight[id] == null) notifySending(item.optString("sub_order_id"), item.optString("phone"))
        inFlight[id] = now
        openWhatsApp(id, item.optString("phone"), item.optString("message"))
    }

    /**
     * Launched within the retry window and still waiting for accessibility?
     *
     * BUG FIX (window mismatch + unbounded growth). This used to be 3 minutes,
     * while the server's claim expires after 5. So between minute 3 and minute 5
     * the bot considered a message "not recently launched" and would re-open
     * WhatsApp for it — while the server was STILL holding the claim, so the
     * same shop got the same order a second time. The two windows have to agree,
     * and the local one must be the LONGER of the two, otherwise the bot
     * re-sends inside the period the server believes is already handled.
     *
     * It also never removed entries for ids that were neither delivered nor
     * retried, so `inFlight` grew for the life of the process. Entries are now
     * dropped once they are older than the window.
     */
    private fun isRecentlyLaunched(id: String): Boolean {
        val launched = inFlight[id] ?: return false
        val age = System.currentTimeMillis() - launched
        if (age >= RETRY_WINDOW_MS) {
            inFlight.remove(id)
            return false
        }
        return true
    }

    private suspend fun fetchPending(root: String, key: String): JSONArray? = withContext(Dispatchers.IO) {
        try {
            val req = Request.Builder()
                .url("$root/api/v1/local/whatsapp/pending")
                .header("X-Agent-Key", key)
                .build()
            val client = http
            client.newCall(req).execute().use { resp ->
                if (resp.code !in 200..299) {
                    Log.w(TAG, "pending → ${resp.code}")
                    return@withContext null
                }
                JSONArray(resp.body?.string().orEmpty())
            }
        } catch (e: Exception) {
            Log.w(TAG, "fetchPending failed: ${e.message}")
            null
        }
    }

    private fun normalizePhone(phone: String): String {
        var digits = phone.filter { it.isDigit() }
        // Strip a domestic trunk prefix ("09876543210" → "9876543210") and an
        // explicit country code ("919876543210") down to the 10-digit mobile
        // before wa.me addressing; otherwise a 12-digit string that is NOT a
        // valid Indian mobile would be sent as-is and open the wrong chat.
        if (digits.length == 11 && digits.startsWith("0")) digits = digits.substring(1)
        return when {
            digits.isEmpty() -> ""
            digits.length == 10 -> "91$digits"
            digits.length == 12 && digits.startsWith("91") -> digits
            else -> ""
        }
    }

    private fun openWhatsApp(id: String, phone: String, message: String) {
        val digits = normalizePhone(phone)
        if (digits.isEmpty()) {
            // Poison entry (no usable shop number): record the attempt so this
            // poll cycle skips it instead of wedging the whole outbox behind it.
            inFlight[id] = System.currentTimeMillis()
            return
        }
        val text = message.let {
            Uri.encode(it)
        }
        val waUri = Uri.parse("https://wa.me/$digits?text=$text")
        AutoSendState.begin(id, digits, message)
        try {
            val intent = Intent(Intent.ACTION_VIEW, waUri)
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            val pkg = if (packageManager.hasApplication("com.whatsapp")) "com.whatsapp" else "com.whatsapp.w4b"
            intent.setPackage(pkg)
            startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "openWhatsApp failed: ${e.message}")
            inFlight.remove(id)
            AutoSendState.clear()
        }
    }

    /**
     * Confirmed by the accessibility service: Send was tapped.
     *
     * The id is remembered locally BEFORE the network call on purpose: a
     * duplicate WhatsApp to a shop is far worse than a row the admin can
     * re-send by hand, and the server cannot distinguish "never sent" from
     * "sent but the confirmation was lost". So the local ledger is the
     * authority on what this phone has already sent.
     */
    fun confirmSent(id: String) {
        notificationManager().cancel(SENDING)
        rememberDelivered(id)
        inFlight.remove(id)
        if (AutoSendState.id == id) AutoSendState.clear()
        scope.launch { markSent(id) }
    }

    /**
     * Tell the server the message went out. Returns true on success.
     *
     * A failure is logged but NOT retried and does NOT un-deliver the message:
     * the shop genuinely has it, so re-offering the row would produce the
     * duplicate this whole ledger exists to prevent. The row simply stays
     * 'Sending' server-side and ages out, and the admin centre shows it as
     * unsent, which is the honest state.
     */
    private suspend fun markSent(id: String) {
        val root = baseUrl()
        val key = getSharedPreferences("agent", Context.MODE_PRIVATE)
            .getString("agent_key", "").orEmpty()
        if (root.isEmpty() || key.isEmpty()) return
        try {
            val req = Request.Builder()
                .url("$root/api/v1/local/whatsapp/${Uri.encode(id)}/mark-sent")
                .post("{}".toRequestBody(JSON_MEDIA))
                .header("Content-Type", "application/json")
                .header("X-Agent-Key", key)
                .build()
            http.newCall(req).execute().use { resp ->
                    Log.i(TAG, "mark-sent → ${resp.code}")
                }
        } catch (e: Exception) {
            Log.w(TAG, "markSent failed: ${e.message}")
        }
    }

    private fun whatsAppInstalled(): Boolean =
        try {
            packageManager.getApplicationInfo("com.whatsapp", 0)
            true
        } catch (e: PackageManager.NameNotFoundException) {
            false
        }

    private fun canStartFromBackground(): Boolean =
        Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)

    private fun notificationManager(): NotificationManager =
        getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    private fun notifyGuidance(text: String) {
        val now = System.currentTimeMillis()
        if (now - lastGuidanceAt < 5 * 60_000L) return
        lastGuidanceAt = now
        notify(GUIDANCE, text, false)
    }

    private fun notifySending(orderId: String, phone: String) {
        notify(SENDING, "Sending WhatsApp to +${normalizePhone(phone)} (order $orderId)…", true)
    }

    private fun notify(code: Int, text: String, ongoing: Boolean) {
        try {
            val nm = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "WhatsApp bot", NotificationManager.IMPORTANCE_LOW)
                )
            }
            val n = NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle("WhatsApp bot")
                .setContentText(text)
                .setAutoCancel(!ongoing)
                .build()
            nm.notify(code, n)
        } catch (e: Exception) {
            Log.d(TAG, "notify skipped: ${e.message}")
        }
    }

    companion object {
        private const val TAG = "DetomsiteWABot"
        private const val CHANNEL = "detomsite_wa_bot"
        /** How many recently-sent ids to remember locally. See [delivered]. */
        private const val DELIVERED_MEMORY = 200

        /**
         * How long one message stays "being worked on" locally.
         *
         * MUST be >= the server's claim staleness (5 min, see
         * `claim_next_whatsapp_log`). If it were shorter the bot would treat a
         * message as retryable while the server still considered it in-flight,
         * and would re-open WhatsApp for it — the duplicate the shopkeeper sees.
         * The margin absorbs clock skew and poll-alignment.
         */
        private const val RETRY_WINDOW_MS = 8 * 60_000L

        /**
         * How long the single outbox slot may be occupied before the send is
         * abandoned and the queue moves on.
         *
         * A send that is going to succeed completes in about a second: the
         * accessibility tap follows the pre-filled message within ~1.3 s. So
         * anything still pending after 45 s is not going to complete, and
         * holding the queue for the full retry window made every OTHER shop's
         * order wait behind one stuck message — the "messages arrive very late"
         * symptom. The abandoned id is NOT marked delivered, so the server
         * re-offers it and nothing is lost.
         */
        private const val OUTBOX_BUSY_MS = 45_000L

        /**
         * Gap between queue polls.
         *
         * 20 s is comfortably inside the server's own throttle for this feed
         * (30/min per client), so the bot can never lock itself out, while
         * keeping a single-shop order to the shop's phone within half a minute.
         */
        private const val POLL_INTERVAL_MS = 20_000L

        private const val SENDING = 70
        private const val GUIDANCE = 71

        @Volatile var instance: WhatsAppBotService? = null

        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

        fun start(context: Context) {
            context.startForegroundService(Intent(context, WhatsAppBotService::class.java))
        }
    }
}

private fun android.content.pm.PackageManager.hasApplication(pkg: String): Boolean =
    try {
        getApplicationInfo(pkg, 0)
        true
    } catch (e: android.content.pm.PackageManager.NameNotFoundException) {
        false
    }
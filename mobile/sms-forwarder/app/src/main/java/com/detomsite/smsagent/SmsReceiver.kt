package com.detomsite.smsagent

import android.annotation.SuppressLint
import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import android.provider.Telephony
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.Data
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Detomsite privacy-first SMS Forwarding Agent.
 *
 * Runs on the shopkeeper's phone. When a bank credit SMS arrives:
 *   1. Extracts the UTR and amount **entirely on-device** (the raw SMS text
 *      never leaves the phone).
 *   2. Sends only `{ phone, utr, amount }` to ``POST /api/v1/local/sms/match``.
 *   3. The backend matches amount + shop → order auto-Confirmed → WhatsApp fired.
 *
 * **Privacy:** The server never sees the bank SMS body — no balances, no
 * account details, no sender ID. Only the transaction proof (UTR + amount)
 * crosses the wire.
 */
class SmsReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return

        val prefs = context.getSharedPreferences("agent", Context.MODE_PRIVATE)
        if (!prefs.getBoolean("enabled", true)) return
        val baseUrl = prefs.getString("base_url", "").orEmpty().trimEnd('/')
        val agentKey = prefs.getString("agent_key", "").orEmpty()
        if (baseUrl.isEmpty() || agentKey.isEmpty()) return

        val messages = Telephony.Sms.Intents.getMessagesFromIntent(intent) ?: return
        val builder = StringBuilder()
        messages.forEach { msg ->
            val body = msg?.displayMessageBody ?: ""
            if (body.isNotEmpty()) {
                if (builder.isNotEmpty()) builder.append(' ')
                builder.append(body)
            }
        }
        val text = builder.toString().trim()
        if (text.isEmpty()) return
        if (!isBankCreditSms(text)) return

        // ── On-device extraction: UTR + amount stay local, raw text never leaves ──
        // The UTR is OPTIONAL. Most real bank credit SMS carry no reference at
        // all ("Rs 80 credited to your a/c ending 1234"), and that is exactly
        // the QR-checkout case: the student scans the QR and never types a UTR,
        // so there is nothing to claim. The server's tier-2 match settles those
        // orders on amount + shop + recency alone. Bailing out here (the old
        // `?: return`) silently dropped every such credit, so the student paid
        // and the order sat unpaid forever — "the bot sometimes just doesn't
        // work". Send the amount even with no UTR and let the server decide.
        val utr = extractUtr(text).orEmpty()
        val amount = extractAmount(text) ?: return

        Log.i(TAG, "On-device: UTR=${utr.ifEmpty { "<none>" }} amount=$amount — sending proof only")

        // ── Keep the process alive until the proof is actually sent ──
        // A bare `CoroutineScope(...).launch {}` from onReceive is fire-and-forget:
        // onReceive returns immediately, the system is then free to kill this
        // process, and the HTTP POST dies with it. That is the single biggest
        // reason the bot "sometimes just doesn't work" — the credit SMS arrives,
        // the order still sits unpaid. goAsync() holds a BroadcastReceiver
        // PendingResult open (Android allows ~10 s) until we call finish(), which
        // covers the request comfortably.
        val pending = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                sendProof(context, baseUrl, agentKey, utr, amount)
            } finally {
                // Always release, or the broadcast stays "in progress" and the
                // system eventually force-finishes the whole app.
                try { pending.finish() } catch (e: Exception) { Log.d(TAG, "finish skipped: ${e.message}") }
            }
        }
    }

    private fun isBankCreditSms(text: String): Boolean {
        val lower = text.lowercase()
        // A debit/outgoing SMS is never a payment proof — never match against
        // it even if it happens to mention "upi"/"utr"/"ref".
        if (listOf(
                "debited", " debit", "deducted", "paid out", "spent",
                "transferred to", "withdrawn", "withdrawal", "paid to",
                "purchase", "debited:", "debit:"
            ).any { lower.contains(it) }) return false
        // OTP / request spam that mentions an amount must not pass even with
        // credit-adjacent words elsewhere in the message.
        if (lower.contains("otp") || lower.contains("one time password")) return false
        return listOf(
            "credited", " credit ", "deposited", "received", "rcvd",
            "cr ", "cr:", "cr.", "jama", "prapt"
        ).any { lower.contains(it) }
    }

    /** Extract UTR on-device. Never sent: sender, balance, account, raw text. */
    private fun extractUtr(text: String): String? {
        val patterns = listOf(
            Regex("(?i)\\butr\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\brrn\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\bupi\\s*(?:ref|txn|transaction)?\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\btransaction\\s*(?:id|no)?\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\btxn\\s*(?:no|id)?\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\bref\\s*(?:erence|\\.|no|#)?\\s*[:.]?\\s*([a-z0-9]{6,30})"),
        )
        for (p in patterns) {
            val hit = p.find(text)?.groupValues?.get(1)?.uppercase().orEmpty()
            if (hit.length in 6..30 && !isPhoneShaped(hit)) return hit
        }
        // Bare 12-digit UPI reference (usually starts with 4) with no label.
        // Phone-shaped 10-digit numbers starting 6-9 are explicitly excluded
        // so a sender/footer number is never filed as a UTR.
        Regex("(?<![a-z0-9])(4\\d{11})(?![a-z0-9])").find(text)?.let { return it.groupValues[1] }
        return null
    }

    private fun isPhoneShaped(code: String): Boolean {
        val digits = code.filter { it.isDigit() }
        // 10-digit Indian mobile starting 6-9 with no letters = phone, not UTR.
        return code.all { it.isDigit() } && digits.length == 10 && digits[0] in "6789"
    }

    /** Extract the credited amount on-device. Supports Rs/INR/₹/रु/रू. */
    private fun extractAmount(text: String): Double? {
        val regex = Regex("(?:Rs\\.?|INR|₹|रु|रू|\\bCr\\.?)\\s*([\\d,]+(?:\\.\\d{1,2})?)", RegexOption.IGNORE_CASE)
        val matches = regex.findAll(text).toList()

        val lower = text.lowercase()
        val creditCues = listOf(
            "credited", "deposited", "received", "rcvd", "successful", "credit", "jama", "prapt"
        )

        // Prefer the amount whose surroundings mention a credit cue, so a
        // balance mention ("Available balance Rs 5,000") is never chosen over
        // the ₹80 credit. A value labelled as balance/available/avl within a
        // 30-char window is never the credit. With no credit cue at all, drop
        // the SMS for manual review instead of guessing the trailing balance.
        if (matches.isEmpty()) return null
        var best: MatchResult? = null
        var bestDist = Int.MAX_VALUE
        for (m in matches) {
            val before = lower.substring(maxOf(0, m.range.first - 30), m.range.first)
            if (listOf("bal", "balance", "available", "avl").any { it in before }) continue
            val start = maxOf(0, m.range.first - 30)
            val end = minOf(text.length, m.range.last + 30)
            val window = lower.substring(start, end)
            val cuePos = creditCues.map { window.indexOf(it) }.filter { it >= 0 }.minOrNull()
                ?: continue
            val dist = kotlin.math.abs((m.range.first - start) - cuePos)
            if (dist < bestDist) {
                bestDist = dist
                best = m
            }
        }

        val chosen = best ?: return null
        return try {
            chosen.groupValues[1].replace(",", "").toDouble()
        } catch (e: Exception) { null }
    }

    /** Send only {phone, utr, amount} — never the raw SMS. */
    private suspend fun sendProof(
        context: Context, baseUrl: String, agentKey: String, utr: String, amount: Double
    ) {
        // Hoisted OUT of the try so the catch block can retry with them: a
        // local declared inside the try is not in scope in the catch, and the
        // first version of this fix could not compile for exactly that reason.
        var request: Request? = null
        var client: OkHttpClient? = null
        try {
            // Accept both "https://host" and "https://host/api/v1/local" as the
            // saved base URL — never double-append the path. normalizeBackendUrl
            // also repairs a stored value saved before normalisation (or typed
            // without a scheme), so an old install recovers instead of failing
            // every incoming bank SMS.
            val root = normalizeBackendUrl(baseUrl)
            val phone = configuredPhone(context, context.getSharedPreferences("agent", Context.MODE_PRIVATE))
            if (phone.isEmpty()) {
                notifyRejected(context, "Shop phone not set or invalid — open the app and save a 10-digit mobile number.")
                return
            }
            val json = JSONObject()
                .put("phone", phone)
                .put("utr", utr)
                .put("amount", amount)
            val body = json.toString().toRequestBody(JSON_MEDIA)
            request = Request.Builder()
                .url("$root/api/v1/local/sms/match")
                .post(body)
                .header("Content-Type", "application/json")
                .header("X-Agent-Key", agentKey)
                .build()
            // goAsync budget: per Android BroadcastReceiver docs the receiver must
            // finish in ~10s (30s max for non-foreground broadcasts like
            // SMS_RECEIVED). So ONE fast attempt lives here (5s connect / 8s
            // read) and every retry/durable delivery moves to WorkManager
            // (ProofRetryWorker: persisted + exponential backoff + CONNECTED),
            // which survives Doze, process death and cold serverless starts.
            // In-receiver sleep+retry loops are what got the process killed
            // mid-retry before.
            client = OkHttpClient.Builder()
                .connectTimeout(5, TimeUnit.SECONDS)
                .readTimeout(8, TimeUnit.SECONDS)
                .writeTimeout(5, TimeUnit.SECONDS)
                .build()
            client!!.newCall(request!!).execute().use { resp ->
                val code = resp.code
                val bodyText = resp.body?.string().orEmpty()
                Log.i(TAG, "sms/match → $code: ${bodyText.take(120)}")
                if (code in 200..299) {
                    val matchedBy = runCatching { JSONObject(bodyText).optString("matched_by") }.getOrDefault("")
                    val token = runCatching { JSONObject(bodyText).optString("order_id") }.getOrDefault("")
                    notifySent(
                        context,
                        if (matchedBy == "utr_claim") "UTR $utr ✓ — order $token completed"
                        else "₹${amount.toInt()} received ✓ — order $token completed"
                    )
                } else {
                    // A rejection used to be written to logcat and nowhere else,
                    // so the shopkeeper saw "the bot didn't work" with no clue
                    // why. The server sends a plain-language reason, so show it.
                    val reason = rejectionReason(bodyText)
                    Log.w(TAG, "Match rejected ($code): $reason")
                    // Retry via WorkManager ONLY on a server-side error. A 5xx can
                    // be a cold start or a blip; a 429/4xx is deliberate and an
                    // immediate retry only burns budget. The worker carries
                    // CONNECTED + exponential backoff and survives process death.
                    if (code in 500..599 || code == 429) {
                        enqueueProofRetry(context, baseUrl, agentKey, phone, utr, amount)
                    }
                    notifyRejected(context, reason)
                }
            }
        } catch (e: Exception) {
            // Network/IO failure: the SMS is NOT redelivered, so hand the proof
            // to WorkManager (persisted + CONNECTED + exponential backoff). The
            // match endpoint is idempotent per credit, so a duplicate delivery
            // from the worker is safe (replay -> 409, never double-settles).
            Log.e(TAG, "sendProof failed (${e.message}) — enqueuing WorkManager retry")
            enqueueProofRetry(context, baseUrl, agentKey,
                configuredPhone(context, context.getSharedPreferences("agent", Context.MODE_PRIVATE)),
                utr, amount)
            notifyRejected(context, "Could not reach DETOMSITE — queued for retry.")
        }
    }

    private fun enqueueProofRetry(
        context: Context, baseUrl: String, agentKey: String, phone: String, utr: String, amount: Double
    ) {
        try {
            if (baseUrl.isEmpty() || agentKey.isEmpty() || phone.isEmpty() || amount <= 0) return
            val input = Data.Builder()
                .putString(ProofRetryWorker.KEY_BASE_URL, baseUrl)
                .putString(ProofRetryWorker.KEY_AGENT_KEY, agentKey)
                .putString(ProofRetryWorker.KEY_PHONE, phone)
                .putString(ProofRetryWorker.KEY_UTR, utr)
                .putDouble(ProofRetryWorker.KEY_AMOUNT, amount)
                .build()
            val constraints = Constraints.Builder()
                .setRequiredNetworkType(NetworkType.CONNECTED)
                .build()
            val work = OneTimeWorkRequestBuilder<ProofRetryWorker>()
                .setInputData(input)
                .setConstraints(constraints)
                .setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 30, TimeUnit.SECONDS)
                .build()
            // Unique per credit so rapid duplicate SMS don't stack workers; KEEP
            // preserves the first queued proof.
            WorkManager.getInstance(context.applicationContext).enqueueUniqueWork(
                "proof-${phone.takeLast(10)}-${utr.ifEmpty { "no-utr" }}-${amount.toInt()}",
                ExistingWorkPolicy.KEEP, work
            )
        } catch (e: Exception) { Log.d(TAG, "enqueue retry skipped: ${e.message}") }

    /** Pull the server's human-readable reason out of an error body. */
    private fun rejectionReason(body: String): String = try {
        JSONObject(body).optString("detail").ifBlank { "the payment did not match an order" }
    } catch (e: Exception) {
        "the payment did not match an order"
    }

    private fun configuredPhone(context: Context, prefs: android.content.SharedPreferences): String {
        return normalizeIndianMobile(
            prefs.getString("phone", "").orEmpty().ifBlank { localNumber(context) }
        )
    }

    companion object {
        /** Single Indian-mobile normalizer shared by SMS + test paths.
         * Returns "" when unusable so callers never POST a bare "+91". */
        fun normalizeIndianMobile(raw: String): String {
            var digits = raw.filter { it.isDigit() }
            if (digits.startsWith("91") && digits.length == 12) digits = digits.substring(2)
            if (digits.startsWith("0") && digits.length == 11) digits = digits.substring(1)
            if (digits.length != 10 || digits[0] !in "6789") return ""
            return "+91$digits"
        }
    }

    @SuppressLint("MissingPermission")
    private fun localNumber(context: Context): String {
        return try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as android.telephony.TelephonyManager
            tm.line1Number ?: ""
        } catch (e: Exception) { "" }
    }

    private fun notifySent(context: Context, preview: String) {
        postNotification(context, "Payment proof sent ✓", preview, idFor(preview))
    }

    /** A credit the bot could NOT settle — say so on the phone, not just in logcat. */
    private fun notifyRejected(context: Context, reason: String) {
        postNotification(context, "Payment needs review", reason, idFor(reason))
    }

    private fun idFor(seed: String): Int = (seed.hashCode() and 0x7fffffff) % 100000 + 1000

    private fun postNotification(context: Context, title: String, text: String, id: Int = 1) {
        try {
            val nm = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                nm.createNotificationChannel(
                    NotificationChannel(CHANNEL, "Agent status", NotificationManager.IMPORTANCE_DEFAULT)
                )
            }
            val n = NotificationCompat.Builder(context, CHANNEL)
                .setSmallIcon(android.R.drawable.stat_sys_download_done)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(text))
                .setAutoCancel(true)
                .build()
            nm.notify(id, n)
        } catch (e: Exception) { Log.d(TAG, "notify skipped: ${e.message}") }
    }

    companion object {
        private const val TAG = "DetomsiteAgent"
        private const val CHANNEL = "detomsite_agent"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
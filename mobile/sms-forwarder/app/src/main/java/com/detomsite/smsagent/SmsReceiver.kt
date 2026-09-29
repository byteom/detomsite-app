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
        // A debit SMS is never a payment proof — never match against it even if
        // it happens to mention "upi"/"utr"/"ref".
        if (listOf("debited", " debit", "deducted", "paid out").any { lower.contains(it) }) return false
        return listOf("credited", " credit ", "deposited", "received", "rcvd", "cr ")
            .any { lower.contains(it) }
    }

    /** Extract UTR on-device. Never sent: sender, balance, account, raw text. */
    private fun extractUtr(text: String): String? {
        val patterns = listOf(
            Regex("(?i)\\butr\\s*:?\\s*([a-z0-9]{6,30})"),
            Regex("(?i)\\bref\\s*(?:erence|\\.|no|#)?\\s*[:.]?\\s*([a-z0-9]{6,30})"),
            Regex("(?<![a-z0-9])([a-z]{0,4}\\d{10,16})(?![a-z0-9])"),
        )
        for (p in patterns) {
            p.find(text)?.let { return it.groupValues[1].uppercase() }
        }
        return null
    }

    /** Extract the credited amount on-device. */
    private fun extractAmount(text: String): Double? {
        val regex = Regex("(?:Rs\\.?|INR|₹|\\bCr\\.?)\\s*([\\d,]+(?:\\.\\d{1,2})?)", RegexOption.IGNORE_CASE)
        val matches = regex.findAll(text).toList()
        if (matches.isEmpty()) return null

        val lower = text.lowercase()
        val creditCues = listOf(
            "credited", "deposited", "received", "rcvd", "successful", "credit", "trns"
        )

        // Prefer the amount whose surroundings mention a credit cue, so a
        // balance mention ("A/c bal: Rs 5,000") is never chosen over the
        // ₹80 credit. Fall back to the last match.
        var best: MatchResult? = null
        var bestDist = Int.MAX_VALUE
        var sawCue = false
        for (m in matches) {
            // A value directly labelled as the balance (within 12 chars) is
            // never the credit.
            val before = lower.substring(maxOf(0, m.range.first - 12), m.range.first)
            if ("bal" in before) continue
            val start = maxOf(0, m.range.first - 30)
            val end = minOf(text.length, m.range.last + 30)
            val window = lower.substring(start, end)
            val cue = creditCues.firstOrNull { it in window } ?: continue
            val dist = minOf(
                m.range.first - start,
                window.indexOf(cue),
                maxOf(0, end - (start + window.indexOf(cue) + cue.length))
            )
            if (dist < bestDist) {
                bestDist = dist
                best = m
                sawCue = true
            }
        }

        val chosen = if (sawCue) best!! else matches.last()
        return try {
            chosen.groupValues[1].replace(",", "").toDouble()
        } catch (e: Exception) { null }
    }

    /** Send only {phone, utr, amount} — never the raw SMS. */
    private suspend fun sendProof(
        context: Context, baseUrl: String, agentKey: String, utr: String, amount: Double
    ) {
        try {
            // Accept both "https://host" and "https://host/api/v1/local" as the
            // saved base URL — never double-append the path.
            val root = baseUrl
                .substringBefore("/api/v1")
                .trimEnd('/')
            val json = JSONObject()
                .put("phone", configuredPhone(context, context.getSharedPreferences("agent", Context.MODE_PRIVATE)))
                .put("utr", utr)
                .put("amount", amount)
            val body = json.toString().toRequestBody(JSON_MEDIA)
            val request = Request.Builder()
                .url("$root/api/v1/local/sms/match")
                .post(body)
                .header("Content-Type", "application/json")
                .header("X-Agent-Key", agentKey)
                .build()
            // Timeouts are sized to fit the goAsync() budget (~10 s), so a hung
            // network can never leave the broadcast pending until Android force-
            // kills the process.
            val client = OkHttpClient.Builder()
                .connectTimeout(6, TimeUnit.SECONDS)
                .readTimeout(6, TimeUnit.SECONDS)
                .build()
            client.newCall(request).execute().use { resp ->
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
                    // Retry ONCE, and only on a server-side error. A 5xx can be a
                    // cold start or a blip; a 429 is a deliberate throttle and
                    // retrying only burns more of the budget. The delay is sized
                    // to finish inside the ~10 s goAsync() window — overrun it and
                    // Android kills the process mid-retry, which is the very bug
                    // this class is fixing.
                    if (code in 500..599) {
                        delay(1500)
                        val retry = client.newCall(request.newBuilder().build()).execute()
                        retry.use { r2 ->
                            val retryBody = r2.body?.string().orEmpty()
                            if (r2.code in 200..299) {
                                val orderId = runCatching { JSONObject(retryBody).optString("order_id") }.getOrDefault("")
                                // Same wording rule as the first attempt: a credit
                                // settled WITHOUT a UTR must not print "UTR " and
                                // then nothing, which reads as a bug to the shopkeeper.
                                notifySent(
                                    context,
                                    if (utr.isEmpty()) "₹${amount.toInt()} received ✓ — order $orderId completed"
                                    else "UTR $utr ✓ — order $orderId completed"
                                )
                            } else {
                                notifyRejected(context, rejectionReason(retryBody))
                            }
                            return
                        }
                    }
                    notifyRejected(context, reason)
                }
            }
        } catch (e: Exception) {
            Log.e(TAG, "sendProof failed: ${e.message}")
            notifyRejected(context, "Could not reach DETOMSITE — check your internet connection.")
        }
    }

    /** Pull the server's human-readable reason out of an error body. */
    private fun rejectionReason(body: String): String = try {
        JSONObject(body).optString("detail").ifBlank { "the payment did not match an order" }
    } catch (e: Exception) {
        "the payment did not match an order"
    }

    private fun configuredPhone(context: Context, prefs: android.content.SharedPreferences): String {
        val manual = prefs.getString("phone", "").orEmpty().trim().replace(Regex("\\D"), "")
        val digits = manual.ifEmpty { localNumber(context).replace(Regex("\\D"), "") }
        val bare = if (digits.startsWith("91")) digits.substring(2) else digits
        return "+91" + bare.takeLast(10)
    }

    @SuppressLint("MissingPermission")
    private fun localNumber(context: Context): String {
        return try {
            val tm = context.getSystemService(Context.TELEPHONY_SERVICE) as android.telephony.TelephonyManager
            tm.line1Number ?: ""
        } catch (e: Exception) { "" }
    }

    private fun notifySent(context: Context, preview: String) {
        postNotification(context, "Payment proof sent ✓", preview)
    }

    /** A credit the bot could NOT settle — say so on the phone, not just in logcat. */
    private fun notifyRejected(context: Context, reason: String) {
        postNotification(context, "Payment needs review", reason)
    }

    private fun postNotification(context: Context, title: String, text: String) {
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
            nm.notify(1, n)
        } catch (e: Exception) { Log.d(TAG, "notify skipped: ${e.message}") }
    }

    companion object {
        private const val TAG = "DetomsiteAgent"
        private const val CHANNEL = "detomsite_agent"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}
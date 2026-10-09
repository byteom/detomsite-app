package com.detomsite.smsagent

import android.content.Context
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Guaranteed SMS-proof delivery.
 *
 * Per Android docs a BroadcastReceiver (even with goAsync) must finish in
 * ~10s (30s max for non-foreground broadcasts like SMS_RECEIVED), while a
 * cold serverless backend can take 7-14s. So SmsReceiver does ONE fast
 * attempt inside goAsync (5s connect / 8s read) and enqueues this worker for
 * everything else: WorkManager persists across Doze/reboot and retries with
 * exponential backoff + CONNECTED constraint (see docs: OneTimeWorkRequest
 * with setBackoffCriteria + setConstraints + enqueue).
 *
 * The /sms/match endpoint is idempotent per credit (UTR stamped on the row;
 * replay -> 409), so a duplicate delivery from a retry is safe.
 */
class ProofRetryWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {

    override suspend fun doWork(): Result {
        val baseUrl = inputData.getString(KEY_BASE_URL).orEmpty()
        val agentKey = inputData.getString(KEY_AGENT_KEY).orEmpty()
        val phone = inputData.getString(KEY_PHONE).orEmpty()
        val utr = inputData.getString(KEY_UTR).orEmpty()
        val amount = inputData.getDouble(KEY_AMOUNT, 0.0)
        if (baseUrl.isEmpty() || agentKey.isEmpty() || phone.isEmpty() || amount <= 0) {
            return Result.failure()
        }
        return try {
            val root = normalizeBackendUrl(baseUrl)
            val json = JSONObject()
                .put("phone", phone)
                .put("utr", utr)
                .put("amount", amount)
            val body = json.toString().toRequestBody(JSON_MEDIA)
            val request = Request.Builder()
                .url("$root/api/v1/local/sms/match")
                .post(body)
                .header("Content-Type", "application/json")
                .header("X-Agent-Key", agentKey)
                .build()
            val client = OkHttpClient.Builder()
                .connectTimeout(10, TimeUnit.SECONDS)
                .readTimeout(20, TimeUnit.SECONDS)
                .writeTimeout(10, TimeUnit.SECONDS)
                .build()
            client.newCall(request).execute().use { resp ->
                when {
                    resp.code in 200..299 -> Result.success()
                    resp.code in 500..599 -> Result.retry()
                    resp.code == 429 -> Result.retry()
                    else -> Result.failure()
                }
            }
        } catch (e: Exception) {
            Result.retry()
        }
    }

    companion object {
        const val KEY_BASE_URL = "base_url"
        const val KEY_AGENT_KEY = "agent_key"
        const val KEY_PHONE = "phone"
        const val KEY_UTR = "utr"
        const val KEY_AMOUNT = "amount"
        private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()
    }
}

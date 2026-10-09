package com.detomsite.smsagent

import android.Manifest
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.View
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat
import androidx.lifecycle.lifecycleScope
import com.detomsite.smsagent.databinding.ActivityMainBinding
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONObject

private val JSON_MEDIA = "application/json; charset=utf-8".toMediaType()

/**
 * Normalise whatever was typed into a usable backend root.
 *
 * PENTEST/RELIABILITY FIX. The app used to pass the typed string straight to
 * OkHttp, so three very common inputs all failed with an opaque error that the
 * catch-all reported as "could not reach the server":
 *
 *   "detomsite-backend.vercel.app"  -> IllegalArgumentException (no scheme)
 *   "http://detomsite-backend..."   -> UnknownServiceException, because
 *                                      Android 9+ blocks cleartext HTTP
 *   "https://host/api/v1/local"     -> would double-append the path
 *
 * So a missing "s", or a missing "https://", looked identical to being offline
 * — which is exactly how it was reported. Fixing the input here means the user
 * cannot get it wrong, and it applies to the WhatsApp bot's own requests too
 * since they read the same stored value.
 */
internal fun normalizeBackendUrl(raw: String): String {
    var url = raw.trim()
    if (url.isEmpty()) return url
    // A bare host (or a host with a path) gets https:// — the API is HTTPS-only.
    if (!url.startsWith("http://", ignoreCase = true) && !url.startsWith("https://", ignoreCase = true)) {
        url = "https://$url"
    }
    // Android blocks cleartext by default; upgrade rather than fail cryptically.
    if (url.startsWith("http://", ignoreCase = true)) {
        url = "https://" + url.substring("http://".length)
    }
    // Keep only the origin — callers append /api/v1/local/... themselves.
    return url.substringBefore("/api/v1").trimEnd('/')
}

class MainActivity : AppCompatActivity() {

    private lateinit var binding: ActivityMainBinding
    private val prefs by lazy { getSharedPreferences("agent", MODE_PRIVATE) }

    private val permissionLauncher =
        registerForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { grants ->
            val ok = grants.values.all { it }
            updatePermissionUI()
            Toast.makeText(
                this,
                if (ok) "SMS access enabled — bank credits will be auto-matched."
                else "SMS permission denied. Please enable it in Settings.",
                Toast.LENGTH_LONG,
            ).show()
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        binding = ActivityMainBinding.inflate(layoutInflater)
        setContentView(binding.root)

        // ─── Privacy-first onboarding: explain what data stays / leaves ───
        binding.tvPrivacyBullet1.text = "✓ Bank SMS stays on your phone"
        binding.tvPrivacyBullet2.text = "✓ Only UTR + amount are sent (no balances, no sender, no raw text)"
        binding.tvPrivacyBullet3.text = "✓ Order auto-confirmed → WhatsApp fired to shopkeeper"
        binding.tvPrivacyBullet4.text = "✓ WhatsApp bot sends the order message all by itself"

        binding.etBaseUrl.setText(prefs.getString("base_url", ""))
        binding.etAgentKey.setText(prefs.getString("agent_key", ""))
        binding.etPhone.setText(prefs.getString("phone", ""))
        binding.swEnabled.isChecked = prefs.getBoolean("enabled", true)
        binding.swWABot.isChecked = prefs.getBoolean("wa_bot_enabled", false)

        binding.btnGrantSms.setOnClickListener { requestPerms() }
        binding.btnSave.setOnClickListener { save() }
        binding.btnTest.setOnClickListener { testConnection() }
        binding.swWABot.setOnCheckedChangeListener { _, checked ->
            prefs.edit().putBoolean("wa_bot_enabled", checked).apply()
            if (checked) {
                WhatsAppBotService.start(this)
                Toast.makeText(this, "WhatsApp bot starting…", Toast.LENGTH_SHORT).show()
            } else {
                stopService(Intent(this, WhatsAppBotService::class.java))
                AutoSendState.clear()
                Toast.makeText(this, "WhatsApp bot stopped.", Toast.LENGTH_SHORT).show()
            }
            updatePermissionUI()
        }
        binding.btnGrantAccessibility.setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }
        binding.btnGrantOverlay.setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                    Uri.parse("package:$packageName"),
                )
            )
        }
        updatePermissionUI()
    }

    override fun onResume() {
        super.onResume()
        updatePermissionUI()
    }

    private fun updatePermissionUI() {
        // SMS section.
        val has = hasPermission(Manifest.permission.RECEIVE_SMS)
                && hasPermission(Manifest.permission.READ_SMS)
        binding.tvPermStatus.text = if (has) "SMS access: ENABLED ✓" else "SMS access: NOT YET GRANTED"
        binding.tvPermStatus.setTextColor(ContextCompat.getColor(this,
            if (has) android.R.color.holo_green_dark else android.R.color.holo_red_dark
        ))
        binding.btnGrantSms.text = if (has) "Re-grant SMS permission" else "Grant SMS permission"

        // Battery exemption (Doze/OEM killers suspend the SMS receiver +
        // WorkManager retries without it). Per PowerManager docs:
        // isIgnoringBatteryOptimizations() + ACTION_REQUEST_IGNORE_BATTERY_
        // OPTIMIZATIONS intent puts the app on the power allowlist.
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            val exempt = pm.isIgnoringBatteryOptimizations(packageName)
            if (!exempt) {
                binding.tvPermStatus.append("\n⚠ Battery optimization ON — tap to exempt or proofs may be lost in Doze.")
                binding.tvPermStatus.setOnClickListener { requestBatteryExemption() }
            } else {
                binding.tvPermStatus.setOnClickListener(null)
            }
        } catch (e: Exception) { /* best-effort UI only */ }

        // WhatsApp bot section.
        val enabled = binding.swWABot.isChecked
        val accOn = isAccessibilityEnabled()
        val overlayOn = Build.VERSION.SDK_INT < Build.VERSION_CODES.M || Settings.canDrawOverlays(this)
        val ready = enabled && accOn && overlayOn
        binding.tvWABotStatus.text = when {
            !enabled -> "Toggle ON to auto-send order WhatsApps"
            !overlayOn -> "Needs “Display over other apps” for auto-open (tap below)"
            !accOn -> "Needs Accessibility enabled for auto-Send (tap below)"
            else -> "READY — order WhatsApps send themselves ✓"
        }
        binding.tvWABotStatus.setTextColor(ContextCompat.getColor(this,
            if (ready) android.R.color.holo_green_dark else android.R.color.holo_orange_dark
        ))
        binding.btnGrantAccessibility.text = if (accOn) "Accessibility: ENABLED ✓" else "Enable Accessibility (auto-Send)"
        binding.btnGrantOverlay.text = if (overlayOn) "Overlay: ENABLED ✓" else "Allow auto-open WhatsApp"
    }

    private fun isAccessibilityEnabled(): Boolean {
        try {
            val expected = componentName.flattenToString()
            val enabled = Settings.Secure.getString(
                contentResolver,
                Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES,
            ) ?: return false
            return enabled.split(':').any { it.equals(expected, ignoreCase = true) }
        } catch (e: Exception) {
            return false
        }
    }

    private fun requestBatteryExemption() {
        try {
            val pm = getSystemService(Context.POWER_SERVICE) as PowerManager
            if (pm.isIgnoringBatteryOptimizations(packageName)) {
                Toast.makeText(this, "Already exempt from battery optimization ✓", Toast.LENGTH_SHORT).show()
                return
            }
            startActivity(
                Intent(
                    Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS,
                    Uri.parse("package:$packageName"),
                )
            )
        } catch (e: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun save() {
        // Store the NORMALISED url, not what was typed. Otherwise a user who
        // typed "detomsite-backend.vercel.app" (no scheme) saves a value that
        // every later request — the SMS match and the WhatsApp bot's queue poll —
        // would fail on, with no error shown at the moment it matters.
        val url = normalizeBackendUrl(binding.etBaseUrl.text.toString())
        val key = binding.etAgentKey.text.toString().trim()
        if (url.isEmpty() || key.isEmpty()) {
            Toast.makeText(this, "Backend URL and Agent Key are required.", Toast.LENGTH_LONG).show()
            return
        }
        // Validate with the SAME normalizer the receiver uses — a value that
        // passes here posts identically at SMS time (no test-pass/real-fail drift).
        val phone = SmsReceiver.normalizeIndianMobile(binding.etPhone.text.toString())
        if (phone.isEmpty()) {
            Toast.makeText(this, "Enter a valid 10-digit mobile number (starts 6-9).", Toast.LENGTH_LONG).show()
            return
        }
        // Show the exact value being stored, so a normalised URL is visible
        // rather than silently different from what was typed.
        binding.etBaseUrl.setText(url)
        prefs.edit()
            .putString("base_url", url)
            .putString("agent_key", key)
            .putString("phone", phone)
            .putBoolean("enabled", binding.swEnabled.isChecked)
            .putBoolean("wa_bot_enabled", binding.swWABot.isChecked)
            .apply()
        if (binding.swWABot.isChecked) WhatsAppBotService.start(this)
        // PENTEST/RELIABILITY FIX: this used to claim "bank credit SMS will be
        // auto-matched" purely because two text boxes were non-empty, which is
        // how a wrong key/phone/URL looked identical to a working setup. Point
        // the user at the check that actually proves it instead of asserting a
        // result nobody has verified.
        Toast.makeText(
            this,
            "Saved. Tap TEST CONNECTION to confirm the key and phone are right.",
            Toast.LENGTH_LONG,
        ).show()
        binding.tvTestResult.visibility = View.GONE
    }

    /**
     * Verify the three settings BEFORE trusting them.
     *
     * PENTEST/RELIABILITY FIX. `save()` stored whatever was typed and then said
     * "Saved — bank credit SMS will be auto-matched on this device", without
     * contacting the server. So a wrong key, a wrong phone or a wrong URL all
     * produced the same cheerful message, and the bot silently did nothing
     * forever after. There were three independent ways to fail and no way to
     * tell them apart.
     *
     * `/sms/match` answers differently for each cause, so one call pins down
     * all three:
     *   401 -> the agent key is wrong
     *   404 -> the key is good, but this phone is not registered to any shop
     *   400/409/422 -> key good + shop found; there is simply nothing to match
     *                  yet, which is the expected "ready" answer
     *   (no response) -> the URL is wrong or there is no connectivity
     */
    private fun testConnection() {
        val url = normalizeBackendUrl(binding.etBaseUrl.text.toString())
        val key = binding.etAgentKey.text.toString().trim()
        // Same normalizer as the receiver: the tested value is the posted value.
        val phone = SmsReceiver.normalizeIndianMobile(binding.etPhone.text.toString())
        if (url.isEmpty() || key.isEmpty() || phone.isEmpty()) {
            showTestResult("Fill in Backend URL, Agent Key and a valid 10-digit Phone first.", false)
            return
        }
        binding.btnTest.isEnabled = false
        showTestResult("Testing $url …", false)

        lifecycleScope.launch(Dispatchers.IO) {
            val root = url
            // A deliberately unmatchable proof: amount 0 is rejected by the
            // matcher with 400, which is only reached AFTER the agent key is
            // accepted. That ordering is what makes this a real connectivity
            // test rather than a guess.
            val payload = JSONObject()
                .put("phone", phone)
                .put("utr", "0")
                .put("amount", 0)
                .toString()
                .toRequestBody(JSON_MEDIA)

            var verdict: String
            var ok = false
            try {
                val request = Request.Builder()
                    .url("$root/api/v1/local/sms/match")
                    .post(payload)
                    .header("Content-Type", "application/json")
                    .header("X-Agent-Key", key)
                    .build()
                val client = OkHttpClient.Builder()
                    // Foreground user action (no goAsync budget): allow a cold
                    // serverless start (7-14s) to answer before calling it offline.
                    .connectTimeout(10, TimeUnit.SECONDS)
                    .readTimeout(20, TimeUnit.SECONDS)
                    .build()
                client.newCall(request).execute().use { resp ->
                    val body = resp.body?.string().orEmpty()
                    val detail = runCatching { JSONObject(body).optString("detail") }.getOrDefault("")
                    verdict = when (resp.code) {
                        401 -> "✗ Agent key rejected (401). Copy the key again from the admin."
                        404 -> "✗ Key is good, but no shop uses the phone $phone. Use the number registered to your shop."
                        400, 409, 422 -> "✓ Connected. Key accepted and your shop was found — ready to match payments."
                        429 -> "⚠ Too many attempts from this device. Wait ~15 minutes."
                        503 -> "✗ Server is not configured for SMS matching (503)."
                        else -> "✗ Unexpected response ${resp.code}: ${detail.take(120)}"
                    }
                    ok = resp.code == 400 || resp.code == 409 || resp.code == 422
                }
            } catch (e: Exception) {
                // PENTEST/RELIABILITY FIX: one catch-all used to render every
                // failure as "could not reach ... check your internet", which is
                // simply false for a mistyped URL and sends the user off to
                // debug the wrong thing. Name the actual cause instead.
                val detail = e.message.orEmpty()
                verdict = when {
                    e is java.net.UnknownHostException ->
                        "✗ Can't find that server name. Check the URL spelling and your internet."
                    // Android blocks cleartext HTTP by default (API 28+). OkHttp's
                    // exception type for it is internal, so match on the text.
                    detail.contains("CLEARTEXT communication") ->
                        "✗ Android blocked an unencrypted connection. Use https:// in the URL."
                    e is javax.net.ssl.SSLException ->
                        "✗ Secure connection failed. Check the URL uses https:// and try again."
                    e is java.net.SocketTimeoutException ->
                        "✗ The server didn't answer in time. Try again in a moment."
                    e is java.net.ConnectException ->
                        "✗ Connection refused. Check the URL and your internet."
                    e is IllegalArgumentException ->
                        "✗ That URL isn't valid. Use https://detomsite-backend.vercel.app"
                    else -> "✗ Could not reach $root — ${e.javaClass.simpleName}: ${detail.take(80)}"
                }
            }
            withContext(Dispatchers.Main) {
                showTestResult(verdict, ok)
                binding.btnTest.isEnabled = true
            }
        }
    }

    private fun showTestResult(text: String, ok: Boolean) {
        binding.tvTestResult.text = text
        binding.tvTestResult.setTextColor(
            ContextCompat.getColor(
                this,
                if (ok) android.R.color.holo_green_dark else android.R.color.holo_orange_dark
            )
        )
        binding.tvTestResult.visibility = View.VISIBLE
    }

    private fun requestPerms() {
        val perms = mutableListOf(
            Manifest.permission.RECEIVE_SMS,
            Manifest.permission.READ_SMS,
        )
        if (Build.VERSION.SDK_INT >= 33) perms.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = perms.filter {
            ContextCompat.checkSelfPermission(this, it) != PackageManager.PERMISSION_GRANTED
        }
        if (missing.isEmpty()) {
            Toast.makeText(this, "All permissions already granted.", Toast.LENGTH_SHORT).show()
        } else {
            permissionLauncher.launch(missing.toTypedArray())
        }
        updatePermissionUI()
    }

    private fun hasPermission(p: String) =
        ContextCompat.checkSelfPermission(this, p) == PackageManager.PERMISSION_GRANTED
}
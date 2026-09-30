package com.detomsite.adminapp

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Handles the **"Confirm order"** button on the order notification.
 *
 * This is the whole point of the notification: the admin approves an order from
 * the lock screen without opening the app. The server marks the order Confirmed,
 * WhatsApps the shop automatically, tells the student and settles the queue row;
 * this receiver then replaces the notification with a short result (or a clear
 * failure) so the admin always gets an answer for their tap.
 *
 * The confirm call is idempotent server-side, so a double tap, a retried
 * broadcast or a stale notification can never double-confirm an order.
 */
class ConfirmReceiver : BroadcastReceiver() {

    override fun onReceive(context: Context, intent: Intent) {
        if (intent.action != ACTION_CONFIRM) return
        val orderId = intent.getStringExtra(EXTRA_ORDER_ID).orEmpty()
        val notificationId = intent.getStringExtra(EXTRA_NOTIFICATION_ID).orEmpty()
        val token = intent.getStringExtra(EXTRA_TOKEN).orEmpty()
        if (orderId.isBlank()) return

        // Answer the tap immediately, then swap in the real outcome. The order
        // notification is dismissed either way — the Confirm button must never
        // still be on screen after it has been used.
        dismissOrderNotification(context, orderId)

        val pending = goAsync()
        val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
        scope.launch {
            try {
                report(context, orderId, notificationId, token)
            } finally {
                scope.cancel()
                pending.finish()
            }
        }
    }

    private suspend fun report(
        context: Context, orderId: String, notificationId: String, token: String,
    ) {
        when (val r = ApiClient.confirmOrder(context, orderId, notificationId)) {
            is ApiResult.Ok -> {
                val res = r.value
                val wa = when {
                    res.whatsappSent -> "The shop was notified on WhatsApp."
                    res.whatsappQueued -> "WhatsApp confirmation queued in the admin portal."
                    else -> ""
                }
                val note = if (res.alreadyConfirmed) "It was already confirmed." else ""
                notifyResult(
                    context,
                    title = "Order #$token confirmed",
                    text = "${res.message}.$note $wa".trim(),
                    ok = true, orderId = orderId, notificationId = notificationId, token = token,
                )
            }
            is ApiResult.Failure -> notifyResult(
                context,
                title = "Could not confirm order #$token",
                text = r.message,
                ok = false, orderId = orderId, notificationId = notificationId, token = token,
            )
            ApiResult.SessionExpired -> notifyResult(
                context,
                title = "Session expired",
                text = "Please open DETOMSITE Admin and sign in again.",
                ok = false, orderId = orderId, notificationId = notificationId, token = token,
            )
        }
    }

    private fun notifyResult(
        context: Context,
        title: String,
        text: String,
        ok: Boolean,
        orderId: String,
        notificationId: String,
        token: String,
    ) {
        val manager =
            context.getSystemService(Context.NOTIFICATION_SERVICE) as? NotificationManager ?: return
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            manager.createNotificationChannel(
                NotificationChannel(
                    CHANNEL_RESULT, "Confirm results", NotificationManager.IMPORTANCE_DEFAULT
                )
            )
        }

        val open = PendingIntent.getActivity(
            context, orderId.hashCode(),
            Intent(context, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        // A failed confirm can be retried from the same screen, so it keeps a
        // working Confirm action; a success is final and only offers "Open app".
        val retry = if (!ok && notificationId.isNotBlank()) {
            PendingIntent.getBroadcast(
                context, orderId.hashCode() + 7,
                Intent(context, ConfirmReceiver::class.java).apply {
                    action = ACTION_CONFIRM
                    putExtra(EXTRA_ORDER_ID, orderId)
                    putExtra(EXTRA_NOTIFICATION_ID, notificationId)
                    putExtra(EXTRA_TOKEN, token)
                },
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
        } else null

        val builder = NotificationCompat.Builder(context, CHANNEL_RESULT)
            .setSmallIcon(
                if (ok) android.R.drawable.stat_notify_chat
                else android.R.drawable.stat_notify_error
            )
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .setContentIntent(open)
        if (retry != null) builder.addAction(0, "Try again", retry)
        else builder.addAction(0, "Open app", open)

        try {
            NotificationManagerCompat.from(context).notify(orderId.hashCode() + 3, builder.build())
        } catch (e: SecurityException) {
            // POST_NOTIFICATIONS not granted.
        }
    }

    private fun dismissOrderNotification(context: Context, orderId: String) {
        try {
            NotificationManagerCompat.from(context).cancel(orderId.hashCode())
        } catch (e: SecurityException) {
            // Nothing to do — the notification is simply not ours to cancel.
        }
    }

    companion object {
        const val ACTION_CONFIRM = "com.detomsite.adminapp.CONFIRM_ORDER"
        const val EXTRA_ORDER_ID = "order_id"
        const val EXTRA_NOTIFICATION_ID = "notification_id"
        const val EXTRA_TOKEN = "token"
        private const val CHANNEL_RESULT = "admin_confirm_result"
    }
}

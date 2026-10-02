package com.detomsite.smsagent

import android.accessibilityservice.AccessibilityService
import android.os.Handler
import android.os.Looper
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo

/**
 * The "bot" half of the phone-side WhatsApp auto-sender.
 *
 * The foreground service opens WhatsApp with an order message pre-filled into a
 * chat. This service only acts when ALL of these hold:
 *
 *  - the bot is currently expecting a send ([AutoSendState.id] is set),
 *  - the foreground window is the WhatsApp conversation (not the chat list,
 *    not a story, not another app),
 *  - the on-screen text actually contains our pre-filled order token — so we
 *    never tap Send in a chat the user is typing into about something else.
 *
 * When all hold, it taps WhatsApp's Send button and tells the foreground
 * service to mark the notification as delivered.
 */
class WhatsAppAccessibilityService : AccessibilityService() {

    private val handler = Handler(Looper.getMainLooper())

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        if (event == null) return
        if (AutoSendState.id == null) return

        val pkg = event.packageName?.toString().orEmpty()
        if (pkg != "com.whatsapp" && pkg != "com.whatsapp.w4b") return
        if (event.eventType != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return

        val className = event.className?.toString().orEmpty()
        if (!className.contains("Conversation")) return

        // Give WhatsApp a beat to render the pre-filled text box.
        //
        // BUG FIX (double send). Every matching event posted ANOTHER delayed
        // trySend and nothing cancelled the previous one. WhatsApp fires
        // TYPE_WINDOW_STATE_CHANGED several times while a chat opens (chat list →
        // conversation, the compose box gaining focus, a re-layout), so three or
        // four trySend calls could be queued for the same message. The first tap
        // clears AutoSendState, but the others were already scheduled and re-read
        // `id` at fire time — so a tap queued for message A could fire against
        // message B if B was claimed in between, and a duplicate/incorrect send
        // would reach the shop. One pending runnable, re-posted, means exactly
        // one attempt is ever in flight and we act on the fully-rendered screen.
        handler.removeCallbacks(trySendRunnable)
        handler.postDelayed(trySendRunnable, 120)
    }

    private val trySendRunnable = Runnable { trySend() }

    private fun trySend() {
        val id = AutoSendState.id ?: return
        val root = rootInActiveWindow ?: return
        val token = AutoSendState.verifyToken ?: return
        if (!containsText(root, token)) return  // not our pre-filled message

        val send = findSendButton(root) ?: return
        if (send.performAction(AccessibilityNodeInfo.ACTION_CLICK)) {
            val payload = id
            AutoSendState.clear()
            handler.postDelayed({
                WhatsAppBotService.instance?.confirmSent(payload)
            }, 1500L)
        }
    }

    /** True when some on-screen node shows the pre-filled order token. */
    private fun containsText(node: AccessibilityNodeInfo, token: String): Boolean {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(node)
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            cur.text?.toString()?.let { if (it.contains(token)) return true }
            for (i in 0 until cur.childCount) {
                cur.getChild(i)?.let { queue.addLast(it) }
            }
        }
        return false
    }

    private fun findSendButton(root: AccessibilityNodeInfo): AccessibilityNodeInfo? {
        val queue = ArrayDeque<AccessibilityNodeInfo>()
        queue.add(root)
        while (queue.isNotEmpty()) {
            val cur = queue.removeFirst()
            val desc = cur.contentDescription?.toString().orEmpty()
            val viewId = cur.viewIdResourceName.orEmpty()
            if (desc.contains("send", ignoreCase = true) ||
                viewId.contains("send", ignoreCase = true)
            ) {
                return cur
            }
            for (i in 0 until cur.childCount) {
                cur.getChild(i)?.let { queue.addLast(it) }
            }
        }
        return null
    }

    override fun onInterrupt() {
        // Nothing to do — AutoSendState gates every tap, so interrupting is safe.
    }
}
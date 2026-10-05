import React, { useState, useEffect, useRef } from 'react'
import { MessageSquare, Send, Zap, ExternalLink, RefreshCw, CheckCircle2 } from 'lucide-react'
import api from '../services/api'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'

const WA_SENT_KEY = 'detomsite-wa-auto'

export function WhatsAppCenterPage() {
  const [pending, setPending] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string[]>([])
  const [sendingAll, setSendingAll] = useState(false)
  const [msg, setMsg] = useState('')

  const [auto, setAuto] = useState(() => {
    try {
      return localStorage.getItem(WA_SENT_KEY) !== '0'
    } catch {
      return false
    }
  })

  const seenRef = useRef<Set<string>>(new Set())

  const load = async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const r = await api.get('/admin/whatsapp/pending')
      const list = r.data || []
      setPending(list)

      // Auto-send logic for newly verified orders
      if (auto) {
        for (const item of list) {
          if (!seenRef.current.has(item.id)) {
            seenRef.current.add(item.id)
            try {
              window.open(item.url, '_blank')
              api.post(`/admin/whatsapp/${item.id}/mark-sent`).catch(() => {})
            } catch {}
          }
        }
      }
    } catch {}
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    return () => clearInterval(t)
  }, [auto])

  const sendOne = async (item: any) => {
    setBusy(b => [...b, item.id])
    try {
      window.open(item.url, '_blank')
      await api.post(`/admin/whatsapp/${item.id}/mark-sent`)
      seenRef.current.add(item.id)
      setPending(p => p.filter(x => x.id !== item.id))
      setMsg(`Dispatched order #${item.order_token} to ${item.shop_name} via WhatsApp.`)
    } catch {
      setMsg('Failed to mark WhatsApp dispatch.')
    } finally {
      setBusy(b => b.filter(x => x !== item.id))
    }
  }

  const sendAll = async () => {
    if (sendingAll || pending.length === 0) return
    setSendingAll(true)
    const list = [...pending]
    for (const item of list) {
      try {
        window.open(item.url, '_blank')
        await api.post(`/admin/whatsapp/${item.id}/mark-sent`)
        seenRef.current.add(item.id)
        setPending(p => p.filter(x => x.id !== item.id))
      } catch {}
    }
    setSendingAll(false)
    if (list.length) {
      setMsg(`Opened WhatsApp dispatch links for all ${list.length} pending orders.`)
    }
  }

  const toggleAuto = () => {
    const next = !auto
    setAuto(next)
    try {
      localStorage.setItem(WA_SENT_KEY, next ? '1' : '0')
    } catch {}
    setMsg(
      next
        ? 'Auto-dispatch is ON — newly verified orders automatically open WhatsApp.'
        : 'Auto-dispatch is OFF — notifications will wait here for manual trigger.'
    )
  }

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              WhatsApp Dispatch Center
            </h1>
            <Badge variant="success" size="sm" dot>
              Polling 8s
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Verified orders auto-generate pre-filled WhatsApp messages to shopkeepers from your phone number
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <Button
            variant={auto ? 'primary' : 'secondary'}
            size="sm"
            onClick={toggleAuto}
            icon={<Zap className={`w-3.5 h-3.5 ${auto ? 'text-amber-300' : ''}`} />}
            title="Toggle automatic browser launch of WhatsApp on new order verification"
          >
            Auto-Dispatch: {auto ? 'ON' : 'OFF'}
          </Button>

          {pending.length > 0 && (
            <Button
              variant="gold"
              size="sm"
              onClick={sendAll}
              disabled={sendingAll}
              loading={sendingAll}
              icon={<Send className="w-3.5 h-3.5" />}
            >
              Dispatch All ({pending.length})
            </Button>
          )}
        </div>
      </div>

      {/* Status banner */}
      {msg && (
        <div
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {/* Main Content */}
      {loading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)]">
          <RefreshCw className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-600 opacity-60" />
          Loading pending WhatsApp notifications...
        </div>
      ) : pending.length === 0 ? (
        <Card className="text-center py-12">
          <div
            className="w-12 h-12 mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3 border border-emerald-500/20"
            style={{ borderRadius: 0 }}
          >
            <CheckCircle2 className="w-6 h-6" />
          </div>
          <h3 className="text-base font-bold text-[var(--text-heading)]">
            All Orders Dispatched
          </h3>
          <p className="mt-1 text-xs text-[var(--text-muted)] max-w-md mx-auto">
            When a customer's payment is verified or an order is confirmed, the shop dispatch package
            appears here ready to transmit.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {pending.map(item => (
            <div
              key={item.id}
              className="border border-emerald-500/30 dark:border-emerald-700/40 bg-[var(--bg-surface)] p-4 shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
                <div className="flex-1 space-y-1.5 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-base font-black text-[var(--text-heading)]">
                      #{item.order_token}
                    </span>
                    <Badge variant="default" size="xs">
                      {item.shop_name || 'Kitchen'}
                    </Badge>
                    <Badge variant="success" size="xs">
                      Payment Verified
                    </Badge>
                  </div>

                  <p className="text-xs text-[var(--text-heading)] font-semibold">
                    {item.student_name} ·{' '}
                    <span className="font-mono text-emerald-700 dark:text-emerald-400 font-bold">
                      ₹{item.total}
                    </span>
                  </p>

                  <p className="text-xs text-[var(--text-muted)] font-mono">Recipient: {item.phone}</p>

                  <div
                    className="mt-2 p-2.5 bg-[var(--bg-surface-subtle)] border border-[var(--border-main)] text-[11px] font-mono text-[var(--text-body)] whitespace-pre-line leading-relaxed max-w-2xl"
                    style={{ borderRadius: 0 }}
                  >
                    {String(item.message || '').slice(0, 240)}
                    {(item.message || '').length > 240 ? '…' : ''}
                  </div>
                </div>

                <div className="flex sm:flex-col gap-2 shrink-0">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => sendOne(item)}
                    disabled={busy.includes(item.id)}
                    loading={busy.includes(item.id)}
                    icon={<Send className="w-3.5 h-3.5" />}
                  >
                    Send on WhatsApp
                  </Button>

                  <a
                    href={item.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-semibold text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                  >
                    <ExternalLink className="w-3 h-3" /> Link Only
                  </a>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

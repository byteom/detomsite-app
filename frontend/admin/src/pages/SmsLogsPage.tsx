import React, { useState, useEffect } from 'react'
import { Smartphone, ArrowDownLeft, ArrowUpRight, RefreshCw, Clock } from 'lucide-react'
import api from '../services/api'
import { fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'

export function SmsLogsPage() {
  const [logs, setLogs] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadLogs = async () => {
    if (document.visibilityState !== 'visible') return
    try {
      const r = await api.get('/local/sms-logs')
      setLogs(r.data || [])
    } catch {}
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadLogs()
    const t = setInterval(loadLogs, 15000)
    return () => clearInterval(t)
  }, [])

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              SMS Gateway Telemetry
            </h1>
            <Badge variant="default" size="md">
              {logs.length} Messages
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Outbound customer and shop order notifications paired with incoming YES/NO confirmation replies
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setLoading(true)
            loadLogs()
          }}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Feed
        </Button>
      </div>

      {/* Main Stream */}
      {loading ? (
        <div className="p-12 text-center text-xs text-[var(--text-muted)]">
          <Clock className="w-8 h-8 mx-auto mb-2 animate-spin text-emerald-600 opacity-60" />
          Loading SMS pipeline...
        </div>
      ) : logs.length === 0 ? (
        <Card className="text-center py-12">
          <Smartphone className="w-8 h-8 mx-auto mb-2 opacity-30 text-[var(--text-muted)]" />
          <p className="text-sm font-bold text-[var(--text-heading)]">No SMS Traffic Yet</p>
          <p className="mt-1 text-xs text-[var(--text-muted)] max-w-sm mx-auto">
            Place an order on the platform to observe live telemetry as SMS messages leave and return
            through the gateway.
          </p>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {logs.map(s => {
            const isIncoming = s.direction === 'in'

            return (
              <div
                key={s.id}
                className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-3.5 transition-colors hover:border-emerald-600/40"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-2 mb-2">
                  <div className="flex items-center gap-2">
                    <Badge variant={isIncoming ? 'success' : 'info'} size="xs">
                      {isIncoming ? (
                        <span className="flex items-center gap-1">
                          <ArrowDownLeft className="w-3 h-3" /> Received
                        </span>
                      ) : (
                        <span className="flex items-center gap-1">
                          <ArrowUpRight className="w-3 h-3" /> Outbound Sent
                        </span>
                      )}
                    </Badge>

                    {s.phone && (
                      <span className="font-mono text-xs text-[var(--text-heading)] font-semibold">
                        {s.phone}
                      </span>
                    )}

                    {s.sub_order_id && (
                      <span className="text-[11px] text-[var(--text-muted)] font-mono">
                        · order #{s.sub_order_id}
                      </span>
                    )}
                  </div>

                  <span className="text-[11px] text-[var(--text-muted)] font-mono">
                    {fmtTime(s.created_at)}
                  </span>
                </div>

                <p className="font-mono text-xs text-[var(--text-body)] whitespace-pre-line leading-relaxed">
                  {s.message}
                </p>

                {s.status && (
                  <div className="mt-2 flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                    <span>Gateway Status:</span>
                    <span className="font-mono font-bold uppercase text-[var(--text-muted)]">
                      {s.status}
                    </span>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import {
  MessageCircleQuestion,
  Search,
  Filter,
  Trash2,
  CheckCircle,
  Clock,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge, BadgeVariant } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

const FEEDBACK_STATUSES = ['Open', 'In Review', 'Fixed', 'Dismissed']

export function FeedbackPage() {
  const [items, setItems] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [showClearAtsConfirm, setShowClearAtsConfirm] = useState(false)
  const [clearingAts, setClearingAts] = useState(false)

  const loadData = () => {
    setLoading(true)
    api
      .get('/admin/feedback')
      .then(r => setItems(r.data || []))
      .catch(e => setErr(apiError(e, 'Could not load feedback submissions')))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    setMsg('')
    setErr('')
    try {
      await api.patch(`/admin/feedback/${id}`, { status: newStatus })
      setMsg(`Ticket updated to "${newStatus}".`)
      setItems(prev => prev.map(f => (f.id === id ? { ...f, status: newStatus } : f)))
    } catch (e: any) {
      setErr(apiError(e, 'Failed to update ticket status'))
    }
  }

  const handleClearAts = async () => {
    setClearingAts(true)
    setMsg('')
    setErr('')
    try {
      const r = await api.delete('/admin/feedback/clear-ats')
      setMsg(r.data?.message || 'ATS feedback records cleared.')
      setShowClearAtsConfirm(false)
      loadData()
    } catch (e: any) {
      setErr(apiError(e, 'Failed to clear ATS feedback'))
    } finally {
      setClearingAts(false)
    }
  }

  const filteredItems = items.filter(f => {
    if (statusFilter !== 'all' && f.status !== statusFilter) return false
    return true
  })

  const atsCount = items.filter(
    f =>
      String(f.subject || '').includes('[ATS]') ||
      String(f.name || '').includes('Test') ||
      String(f.username || '').includes('ats')
  ).length

  const openCount = items.filter(f => f.status === 'Open' || !f.status).length
  const inReviewCount = items.filter(f => f.status === 'In Review').length
  const fixedCount = items.filter(f => f.status === 'Fixed').length

  const columns: Column<any>[] = [
    {
      key: 'reporter',
      header: 'Reporter',
      sortable: true,
      render: (f: any) => (
        <div>
          <p className="font-semibold text-[var(--text-heading)]">
            {f.name || f.username || 'Anonymous'}
          </p>
          {f.email && <p className="text-[11px] text-[var(--text-muted)]">{f.email}</p>}
        </div>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      sortable: true,
      render: (f: any) => {
        const isBug = String(f.type || f.subject || '').toLowerCase().includes('bug')
        return (
          <Badge variant={isBug ? 'error' : 'info'} size="xs">
            {f.type || (isBug ? 'Bug' : 'Feedback')}
          </Badge>
        )
      },
    },
    {
      key: 'subject',
      header: 'Subject & Details',
      render: (f: any) => (
        <div className="max-w-md">
          <p className="font-bold text-[var(--text-heading)] text-xs">{f.subject}</p>
          <p className="text-xs text-[var(--text-muted)] line-clamp-2 mt-0.5">{f.message}</p>
          {f.page && (
            <span className="inline-block mt-1 text-[10px] text-[var(--text-dim)] font-mono">
              Page: {f.page}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      sortable: true,
      render: (f: any) => {
        const s = f.status || 'Open'
        const variant: BadgeVariant =
          s === 'Fixed' ? 'success' : s === 'In Review' ? 'info' : s === 'Open' ? 'gold' : 'default'
        return <Badge variant={variant} size="xs">{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Received',
      sortable: true,
      render: (f: any) => (
        <span className="text-[var(--text-muted)] font-mono text-xs whitespace-nowrap">
          {fmtTime(f.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Update Status',
      align: 'right',
      render: (f: any) => (
        <div className="flex items-center justify-end gap-1">
          {FEEDBACK_STATUSES.filter(s => s !== f.status).map(s => (
            <Button
              key={s}
              variant={s === 'Fixed' ? 'primary' : 'secondary'}
              size="xs"
              onClick={() => handleUpdateStatus(f.id, s)}
            >
              {s}
            </Button>
          ))}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              Feedback & Bug Reports
            </h1>
            <Badge variant="default" size="md">
              {items.length} Reports
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Student bug disclosures, UI improvement submissions, and feature suggestions
          </p>
        </div>

        <div className="flex items-center gap-2">
          {atsCount > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowClearAtsConfirm(true)}
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Clear ATS ({atsCount})
            </Button>
          )}

          <Button
            variant="secondary"
            size="sm"
            onClick={loadData}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* Messages */}
      {msg && (
        <div
          className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}
      {err && (
        <div
          className="p-3 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {err}
        </div>
      )}

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard
          title="Open Tickets"
          value={openCount}
          subtitle="Awaiting review"
          icon={<AlertTriangle className="w-5 h-5" />}
          variant="gold"
        />

        <StatCard
          title="In Review"
          value={inReviewCount}
          subtitle="Currently triaged"
          icon={<Clock className="w-5 h-5" />}
          variant="info"
        />

        <StatCard
          title="Resolved"
          value={fixedCount}
          subtitle="Fixes released"
          icon={<CheckCircle className="w-5 h-5" />}
          variant="emerald"
        />

        <StatCard
          title="Automated Test Records"
          value={atsCount}
          subtitle="Hidden mock test data"
          icon={<Trash2 className="w-5 h-5" />}
          variant="default"
        />
      </div>

      {/* Table */}
      <DataTable
        columns={columns}
        data={filteredItems}
        loading={loading}
        searchPlaceholder="Search feedback reporter, subject, message..."
        searchableKeys={['name', 'username', 'email', 'subject', 'message', 'page']}
        filterSlot={
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="bg-[var(--bg-surface)] text-[var(--text-heading)] border border-[var(--border-main)] px-2.5 py-1.5 text-xs outline-none focus:border-emerald-600 transition-colors"
            style={{ borderRadius: 0 }}
          >
            <option value="all" className="bg-[var(--bg-surface)] text-[var(--text-heading)]">All Ticket Statuses</option>
            {FEEDBACK_STATUSES.map(s => (
              <option key={s} value={s} className="bg-[var(--bg-surface)] text-[var(--text-heading)]">
                {s}
              </option>
            ))}
          </select>
        }
        emptyTitle="No feedback tickets found"
        emptyDescription="There are currently no reports matching your status and search filters."
      />

      {/* Clear ATS Confirmation */}
      <ConfirmDialog
        open={showClearAtsConfirm}
        onClose={() => setShowClearAtsConfirm(false)}
        onConfirm={handleClearAts}
        loading={clearingAts}
        title="Purge Automated Test Records"
        description={`This will permanently remove all ${atsCount} automated test suite entries from the database. Real user submissions will not be affected.`}
        confirmText="Purge Test Data"
        variant="danger"
      />
    </div>
  )
}

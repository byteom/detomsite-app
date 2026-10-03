import React, { useState, useEffect } from 'react'
import {
  MessageCircleQuestion,
  Bug,
  Lightbulb,
  Sparkles,
  MessageSquare,
  Trash2,
  CheckCircle,
  RefreshCw,
  Search,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge, BadgeVariant } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

const FEEDBACK_STATUSES = ['Open', 'In Review', 'Fixed', "Won't Fix"] as const

const FEEDBACK_CATEGORIES: Record<
  string,
  { label: string; icon: React.ReactNode; variant: BadgeVariant }
> = {
  Bug: {
    label: 'Bug',
    icon: <Bug className="w-3 h-3" />,
    variant: 'error',
  },
  Improvement: {
    label: 'Improvement',
    icon: <Lightbulb className="w-3 h-3" />,
    variant: 'gold',
  },
  Suggestion: {
    label: 'Suggestion',
    icon: <Sparkles className="w-3 h-3" />,
    variant: 'success',
  },
  Other: {
    label: 'Other',
    icon: <MessageSquare className="w-3 h-3" />,
    variant: 'info',
  },
}

export function FeedbackPage() {
  const [items, setItems] = useState<any[]>([])
  const [atsCount, setAtsCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState('all')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [showClearAtsConfirm, setShowClearAtsConfirm] = useState(false)
  const [clearingAts, setClearingAts] = useState(false)

  const loadData = async () => {
    setLoading(true)
    try {
      const [userRes, atsRes] = await Promise.all([
        api.get('/admin/feedback', { params: { source: 'User' } }),
        api.get('/admin/feedback', { params: { source: 'ATS' } }),
      ])
      setItems(userRes.data || [])
      setAtsCount(atsRes.data?.length || 0)
    } catch (e: any) {
      setErr(apiError(e, 'Could not fetch student feedback'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  const handleClearAts = async () => {
    setClearingAts(true)
    try {
      await api.delete('/admin/feedback', { params: { source: 'ATS' } })
      setMsg('Purged automated test tickets. Only authentic student submissions remain.')
      setAtsCount(0)
    } catch (e: any) {
      setErr(apiError(e, 'Could not clear test entries'))
    } finally {
      setClearingAts(false)
      setShowClearAtsConfirm(false)
    }
  }

  const handleUpdateStatus = async (id: string, newStatus: string) => {
    try {
      await api.patch(`/admin/feedback/${id}`, { status: newStatus })
      setMsg(`Ticket updated to "${newStatus}".`)
      setItems(prev => prev.map(x => (x.id === id ? { ...x, status: newStatus } : x)))
    } catch (e: any) {
      setErr(apiError(e, 'Failed to update ticket status'))
    }
  }

  const counts = FEEDBACK_STATUSES.reduce<Record<string, number>>((acc, s) => {
    acc[s] = items.filter(i => i.status === s).length
    return acc
  }, {})

  const filteredItems = items.filter(i => {
    if (statusFilter !== 'all' && i.status !== statusFilter) return false
    return true
  })

  const columns: Column<any>[] = [
    {
      key: 'reporter',
      header: 'Submitted By',
      sortable: true,
      render: (f: any) => (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">
            {f.name || f.username || 'Anonymous'}
          </p>
          <p className="text-[11px] text-gray-500 font-mono">@{f.username || 'student'}</p>
          {f.email && <p className="text-[11px] text-gray-400 font-mono">{f.email}</p>}
        </div>
      ),
    },
    {
      key: 'category',
      header: 'Category',
      sortable: true,
      align: 'center',
      render: (f: any) => {
        const cat = FEEDBACK_CATEGORIES[f.category] || FEEDBACK_CATEGORIES.Other
        return (
          <Badge variant={cat.variant} size="xs">
            <span className="flex items-center gap-1">
              {cat.icon}
              {cat.label}
            </span>
          </Badge>
        )
      },
    },
    {
      key: 'subject',
      header: 'Subject & Description',
      render: (f: any) => (
        <div className="max-w-md">
          <p className="font-bold text-gray-900 dark:text-white text-xs">{f.subject}</p>
          <p className="mt-1 text-xs text-gray-600 dark:text-gray-400 line-clamp-2" title={f.message}>
            {f.message}
          </p>
          {f.page && (
            <span className="inline-block mt-1 text-[10px] text-gray-400 font-mono">
              Page: {f.page}
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: 'Triage Status',
      sortable: true,
      align: 'center',
      render: (f: any) => {
        const s = f.status
        const variant =
          s === 'Fixed' ? 'success' : s === 'In Review' ? 'info' : s === 'Open' ? 'gold' : 'default'
        return <Badge variant={variant} size="xs">{s}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Received',
      sortable: true,
      render: (f: any) => (
        <span className="text-gray-500 font-mono text-xs whitespace-nowrap">
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
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
              Feedback & Bug Reports
            </h1>
            <Badge variant="default" size="md">
              {items.length} Reports
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Student bug disclosures, UI improvement submissions, and feature suggestions
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {atsCount > 0 && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setShowClearAtsConfirm(true)}
              icon={<Trash2 className="w-3.5 h-3.5" />}
            >
              Clear Test Data ({atsCount})
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
          className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
          style={{ borderRadius: 0 }}
        >
          {msg}
        </div>
      )}

      {err && (
        <div
          className="p-3.5 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
          style={{ borderRadius: 0 }}
        >
          {err}
        </div>
      )}

      {/* KPI Status Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3.5">
        <StatCard
          title="Open Tickets"
          value={counts['Open'] || 0}
          subtitle="Awaiting administrative review"
          icon={<Bug className="w-5 h-5" />}
          variant="gold"
        />

        <StatCard
          title="In Review"
          value={counts['In Review'] || 0}
          subtitle="Currently being investigated"
          icon={<Lightbulb className="w-5 h-5" />}
          variant="info"
        />

        <StatCard
          title="Resolved & Fixed"
          value={counts['Fixed'] || 0}
          subtitle="Applied to production releases"
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
            className="bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-2.5 py-1.5 text-xs text-gray-800 dark:text-gray-200 outline-none focus:border-emerald-600"
            style={{ borderRadius: 0 }}
          >
            <option value="all">All Ticket Statuses</option>
            {FEEDBACK_STATUSES.map(s => (
              <option key={s} value={s}>
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

import React, { useState, useCallback, useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  CheckSquare,
  Clock,
  Check,
  X,
  Store,
  AlertCircle,
  RefreshCw,
  MessageSquare,
  Eye,
  ShieldAlert,
  CheckCircle2,
  User,
  ShoppingBag,
  XCircle,
  Search,
  ArrowRight,
  ExternalLink,
} from 'lucide-react'
import api, { dedupeGet } from '../services/api'
import { usePolling } from '../hooks/usePolling'
import { apiError, fmtTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'

// Gentle sound alert for newly arrived incoming orders
function playNewOrderChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext
    if (!AudioCtx) return
    const ctx = new AudioCtx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(587.33, ctx.currentTime) // D5
    osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.15) // A5
    gain.gain.setValueAtTime(0.12, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
    osc.connect(gain)
    gain.connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.35)
  } catch {
    // blocked by autoplay policy until user gesture
  }
}

export default function ApprovalsPage() {
  const [orders, setOrders] = useState<any[]>([])
  const [initialLoading, setInitialLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [newOrderNotice, setNewOrderNotice] = useState<string | null>(null)
  const [newlyAddedIds, setNewlyAddedIds] = useState<Set<string>>(new Set())
  const hasLoadedOnceRef = useRef(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'needs_confirmation' | 'all_ongoing' | 'in_progress'>('needs_confirmation')
  const [search, setSearch] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  // Detail Modal state
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [proof, setProof] = useState<any | null>(null)
  const [proofLoading, setProofLoading] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [rejecting, setRejecting] = useState(false)

  // Status checkers
  const isTerminal = (status?: string) => {
    const s = String(status || '').toLowerCase().trim()
    return ['completed', 'delivered', 'cancelled', 'rejected', 'failed'].includes(s)
  }

  const isOngoing = (status?: string) => !isTerminal(status)

  const needsConfirmation = (status?: string) => {
    const s = String(status || '').toLowerCase().trim()
    return ['pending payment', 'pending acceptance', 'placed', 'pending'].includes(s)
  }

  const isInProgress = (status?: string) => isOngoing(status) && !needsConfirmation(status)

  // Auto-dismiss new order notice after 8 seconds
  useEffect(() => {
    if (newOrderNotice) {
      const timer = setTimeout(() => setNewOrderNotice(null), 8000)
      return () => clearTimeout(timer)
    }
  }, [newOrderNotice])

  // Load live orders silently in the background
  const loadOrders = useCallback(async (isManualRefresh = false) => {
    if (document.visibilityState !== 'visible') return
    if (isManualRefresh) setRefreshing(true)

    try {
      const r: any = await dedupeGet('/admin/orders')
      const rawList = Array.isArray(r.data) ? r.data : []
      // Sort newest first by created_at or id so incoming orders are always on top
      const sorted = [...rawList].sort((a, b) => {
        const timeA = new Date(a.created_at || 0).getTime()
        const timeB = new Date(b.created_at || 0).getTime()
        if (timeA !== timeB) return timeB - timeA
        return (Number(b.token) || 0) - (Number(a.token) || 0)
      })

      setOrders((prevOrders: any[]) => {
        // Initial first load
        if (!hasLoadedOnceRef.current || prevOrders.length === 0) {
          return sorted
        }

        const prevKeys = new Set(prevOrders.map((o: any) => String(o.id || o.token)))
        // Any order whose ID was not in the existing active list is brand-new
        const brandNewOrders = sorted.filter((o: any) => !prevKeys.has(String(o.id || o.token)))

        if (brandNewOrders.length > 0) {
          playNewOrderChime()
          const first = brandNewOrders[0]
          setNewOrderNotice(
            brandNewOrders.length === 1
              ? `🔔 New incoming order #${first.token} from ${first.shop_name || 'shop'} added to top!`
              : `🔔 ${brandNewOrders.length} new incoming orders received — added to top!`
          )

          const brandNewIdSet = new Set(brandNewOrders.map((o: any) => String(o.id || o.token)))
          setNewlyAddedIds(brandNewIdSet)
          setTimeout(() => setNewlyAddedIds(new Set()), 12000)

          // Prepend newly found orders directly at the very top, followed by remaining orders
          const remaining = sorted.filter((o: any) => !brandNewIdSet.has(String(o.id || o.token)))
          return [...brandNewOrders, ...remaining]
        }

        // Compare if anything actually changed (status, payment_status, total, proof_status, etc.)
        const prevMap = new Map(prevOrders.map((o: any) => [String(o.id || o.token), o]))
        let hasAnyUpdate = prevOrders.length !== sorted.length

        if (!hasAnyUpdate) {
          for (const item of sorted) {
            const key = String(item.id || item.token)
            const oldItem = prevMap.get(key)
            if (!oldItem) {
              hasAnyUpdate = true
              break
            }
            if (
              oldItem.status !== item.status ||
              oldItem.payment_status !== item.payment_status ||
              oldItem.total !== item.total ||
              oldItem.proof_status !== item.proof_status ||
              oldItem.updated_at !== item.updated_at
            ) {
              hasAnyUpdate = true
              break
            }
          }
        }

        // If no changes at all: return prevOrders directly to prevent any re-render or layout jitter!
        if (!hasAnyUpdate) {
          return prevOrders
        }

        return sorted
      })
    } catch (e: any) {
      if (!hasLoadedOnceRef.current) {
        setErr(apiError(e, 'Could not fetch live orders'))
      }
    } finally {
      hasLoadedOnceRef.current = true
      setInitialLoading(false)
      setRefreshing(false)
    }
  }, [])

  // Poll silently in the background every 10 seconds — NEVER reloads page or shows spinner
  usePolling(loadOrders, 10000, [])

  // Filter only ongoing orders (completed & cancelled are excluded from this queue)
  const ongoingOrders = orders.filter((o: any) => isOngoing(o.status))

  // KPI Counts
  const pendingCount = ongoingOrders.filter((o: any) => needsConfirmation(o.status)).length
  const inProgressCount = ongoingOrders.filter((o: any) => isInProgress(o.status)).length
  const totalOngoingCount = ongoingOrders.length

  // Filter by active tab and search query
  const filteredOrders = ongoingOrders.filter((o: any) => {
    // Tab filter
    if (activeTab === 'needs_confirmation' && !needsConfirmation(o.status)) return false
    if (activeTab === 'in_progress' && !isInProgress(o.status)) return false

    // Search query
    if (search.trim()) {
      const q = search.toLowerCase().trim()
      const token = String(o.token || '').toLowerCase()
      const shop = String(o.shop_name || '').toLowerCase()
      const student = String(o.student_name || '').toLowerCase()
      const phone = String(o.student_phone || '').toLowerCase()
      const items = String(o.items || '').toLowerCase()
      return token.includes(q) || shop.includes(q) || student.includes(q) || phone.includes(q) || items.includes(q)
    }

    return true
  })

  // 1-Click Confirm Order
  const handleConfirmOrder = async (order: any) => {
    setBusyId(order.id)
    setMsg('')
    setErr('')
    try {
      const r = await api.post(`/admin/orders/${order.id}/confirm`)
      setMsg(r.data?.message || `Order #${order.token} verified & confirmed!`)
      // Update local state: status becomes Confirmed (moves to In Progress)
      setOrders(list =>
        list.map(x => (x.id === order.id ? { ...x, status: r.data?.order?.status || 'Confirmed' } : x))
      )
      if (selectedOrder?.id === order.id) {
        setSelectedOrder((prev: any) => ({ ...prev, status: 'Confirmed' }))
      }
    } catch (e: any) {
      const errMsg = apiError(e, 'Could not confirm this order')
      setErr(errMsg)
      // If UPI proof is missing or requires inspection, open the modal so admin can review
      if (errMsg.toLowerCase().includes('proof') || errMsg.toLowerCase().includes('utr')) {
        handleOpenOrder(order)
      }
    } finally {
      setBusyId(null)
    }
  }

  // 1-Click Mark Completed (order leaves this ongoing queue)
  const handleMarkCompleted = async (order: any) => {
    if (!window.confirm(`Mark Order #${order.token} as Completed? It will be removed from this live queue.`)) return
    setBusyId(order.id)
    setMsg('')
    setErr('')
    try {
      await api.patch(`/local/orders/${order.id}/status`, { status: 'Completed' })
      setMsg(`Order #${order.token} marked as Completed and moved to history!`)
      // Immediately remove from ongoing orders
      setOrders(list => list.map(x => (x.id === order.id ? { ...x, status: 'Completed' } : x)))
      if (selectedOrder?.id === order.id) {
        setSelectedOrder(null)
      }
    } catch (e: any) {
      setErr(apiError(e, 'Could not update order status'))
    } finally {
      setBusyId(null)
    }
  }

  // Reject / Cancel Order
  const handleRejectOrder = async (orderId: string, mode: 'resubmit' | 'cancel') => {
    const trimmed = rejectReason.trim()
    if (!trimmed) {
      setErr('A reason is required so the student knows what to fix.')
      return
    }
    const label = mode === 'cancel'
      ? 'Reject & cancel this order? The order will close and leave the live queue.'
      : 'Reject proof & ask for resubmit? The student can upload a fresh screenshot.'
    if (!window.confirm(label)) return
    setRejecting(true)
    setMsg('')
    setErr('')
    try {
      const r = await api.post(`/admin/orders/${orderId}/reject`, { mode, reason: trimmed })
      const nextStatus = mode === 'cancel' ? 'Cancelled' : selectedOrder?.status
      setMsg(r.data?.message || (mode === 'cancel' ? 'Order cancelled.' : 'Proof rejected — student asked to resubmit.'))
      setOrders(list =>
        list.map(x => (x.id === orderId ? { ...x, status: r.data?.order?.status || nextStatus } : x))
      )
      if (mode === 'cancel') {
        setSelectedOrder(null)
      } else if (selectedOrder?.id === orderId) {
        loadProof(orderId)
      }
      setRejectReason('')
    } catch (e: any) {
      setErr(apiError(e, 'Could not reject this order'))
    } finally {
      setRejecting(false)
    }
  }

  // Open WhatsApp link
  const handleOpenWhatsApp = async (orderId: string) => {
    try {
      const r = await api.get(`/admin/orders/${orderId}/whatsapp-link`)
      if (r.data?.url) {
        window.open(r.data.url, '_blank')
      }
    } catch (e: any) {
      alert(apiError(e, 'Could not build WhatsApp dispatch link'))
    }
  }

  // Load proof for modal
  const loadProof = useCallback((orderId: string) => {
    setProof(null)
    setProofLoading(true)
    api
      .get(`/local/payments/proof/${orderId}`)
      .then((r: any) => setProof(r.data))
      .catch(() => setProof(null))
      .finally(() => setProofLoading(false))
  }, [])

  const handleOpenOrder = (order: any) => {
    setMsg('')
    setErr('')
    setRejectReason('')
    setSelectedOrder(order)
  }

  useEffect(() => {
    if (!selectedOrder) {
      setProof(null)
      setRejectReason('')
      return
    }
    if (String(selectedOrder.payment_method || 'UPI').toUpperCase() === 'COD') {
      setProof(null)
      return
    }
    loadProof(selectedOrder.id)
  }, [selectedOrder, loadProof])

  const detailIsCod = String(selectedOrder?.payment_method || 'UPI').toUpperCase() === 'COD'
  const detailProofStatus: string = proof?.proof_status || ''
  const isUpiWithoutProof =
    !!selectedOrder &&
    !detailIsCod &&
    detailProofStatus !== 'PAYMENT_PROOF_SUBMITTED' &&
    detailProofStatus !== 'PAYMENT_APPROVED'

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              Order Approvals & Live Queue
            </h1>
            {pendingCount > 0 ? (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-500/15 border border-amber-500/40 text-amber-800 dark:text-amber-300 text-xs font-bold">
                <span className="w-2 h-2 rounded-full bg-amber-500 animate-ping" />
                {pendingCount} Need Confirmation
              </span>
            ) : (
              <Badge variant="success" size="md">
                All Orders Confirmed
              </Badge>
            )}
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">
            Real-time command center for new incoming orders and active ongoing orders until completion
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link to="/orders">
            <Button variant="ghost" size="sm" icon={<ArrowRight className="w-3.5 h-3.5" />}>
              All Orders Desk (1300+ History)
            </Button>
          </Link>

          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadOrders(true)}
            icon={<RefreshCw className={`w-3.5 h-3.5 ${refreshing ? 'animate-spin' : ''}`} />}
          >
            Refresh
          </Button>
        </div>
      </div>

      {/* New Order Alert Banner (when background poll discovers a new incoming order) */}
      {newOrderNotice && (
        <div
          className="p-3 bg-amber-500/15 border border-amber-500/50 text-xs font-bold text-amber-900 dark:text-amber-200 flex items-center justify-between gap-2 shadow-xs animate-slide-up"
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2.5 w-2.5 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-amber-500" />
            </span>
            <span>{newOrderNotice}</span>
          </div>
          <button
            type="button"
            onClick={() => setNewOrderNotice(null)}
            className="p-1 text-amber-800 dark:text-amber-300 hover:opacity-75"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Top Action Messages (when modal is closed) */}
      {!selectedOrder && msg && (
        <div
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center justify-between gap-2 animate-fade-in"
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
            <span>{msg}</span>
          </div>
          <button type="button" onClick={() => setMsg('')} className="p-0.5 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {!selectedOrder && err && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-center justify-between gap-2 animate-fade-in"
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
            <span>{err}</span>
          </div>
          <button type="button" onClick={() => setErr('')} className="p-0.5 hover:opacity-75">
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* KPI Stats Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div
          onClick={() => setActiveTab('needs_confirmation')}
          className={`p-3.5 border cursor-pointer transition-colors ${
            activeTab === 'needs_confirmation'
              ? 'border-amber-500 bg-amber-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:border-amber-500/50'
          }`}
          style={{ borderRadius: 0 }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
              Needs Confirmation
            </p>
            {pendingCount > 0 && <span className="h-2 w-2 rounded-full bg-amber-500 animate-pulse" />}
          </div>
          <p className="text-2xl font-black text-amber-600 dark:text-amber-400 font-mono mt-1">
            {pendingCount}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Incoming orders awaiting admin approval
          </p>
        </div>

        <div
          onClick={() => setActiveTab('in_progress')}
          className={`p-3.5 border cursor-pointer transition-colors ${
            activeTab === 'in_progress'
              ? 'border-blue-500 bg-blue-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:border-blue-500/50'
          }`}
          style={{ borderRadius: 0 }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
            In Preparation / Kitchen
          </p>
          <p className="text-2xl font-black text-blue-600 dark:text-blue-400 font-mono mt-1">
            {inProgressCount}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Confirmed orders being cooked or packed
          </p>
        </div>

        <div
          onClick={() => setActiveTab('all_ongoing')}
          className={`p-3.5 border cursor-pointer transition-colors ${
            activeTab === 'all_ongoing'
              ? 'border-emerald-500 bg-emerald-500/10 shadow-xs'
              : 'border-[var(--border-main)] bg-[var(--bg-surface)] hover:border-emerald-500/50'
          }`}
          style={{ borderRadius: 0 }}
        >
          <p className="text-[11px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
            Total Ongoing Orders
          </p>
          <p className="text-2xl font-black text-[var(--text-heading)] font-mono mt-1">
            {totalOngoingCount}
          </p>
          <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
            Active orders currently in flight
          </p>
        </div>
      </div>

      {/* Filter Tabs & Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveTab('needs_confirmation')}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === 'needs_confirmation'
                ? 'bg-amber-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] bg-[var(--bg-surface)] border border-[var(--border-main)]'
            }`}
            style={{ borderRadius: 0 }}
          >
            Needs Confirmation ({pendingCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('in_progress')}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === 'in_progress'
                ? 'bg-blue-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] bg-[var(--bg-surface)] border border-[var(--border-main)]'
            }`}
            style={{ borderRadius: 0 }}
          >
            In Kitchen / Progress ({inProgressCount})
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('all_ongoing')}
            className={`px-3 py-1.5 text-xs font-bold transition-colors ${
              activeTab === 'all_ongoing'
                ? 'bg-emerald-600 text-white'
                : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] bg-[var(--bg-surface)] border border-[var(--border-main)]'
            }`}
            style={{ borderRadius: 0 }}
          >
            All Ongoing ({totalOngoingCount})
          </button>
        </div>

        {/* Quick Search */}
        <div className="relative min-w-[220px] sm:w-72">
          <Search className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search token (#), student, shop..."
            className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] pl-8 pr-7 py-1.5 text-xs text-[var(--text-heading)] outline-none focus:border-emerald-600 transition-colors"
            style={{ borderRadius: 0 }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--text-dim)] hover:text-[var(--text-heading)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Main Order Queue Listing */}
      {initialLoading && orders.length === 0 ? (
        <div className="p-16 text-center text-xs text-[var(--text-muted)] border border-[var(--border-main)] bg-[var(--bg-surface)]">
          <Clock className="w-8 h-8 mx-auto mb-2.5 animate-spin text-emerald-600 opacity-60" />
          Loading active orders queue...
        </div>
      ) : filteredOrders.length === 0 ? (
        <Card className="text-center py-16">
          <div
            className="w-14 h-14 mx-auto flex items-center justify-center bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 mb-3.5 border border-emerald-500/20"
            style={{ borderRadius: 0 }}
          >
            <Check className="w-7 h-7" />
          </div>
          <h3 className="text-lg font-bold text-[var(--text-heading)]">
            {activeTab === 'needs_confirmation'
              ? 'No Orders Awaiting Confirmation'
              : 'No Active Orders in This View'}
          </h3>
          <p className="mt-1.5 text-xs text-[var(--text-muted)] max-w-md mx-auto leading-relaxed">
            {activeTab === 'needs_confirmation' && inProgressCount > 0
              ? `All incoming orders have been confirmed! You currently have ${inProgressCount} orders in progress/preparation.`
              : 'New student orders will appear here automatically in real time as students place them.'}
          </p>

          <div className="mt-5 flex items-center justify-center gap-3">
            {activeTab === 'needs_confirmation' && inProgressCount > 0 && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => setActiveTab('in_progress')}
                icon={<ArrowRight className="w-3.5 h-3.5" />}
              >
                View In-Progress Orders ({inProgressCount})
              </Button>
            )}
            <Link to="/orders">
              <Button variant="secondary" size="sm" icon={<ExternalLink className="w-3.5 h-3.5" />}>
                Go to All Orders History
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <div className="space-y-3.5">
          {filteredOrders.map((order: any) => {
            const isPendingAction = needsConfirmation(order.status)
            const isCod = String(order.payment_method || 'UPI').toUpperCase() === 'COD'
            const isBrandNew = newlyAddedIds.has(String(order.id || order.token))

            return (
              <div
                key={order.id}
                onClick={() => handleOpenOrder(order)}
                className={`border bg-[var(--bg-surface)] p-4 cursor-pointer transition-all hover:shadow-md ${
                  isBrandNew
                    ? 'border-emerald-500 ring-2 ring-emerald-500/60 bg-emerald-500/5'
                    : isPendingAction
                    ? 'border-amber-500/50 hover:border-amber-500 bg-amber-500/2'
                    : 'border-[var(--border-main)] hover:border-emerald-600/70'
                }`}
                style={{ borderRadius: 0 }}
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  {/* Left Column: Token, Shop, Badges, Student & Items */}
                  <div className="space-y-2 flex-1 min-w-0">
                    {/* Header Row */}
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-lg font-black text-[var(--text-heading)]">
                        #{order.token}
                      </span>

                      {isBrandNew && (
                        <Badge variant="success" size="xs">
                          ✨ Just Arrived
                        </Badge>
                      )}

                      <Badge variant="default" size="xs">
                        <Store className="w-3 h-3 mr-1 inline" />
                        {order.shop_name}
                      </Badge>

                      <Badge variant={isCod ? 'gold' : 'cyan'} size="xs">
                        {isCod ? 'Cash on Delivery' : 'UPI Online'}
                      </Badge>

                      <Badge
                        variant={
                          isPendingAction
                            ? 'warning'
                            : ['completed', 'delivered'].includes(String(order.status).toLowerCase())
                            ? 'success'
                            : 'purple'
                        }
                        size="xs"
                      >
                        {isPendingAction ? `⏳ ${order.status}` : `⚡ ${order.status}`}
                      </Badge>

                      <span className="text-[11px] text-[var(--text-muted)] font-mono ml-auto lg:ml-2">
                        {fmtTime(order.created_at)}
                      </span>
                    </div>

                    {/* Customer & Location Row */}
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                      <div className="flex items-center gap-1.5">
                        <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                        <span className="font-bold text-[var(--text-heading)]">
                          {order.student_name}
                        </span>
                        {order.student_phone && (
                          <span className="text-[var(--text-muted)] font-mono text-[11px]">
                            ({order.student_phone})
                          </span>
                        )}
                      </div>

                      <div className="text-[var(--text-muted)] flex items-center gap-1">
                        <span>📍</span>
                        <span>{order.delivery_location || 'Campus Delivery'}</span>
                        {order.delivery_slot && (
                          <span className="font-mono text-[11px] text-[var(--text-dim)]">
                            · {order.delivery_slot}
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Items Ordered */}
                    {order.items && (
                      <div className="text-xs text-[var(--text-muted)] flex items-start gap-1.5 bg-[var(--bg-surface-subtle)] p-2 border border-[var(--border-subtle)]">
                        <ShoppingBag className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                        <span className="font-medium text-[var(--text-heading)] line-clamp-2">
                          {order.items}
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Right Column: Price and Action Buttons */}
                  <div
                    className="flex lg:flex-col items-center lg:items-end justify-between gap-3 shrink-0 pt-2 lg:pt-0 border-t lg:border-t-0 border-[var(--border-subtle)]"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <div className="text-left lg:text-right">
                      <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Total Amount</p>
                      <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                        ₹{order.total}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* WhatsApp Dispatch Button */}
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => handleOpenWhatsApp(order.id)}
                        title="Dispatch order details to shop via WhatsApp"
                        icon={<MessageSquare className="w-3 h-3 text-emerald-600" />}
                      >
                        WA
                      </Button>

                      {/* If order needs confirmation */}
                      {isPendingAction ? (
                        <>
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => handleConfirmOrder(order)}
                            disabled={busyId === order.id}
                            loading={busyId === order.id}
                            icon={<Check className="w-3.5 h-3.5" />}
                            title="1-Click verify & confirm this order"
                          >
                            Confirm Order
                          </Button>

                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleOpenOrder(order)}
                            title="Inspect payment proof and details"
                            icon={<Eye className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
                          >
                            Details
                          </Button>
                        </>
                      ) : (
                        /* If order is already in progress (Confirmed/Accepted) */
                        <>
                          <Button
                            variant="primary"
                            size="xs"
                            onClick={() => handleMarkCompleted(order)}
                            disabled={busyId === order.id}
                            loading={busyId === order.id}
                            icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                            title="Mark order as completed once student receives it"
                          >
                            Mark Completed
                          </Button>

                          <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => handleOpenOrder(order)}
                            title="Open breakdown modal"
                            icon={<Eye className="w-3.5 h-3.5 text-[var(--text-dim)]" />}
                          >
                            Details
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Order Breakdown & Verification Modal */}
      {selectedOrder && (
        <Modal
          open={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order #${selectedOrder.token} Breakdown`}
          description={`Placed on ${fmtTime(selectedOrder.created_at)}`}
          maxWidth="3xl"
          footer={
            <div className="flex items-center justify-between w-full flex-wrap gap-2">
              <div className="flex items-center gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleOpenWhatsApp(selectedOrder.id)}
                  icon={<MessageSquare className="w-3.5 h-3.5 text-emerald-600" />}
                >
                  WhatsApp Dispatch
                </Button>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                {needsConfirmation(selectedOrder.status) ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleConfirmOrder(selectedOrder)}
                    loading={busyId === selectedOrder.id}
                    disabled={busyId === selectedOrder.id || rejecting}
                    icon={<Check className="w-3.5 h-3.5" />}
                    title={
                      isUpiWithoutProof
                        ? 'Waiting for student UTR + screenshot — cannot confirm yet'
                        : 'Verify payment (UPI) & confirm order in one click'
                    }
                  >
                    Verify & Confirm
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => handleMarkCompleted(selectedOrder)}
                    loading={busyId === selectedOrder.id}
                    disabled={busyId === selectedOrder.id}
                    icon={<CheckCircle2 className="w-3.5 h-3.5" />}
                  >
                    Mark Completed
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => setSelectedOrder(null)}>
                  Close
                </Button>
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-[var(--text-body)]">
            {/* Modal Top Validation & Action Warnings */}
            {err && (
              <div
                className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-start justify-between gap-2.5 animate-fade-in"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600 dark:text-red-400" />
                  <span>{err}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setErr('')}
                  className="text-red-600 dark:text-red-400 hover:opacity-70 p-0.5"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {msg && (
              <div
                className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-start justify-between gap-2.5 animate-fade-in"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  <span>{msg}</span>
                </div>
                <button
                  type="button"
                  onClick={() => setMsg('')}
                  className="text-emerald-600 dark:text-emerald-400 hover:opacity-70 p-0.5"
                  title="Dismiss alert"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* Meta stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-dim)]">Total Amount</p>
                <p className="text-xl font-black text-[var(--text-heading)] font-mono mt-0.5">
                  ₹{selectedOrder.total}
                </p>
              </div>

              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-dim)]">Status</p>
                <div className="mt-1">
                  <Badge
                    variant={
                      needsConfirmation(selectedOrder.status)
                        ? 'warning'
                        : ['completed', 'delivered'].includes(String(selectedOrder.status).toLowerCase())
                        ? 'success'
                        : 'purple'
                    }
                    size="xs"
                  >
                    {selectedOrder.status}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-dim)]">Payment</p>
                <div className="mt-1">
                  <Badge
                    variant={selectedOrder.payment_method === 'COD' ? 'gold' : 'cyan'}
                    size="xs"
                  >
                    {selectedOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Online'}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold tracking-wider text-[var(--text-dim)]">Admin Share</p>
                <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  ₹10
                </p>
              </div>
            </div>

            {/* Customer & Shop Details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                  <User className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Customer Information
                  </p>
                </div>
                <p className="font-bold text-[var(--text-heading)] text-sm">
                  {selectedOrder.student_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-1">
                  Phone: <span className="text-[var(--text-heading)] font-semibold">{selectedOrder.student_phone || '—'}</span>
                </p>
                <p className="text-[var(--text-muted)] mt-1">
                  Delivery Point: <span className="text-[var(--text-body)] font-medium">{selectedOrder.delivery_location || 'Campus Delivery'}</span>
                </p>
                {selectedOrder.delivery_slot && (
                  <p className="text-[var(--text-muted)] mt-0.5">
                    Slot: <span className="text-[var(--text-body)] font-medium">{selectedOrder.delivery_slot}</span>
                  </p>
                )}
              </div>

              <div
                className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center gap-2 mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                  <Store className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Shop Information
                  </p>
                </div>
                <p className="font-bold text-[var(--text-heading)] text-sm">
                  {selectedOrder.shop_name}
                </p>
                <p className="text-[var(--text-muted)] font-mono mt-1">
                  Vendor Phone: <span className="text-[var(--text-heading)] font-semibold">{selectedOrder.shop_phone || '—'}</span>
                </p>
                <p className="text-[var(--text-muted)] mt-1">
                  Order Token: <span className="font-mono font-bold text-[var(--text-heading)]">#{selectedOrder.token}</span>
                </p>
              </div>
            </div>

            {/* Items Breakdown */}
            <div
              className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface)]"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between mb-2 pb-1.5 border-b border-[var(--border-subtle)]">
                <div className="flex items-center gap-2">
                  <ShoppingBag className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Order Items
                  </p>
                </div>
                <Badge variant="default" size="xs">
                  {String(selectedOrder.items || '').split(',').filter(Boolean).length} items
                </Badge>
              </div>
              <div className="divide-y divide-[var(--border-subtle)] text-xs">
                {String(selectedOrder.items || '')
                  .split(',')
                  .map((item, idx) => (
                    <div key={idx} className="py-2 flex items-center justify-between">
                      <span className="font-medium text-[var(--text-heading)]">
                        {item.trim()}
                      </span>
                    </div>
                  ))}
              </div>
            </div>

            {/* UPI Payment Proof (if UPI) */}
            {!detailIsCod && (
              <div
                className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface)]"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px] mb-2">
                  UPI Payment Proof
                </p>
                {proofLoading ? (
                  <p className="text-xs text-[var(--text-muted)]">Loading proof…</p>
                ) : proof?.payment_screenshot_url || proof?.utr_number ? (
                  <div className="space-y-2 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-[var(--text-muted)]">
                        UTR:{' '}
                        <span className="font-mono font-bold text-[var(--text-heading)]">
                          {proof.utr_number || '—'}
                        </span>
                      </span>
                      <Badge
                        variant={
                          detailProofStatus === 'PAYMENT_APPROVED'
                            ? 'success'
                            : detailProofStatus === 'PAYMENT_REJECTED'
                            ? 'error'
                            : detailProofStatus === 'PAYMENT_PROOF_SUBMITTED'
                            ? 'warning'
                            : 'default'
                        }
                        size="xs"
                      >
                        {detailProofStatus.replace(/_/g, ' ') || 'PENDING PAYMENT'}
                      </Badge>
                    </div>
                    {proof.payment_screenshot_url && (
                      <a
                        href={proof.payment_screenshot_url}
                        target="_blank"
                        rel="noreferrer"
                        title="Open full screenshot"
                      >
                        <img
                          src={proof.payment_screenshot_url}
                          alt="Payment screenshot"
                          className="max-h-64 w-full rounded border border-[var(--border-main)] object-contain bg-white"
                        />
                      </a>
                    )}
                    {proof.payment_rejection_reason && (
                      <p className="text-red-600 font-semibold">
                        Last rejection: {proof.payment_rejection_reason}
                      </p>
                    )}
                  </div>
                ) : (
                  <p className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-semibold">
                    <ShieldAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    <span>
                      No UTR + screenshot submitted yet. This UPI order cannot be
                      confirmed until the student submits proof.
                    </span>
                  </p>
                )}
              </div>
            )}

            {/* Reject section (only if order is still actionable) */}
            {needsConfirmation(selectedOrder.status) && (
              <div
                className={`p-4 border ${
                  err && !rejectReason.trim()
                    ? 'border-red-500 bg-red-500/10 ring-1 ring-red-500/30'
                    : 'border-red-500/30 bg-red-500/5'
                }`}
                style={{ borderRadius: 0 }}
              >
                <div className="flex items-center justify-between mb-2">
                  <p className="font-bold text-[var(--text-heading)] uppercase tracking-wider text-[11px]">
                    Reject this order
                  </p>
                  {err && !rejectReason.trim() && (
                    <span className="text-[11px] font-bold text-red-600 dark:text-red-400">
                      * Reason is required
                    </span>
                  )}
                </div>
                <label className="text-[11px] font-bold text-[var(--text-muted)]">
                  Reason (required — student sees this)
                </label>
                <input
                  type="text"
                  value={rejectReason}
                  onChange={(e) => {
                    setRejectReason(e.target.value)
                    if (err) setErr('')
                  }}
                  placeholder={
                    detailIsCod
                      ? 'e.g. Kitchen closed — order cancelled'
                      : 'e.g. Screenshot is blurry — send a clearer one'
                  }
                  maxLength={500}
                  className={`mt-1 w-full border ${
                    err && !rejectReason.trim()
                      ? 'border-red-500 ring-1 ring-red-500'
                      : 'border-[var(--border-main)]'
                  } bg-[var(--bg-input)] px-3 py-2 text-xs outline-none focus:border-red-500`}
                />
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {!detailIsCod && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => handleRejectOrder(selectedOrder.id, 'resubmit')}
                      disabled={rejecting || busyId === selectedOrder.id}
                      loading={rejecting}
                      icon={<RefreshCw className="w-3.5 h-3.5" />}
                      title="Reject proof — order stays open, student submits fresh UTR + screenshot"
                    >
                      Ask for Resubmit
                    </Button>
                  )}
                  <Button
                    variant="danger"
                    size="sm"
                    onClick={() => handleRejectOrder(selectedOrder.id, 'cancel')}
                    disabled={rejecting || busyId === selectedOrder.id}
                    loading={rejecting}
                    icon={<XCircle className="w-3.5 h-3.5" />}
                    title="Reject & cancel — order closes, student is told why"
                  >
                    Reject & Cancel Order
                  </Button>
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}

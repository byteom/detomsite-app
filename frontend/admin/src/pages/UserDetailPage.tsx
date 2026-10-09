import React, { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import {
  ArrowLeft,
  User,
  Users,
  Mail,
  Phone,
  Calendar,
  Clock,
  ShoppingBag,
  CreditCard,
  MapPin,
  Activity,
  Star,
  MessageSquare,
  Shield,
  CheckCircle,
  XCircle,
  AlertCircle,
  Edit,
  Ban,
  Trash2,
  ExternalLink,
  RefreshCw,
  Eye,
  ChevronRight,
  Copy,
  Check,
  Store,
  DollarSign,
  PackageCheck,
  PackageX,
  Hourglass,
  Layers,
  Inbox,
  Search,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtDateOnly, fmtCurrency, fmtRelativeTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge, BadgeVariant } from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import { Modal } from '../components/ui/Modal'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { OrderItemsCell } from '../components/common/OrderItemsCell'

type TabType = 'overview' | 'orders' | 'payments' | 'addresses' | 'activity' | 'feedback'

export function UserDetailPage() {
  const { userId } = useParams<{ userId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<any | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [actionMsg, setActionMsg] = useState('')
  const [actionErr, setActionErr] = useState('')

  const [activeTab, setActiveTab] = useState<TabType>('overview')

  // Modals & Dialogs state
  const [selectedOrder, setSelectedOrder] = useState<any | null>(null)
  const [isEditOpen, setIsEditOpen] = useState(false)
  const [isSuspendConfirmOpen, setIsSuspendConfirmOpen] = useState(false)
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] = useState(false)
  const [copiedField, setCopiedField] = useState<string | null>(null)

  // Edit form state
  const [editForm, setEditForm] = useState({
    name: '',
    email: '',
    phone: '',
    role: 'student',
    status: 'active',
  })
  const [savingEdit, setSavingEdit] = useState(false)
  const [processingStatus, setProcessingStatus] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Filters within orders tab
  const [orderSearch, setOrderSearch] = useState('')
  const [orderStatusFilter, setOrderStatusFilter] = useState('all')

  // Filters within payments tab
  const [paymentSearch, setPaymentSearch] = useState('')
  const [paymentMethodFilter, setPaymentMethodFilter] = useState('all')

  const loadUserOverview = async () => {
    if (!userId) return
    setLoading(true)
    setError('')
    try {
      const res = await api.get(`/admin/users/${userId}`)
      setData(res.data)
      if (res.data?.user) {
        setEditForm({
          name: res.data.user.name || '',
          email: res.data.user.email || '',
          phone: res.data.user.phone || '',
          role: res.data.user.role || 'student',
          status: res.data.user.status || 'active',
        })
      }
    } catch (e: any) {
      setError(apiError(e, 'Failed to retrieve user overview'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUserOverview()
  }, [userId])

  const copyToClipboard = (text: string, field: string) => {
    if (!text) return
    navigator.clipboard.writeText(text)
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 2000)
  }

  // Handle Edit User Save
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!userId) return
    setSavingEdit(true)
    setActionErr('')
    setActionMsg('')
    try {
      const res = await api.put(`/admin/users/${userId}`, editForm)
      setActionMsg('User account updated successfully.')
      setIsEditOpen(false)
      loadUserOverview()
    } catch (e: any) {
      setActionErr(apiError(e, 'Could not update user details'))
    } finally {
      setSavingEdit(false)
    }
  }

  // Handle Status Toggle (Suspend / Activate)
  const handleToggleStatus = async () => {
    if (!userId || !data?.user) return
    setProcessingStatus(true)
    setActionErr('')
    setActionMsg('')
    const targetStatus = data.user.status === 'blocked' ? 'active' : 'blocked'
    try {
      await api.post(`/admin/users/${userId}/status`, { status: targetStatus })
      setActionMsg(`Account status changed to ${targetStatus}.`)
      setIsSuspendConfirmOpen(false)
      loadUserOverview()
    } catch (e: any) {
      setActionErr(apiError(e, 'Failed to modify account status'))
    } finally {
      setProcessingStatus(false)
    }
  }

  // Handle User Delete
  const handleDeleteUser = async () => {
    if (!userId || !data?.user) return
    setDeleting(true)
    setActionErr('')
    setActionMsg('')
    try {
      await api.delete(`/admin/users/${userId}`)
      navigate('/users', { replace: true })
    } catch (e: any) {
      setActionErr(apiError(e, 'Failed to delete user account'))
      setIsDeleteConfirmOpen(false)
    } finally {
      setDeleting(false)
    }
  }

  // Filtered Orders for the Orders Tab
  const filteredOrders = useMemo(() => {
    if (!data?.orders) return []
    return data.orders.filter((o: any) => {
      const q = orderSearch.toLowerCase().trim()
      const matchSearch =
        !q ||
        String(o.id || '').toLowerCase().includes(q) ||
        String(o.token || '').includes(q) ||
        String(o.shop_name || '').toLowerCase().includes(q) ||
        String(o.items || '').toLowerCase().includes(q) ||
        String(o.delivery_location || '').toLowerCase().includes(q)

      const matchStatus =
        orderStatusFilter === 'all' ||
        String(o.status || '').toLowerCase() === orderStatusFilter.toLowerCase()

      return matchSearch && matchStatus
    })
  }, [data?.orders, orderSearch, orderStatusFilter])

  // Filtered Payments for the Payments Tab
  const filteredPayments = useMemo(() => {
    if (!data?.payments) return []
    return data.payments.filter((p: any) => {
      const q = paymentSearch.toLowerCase().trim()
      const matchSearch =
        !q ||
        String(p.id || '').toLowerCase().includes(q) ||
        String(p.order_id || '').toLowerCase().includes(q) ||
        String(p.utr_number || '').toLowerCase().includes(q)

      const matchMethod =
        paymentMethodFilter === 'all' ||
        String(p.method || '').toLowerCase() === paymentMethodFilter.toLowerCase()

      return matchSearch && matchMethod
    })
  }, [data?.payments, paymentSearch, paymentMethodFilter])

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 bg-[var(--bg-surface-subtle)] w-48 border border-[var(--border-main)]" />
        <div className="h-44 bg-[var(--bg-surface)] border border-[var(--border-main)] p-6" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-24 bg-[var(--bg-surface)] border border-[var(--border-main)]" />
          ))}
        </div>
      </div>
    )
  }

  if (error || !data?.user) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-2">
          <Link
            to="/users"
            className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--text-muted)] hover:text-[var(--text-heading)] transition-colors"
          >
            <ArrowLeft className="w-3.5 h-3.5" /> Back to Users Directory
          </Link>
        </div>
        <Card className="p-10 text-center">
          <AlertCircle className="w-10 h-10 text-red-500 mx-auto mb-3" />
          <h2 className="text-lg font-black text-[var(--text-heading)]">User Account Not Found</h2>
          <p className="text-xs text-[var(--text-muted)] mt-1 max-w-md mx-auto">
            {error || 'The requested user profile does not exist or has been removed.'}
          </p>
          <div className="mt-5">
            <Button variant="secondary" size="sm" onClick={() => navigate('/users')}>
              Return to Users
            </Button>
          </div>
        </Card>
      </div>
    )
  }

  const { user, stats, orders, payments, addresses, reviews, feedback, activity, shop } = data
  const isSuperAdmin = user.id === 1 || user.username === '12'
  const isBlocked = user.status === 'blocked' || user.status === 'suspended'

  const roleVariant: BadgeVariant =
    user.role === 'admin' ? 'purple' : user.role === 'student' ? 'success' : 'info'

  const statusVariant: BadgeVariant = isBlocked ? 'error' : 'success'

  const userInitials = (user.name || user.username || 'U')
    .split(' ')
    .map((n: string) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Breadcrumb Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-b border-[var(--border-main)] pb-3">
        <div className="flex items-center gap-2 font-mono">
          <Link
            to="/users"
            className="text-[var(--text-muted)] hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors flex items-center gap-1"
          >
            <Users className="w-3.5 h-3.5" /> Users
          </Link>
          <span className="text-[var(--text-dim)]">/</span>
          <span className="font-bold text-[var(--text-heading)] truncate max-w-[200px]">
            {user.name}
          </span>
          <span className="text-[var(--text-dim)]">/</span>
          <span className="uppercase text-emerald-600 dark:text-emerald-400 font-bold">
            {activeTab}
          </span>
        </div>

        <Button
          variant="secondary"
          size="xs"
          onClick={() => navigate('/users')}
          icon={<ArrowLeft className="w-3 h-3" />}
        >
          All Accounts
        </Button>
      </div>

      {/* Global Alerts */}
      {actionMsg && (
        <div
          className="p-3 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center justify-between"
          style={{ borderRadius: 0 }}
        >
          <span className="flex items-center gap-2">
            <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            {actionMsg}
          </span>
          <button
            onClick={() => setActionMsg('')}
            className="text-xs hover:underline text-emerald-700 dark:text-emerald-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {actionErr && (
        <div
          className="p-3 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-center justify-between"
          style={{ borderRadius: 0 }}
        >
          <span className="flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
            {actionErr}
          </span>
          <button
            onClick={() => setActionErr('')}
            className="text-xs hover:underline text-red-700 dark:text-red-400"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* 360° Profile Header */}
      <div
        className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-5 lg:p-6 shadow-xs relative overflow-hidden"
        style={{ borderRadius: 0 }}
      >
        <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-6">
          {/* Identity & Contact Details */}
          <div className="flex items-start gap-4 flex-1 min-w-0">
            {/* Square Avatar with Role Accent */}
            <div
              className={`w-16 h-16 shrink-0 font-black text-xl flex items-center justify-center border-2 ${
                user.role === 'admin'
                  ? 'bg-purple-500/10 border-purple-500 text-purple-700 dark:text-purple-300'
                  : user.role === 'shopkeeper'
                  ? 'bg-blue-500/10 border-blue-500 text-blue-700 dark:text-blue-300'
                  : 'bg-emerald-500/10 border-emerald-500 text-emerald-700 dark:text-emerald-300'
              }`}
              style={{ borderRadius: 0 }}
            >
              {userInitials}
            </div>

            <div className="space-y-1.5 flex-1 min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl lg:text-2xl font-black text-[var(--text-heading)] tracking-tight">
                  {user.name}
                </h1>
                <Badge variant={roleVariant} size="xs">
                  {user.role}
                </Badge>
                <Badge variant={statusVariant} size="xs" dot>
                  {user.status || 'Active'}
                </Badge>
                <span className="font-mono text-xs text-[var(--text-dim)] border border-[var(--border-main)] px-1.5 py-0.5 bg-[var(--bg-surface-subtle)]">
                  ID: #{user.id}
                </span>
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--text-muted)] font-mono">
                <span className="text-[var(--text-heading)] font-semibold">@{user.username}</span>

                {user.email && (
                  <span className="flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                    <span>{user.email}</span>
                    <button
                      onClick={() => copyToClipboard(user.email, 'email')}
                      title="Copy email address"
                      className="hover:text-[var(--text-heading)] ml-0.5"
                    >
                      {copiedField === 'email' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-[var(--text-dim)]" />
                      )}
                    </button>
                  </span>
                )}

                {user.phone && (
                  <span className="flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[var(--text-dim)]" />
                    <span>{user.phone}</span>
                    <button
                      onClick={() => copyToClipboard(user.phone, 'phone')}
                      title="Copy phone number"
                      className="hover:text-[var(--text-heading)] ml-0.5"
                    >
                      {copiedField === 'phone' ? (
                        <Check className="w-3 h-3 text-emerald-600" />
                      ) : (
                        <Copy className="w-3 h-3 text-[var(--text-dim)]" />
                      )}
                    </button>
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-[var(--text-dim)] pt-1">
                <span className="flex items-center gap-1">
                  <Calendar className="w-3 h-3 text-[var(--text-dim)]" />
                  Registered: {fmtDateOnly(user.created_at)} ({fmtRelativeTime(user.created_at)})
                </span>
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3 text-[var(--text-dim)]" />
                  Last Login: {user.last_login ? fmtTime(user.last_login) : 'Never recorded'}
                </span>
              </div>
            </div>
          </div>

          {/* Action Toolbar */}
          <div className="flex flex-wrap items-center gap-2 shrink-0 border-t lg:border-t-0 pt-4 lg:pt-0 border-[var(--border-subtle)]">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsEditOpen(true)}
              icon={<Edit className="w-3.5 h-3.5" />}
            >
              Edit Details
            </Button>

            {!isSuperAdmin && (
              <Button
                variant={isBlocked ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => setIsSuspendConfirmOpen(true)}
                icon={isBlocked ? <CheckCircle className="w-3.5 h-3.5" /> : <Ban className="w-3.5 h-3.5" />}
              >
                {isBlocked ? 'Activate Account' : 'Suspend Account'}
              </Button>
            )}

            {user.role !== 'admin' && (
              <Button
                variant="danger"
                size="sm"
                onClick={() => setIsDeleteConfirmOpen(true)}
                icon={<Trash2 className="w-3.5 h-3.5" />}
              >
                Delete Account
              </Button>
            )}

            <Button
              variant="ghost"
              size="sm"
              onClick={loadUserOverview}
              title="Refresh User Profile"
              icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
            />
          </div>
        </div>
      </div>

      {/* Primary Tab Navigation */}
      <div className="border-b border-[var(--border-main)] flex items-center gap-1 overflow-x-auto no-scrollbar">
        {[
          { id: 'overview', label: 'Overview', icon: Layers },
          { id: 'orders', label: 'Order History', count: stats.total_orders, icon: ShoppingBag },
          { id: 'payments', label: 'Payments', count: payments.length, icon: CreditCard },
          { id: 'addresses', label: 'Addresses & Locations', count: addresses.length, icon: MapPin },
          { id: 'activity', label: 'Activity Timeline', count: activity.length, icon: Activity },
          {
            id: 'feedback',
            label: 'Reviews & Feedback',
            count: stats.reviews_count + stats.feedback_count,
            icon: Star,
          },
        ].map(t => {
          const Icon = t.icon
          const isActive = activeTab === t.id
          return (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id as TabType)}
              className={`px-4 py-2.5 text-xs font-bold transition-all border-b-2 whitespace-nowrap flex items-center gap-2 select-none ${
                isActive
                  ? 'border-emerald-600 text-[var(--text-heading)] bg-[var(--bg-surface)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)]'
              }`}
              style={{ borderRadius: 0 }}
            >
              <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-emerald-600 dark:text-emerald-400' : ''}`} />
              <span>{t.label}</span>
              {t.count !== undefined && (
                <span
                  className={`px-1.5 py-0.2 text-[10px] font-mono font-bold ${
                    isActive
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[var(--bg-surface-subtle)] text-[var(--text-dim)] border border-[var(--border-main)]'
                  }`}
                  style={{ borderRadius: 0 }}
                >
                  {t.count}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* ─────────────────────────────────────────────────────────────
          TAB 1: OVERVIEW
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Key Metric Stat Cards */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total Orders</span>
                <ShoppingBag className="w-3.5 h-3.5 text-blue-500" />
              </div>
              <p className="text-xl font-black text-[var(--text-heading)] font-mono">
                {stats.total_orders}
              </p>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Lifetime checkouts</p>
            </div>

            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Total Spent</span>
                <DollarSign className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 font-mono">
                {fmtCurrency(stats.total_spent)}
              </p>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">Delivered orders sum</p>
            </div>

            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Completed</span>
                <PackageCheck className="w-3.5 h-3.5 text-emerald-600" />
              </div>
              <p className="text-xl font-black text-[var(--text-heading)] font-mono">
                {stats.completed_orders}
              </p>
              <p className="text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">Successful orders</p>
            </div>

            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Pending</span>
                <Hourglass className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <p className="text-xl font-black text-[var(--text-heading)] font-mono">
                {stats.pending_orders}
              </p>
              <p className="text-[10px] text-amber-600 dark:text-amber-400 mt-0.5">In-flight / Awaiting</p>
            </div>

            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Cancelled</span>
                <PackageX className="w-3.5 h-3.5 text-red-500" />
              </div>
              <p className="text-xl font-black text-[var(--text-heading)] font-mono">
                {stats.cancelled_orders}
              </p>
              <p className="text-[10px] text-red-600 dark:text-red-400 mt-0.5">Rejected or voided</p>
            </div>

            <div
              className="p-3.5 bg-[var(--bg-surface)] border border-[var(--border-main)] shadow-xs"
              style={{ borderRadius: 0 }}
            >
              <div className="flex items-center justify-between text-[var(--text-dim)] mb-1">
                <span className="text-[10px] font-bold uppercase tracking-wider">Engagement</span>
                <Star className="w-3.5 h-3.5 text-purple-500" />
              </div>
              <p className="text-xl font-black text-[var(--text-heading)] font-mono">
                {stats.reviews_count + stats.feedback_count}
              </p>
              <p className="text-[10px] text-purple-600 dark:text-purple-400 mt-0.5">Reviews & reports</p>
            </div>
          </div>

          {/* Two-Column Structured Profile Content */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left 1/3: Account Details & Delivery Addresses */}
            <div className="space-y-6">
              {/* Account Metadata Card */}
              <Card title="Account Credentials & Role" subtitle="Core platform identification">
                <div className="divide-y divide-[var(--border-subtle)] text-xs">
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">User ID</span>
                    <span className="font-mono font-bold text-[var(--text-heading)]">#{user.id}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Username</span>
                    <span className="font-mono font-bold text-[var(--text-heading)]">@{user.username}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Full Name</span>
                    <span className="font-bold text-[var(--text-heading)]">{user.name}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Email</span>
                    <span className="font-mono text-[var(--text-heading)] truncate max-w-[160px]">
                      {user.email || '—'}
                    </span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Phone</span>
                    <span className="font-mono text-[var(--text-heading)]">{user.phone || '—'}</span>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Platform Role</span>
                    <Badge variant={roleVariant} size="xs">
                      {user.role}
                    </Badge>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Status</span>
                    <Badge variant={statusVariant} size="xs" dot>
                      {user.status || 'Active'}
                    </Badge>
                  </div>
                  <div className="py-2.5 flex items-center justify-between">
                    <span className="text-[var(--text-muted)]">Registered On</span>
                    <span className="font-mono text-[var(--text-heading)]">{fmtDateOnly(user.created_at)}</span>
                  </div>
                </div>
              </Card>

              {/* Delivery Locations / Addresses */}
              <Card
                title="Delivery Addresses & Slots"
                subtitle="Historical delivery drop points used by customer"
                action={
                  addresses.length > 0 && (
                    <Badge variant="default" size="xs">
                      {addresses.length} Locations
                    </Badge>
                  )
                }
              >
                {addresses.length === 0 ? (
                  <div className="text-center py-6 text-[var(--text-muted)] text-xs">
                    <MapPin className="w-6 h-6 mx-auto mb-1.5 opacity-30" />
                    No delivery addresses recorded yet
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {addresses.map((a: any, i: number) => (
                      <div
                        key={i}
                        className="p-3 border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] text-xs"
                        style={{ borderRadius: 0 }}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <p className="font-bold text-[var(--text-heading)] flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                            {a.location}
                          </p>
                          <span className="text-[10px] font-mono px-1.5 py-0.5 bg-[var(--bg-surface)] border border-[var(--border-main)] font-bold text-[var(--text-heading)] shrink-0">
                            {a.order_count} {a.order_count === 1 ? 'order' : 'orders'}
                          </span>
                        </div>
                        {a.slot && (
                          <p className="text-[11px] text-[var(--text-muted)] font-mono mt-1 ml-5">
                            Slot: {a.slot}
                          </p>
                        )}
                        {a.last_used && (
                          <p className="text-[10px] text-[var(--text-dim)] mt-1 ml-5">
                            Last order: {fmtDateOnly(a.last_used)}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </Card>

              {/* Linked Shop (If Shopkeeper) */}
              {shop && (
                <Card title="Linked Business / Kitchen" subtitle="Vendor store owned by this account">
                  <div className="space-y-3 text-xs">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-[var(--text-heading)] flex items-center gap-1.5">
                        <Store className="w-4 h-4 text-blue-600" />
                        {shop.name}
                      </span>
                      <Badge variant={shop.status === 'Open' ? 'success' : 'neutral'} size="xs">
                        {shop.status}
                      </Badge>
                    </div>

                    <div className="divide-y divide-[var(--border-subtle)] text-xs font-mono">
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[var(--text-muted)]">Category:</span>
                        <span className="text-[var(--text-heading)]">{shop.category}</span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[var(--text-muted)]">Approval:</span>
                        <Badge variant={shop.approval_status === 'Approved' ? 'success' : 'warning'} size="xs">
                          {shop.approval_status}
                        </Badge>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[var(--text-muted)]">Orders Today:</span>
                        <span className="text-[var(--text-heading)]">{shop.orders_today || 0}</span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[var(--text-muted)]">UPI Setup:</span>
                        <span className="text-[var(--text-heading)]">{shop.upi_id || 'Not configured'}</span>
                      </div>
                      <div className="py-1.5 flex justify-between">
                        <span className="text-[var(--text-muted)]">Admin Dues:</span>
                        <span className="text-amber-600 dark:text-amber-400 font-bold">
                          ₹{shop.admin_dues_balance || 0}
                        </span>
                      </div>
                    </div>

                    <div className="pt-2">
                      <Link to="/vendors">
                        <Button variant="secondary" size="xs" className="w-full">
                          Manage in Vendors Desk →
                        </Button>
                      </Link>
                    </div>
                  </div>
                </Card>
              )}
            </div>

            {/* Right 2/3: Recent Orders & Chronological Activity Feed */}
            <div className="lg:col-span-2 space-y-6">
              {/* Recent Orders Preview */}
              <Card
                title="Recent Orders"
                subtitle="Most recent campus food orders placed by this account"
                action={
                  orders.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setActiveTab('orders')}
                      icon={<ChevronRight className="w-3.5 h-3.5" />}
                    >
                      View All ({orders.length})
                    </Button>
                  )
                }
              >
                {orders.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)] text-xs">
                    <ShoppingBag className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No orders have been placed by this customer yet.
                  </div>
                ) : (
                  <div className="divide-y divide-[var(--border-subtle)]">
                    {orders.slice(0, 4).map((o: any) => {
                      const sLower = String(o.status || '').toLowerCase()
                      let sVariant: BadgeVariant = 'info'
                      if (sLower.includes('completed') || sLower.includes('delivered')) sVariant = 'success'
                      else if (sLower.includes('cancelled') || sLower.includes('rejected')) sVariant = 'error'
                      else if (sLower.includes('pending') || sLower === 'placed') sVariant = 'warning'

                      return (
                        <div
                          key={o.id}
                          className="py-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-[var(--bg-surface-hover)] p-2 transition-colors cursor-pointer"
                          onClick={() => setSelectedOrder(o)}
                        >
                          <div className="space-y-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-xs text-[var(--text-heading)]">
                                #{o.token || o.id}
                              </span>
                              <span className="font-bold text-xs text-[var(--text-heading)] truncate max-w-[200px]">
                                {o.shop_name}
                              </span>
                              <Badge variant={sVariant} size="xs">
                                {o.status}
                              </Badge>
                              <Badge
                                variant={o.payment_method === 'COD' ? 'gold' : 'cyan'}
                                size="xs"
                              >
                                {o.payment_method || 'UPI'}
                              </Badge>
                            </div>
                            <p className="text-xs text-[var(--text-muted)] truncate max-w-md">
                              {o.items}
                            </p>
                            <p className="text-[11px] text-[var(--text-dim)] font-mono">
                              {fmtTime(o.created_at)} • {o.delivery_location || 'Campus'}
                            </p>
                          </div>

                          <div className="flex items-center gap-3 shrink-0 self-end sm:self-center">
                            <span className="font-mono font-bold text-sm text-[var(--text-heading)]">
                              ₹{o.total}
                            </span>
                            <Button
                              variant="ghost"
                              size="xs"
                              onClick={(e) => {
                                e.stopPropagation()
                                setSelectedOrder(o)
                              }}
                              title="Inspect order details"
                              icon={<Eye className="w-3.5 h-3.5" />}
                            />
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </Card>

              {/* Activity Timeline Preview */}
              <Card
                title="Activity Timeline"
                subtitle="Audit trail of logins, orders, reviews, and account events"
                action={
                  activity.length > 0 && (
                    <Button
                      variant="ghost"
                      size="xs"
                      onClick={() => setActiveTab('activity')}
                      icon={<ChevronRight className="w-3.5 h-3.5" />}
                    >
                      Full Timeline ({activity.length})
                    </Button>
                  )
                }
              >
                {activity.length === 0 ? (
                  <div className="text-center py-8 text-[var(--text-muted)] text-xs">
                    <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
                    No logged activity events found for this user.
                  </div>
                ) : (
                  <div className="relative pl-6 space-y-4 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-[var(--border-main)]">
                    {activity.slice(0, 5).map((ev: any, idx: number) => (
                      <div key={ev.id || idx} className="relative text-xs">
                        {/* Dot on line */}
                        <div
                          className={`absolute -left-[23px] top-1 w-2.5 h-2.5 border-2 bg-[var(--bg-surface)] ${
                            ev.type === 'order'
                              ? 'border-emerald-600'
                              : ev.type === 'login'
                              ? 'border-blue-600'
                              : ev.type === 'registration'
                              ? 'border-purple-600'
                              : 'border-amber-600'
                          }`}
                          style={{ borderRadius: 0 }}
                        />

                        <div className="flex items-baseline justify-between gap-2">
                          <p className="font-bold text-[var(--text-heading)]">{ev.title}</p>
                          <span className="text-[10px] text-[var(--text-dim)] font-mono shrink-0">
                            {fmtTime(ev.timestamp)}
                          </span>
                        </div>
                        <p className="text-[var(--text-muted)] mt-0.5">{ev.description}</p>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            </div>
          </div>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 2: ORDER HISTORY
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'orders' && (
        <Card
          title="Complete Order History"
          subtitle={`All orders associated with ${user.name} (${orders.length} total)`}
        >
          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 p-3 bg-[var(--bg-surface-subtle)] border border-[var(--border-main)]">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={orderSearch}
                onChange={e => setOrderSearch(e.target.value)}
                placeholder="Search order ID, shop, items, location..."
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none"
                style={{ borderRadius: 0 }}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Status:</span>
              <select
                value={orderStatusFilter}
                onChange={e => setOrderStatusFilter(e.target.value)}
                className="text-xs bg-[var(--bg-surface)] border border-[var(--border-main)] px-2.5 py-1.5 text-[var(--text-heading)]"
                style={{ borderRadius: 0 }}
              >
                <option value="all">All Statuses</option>
                <option value="Completed">Completed</option>
                <option value="Delivered">Delivered</option>
                <option value="Pending Acceptance">Pending Acceptance</option>
                <option value="Accepted">Accepted</option>
                <option value="Preparing">Preparing</option>
                <option value="Cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {filteredOrders.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-xs">
              <Inbox className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No orders matched your search or filters.
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[var(--bg-surface-subtle)] border-b border-[var(--border-main)] uppercase font-bold text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Token / ID</th>
                    <th className="px-4 py-3">Placed At</th>
                    <th className="px-4 py-3">Restaurant</th>
                    <th className="px-4 py-3">Items Ordered</th>
                    <th className="px-4 py-3">Location & Slot</th>
                    <th className="px-4 py-3 text-right">Total</th>
                    <th className="px-4 py-3 text-center">Method</th>
                    <th className="px-4 py-3 text-center">Status</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredOrders.map((o: any) => {
                    const sLower = String(o.status || '').toLowerCase()
                    let sVariant: BadgeVariant = 'info'
                    if (sLower.includes('completed') || sLower.includes('delivered')) sVariant = 'success'
                    else if (sLower.includes('cancelled') || sLower.includes('rejected')) sVariant = 'error'
                    else if (sLower.includes('pending') || sLower === 'placed') sVariant = 'warning'

                    return (
                      <tr
                        key={o.id}
                        className="hover:bg-[var(--bg-surface-hover)] transition-colors cursor-pointer"
                        onClick={() => setSelectedOrder(o)}
                      >
                        <td className="px-4 py-3 font-mono font-bold text-[var(--text-heading)]">
                          #{o.token || o.id}
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--text-muted)] whitespace-nowrap">
                          {fmtTime(o.created_at)}
                        </td>
                        <td className="px-4 py-3 font-bold text-[var(--text-heading)]">
                          {o.shop_name}
                        </td>
                        <td className="px-4 py-3 max-w-xs">
                          <OrderItemsCell items={o.items} />
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-[var(--text-body)]">{o.delivery_location || 'Campus'}</p>
                          {o.delivery_slot && (
                            <p className="text-[11px] text-[var(--text-muted)] font-mono">{o.delivery_slot}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--text-heading)]">
                          ₹{o.total}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={o.payment_method === 'COD' ? 'gold' : 'cyan'}
                            size="xs"
                          >
                            {o.payment_method || 'UPI'}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={sVariant} size="xs">
                            {o.status}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            variant="secondary"
                            size="xs"
                            onClick={(e) => {
                              e.stopPropagation()
                              setSelectedOrder(o)
                            }}
                            icon={<Eye className="w-3 h-3" />}
                          >
                            Details
                          </Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 3: PAYMENTS HISTORY
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'payments' && (
        <Card
          title="Payment & Transaction Records"
          subtitle={`Transactions verified for orders belonging to this account (${payments.length} total)`}
        >
          {/* Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 p-3 bg-[var(--bg-surface-subtle)] border border-[var(--border-main)]">
            <div className="relative flex-1 max-w-sm">
              <Search className="w-3.5 h-3.5 text-[var(--text-dim)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={paymentSearch}
                onChange={e => setPaymentSearch(e.target.value)}
                placeholder="Search payment ID, order ID, UTR number..."
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] pl-8 pr-3 py-1.5 text-xs text-[var(--text-heading)] placeholder:text-[var(--text-dim)] outline-none"
                style={{ borderRadius: 0 }}
              />
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-[var(--text-muted)]">Method:</span>
              <select
                value={paymentMethodFilter}
                onChange={e => setPaymentMethodFilter(e.target.value)}
                className="text-xs bg-[var(--bg-surface)] border border-[var(--border-main)] px-2.5 py-1.5 text-[var(--text-heading)]"
                style={{ borderRadius: 0 }}
              >
                <option value="all">All Methods</option>
                <option value="UPI">UPI Payment</option>
                <option value="COD">Cash on Delivery</option>
              </select>
            </div>
          </div>

          {filteredPayments.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-xs">
              <CreditCard className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No payment transactions matching criteria.
            </div>
          ) : (
            <div className="overflow-x-auto no-scrollbar">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-[var(--bg-surface-subtle)] border-b border-[var(--border-main)] uppercase font-bold text-[var(--text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Txn ID</th>
                    <th className="px-4 py-3">Linked Order</th>
                    <th className="px-4 py-3">Timestamp</th>
                    <th className="px-4 py-3 text-right">Amount</th>
                    <th className="px-4 py-3 text-center">Method</th>
                    <th className="px-4 py-3">UTR / Ref Number</th>
                    <th className="px-4 py-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border-subtle)]">
                  {filteredPayments.map((p: any) => {
                    const linked = orders.find((o: any) => o.id === p.order_id)
                    return (
                      <tr key={p.id} className="hover:bg-[var(--bg-surface-hover)]">
                        <td className="px-4 py-3 font-mono font-bold text-[var(--text-heading)]">
                          {p.id}
                        </td>
                        <td className="px-4 py-3 font-mono text-emerald-600 dark:text-emerald-400">
                          {linked ? (
                            <button
                              onClick={() => setSelectedOrder(linked)}
                              className="hover:underline flex items-center gap-1 font-bold"
                            >
                              #{linked.token || linked.id} ({linked.shop_name})
                            </button>
                          ) : (
                            p.order_id || '—'
                          )}
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--text-muted)] whitespace-nowrap">
                          {fmtTime(p.created_at)}
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-[var(--text-heading)]">
                          ₹{p.amount}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge variant={p.method === 'COD' ? 'gold' : 'cyan'} size="xs">
                            {p.method}
                          </Badge>
                        </td>
                        <td className="px-4 py-3 font-mono text-[var(--text-body)]">
                          {p.utr_number || '—'}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <Badge
                            variant={
                              p.status === 'Success'
                                ? 'success'
                                : p.status === 'Failed'
                                ? 'error'
                                : 'warning'
                            }
                            size="xs"
                          >
                            {p.status}
                          </Badge>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 4: ADDRESSES & LOCATIONS
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'addresses' && (
        <Card
          title="Saved & Historical Delivery Addresses"
          subtitle="All destination drop locations recorded across past order checkouts"
        >
          {addresses.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-xs">
              <MapPin className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No delivery addresses recorded for this user.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {addresses.map((a: any, i: number) => (
                <div
                  key={i}
                  className="p-4 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] space-y-2 shadow-xs"
                  style={{ borderRadius: 0 }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-mono text-xs font-black text-emerald-600 dark:text-emerald-400">
                      LOCATION #{i + 1}
                    </span>
                    <span className="font-mono text-xs font-bold text-[var(--text-heading)] bg-[var(--bg-surface)] px-2 py-0.5 border border-[var(--border-main)]">
                      {a.order_count} {a.order_count === 1 ? 'Checkout' : 'Checkouts'}
                    </span>
                  </div>

                  <p className="font-black text-sm text-[var(--text-heading)]">{a.location}</p>

                  {a.slot && (
                    <div className="text-xs text-[var(--text-muted)] font-mono">
                      Preferred Slot: <span className="text-[var(--text-heading)] font-semibold">{a.slot}</span>
                    </div>
                  )}

                  {a.last_used && (
                    <p className="text-[11px] text-[var(--text-dim)] pt-2 border-t border-[var(--border-subtle)]">
                      Last Order: {fmtDateOnly(a.last_used)} ({fmtRelativeTime(a.last_used)})
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 5: ACTIVITY TIMELINE
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'activity' && (
        <Card
          title="Audit & Activity Timeline"
          subtitle="Chronological sequence of all interactions, logins, and order events"
        >
          {activity.length === 0 ? (
            <div className="text-center py-12 text-[var(--text-muted)] text-xs">
              <Activity className="w-8 h-8 mx-auto mb-2 opacity-30" />
              No activity logs recorded.
            </div>
          ) : (
            <div className="relative pl-8 space-y-6 before:absolute before:left-3 before:top-3 before:bottom-3 before:w-0.5 before:bg-[var(--border-main)] max-w-3xl">
              {activity.map((ev: any, idx: number) => (
                <div key={ev.id || idx} className="relative text-xs">
                  {/* Square Pin on timeline */}
                  <div
                    className={`absolute -left-[30px] top-1 w-3 h-3 border-2 bg-[var(--bg-surface)] ${
                      ev.type === 'order'
                        ? 'border-emerald-600'
                        : ev.type === 'login'
                        ? 'border-blue-600'
                        : ev.type === 'registration'
                        ? 'border-purple-600'
                        : 'border-amber-600'
                    }`}
                    style={{ borderRadius: 0 }}
                  />

                  <div className="p-3.5 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] space-y-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-black text-sm text-[var(--text-heading)]">{ev.title}</p>
                      <span className="font-mono text-[11px] text-[var(--text-dim)]">
                        {fmtTime(ev.timestamp)}
                      </span>
                    </div>

                    <p className="text-[var(--text-muted)] leading-relaxed">{ev.description}</p>

                    {ev.status && (
                      <div className="pt-1.5">
                        <Badge variant="default" size="xs">
                          Status: {ev.status}
                        </Badge>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* ─────────────────────────────────────────────────────────────
          TAB 6: REVIEWS & FEEDBACK
      ────────────────────────────────────────────────────────────── */}
      {activeTab === 'feedback' && (
        <div className="space-y-6">
          {/* Reviews Card */}
          <Card
            title="Shop & Vendor Reviews"
            subtitle={`Ratings and feedback submitted for campus kitchens (${reviews.length} total)`}
          >
            {reviews.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)] text-xs">
                <Star className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No vendor reviews submitted by this customer.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {reviews.map((r: any) => (
                  <div key={r.id} className="py-3.5 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-[var(--text-heading)]">{r.shop_name}</span>
                        <div className="flex items-center text-amber-500">
                          {Array.from({ length: 5 }).map((_, i) => (
                            <Star
                              key={i}
                              className={`w-3.5 h-3.5 ${
                                i < r.rating ? 'fill-amber-400 text-amber-400' : 'text-gray-300 dark:text-gray-600'
                              }`}
                            />
                          ))}
                        </div>
                      </div>
                      <span className="text-[11px] font-mono text-[var(--text-dim)]">
                        {fmtTime(r.created_at)}
                      </span>
                    </div>
                    <p className="text-[var(--text-body)] italic bg-[var(--bg-surface-subtle)] p-2.5 border border-[var(--border-subtle)]">
                      "{r.comment}"
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* Feedback & Bug Reports Card */}
          <Card
            title="Platform Feedback & Bug Reports"
            subtitle={`System feedback and improvement ideas sent by this user (${feedback.length} total)`}
          >
            {feedback.length === 0 ? (
              <div className="text-center py-8 text-[var(--text-muted)] text-xs">
                <MessageSquare className="w-8 h-8 mx-auto mb-2 opacity-30" />
                No site feedback or bug reports submitted by this user.
              </div>
            ) : (
              <div className="divide-y divide-[var(--border-subtle)]">
                {feedback.map((f: any) => (
                  <div key={f.id} className="py-3.5 space-y-1.5 text-xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={String(f.category || '').toLowerCase() === 'bug' ? 'error' : 'info'}
                          size="xs"
                        >
                          {f.category || 'Feedback'}
                        </Badge>
                        <h4 className="font-bold text-[var(--text-heading)]">{f.subject}</h4>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge
                          variant={f.status === 'Fixed' ? 'success' : f.status === 'In Review' ? 'info' : 'warning'}
                          size="xs"
                        >
                          {f.status}
                        </Badge>
                        <span className="text-[11px] font-mono text-[var(--text-dim)]">
                          {fmtTime(f.created_at)}
                        </span>
                      </div>
                    </div>
                    <p className="text-[var(--text-body)] leading-relaxed">{f.message}</p>
                    {f.page && (
                      <p className="text-[10px] text-[var(--text-dim)] font-mono">
                        Reported from route: {f.page}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: ORDER DETAIL BREAKDOWN
      ────────────────────────────────────────────────────────────── */}
      {selectedOrder && (
        <Modal
          isOpen={Boolean(selectedOrder)}
          onClose={() => setSelectedOrder(null)}
          title={`Order #${selectedOrder.token || selectedOrder.id} Details`}
          size="lg"
          footer={
            <div className="flex items-center justify-between w-full">
              <span className="text-xs text-[var(--text-dim)] font-mono">
                Order ID: {selectedOrder.id}
              </span>
              <Button variant="secondary" size="sm" onClick={() => setSelectedOrder(null)}>
                Close
              </Button>
            </div>
          }
        >
          <div className="space-y-4 text-xs text-[var(--text-body)]">
            {/* Top metadata stats */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Order Total</p>
                <p className="text-lg font-black text-[var(--text-heading)] font-mono mt-0.5">
                  ₹{selectedOrder.total}
                </p>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Status</p>
                <div className="mt-1">
                  <Badge
                    variant={
                      String(selectedOrder.status || '').toLowerCase().includes('completed') ||
                      String(selectedOrder.status || '').toLowerCase().includes('delivered')
                        ? 'success'
                        : String(selectedOrder.status || '').toLowerCase().includes('cancelled')
                        ? 'error'
                        : 'warning'
                    }
                    size="xs"
                  >
                    {selectedOrder.status}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Payment Method</p>
                <div className="mt-1">
                  <Badge
                    variant={selectedOrder.payment_method === 'COD' ? 'gold' : 'cyan'}
                    size="xs"
                  >
                    {selectedOrder.payment_method === 'COD' ? 'Cash on Delivery' : 'UPI Payment'}
                  </Badge>
                </div>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
                style={{ borderRadius: 0 }}
              >
                <p className="text-[10px] uppercase font-bold text-[var(--text-dim)]">Platform Share</p>
                <p className="text-base font-black text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                  ₹10
                </p>
              </div>
            </div>

            {/* Shop & Location details */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface)] space-y-1.5"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase text-[11px]">
                  Restaurant / Kitchen
                </p>
                <p className="font-black text-sm text-[var(--text-heading)]">
                  {selectedOrder.shop_name}
                </p>
                <p className="text-xs text-[var(--text-dim)] font-mono">
                  Shop ID: {selectedOrder.shop_id}
                </p>
              </div>

              <div
                className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface)] space-y-1.5"
                style={{ borderRadius: 0 }}
              >
                <p className="font-bold text-[var(--text-heading)] uppercase text-[11px]">
                  Delivery Drop Point
                </p>
                <p className="font-bold text-xs text-[var(--text-heading)]">
                  {selectedOrder.delivery_location || 'Campus'}
                </p>
                {selectedOrder.delivery_slot && (
                  <p className="text-xs text-[var(--text-muted)] font-mono">
                    Slot: {selectedOrder.delivery_slot}
                  </p>
                )}
              </div>
            </div>

            {/* Items Breakdown */}
            <div
              className="p-3 border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] space-y-2"
              style={{ borderRadius: 0 }}
            >
              <p className="font-bold text-[var(--text-heading)] uppercase text-[11px]">
                Items Ordered
              </p>
              <p className="text-xs text-[var(--text-body)] font-medium leading-relaxed">
                {selectedOrder.items}
              </p>
            </div>

            {/* Pricing Summary */}
            <div className="border border-[var(--border-main)] bg-[var(--bg-surface)] p-3 divide-y divide-[var(--border-subtle)] font-mono text-xs">
              <div className="py-1.5 flex justify-between">
                <span className="text-[var(--text-muted)]">Subtotal</span>
                <span>₹{selectedOrder.subtotal || selectedOrder.total}</span>
              </div>
              <div className="py-1.5 flex justify-between">
                <span className="text-[var(--text-muted)]">Platform Fee (Admin)</span>
                <span className="text-emerald-600 font-bold">₹10</span>
              </div>
              {selectedOrder.delivery_fee > 0 && (
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-muted)]">Delivery Fee</span>
                  <span>₹{selectedOrder.delivery_fee}</span>
                </div>
              )}
              {selectedOrder.tax > 0 && (
                <div className="py-1.5 flex justify-between">
                  <span className="text-[var(--text-muted)]">Taxes</span>
                  <span>₹{selectedOrder.tax}</span>
                </div>
              )}
              <div className="py-2 flex justify-between text-sm font-black text-[var(--text-heading)]">
                <span>Final Total</span>
                <span>₹{selectedOrder.total}</span>
              </div>
            </div>

            {/* Timestamp */}
            <p className="text-[11px] text-[var(--text-dim)] font-mono text-right">
              Placed on: {fmtTime(selectedOrder.created_at)}
            </p>
          </div>
        </Modal>
      )}

      {/* ─────────────────────────────────────────────────────────────
          MODAL: EDIT USER PROFILE
      ────────────────────────────────────────────────────────────── */}
      {isEditOpen && (
        <Modal
          isOpen={isEditOpen}
          onClose={() => setIsEditOpen(false)}
          title={`Edit Account: @${user.username}`}
          size="md"
        >
          <form onSubmit={handleSaveEdit} className="space-y-4 text-xs">
            <div>
              <label className="block font-bold text-[var(--text-heading)] uppercase mb-1">
                Full Name
              </label>
              <input
                type="text"
                required
                value={editForm.name}
                onChange={e => setEditForm({ ...editForm, name: e.target.value })}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] px-3 py-2 text-xs text-[var(--text-heading)] outline-none"
                style={{ borderRadius: 0 }}
              />
            </div>

            <div>
              <label className="block font-bold text-[var(--text-heading)] uppercase mb-1">
                Email Address
              </label>
              <input
                type="email"
                value={editForm.email}
                onChange={e => setEditForm({ ...editForm, email: e.target.value })}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] px-3 py-2 text-xs text-[var(--text-heading)] outline-none"
                style={{ borderRadius: 0 }}
              />
            </div>

            <div>
              <label className="block font-bold text-[var(--text-heading)] uppercase mb-1">
                Phone Number
              </label>
              <input
                type="tel"
                value={editForm.phone}
                onChange={e => setEditForm({ ...editForm, phone: e.target.value })}
                className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] px-3 py-2 text-xs text-[var(--text-heading)] outline-none"
                style={{ borderRadius: 0 }}
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-bold text-[var(--text-heading)] uppercase mb-1">
                  Platform Role
                </label>
                <select
                  disabled={isSuperAdmin}
                  value={editForm.role}
                  onChange={e => setEditForm({ ...editForm, role: e.target.value })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] px-2.5 py-2 text-xs text-[var(--text-heading)]"
                  style={{ borderRadius: 0 }}
                >
                  <option value="student">Student</option>
                  <option value="shopkeeper">Shopkeeper</option>
                  <option value="admin">Administrator</option>
                </select>
              </div>

              <div>
                <label className="block font-bold text-[var(--text-heading)] uppercase mb-1">
                  Account Status
                </label>
                <select
                  disabled={isSuperAdmin}
                  value={editForm.status}
                  onChange={e => setEditForm({ ...editForm, status: e.target.value })}
                  className="w-full bg-[var(--bg-surface)] border border-[var(--border-main)] px-2.5 py-2 text-xs text-[var(--text-heading)]"
                  style={{ borderRadius: 0 }}
                >
                  <option value="active">Active</option>
                  <option value="blocked">Suspended / Blocked</option>
                </select>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-4 border-t border-[var(--border-main)]">
              <Button variant="ghost" size="sm" type="button" onClick={() => setIsEditOpen(false)}>
                Cancel
              </Button>
              <Button variant="primary" size="sm" type="submit" loading={savingEdit}>
                Save Changes
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* ─────────────────────────────────────────────────────────────
          CONFIRM DIALOGS: SUSPEND & DELETE
      ────────────────────────────────────────────────────────────── */}
      <ConfirmDialog
        isOpen={isSuspendConfirmOpen}
        onClose={() => setIsSuspendConfirmOpen(false)}
        onConfirm={handleToggleStatus}
        loading={processingStatus}
        title={isBlocked ? 'Reactivate Account?' : 'Suspend Account?'}
        message={
          isBlocked
            ? `Are you sure you want to reactivate the account for ${user.name}? The user will regain access to log in and place orders.`
            : `Are you sure you want to suspend @${user.username}? The user will immediately be blocked from logging into the portal.`
        }
        confirmText={isBlocked ? 'Yes, Activate Account' : 'Yes, Suspend Account'}
        variant={isBlocked ? 'primary' : 'danger'}
      />

      <ConfirmDialog
        isOpen={isDeleteConfirmOpen}
        onClose={() => setIsDeleteConfirmOpen(false)}
        onConfirm={handleDeleteUser}
        loading={deleting}
        title={`Permanently Delete @${user.username}?`}
        message={`This action cannot be undone. All active sessions, registrations, and references for ${user.name} will be permanently purged from the database.`}
        confirmText="Yes, Delete Permanently"
        variant="danger"
      />
    </div>
  )
}

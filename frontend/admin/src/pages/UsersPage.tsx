import React, { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Users,
  Trash2,
  Shield,
  UserCheck,
  RefreshCw,
  ShoppingBag,
  IndianRupee,
  ArrowRight,
  Filter,
  CheckCircle2,
  AlertTriangle,
  UserX,
  ExternalLink,
} from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime, fmtDateOnly, fmtRelativeTime, fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

export function UsersPage() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<any[]>([])
  const [roleFilter, setRoleFilter] = useState<'all' | 'student' | 'shopkeeper' | 'admin'>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'suspended'>('all')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [userToDelete, setUserToDelete] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadUsers = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/users')
      setUsers(r.data || [])
      setErr('')
    } catch (e: any) {
      setErr(apiError(e, 'Could not fetch user directory'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [])

  // Calculate top-level directory KPIs from actual data
  const metrics = useMemo(() => {
    const total = users.length
    const students = users.filter(u => String(u.role).toLowerCase() === 'student')
    const shopkeepers = users.filter(u => String(u.role).toLowerCase() === 'shopkeeper')
    const admins = users.filter(u => String(u.role).toLowerCase() === 'admin')
    const totalOrders = users.reduce((sum, u) => sum + (Number(u.orders_count) || 0), 0)
    const totalSpend = users.reduce((sum, u) => sum + (Number(u.total_spent) || 0), 0)

    return {
      total,
      studentsCount: students.length,
      shopkeepersCount: shopkeepers.length,
      adminsCount: admins.length,
      totalOrders,
      totalSpend,
    }
  }, [users])

  // Client-side filtering by role & status
  const filteredUsers = useMemo(() => {
    return users.filter(u => {
      const role = String(u.role || 'student').toLowerCase()
      const status = String(u.status || 'active').toLowerCase()

      if (roleFilter !== 'all' && role !== roleFilter) return false
      if (statusFilter !== 'all') {
        if (statusFilter === 'active' && status !== 'active') return false
        if (statusFilter === 'suspended' && status === 'active') return false
      }
      return true
    })
  }, [users, roleFilter, statusFilter])

  const handleDeleteUser = async () => {
    if (!userToDelete) return
    setDeleting(true)
    try {
      await api.delete(`/admin/users/${userToDelete.id}`)
      setMsg(`User "${userToDelete.username}" deleted successfully. Email and username are freed for registration.`)
      setErr('')
      setUsers(prev => prev.filter(x => x.id !== userToDelete.id))
      setUserToDelete(null)
    } catch (e: any) {
      setErr(apiError(e, 'Failed to delete user account'))
    } finally {
      setDeleting(false)
    }
  }

  const columns: Column<any>[] = [
    {
      key: 'user',
      header: 'Customer / User',
      sortable: true,
      sortValue: (u: any) => u.name || u.username,
      render: (u: any) => {
        const initials = (u.name || u.username || 'U')
          .split(' ')
          .map((n: string) => n[0])
          .slice(0, 2)
          .join('')
          .toUpperCase()
        const isActive = String(u.status || 'active').toLowerCase() === 'active'

        return (
          <div className="flex items-center gap-3">
            <div
              className={`w-9 h-9 shrink-0 flex items-center justify-center font-bold text-xs tracking-wider border relative ${
                isActive
                  ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
                  : 'bg-red-500/10 border-red-500/30 text-red-700 dark:text-red-300'
              }`}
              style={{ borderRadius: 0 }}
            >
              {initials}
              <span
                className={`absolute -top-0.5 -right-0.5 w-2.5 h-2.5 border-2 border-[var(--bg-surface)] ${
                  isActive ? 'bg-emerald-600' : 'bg-red-600'
                }`}
              />
            </div>
            <div className="min-w-0">
              <div className="font-bold text-sm text-[var(--text-heading)] group-hover:text-emerald-700 dark:group-hover:text-emerald-400 transition-colors flex items-center gap-1.5">
                <span>{u.name || 'Anonymous User'}</span>
              </div>
              <div className="text-xs font-mono text-[var(--text-muted)]">@{u.username}</div>
            </div>
          </div>
        )
      },
    },
    {
      key: 'contact',
      header: 'Contact Info',
      render: (u: any) => (
        <div className="space-y-0.5 text-xs font-mono">
          <div className="text-[var(--text-body)] truncate max-w-[200px]" title={u.email}>
            {u.email || '—'}
          </div>
          <div className="text-[var(--text-muted)]">{u.phone || 'No phone'}</div>
        </div>
      ),
    },
    {
      key: 'role_status',
      header: 'Role & Status',
      align: 'center',
      render: (u: any) => {
        const r = String(u.role || 'student').toLowerCase()
        const roleVariant = r === 'admin' ? 'purple' : r === 'student' ? 'success' : 'info'
        const isActive = String(u.status || 'active').toLowerCase() === 'active'

        return (
          <div className="flex flex-col items-center gap-1.5">
            <Badge variant={roleVariant} size="xs">
              {u.role || 'student'}
            </Badge>
            <Badge variant={isActive ? 'success' : 'danger'} size="xs">
              {isActive ? 'Active' : 'Suspended'}
            </Badge>
          </div>
        )
      },
    },
    {
      key: 'orders_spend',
      header: 'Orders & Spend',
      sortable: true,
      sortValue: (u: any) => Number(u.orders_count) || 0,
      render: (u: any) => {
        const count = Number(u.orders_count) || 0
        const spent = Number(u.total_spent) || 0
        return (
          <div className="text-xs">
            <div className="flex items-center gap-1.5">
              <Badge variant={count > 0 ? 'emerald' : 'neutral'} size="xs">
                {count} {count === 1 ? 'order' : 'orders'}
              </Badge>
            </div>
            <div className="font-bold text-[var(--text-heading)] mt-0.5 tabular-nums">
              {fmtCurrency(spent)}
            </div>
          </div>
        )
      },
    },
    {
      key: 'activity',
      header: 'Registration & Activity',
      sortable: true,
      sortValue: (u: any) => u.created_at || '',
      render: (u: any) => (
        <div className="text-xs space-y-0.5">
          <div className="text-[var(--text-body)] font-mono">{fmtDateOnly(u.created_at)}</div>
          <div className="text-[var(--text-muted)] text-[11px]">
            Login: {u.last_login ? fmtRelativeTime(u.last_login) : 'Never'}
          </div>
        </div>
      ),
    },
    {
      key: 'actions',
      header: 'Manage',
      align: 'right',
      render: (u: any) => (
        <div className="flex items-center justify-end gap-2" onClick={e => e.stopPropagation()}>
          <Button
            variant="secondary"
            size="xs"
            onClick={() => navigate(`/users/${u.id}`)}
            icon={<ArrowRight className="w-3.5 h-3.5" />}
          >
            360° Profile
          </Button>

          {u.role !== 'admin' && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => setUserToDelete(u)}
              title="Delete user account"
              className="text-red-600 hover:bg-red-500/10"
              icon={<Trash2 className="w-3.5 h-3.5" />}
            />
          )}
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6 text-[var(--text-body)]">
      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--border-main)] pb-4">
        <div>
          <div className="flex items-center gap-2.5">
            <h1 className="text-2xl font-black text-[var(--text-heading)] tracking-tight">
              User Management & Directory
            </h1>
            <Badge variant="emerald" size="md">
              {users.length} Users
            </Badge>
          </div>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            Complete 360° user overview, order history, payment records, address book, and security controls
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={loadUsers}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Directory
        </Button>
      </div>

      {/* KPI Stat Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <StatCard
          title="Total Users"
          value={metrics.total}
          subtitle="All registered accounts"
          icon={<Users className="w-5 h-5" />}
          variant="default"
        />
        <StatCard
          title="Student Customers"
          value={metrics.studentsCount}
          subtitle={`${metrics.total > 0 ? Math.round((metrics.studentsCount / metrics.total) * 100) : 0}% of platform base`}
          icon={<UserCheck className="w-5 h-5" />}
          variant="emerald"
        />
        <StatCard
          title="Kitchen Partners"
          value={metrics.shopkeepersCount}
          subtitle="Registered vendors"
          icon={<ShoppingBag className="w-5 h-5" />}
          variant="info"
        />
        <StatCard
          title="Administrators"
          value={metrics.adminsCount}
          subtitle="Super-admins & staff"
          icon={<Shield className="w-5 h-5" />}
          variant="gold"
        />
        <StatCard
          title="Platform Spend"
          value={fmtCurrency(metrics.totalSpend)}
          subtitle={`${metrics.totalOrders} total orders placed`}
          icon={<IndianRupee className="w-5 h-5" />}
          variant="default"
        />
      </div>

      {/* Feedback Messages */}
      {msg && (
        <div
          className="p-3.5 bg-emerald-500/10 border border-emerald-500/30 text-xs font-semibold text-emerald-800 dark:text-emerald-300 flex items-center gap-2"
          style={{ borderRadius: 0 }}
        >
          <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600" />
          <span>{msg}</span>
        </div>
      )}

      {err && (
        <div
          className="p-3.5 bg-red-500/10 border border-red-500/30 text-xs font-semibold text-red-800 dark:text-red-300 flex items-center gap-2"
          style={{ borderRadius: 0 }}
        >
          <AlertTriangle className="w-4 h-4 shrink-0 text-red-600" />
          <span>{err}</span>
        </div>
      )}

      {/* Interactive Data Table with Filters */}
      <DataTable
        columns={columns}
        data={filteredUsers}
        loading={loading}
        searchPlaceholder="Search name, @username, email, phone, role..."
        searchableKeys={['username', 'name', 'email', 'phone', 'role']}
        onRowClick={(u: any) => navigate(`/users/${u.id}`)}
        filterSlot={
          <div className="flex flex-wrap items-center gap-2">
            {/* Role Filter Tabs */}
            <div className="flex items-center border border-[var(--border-main)] bg-[var(--bg-surface)] p-0.5" style={{ borderRadius: 0 }}>
              {(
                [
                  { id: 'all', label: 'All Accounts', count: metrics.total },
                  { id: 'student', label: 'Students', count: metrics.studentsCount },
                  { id: 'shopkeeper', label: 'Kitchens', count: metrics.shopkeepersCount },
                  { id: 'admin', label: 'Admins', count: metrics.adminsCount },
                ] as const
              ).map(t => (
                <button
                  key={t.id}
                  onClick={() => setRoleFilter(t.id)}
                  className={`px-3 py-1.5 text-xs font-bold transition-all flex items-center gap-1.5 select-none ${
                    roleFilter === t.id
                      ? 'bg-emerald-700 dark:bg-emerald-600 text-white shadow-sm'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)]'
                  }`}
                  style={{ borderRadius: 0 }}
                >
                  <span>{t.label}</span>
                  <span
                    className={`text-[10px] px-1 py-0.2 font-mono ${
                      roleFilter === t.id
                        ? 'bg-white/20 text-white'
                        : 'bg-[var(--bg-surface-subtle)] text-[var(--text-muted)] border border-[var(--border-subtle)]'
                    }`}
                  >
                    {t.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Status Filter */}
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as any)}
              className="text-xs font-semibold px-3 py-1.5 border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-body)] outline-none focus:border-emerald-600"
              style={{ borderRadius: 0 }}
            >
              <option value="all">All Statuses</option>
              <option value="active">Active Only</option>
              <option value="suspended">Suspended Only</option>
            </select>
          </div>
        }
        emptyTitle="No users found"
        emptyDescription="There are no user accounts matching your criteria in this segment."
      />

      {/* Delete User Confirmation Dialog */}
      <ConfirmDialog
        open={Boolean(userToDelete)}
        onClose={() => setUserToDelete(null)}
        onConfirm={handleDeleteUser}
        loading={deleting}
        title="Delete User Account"
        description={
          <div>
            <p>
              Are you sure you want to permanently delete account{' '}
              <b>@{userToDelete?.username}</b> ({userToDelete?.name})?
            </p>
            <p className="mt-2 text-red-600 dark:text-red-400 font-semibold text-xs">
              Warning: This removes their active sessions and credentials, freeing their username and email for re-registration.
            </p>
          </div>
        }
        confirmText="Permanently Delete User"
        variant="danger"
      />
    </div>
  )
}

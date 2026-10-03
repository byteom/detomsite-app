import React, { useState, useEffect } from 'react'
import { Users, Trash2, Shield, UserCheck, Search, RefreshCw } from 'lucide-react'
import api from '../services/api'
import { apiError, fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { DataTable, Column } from '../components/ui/DataTable'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'

export function UsersPage() {
  const [users, setUsers] = useState<any[]>([])
  const [tab, setTab] = useState<'all' | 'students' | 'shopkeepers'>('all')
  const [loading, setLoading] = useState(true)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [userToDelete, setUserToDelete] = useState<any | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadUsers = async () => {
    setLoading(true)
    const endpoint =
      tab === 'all'
        ? '/admin/users'
        : tab === 'students'
        ? '/admin/users/students'
        : '/admin/users/shopkeepers'

    try {
      const r = await api.get(endpoint)
      setUsers(r.data || [])
    } catch (e: any) {
      setErr(apiError(e, 'Could not fetch user directory'))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadUsers()
  }, [tab])

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
      key: 'username',
      header: 'Username',
      sortable: true,
      render: (u: any) => (
        <span className="font-mono font-bold text-xs text-gray-900 dark:text-white">
          @{u.username}
        </span>
      ),
    },
    {
      key: 'name',
      header: 'Full Name',
      sortable: true,
      render: (u: any) => (
        <span className="font-semibold text-gray-800 dark:text-gray-200">{u.name || '—'}</span>
      ),
    },
    {
      key: 'email',
      header: 'Email Address',
      sortable: true,
      render: (u: any) => (
        <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{u.email || '—'}</span>
      ),
    },
    {
      key: 'phone',
      header: 'Phone Number',
      sortable: true,
      render: (u: any) => (
        <span className="text-gray-600 dark:text-gray-400 font-mono text-xs">{u.phone || '—'}</span>
      ),
    },
    {
      key: 'role',
      header: 'Platform Role',
      sortable: true,
      align: 'center',
      render: (u: any) => {
        const r = u.role
        const variant = r === 'admin' ? 'gold' : r === 'student' ? 'success' : 'info'
        return <Badge variant={variant} size="xs">{r}</Badge>
      },
    },
    {
      key: 'created_at',
      header: 'Registered',
      sortable: true,
      render: (u: any) => (
        <span className="text-gray-500 dark:text-gray-400 whitespace-nowrap">
          {fmtTime(u.created_at)}
        </span>
      ),
    },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      render: (u: any) => (
        <div>
          {u.role !== 'admin' ? (
            <Button
              variant="danger"
              size="xs"
              onClick={() => setUserToDelete(u)}
              title="Delete user account permanently"
              icon={<Trash2 className="w-3 h-3" />}
            >
              Delete
            </Button>
          ) : (
            <span className="text-gray-400 text-xs italic">Protected</span>
          )}
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
              Users & Account Directory
            </h1>
            <Badge variant="default" size="md">
              {users.length} Registered
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Manage student customers, restaurant owners, and administrator accounts
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

      {/* Data Table with Tab filter */}
      <DataTable
        columns={columns}
        data={users}
        loading={loading}
        searchPlaceholder="Search username, name, email, phone..."
        searchableKeys={['username', 'name', 'email', 'phone', 'role']}
        filterSlot={
          <div className="flex items-center gap-1.5">
            {(
              [
                { id: 'all', label: 'All Users' },
                { id: 'students', label: 'Students' },
                { id: 'shopkeepers', label: 'Shopkeepers' },
              ] as const
            ).map(t => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`px-3 py-1.5 text-xs font-bold transition-colors select-none ${
                  tab === t.id
                    ? 'bg-emerald-700 dark:bg-emerald-600 text-white'
                    : 'bg-gray-100 dark:bg-admin-surface-darkSubtle text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-800'
                }`}
                style={{ borderRadius: 0 }}
              >
                {t.label}
              </button>
            ))}
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
            <p className="mt-2 text-red-600 dark:text-red-400 font-semibold">
              Warning: This removes their active sessions, preferences, and profile data, freeing their
              username and email for re-registration.
            </p>
          </div>
        }
        confirmText="Permanently Delete User"
        variant="danger"
      />
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { AdminSidebar } from './AdminSidebar'
import { AdminHeader } from './AdminHeader'
import { ConfirmDialog } from '../ui/ConfirmDialog'
import { dedupeGet } from '../../services/api'
import { usePolling } from '../../hooks/usePolling'

interface AdminLayoutProps {
  children: React.ReactNode
}

export function AdminLayout({ children }: AdminLayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('detomsite-admin-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileOpen, setMobileOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [pendingApprovalsCount, setPendingApprovalsCount] = useState(0)

  const handleToggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('detomsite-admin-sidebar-collapsed', String(next))
      } catch {}
      return next
    })
  }

  // Poll for pending notifications to keep badge in sync
  const checkPending = () => {
    if (document.visibilityState !== 'visible') return
    dedupeGet('/admin/notifications')
      .then((r: any) => {
        const list = r.data || []
        const count = list.filter(
          (n: any) => n?.action === 'confirm_order' && n?.action_state === 'pending' && n?.order_id
        ).length
        setPendingApprovalsCount(count)
      })
      .catch(() => {})
  }
  usePolling(checkPending, 20000, [])

  const executeLogout = () => {
    localStorage.removeItem('admin_token')
    localStorage.removeItem('admin_user')
    window.location.href = '/login'
  }

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-body)] flex">
      {/* Desktop Sidebar */}
      <div className="hidden md:block shrink-0 sticky top-0 h-screen z-40">
        <AdminSidebar
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
          pendingApprovalsCount={pendingApprovalsCount}
        />
      </div>

      {/* Mobile Drawer */}
      {mobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileOpen(false)}
          />

          {/* Drawer content */}
          <div className="relative w-72 max-w-[80vw] h-full z-10">
            <AdminSidebar
              collapsed={false}
              onToggleCollapse={() => setMobileOpen(false)}
              pendingApprovalsCount={pendingApprovalsCount}
              onCloseMobile={() => setMobileOpen(false)}
            />
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-page)]">
        <AdminHeader
          onOpenMobileMenu={() => setMobileOpen(true)}
          onLogout={() => setShowLogoutConfirm(true)}
        />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl w-full mx-auto animate-fade-in text-[var(--text-body)]">
          {children}
        </main>
      </div>

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={executeLogout}
        title="Sign Out of Admin Portal"
        description="Are you sure you want to end your current admin session? You will need to log back in with your administrator credentials to access the platform."
        confirmText="Sign Out"
        cancelText="Stay Signed In"
        variant="danger"
      />
    </div>
  )
}

import React, { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  TrendingUp,
  MoreHorizontal,
  Layers,
  QrCode,
  Settings,
  Download,
  LogOut,
  X,
  CreditCard,
} from 'lucide-react'
import { ShopkeeperSidebar } from './ShopkeeperSidebar'
import { ShopkeeperHeader } from './ShopkeeperHeader'
import { ConfirmDialog } from '../ui/ConfirmDialog'

interface ShopkeeperLayoutProps {
  children: React.ReactNode
  shopName?: string
  pendingOrdersCount?: number
  shopPresent?: boolean
  onTogglePresent?: () => void
  onRefresh?: () => void
  refreshing?: boolean
}

export function ShopkeeperLayout({
  children,
  shopName,
  pendingOrdersCount = 0,
  shopPresent = true,
  onTogglePresent,
  onRefresh,
  refreshing = false,
}: ShopkeeperLayoutProps) {
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('detomsite-shopkeeper-sidebar-collapsed') === 'true'
    } catch {
      return false
    }
  })
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false)
  const [mobileMoreOpen, setMobileMoreOpen] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)
  const [showStatusConfirm, setShowStatusConfirm] = useState(false)
  const location = useLocation()
  const navigate = useNavigate()

  const handleToggleCollapse = () => {
    setCollapsed(prev => {
      const next = !prev
      try {
        localStorage.setItem('detomsite-shopkeeper-sidebar-collapsed', String(next))
      } catch {}
      return next
    })
  }

  const executeLogout = () => {
    localStorage.removeItem('vendor_token')
    localStorage.removeItem('vendor_user')
    navigate('/login')
  }

  const handleStatusToggleClick = () => {
    setShowStatusConfirm(true)
  }

  const confirmStatusToggle = () => {
    setShowStatusConfirm(false)
    if (onTogglePresent) onTogglePresent()
  }

  const currentPath = location.pathname

  const isTabActive = (path: string) => {
    if (path === '/mobile') {
      return currentPath === '/mobile' || currentPath === '/mobile/'
    }
    return currentPath === path || currentPath.startsWith(path + '/')
  }

  // 4 Primary Mobile Navigation tabs + 1 "More" button
  const PRIMARY_MOBILE_TABS = [
    { path: '/mobile', label: 'Home', icon: LayoutDashboard },
    {
      path: '/mobile/orders',
      label: 'Orders',
      icon: ShoppingBag,
      badge: pendingOrdersCount > 0 ? pendingOrdersCount : undefined,
    },
    { path: '/mobile/products', label: 'Menu', icon: Package },
    { path: '/mobile/history', label: 'Sales', icon: TrendingUp },
  ]

  const isMoreActive =
    currentPath.includes('/inventory') ||
    currentPath.includes('/scan') ||
    currentPath.includes('/settings')

  return (
    <div className="min-h-screen bg-[var(--bg-page)] text-[var(--text-body)] flex">
      {/* Desktop Sidebar (>= 768px) */}
      <div className="hidden md:block shrink-0 sticky top-0 h-screen z-40">
        <ShopkeeperSidebar
          collapsed={collapsed}
          onToggleCollapse={handleToggleCollapse}
          pendingOrdersCount={pendingOrdersCount}
          onLogout={() => setShowLogoutConfirm(true)}
          shopName={shopName}
        />
      </div>

      {/* Mobile Drawer (Left sidebar modal triggered by hamburger) */}
      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="relative w-72 max-w-[80vw] h-full z-10 shadow-2xl">
            <ShopkeeperSidebar
              collapsed={false}
              onToggleCollapse={() => setMobileDrawerOpen(false)}
              pendingOrdersCount={pendingOrdersCount}
              onCloseMobile={() => setMobileDrawerOpen(false)}
              onLogout={() => {
                setMobileDrawerOpen(false)
                setShowLogoutConfirm(true)
              }}
              shopName={shopName}
            />
          </div>
        </div>
      )}

      {/* Mobile "More" Bottom Sheet Sheet/Drawer */}
      {mobileMoreOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex flex-col justify-end">
          <div
            className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity"
            onClick={() => setMobileMoreOpen(false)}
          />
          <div
            className="relative w-full rounded-t-2xl border-t border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-body)] z-10 p-4 shadow-2xl animate-slide-up"
          >
            <div className="flex items-center justify-between pb-3 border-b border-[var(--border-main)]">
              <div>
                <h3 className="font-bold text-sm text-[var(--text-heading)]">Additional Actions</h3>
                <p className="text-[11px] text-[var(--text-muted)]">Operations & management tools</p>
              </div>
              <button
                type="button"
                onClick={() => setMobileMoreOpen(false)}
                className="p-1 rounded-lg text-[var(--text-dim)] hover:text-[var(--text-heading)]"
                aria-label="Close menu"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-2.5 py-4">
              <Link
                to="/mobile/inventory"
                onClick={() => setMobileMoreOpen(false)}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] hover:bg-[var(--bg-surface-hover)] text-xs font-bold text-[var(--text-heading)]"
              >
                <Layers className="w-5 h-5 text-emerald-600 shrink-0" />
                <span>Inventory</span>
              </Link>

              <Link
                to="/scan"
                onClick={() => setMobileMoreOpen(false)}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] hover:bg-[var(--bg-surface-hover)] text-xs font-bold text-[var(--text-heading)]"
              >
                <QrCode className="w-5 h-5 text-blue-600 shrink-0" />
                <span>Scan & Serve</span>
              </Link>

              <Link
                to="/mobile/settings"
                onClick={() => setMobileMoreOpen(false)}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] hover:bg-[var(--bg-surface-hover)] text-xs font-bold text-[var(--text-heading)]"
              >
                <Settings className="w-5 h-5 text-amber-600 shrink-0" />
                <span>Shop Settings</span>
              </Link>

              <Link
                to="/mobile/settings"
                onClick={() => setMobileMoreOpen(false)}
                className="flex items-center gap-3 p-3 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)] hover:bg-[var(--bg-surface-hover)] text-xs font-bold text-[var(--text-heading)]"
              >
                <CreditCard className="w-5 h-5 text-purple-600 shrink-0" />
                <span>Pay Admin Share</span>
              </Link>
            </div>

            <div className="pt-2 border-t border-[var(--border-main)] flex gap-2">
              <a
                href={`${window.location.origin}/Detomsite-Shopkeeper.apk`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center justify-center gap-2 py-2.5 px-3 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 rounded-lg transition-colors"
              >
                <Download className="w-4 h-4" />
                <span>Get App APK</span>
              </a>

              <button
                type="button"
                onClick={() => {
                  setMobileMoreOpen(false)
                  setShowLogoutConfirm(true)
                }}
                className="flex items-center justify-center gap-1.5 py-2.5 px-4 text-xs font-bold text-red-600 border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/30 hover:bg-red-100 rounded-lg"
              >
                <LogOut className="w-4 h-4" />
                <span>Sign Out</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main Column */}
      <div className="flex-1 flex flex-col min-w-0 bg-[var(--bg-page)]">
        <ShopkeeperHeader
          onOpenMobileMenu={() => setMobileDrawerOpen(true)}
          onLogout={() => setShowLogoutConfirm(true)}
          shopName={shopName}
          shopPresent={shopPresent}
          onTogglePresent={handleStatusToggleClick}
          onRefresh={onRefresh}
          refreshing={refreshing}
          pendingOrdersCount={pendingOrdersCount}
        />

        <main className="flex-1 p-3 sm:p-5 lg:p-7 max-w-7xl w-full mx-auto animate-fade-in text-[var(--text-body)] pb-24 md:pb-8">
          {children}
        </main>

        {/* Mobile bottom navigation bar (Fixed at bottom on phones < 768px) */}
        <nav
          className="md:hidden fixed bottom-0 inset-x-0 z-40 border-t border-[var(--border-main)] bg-[var(--bg-surface)]/98 backdrop-blur-md shadow-lg"
          style={{ paddingBottom: 'max(0.25rem, env(safe-area-inset-bottom, 0px))' }}
        >
          <div className="grid grid-cols-5 items-stretch h-14">
            {PRIMARY_MOBILE_TABS.map(tab => {
              const Icon = tab.icon
              const active = isTabActive(tab.path)
              return (
                <Link
                  key={tab.path}
                  to={tab.path}
                  className={`flex flex-col items-center justify-center gap-0.5 relative transition-colors select-none ${
                    active
                      ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-t-2 border-emerald-600'
                      : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] border-t-2 border-transparent'
                  }`}
                  style={{ minHeight: '44px' }}
                >
                  <div className="relative">
                    <Icon className="w-5 h-5" />
                    {tab.badge !== undefined && (
                      <span className="absolute -top-1.5 -right-2 px-1.5 py-0.2 text-[9px] font-black rounded-full bg-amber-500 text-gray-950">
                        {tab.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-bold tracking-tight">{tab.label}</span>
                </Link>
              )
            })}

            {/* "More" tab button */}
            <button
              type="button"
              onClick={() => setMobileMoreOpen(true)}
              className={`flex flex-col items-center justify-center gap-0.5 relative transition-colors select-none ${
                isMoreActive || mobileMoreOpen
                  ? 'text-emerald-700 dark:text-emerald-400 bg-emerald-500/10 border-t-2 border-emerald-600'
                  : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] border-t-2 border-transparent'
              }`}
              style={{ minHeight: '44px' }}
              aria-label="More navigation options"
            >
              <MoreHorizontal className="w-5 h-5" />
              <span className="text-[10px] font-bold tracking-tight">More</span>
            </button>
          </div>
        </nav>
      </div>

      {/* Shop Status Toggle Confirmation Dialog */}
      <ConfirmDialog
        open={showStatusConfirm}
        onClose={() => setShowStatusConfirm(false)}
        onConfirm={confirmStatusToggle}
        title={shopPresent ? 'Pause Incoming Orders?' : 'Start Accepting Orders?'}
        description={
          shopPresent
            ? 'Your shop will be shown as Closed on the campus portal. Existing orders will still need to be fulfilled, but students will not be able to place new orders.'
            : 'Your shop will immediately appear as Open on the campus portal, and students will be able to place new orders for delivery.'
        }
        confirmText={shopPresent ? 'Pause Orders' : 'Open Shop Now'}
        cancelText="Cancel"
        variant={shopPresent ? 'warning' : 'primary'}
      />

      {/* Logout Confirmation Dialog */}
      <ConfirmDialog
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={executeLogout}
        title="Sign Out of Shopkeeper Portal"
        description="Are you sure you want to end your current session? You will need to log back in with your username and password to process orders."
        confirmText="Sign Out"
        cancelText="Stay Signed In"
        variant="danger"
      />
    </div>
  )
}

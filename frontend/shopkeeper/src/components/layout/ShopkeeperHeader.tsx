import React from 'react'
import { Menu, Sun, Moon, LogOut, User, RefreshCw, Power } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { safeStorageJSON } from '../../utils/formatters'

interface ShopkeeperHeaderProps {
  onOpenMobileMenu: () => void
  onLogout: () => void
  shopName?: string
  shopPresent?: boolean
  onTogglePresent?: () => void
  onRefresh?: () => void
  refreshing?: boolean
  pendingOrdersCount?: number
}

function safeGetVendor(): Record<string, any> {
  return safeStorageJSON<Record<string, any>>('vendor_user', {})
}

export function ShopkeeperHeader({
  onOpenMobileMenu,
  onLogout,
  shopName,
  shopPresent = true,
  onTogglePresent,
  onRefresh,
  refreshing = false,
  pendingOrdersCount = 0,
}: ShopkeeperHeaderProps) {
  const { isDark, toggleTheme } = useTheme()
  const vendor = safeGetVendor()

  return (
    <header
      className="h-14 sticky top-0 z-30 flex items-center justify-between px-3 sm:px-4 border-b border-[var(--border-main)] bg-[var(--bg-surface)]/95 backdrop-blur-xs select-none"
    >
      {/* Left: Mobile hamburger & Shop Status */}
      <div className="flex items-center gap-2 sm:gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="p-1.5 md:hidden text-[var(--text-muted)] hover:text-[var(--text-heading)] rounded-lg border border-[var(--border-main)] shrink-0"
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 truncate">
          <span className="flex h-2.5 w-2.5 relative shrink-0">
            {shopPresent ? (
              <>
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
              </>
            ) : (
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-red-500" />
            )}
          </span>
          <span className="font-bold text-xs sm:text-sm text-[var(--text-heading)] truncate max-w-[140px] sm:max-w-[200px]">
            {shopName || 'Shop Desk'}
          </span>
          {pendingOrdersCount > 0 && (
            <span
              className="badge-solid-base badge-solid-warning px-2 py-0.5 text-[10px] font-black rounded-full shrink-0 hidden sm:inline-flex"
            >
              {pendingOrdersCount} NEW
            </span>
          )}
        </div>
      </div>

      {/* Right: Status toggle, Refresh, Theme, Profile, Logout */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        {/* Shop Live Status Toggle Button */}
        {onTogglePresent && (
          <button
            type="button"
            onClick={onTogglePresent}
            className={`flex items-center gap-1.5 px-2.5 sm:px-3 py-1 text-[11px] sm:text-xs font-bold rounded-lg transition-all border ${
              shopPresent
                ? 'bg-emerald-600/10 border-emerald-600 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-600/20'
                : 'bg-red-600/10 border-red-500 text-red-600 dark:text-red-400 hover:bg-red-600/20'
            }`}
            title={shopPresent ? 'Shop is OPEN. Click to pause orders.' : 'Shop is CLOSED. Click to start accepting orders.'}
          >
            <Power className="w-3.5 h-3.5 shrink-0" />
            <span className="hidden xs:inline">{shopPresent ? 'Open' : 'Closed'}</span>
          </button>
        )}

        {/* Manual Refresh / Sync Button */}
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className={`p-1.5 sm:p-2 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] rounded-lg border border-[var(--border-main)] transition-colors ${
              refreshing ? 'animate-spin text-emerald-600' : ''
            }`}
            title="Refresh orders and status"
            aria-label="Refresh orders"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        )}

        {/* Theme Toggle (Light / Dark Mode) */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-1.5 sm:p-2 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] rounded-lg border border-[var(--border-main)] transition-colors"
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
        </button>

        <div className="h-5 w-px bg-[var(--border-main)] hidden sm:block mx-0.5" />

        {/* Vendor Chip (Desktop) */}
        <div
          className="hidden md:flex items-center gap-2 px-2.5 py-1 text-xs rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
        >
          <div
            className="flex h-5 w-5 items-center justify-center rounded-md bg-emerald-700 text-white font-bold text-[10px]"
          >
            <User className="w-3 h-3" />
          </div>
          <span className="font-semibold text-[var(--text-heading)] max-w-[100px] truncate">
            {vendor.name || vendor.username || 'Shopkeeper'}
          </span>
        </div>

        {/* Logout Action */}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 text-xs font-semibold rounded-lg text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-transparent hover:border-red-200 dark:hover:border-red-900/40 transition-colors"
          title="Sign out of Shopkeeper Portal"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}

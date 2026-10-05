import React from 'react'
import { Menu, Sun, Moon, LogOut, User } from 'lucide-react'
import { useTheme } from '../../context/ThemeContext'
import { NotificationBell } from '../notifications/NotificationBell'
import { safeStorageJSON } from '../../utils/formatters'

interface AdminHeaderProps {
  onOpenMobileMenu: () => void
  onLogout: () => void
}

export function AdminHeader({ onOpenMobileMenu, onLogout }: AdminHeaderProps) {
  const { isDark, toggleTheme } = useTheme()
  const admin = safeStorageJSON<Record<string, any>>('admin_user', {})

  return (
    <header
      className="h-14 sticky top-0 z-30 flex items-center justify-between px-4 border-b border-[var(--border-main)] bg-[var(--bg-surface)]/95 backdrop-blur-xs select-none"
      style={{ borderRadius: 0 }}
    >
      {/* Left: Mobile hamburger & Status */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileMenu}
          className="p-1.5 md:hidden text-[var(--text-muted)] hover:text-[var(--text-heading)] border border-[var(--border-main)]"
          style={{ borderRadius: 0 }}
          aria-label="Open navigation menu"
        >
          <Menu className="w-5 h-5" />
        </button>

        <div className="hidden sm:flex items-center gap-2 text-xs">
          <span className="flex h-2 w-2 relative">
            <span className="animate-ping absolute inline-flex h-full w-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 bg-emerald-500" />
          </span>
          <span className="font-semibold text-[var(--text-heading)]">Operations Desk</span>
          <span className="text-[var(--text-dim)]">·</span>
          <span className="text-[var(--text-muted)] font-mono">v1.2.0</span>
        </div>
      </div>

      {/* Right: Actions, Theme, Notifications, Profile */}
      <div className="flex items-center gap-2">
        {/* Theme Toggle (Light / Dark Mode) */}
        <button
          type="button"
          onClick={toggleTheme}
          className="p-2 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] border border-[var(--border-main)] transition-colors"
          style={{ borderRadius: 0 }}
          title={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
          aria-label="Toggle theme"
        >
          {isDark ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4 text-slate-700" />}
        </button>

        {/* Live Notification Bell */}
        <NotificationBell />

        <div className="h-5 w-px bg-[var(--border-main)] mx-1" />

        {/* Admin User Chip */}
        <div
          className="flex items-center gap-2 px-2.5 py-1 text-xs border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]"
          style={{ borderRadius: 0 }}
        >
          <div
            className="flex h-5 w-5 items-center justify-center bg-emerald-700 text-white font-bold text-[10px]"
            style={{ borderRadius: 0 }}
          >
            <User className="w-3 h-3" />
          </div>
          <span className="font-semibold text-[var(--text-heading)] max-w-[100px] truncate">
            {admin.name || admin.username || 'Admin'}
          </span>
        </div>

        {/* Logout Action */}
        <button
          type="button"
          onClick={onLogout}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950/30 border border-transparent hover:border-red-200 dark:hover:border-red-900/40 transition-colors"
          style={{ borderRadius: 0 }}
          title="Sign out of Admin Portal"
        >
          <LogOut className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">Logout</span>
        </button>
      </div>
    </header>
  )
}

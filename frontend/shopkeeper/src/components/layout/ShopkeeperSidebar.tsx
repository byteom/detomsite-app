import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  Layers,
  QrCode,
  TrendingUp,
  Settings,
  Download,
  ChevronLeft,
  ChevronRight,
  Store,
  LogOut,
  User,
} from 'lucide-react'
import { safeStorageJSON } from '../../utils/formatters'

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string | number
  badgeVariant?: 'success' | 'gold' | 'warning' | 'default'
}

interface NavGroup {
  group: string
  items: NavItem[]
}

interface ShopkeeperSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  pendingOrdersCount?: number
  onCloseMobile?: () => void
  onLogout?: () => void
  shopName?: string
}

export function ShopkeeperSidebar({
  collapsed,
  onToggleCollapse,
  pendingOrdersCount = 0,
  onCloseMobile,
  onLogout,
  shopName,
}: ShopkeeperSidebarProps) {
  const location = useLocation()
  const currentPath = location.pathname
  const vendor = safeStorageJSON<Record<string, any>>('vendor_user', {})

  const navigationGroups: NavGroup[] = [
    {
      group: 'Overview',
      items: [
        { path: '/mobile', label: 'Dashboard', icon: LayoutDashboard },
        {
          path: '/scan',
          label: 'Scan & Serve',
          icon: QrCode,
        },
      ],
    },
    {
      group: 'Operations',
      items: [
        {
          path: '/mobile/orders',
          label: 'Orders Desk',
          icon: ShoppingBag,
          badge: pendingOrdersCount > 0 ? pendingOrdersCount : undefined,
          badgeVariant: 'warning',
        },
        { path: '/mobile/products', label: 'Products & Menu', icon: Package },
        { path: '/mobile/inventory', label: 'Inventory', icon: Layers },
      ],
    },
    {
      group: 'Business',
      items: [
        { path: '/mobile/history', label: 'Sales & Earnings', icon: TrendingUp },
        { path: '/mobile/settings', label: 'Shop Settings', icon: Settings },
      ],
    },
  ]

  const isActive = (path: string) => {
    if (path === '/mobile') {
      return currentPath === '/mobile' || currentPath === '/mobile/'
    }
    return currentPath === path || currentPath.startsWith(path + '/')
  }

  return (
    <aside
      className={`h-full flex flex-col justify-between border-r border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-body)] transition-all duration-200 select-none ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Brand Header */}
      <div>
        <div className="h-14 flex items-center justify-between px-3.5 border-b border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
          <Link
            to="/mobile"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5 overflow-hidden"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white font-black text-sm tracking-wider shadow-xs"
            >
              D
            </div>
            {!collapsed && (
              <div className="flex flex-col min-w-0">
                <span className="font-black text-xs uppercase tracking-widest text-[var(--text-heading)] flex items-center gap-1.5 truncate">
                  DETOMSITE <Store className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                </span>
                <span className="text-[10px] text-[var(--text-muted)] font-medium tracking-tight truncate">
                  {shopName || 'Shopkeeper Portal'}
                </span>
              </div>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden md:flex p-1.5 text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)] rounded-lg"
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation list */}
        <div className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-200px)]">
          {navigationGroups.map(group => (
            <div key={group.group}>
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--text-dim)]">
                  {group.group}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const Icon = item.icon
                  const active = isActive(item.path)

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onCloseMobile}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-3 px-3 py-2 text-xs font-semibold rounded-lg transition-colors duration-150 relative ${
                        active
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 font-bold'
                          : 'text-[var(--text-muted)] hover:text-[var(--text-heading)] hover:bg-[var(--bg-surface-hover)]'
                      }`}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-[var(--text-dim)]'}`} />

                      {!collapsed && (
                        <div className="flex items-center justify-between flex-1 truncate">
                          <span className="truncate">{item.label}</span>
                          {item.badge !== undefined && (
                            <span
                              className="px-2 py-0.5 text-[10px] font-black rounded-full bg-amber-500 text-gray-950 shrink-0"
                            >
                              {item.badge}
                            </span>
                          )}
                        </div>
                      )}
                    </Link>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer: User profile & APK Download */}
      <div className="border-t border-[var(--border-main)] bg-[var(--bg-surface-subtle)] p-2 space-y-1.5">
        <a
          href={`${window.location.origin}/Detomsite-Shopkeeper.apk`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2 px-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 rounded-lg transition-colors shadow-xs"
          title="Download the Android Shopkeeper APK"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && <span>Shopkeeper App</span>}
        </a>

        {!collapsed && (
          <div className="flex items-center justify-between p-2 rounded-lg border border-[var(--border-main)] bg-[var(--bg-surface)] text-xs">
            <div className="flex items-center gap-2 min-w-0">
              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-emerald-700 text-white text-[10px] font-bold">
                <User className="w-3.5 h-3.5" />
              </div>
              <div className="truncate">
                <p className="font-bold text-[var(--text-heading)] truncate text-[11px]">
                  {vendor.name || vendor.username || 'Shopkeeper'}
                </p>
                <p className="text-[10px] text-[var(--text-muted)] truncate">
                  {vendor.phone || 'Online'}
                </p>
              </div>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                className="p-1 rounded-md text-red-600 hover:bg-red-50 dark:hover:bg-red-950/30 transition-colors"
                title="Sign out"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  )
}

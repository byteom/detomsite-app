import React from 'react'
import { Link, useLocation } from 'react-router-dom'
import {
  LayoutDashboard,
  CheckSquare,
  ShoppingBag,
  MessageSquare,
  Smartphone,
  Store,
  Users,
  CreditCard,
  TrendingUp,
  MessageCircleQuestion,
  Star,
  Sliders,
  Download,
  ChevronLeft,
  ChevronRight,
  ShieldCheck,
} from 'lucide-react'

interface NavItem {
  path: string
  label: string
  icon: React.ComponentType<{ className?: string }>
  badge?: string | number
  badgeVariant?: 'success' | 'gold' | 'default'
}

interface NavGroup {
  group: string
  items: NavItem[]
}

interface AdminSidebarProps {
  collapsed: boolean
  onToggleCollapse: () => void
  pendingApprovalsCount?: number
  onCloseMobile?: () => void
}

export function AdminSidebar({
  collapsed,
  onToggleCollapse,
  pendingApprovalsCount = 0,
  onCloseMobile,
}: AdminSidebarProps) {
  const location = useLocation()
  const currentPath = location.pathname

  const navigationGroups: NavGroup[] = [
    {
      group: 'Overview',
      items: [
        { path: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
        {
          path: '/approvals',
          label: 'Order Approvals',
          icon: CheckSquare,
          badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
          badgeVariant: 'gold',
        },
      ],
    },
    {
      group: 'Operations',
      items: [
        { path: '/orders', label: 'Orders Desk', icon: ShoppingBag },
        { path: '/whatsapp', label: 'WhatsApp Center', icon: MessageSquare },
        { path: '/sms', label: 'SMS Pipeline', icon: Smartphone },
      ],
    },
    {
      group: 'Management',
      items: [
        { path: '/vendors', label: 'Vendors & Catalog', icon: Store },
        { path: '/users', label: 'Users Directory', icon: Users },
      ],
    },
    {
      group: 'Finance & Logs',
      items: [
        { path: '/payments', label: 'Payments & Shares', icon: CreditCard },
        { path: '/revenue', label: 'Revenue & Logs', icon: TrendingUp },
      ],
    },
    {
      group: 'Quality & Desk',
      items: [
        { path: '/feedback', label: 'Feedback & Bugs', icon: MessageCircleQuestion },
        { path: '/reviews', label: 'Student Reviews', icon: Star },
      ],
    },
    {
      group: 'Configuration',
      items: [{ path: '/settings', label: 'System Settings', icon: Sliders }],
    },
  ]

  return (
    <aside
      className={`h-full flex flex-col justify-between border-r border-gray-200 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark transition-all duration-200 select-none ${
        collapsed ? 'w-16' : 'w-64'
      }`}
      style={{ borderRadius: 0 }}
    >
      {/* Brand Header */}
      <div>
        <div className="h-14 flex items-center justify-between px-3.5 border-b border-gray-200 dark:border-admin-border-dark bg-gray-50/60 dark:bg-admin-surface-darkSubtle/30">
          <Link
            to="/dashboard"
            onClick={onCloseMobile}
            className="flex items-center gap-2.5 overflow-hidden"
          >
            <div
              className="flex h-8 w-8 shrink-0 items-center justify-center bg-emerald-700 dark:bg-emerald-600 text-white font-black text-sm tracking-wider"
              style={{ borderRadius: 0 }}
            >
              D
            </div>
            {!collapsed && (
              <div className="flex flex-col">
                <span className="font-black text-xs uppercase tracking-widest text-gray-900 dark:text-white flex items-center gap-1.5">
                  DETOMSITE <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                </span>
                <span className="text-[10px] text-gray-400 font-medium tracking-tight">
                  Admin Platform
                </span>
              </div>
            )}
          </Link>

          {/* Desktop collapse toggle */}
          <button
            type="button"
            onClick={onToggleCollapse}
            className="hidden md:flex p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-admin-surface-darkHover"
            style={{ borderRadius: 0 }}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronLeft className="w-4 h-4" />}
          </button>
        </div>

        {/* Navigation list */}
        <div className="p-2 space-y-4 overflow-y-auto max-h-[calc(100vh-140px)]">
          {navigationGroups.map(group => (
            <div key={group.group}>
              {!collapsed && (
                <p className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  {group.group}
                </p>
              )}
              <div className="space-y-0.5">
                {group.items.map(item => {
                  const Icon = item.icon
                  const active = currentPath === item.path

                  return (
                    <Link
                      key={item.path}
                      to={item.path}
                      onClick={onCloseMobile}
                      title={collapsed ? item.label : undefined}
                      className={`flex items-center gap-3 px-3 py-2 text-xs font-semibold transition-colors duration-150 relative ${
                        active
                          ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 border-l-2 border-emerald-600 dark:border-emerald-500'
                          : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 hover:bg-gray-50 dark:hover:bg-admin-surface-darkHover'
                      }`}
                      style={{ borderRadius: 0 }}
                    >
                      <Icon className={`w-4 h-4 shrink-0 ${active ? 'text-emerald-600 dark:text-emerald-400' : 'text-gray-400'}`} />

                      {!collapsed && (
                        <div className="flex items-center justify-between flex-1 truncate">
                          <span className="truncate">{item.label}</span>
                          {item.badge !== undefined && (
                            <span
                              className="px-1.5 py-0.2 text-[10px] font-black bg-amber-500 text-black shrink-0"
                              style={{ borderRadius: 0 }}
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

      {/* Footer app download */}
      <div className="p-2 border-t border-gray-200 dark:border-admin-border-dark bg-gray-50/50 dark:bg-admin-surface-darkSubtle/20">
        <a
          href={`${window.location.origin}/Detomsite-Admin.apk`}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-center gap-2 w-full py-2 px-2.5 text-xs font-bold text-white bg-emerald-700 hover:bg-emerald-600 dark:bg-emerald-600 dark:hover:bg-emerald-500 transition-colors shadow-xs"
          style={{ borderRadius: 0 }}
          title="Download the Android Admin APK"
        >
          <Download className="w-3.5 h-3.5 shrink-0" />
          {!collapsed && <span>Admin Android App</span>}
        </a>
      </div>
    </aside>
  )
}

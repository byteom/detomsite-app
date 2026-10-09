import React, { useState } from 'react'
import {
  Settings,
  CreditCard,
  Bell,
  Store,
  QrCode,
  LogOut,
  Smartphone,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
} from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { Shop, ShopStats } from '../types'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { ConfirmDialog } from '../components/ui/ConfirmDialog'
import { buildShopUpiUri } from '../utils/helpers'

interface SettingsPageProps {
  shop: Shop | null
  stats: ShopStats
  approvalStatus: string
  upiId: string
  setUpiId: (id: string) => void
  onSaveUpi: () => void
  upiEnabled: boolean
  codEnabled: boolean
  onTogglePayment: (key: 'upi_enabled' | 'cod_enabled', value: boolean) => Promise<void>
  pushState: string
  pushReason: string
  pushError: string
  onEnablePush: () => Promise<void>
  onDisablePush: () => Promise<void>
  onSendTestPush: () => Promise<void>
  sendingTest: boolean
  onOpenDuesPay: () => void
  onOpenAgentGuide: () => void
  onLogout: () => void
}

export function SettingsPage({
  shop,
  stats,
  approvalStatus,
  upiId,
  setUpiId,
  onSaveUpi,
  upiEnabled,
  codEnabled,
  onTogglePayment,
  pushState,
  pushReason,
  pushError,
  onEnablePush,
  onDisablePush,
  onSendTestPush,
  sendingTest,
  onOpenDuesPay,
  onOpenAgentGuide,
  onLogout,
}: SettingsPageProps) {
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const duesAmount = stats.platform_fee_due ?? 0
  const duesPaid = stats.share_paid_month ?? stats.share_paid_today
  const qrUri = upiId.trim() ? buildShopUpiUri(upiId.trim(), shop?.name || 'DETOMSITE Shop') : ''

  return (
    <div className="space-y-4 max-w-3xl">
      {/* ─── Header ─── */}
      <div className="border-b border-[var(--border-main)] pb-3">
        <h1 className="text-lg sm:text-xl font-black text-[var(--text-heading)] flex items-center gap-2">
          <Settings className="w-5 h-5 text-emerald-600" />
          Shop Settings & Configuration
        </h1>
        <p className="text-xs text-[var(--text-muted)]">
          Manage payment channels, UPI QR code, push alerts, and shop credentials
        </p>
      </div>

      {/* ─── 1. Admin Share & Dues Settlement ─── */}
      {approvalStatus === 'Approved' && (
        <Card
          className="border-l-4 border-l-amber-500"
          title={
            <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
              <CreditCard className="w-4 h-4 text-amber-600" />
              Platform Share (₹10 / order)
            </span>
          }
          action={
            <Button
              variant={duesPaid ? 'secondary' : 'gold'}
              size="sm"
              onClick={onOpenDuesPay}
              disabled={Boolean(duesPaid)}
            >
              {duesPaid ? 'Settled for Month ✓' : `Pay ₹${duesAmount} via UPI`}
            </Button>
          }
        >
          <div className="space-y-2 text-xs">
            <p className="text-[var(--text-muted)]">
              DETOMSITE charges a flat ₹10 fee per completed order. This fee is paid directly by the shopkeeper to the admin's UPI, never added to the student's bill.
            </p>
            <div className="flex items-center justify-between p-2.5 border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] font-medium">
              <span>This month's share due:</span>
              <span className="font-black text-base text-[var(--text-heading)] tabular-nums">
                ₹{duesAmount}
              </span>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">
              {duesPaid
                ? 'Your share has been paid and confirmed by the administrator.'
                : 'Click "Pay via UPI" to open the Admin UPI QR or pay directly.'}
            </p>
          </div>
        </Card>
      )}

      {/* ─── 2. Payment Methods Control ─── */}
      <Card
        title={
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
            <CreditCard className="w-4 h-4 text-emerald-600" />
            Accepted Payment Methods
          </span>
        }
        subtitle="Choose which payment options students see when placing orders"
      >
        <div className="space-y-3">
          {/* UPI Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
            <div>
              <p className="font-bold text-xs text-[var(--text-heading)]">UPI / QR Payments</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Students pay into your bank via GPay, PhonePe, or Paytm
                {!upiId.trim() && ' (Set your UPI ID below first)'}
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={upiEnabled}
              onClick={() => onTogglePayment('upi_enabled', !upiEnabled)}
              className={`relative h-6 w-11 rounded-full transition-colors border ${
                upiEnabled
                  ? 'bg-emerald-600 border-emerald-700'
                  : 'bg-slate-300 dark:bg-slate-700 border-slate-400'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform ${
                  upiEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>

          {/* Cash on Delivery Toggle */}
          <div className="flex items-center justify-between p-3.5 rounded-xl border border-[var(--border-main)] bg-[var(--bg-surface-subtle)]">
            <div>
              <p className="font-bold text-xs text-[var(--text-heading)]">Cash on Delivery (COD)</p>
              <p className="text-[11px] text-[var(--text-muted)] mt-0.5">
                Students hand cash upon food handover or delivery
              </p>
            </div>

            <button
              type="button"
              role="switch"
              aria-checked={codEnabled}
              onClick={() => onTogglePayment('cod_enabled', !codEnabled)}
              className={`relative h-6 w-11 rounded-full transition-colors border ${
                codEnabled
                  ? 'bg-emerald-600 border-emerald-700'
                  : 'bg-slate-300 dark:bg-slate-700 border-slate-400'
              }`}
            >
              <span
                className={`absolute top-0.5 h-4.5 w-4.5 rounded-full bg-white shadow-xs transition-transform ${
                  codEnabled ? 'translate-x-5' : 'translate-x-0.5'
                }`}
              />
            </button>
          </div>
        </div>
      </Card>

      {/* ─── 3. Shopkeeper UPI ID & Student QR Preview ─── */}
      <Card
        title={
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
            <QrCode className="w-4 h-4 text-emerald-600" />
            Your Shop UPI ID & QR Code
          </span>
        }
        subtitle="Where student UPI payments arrive"
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex-1">
              <Input
                label="Shop UPI ID"
                value={upiId}
                onChange={(e) => setUpiId(e.target.value)}
                placeholder="e.g. yourshopname@okhdfcbank"
              />
            </div>
            <div className="sm:self-end">
              <Button variant="primary" size="md" onClick={onSaveUpi} className="w-full sm:w-auto">
                Save UPI ID
              </Button>
            </div>
          </div>

          {qrUri && (
            <div className="p-4 rounded-xl border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)] flex flex-col sm:flex-row items-center gap-4 text-center sm:text-left">
              <div className="p-3 bg-white border border-[var(--border-main)] rounded-lg shrink-0">
                <QRCodeSVG value={qrUri} size={110} level="M" />
              </div>
              <div className="text-xs space-y-1">
                <p className="font-bold text-[var(--text-heading)]">Student Checkout QR Preview</p>
                <p className="text-[var(--text-muted)]">
                  When UPI payments are active, students scanning this QR pay directly into your account:
                </p>
                <p className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
                  {upiId}
                </p>
              </div>
            </div>
          )}
        </div>
      </Card>

      {/* ─── 4. Order Push Notifications ─── */}
      <Card
        title={
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
            <Bell className="w-4 h-4 text-emerald-600" />
            Live Order Notifications
          </span>
        }
        subtitle="Get instant alerts on your phone the second a student orders"
        action={
          <Badge
            variant={
              pushState === 'subscribed'
                ? 'success'
                : pushState === 'denied'
                ? 'error'
                : pushState === 'disabled'
                ? 'neutral'
                : 'warning'
            }
            size="xs"
            dot
          >
            {pushState === 'subscribed'
              ? 'ALERTS ACTIVE'
              : pushState === 'denied'
              ? 'BLOCKED'
              : 'OFF'}
          </Badge>
        }
      >
        <div className="space-y-3 text-xs">
          <p className="text-[var(--text-muted)]">
            {pushState === 'subscribed'
              ? "Push alerts are enabled! You'll receive high-priority sound alerts on new orders even if the browser tab is closed."
              : pushState === 'denied'
              ? 'Notifications are blocked in your browser settings. Please allow notifications in site permissions and tap Enable.'
              : pushReason ||
                pushError ||
                'Enable phone alerts so you never miss a new kitchen order.'}
          </p>

          <div className="flex flex-wrap gap-2 pt-1">
            {pushState === 'subscribed' ? (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={onSendTestPush}
                  loading={sendingTest}
                >
                  Send Test Alert
                </Button>
                <Button variant="danger" size="sm" onClick={onDisablePush}>
                  Disable Alerts
                </Button>
              </>
            ) : (
              <Button variant="primary" size="sm" onClick={onEnablePush}>
                Enable Order Alerts
              </Button>
            )}
          </div>
        </div>
      </Card>

      {/* ─── 5. SMS Payment Agent (disabled — manual verification only) ─── */}
      <Card
        title={
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
            <Smartphone className="w-4 h-4 text-emerald-600" />
            SMS Payment Agent (Disabled)
          </span>
        }
        subtitle="Automatic bank confirmation is turned off — payments are verified manually by an admin"
      >
        <div className="space-y-2 text-xs text-[var(--text-muted)]">
          <p>
            Automatic order confirmation via bank SMS is disabled. Student UPI
            payments are verified by an admin from the submitted UTR +
            screenshot — no agent app is required on the shop phone.
          </p>
          <div className="pt-2">
            <Button
              variant="secondary"
              size="sm"
              icon={<ExternalLink className="w-3.5 h-3.5" />}
              onClick={onOpenAgentGuide}
            >
              View SMS Agent Guide & Setup
            </Button>
          </div>
        </div>
      </Card>

      {/* ─── 6. Shop Information & Account ─── */}
      <Card
        title={
          <span className="flex items-center gap-2 text-sm font-bold text-[var(--text-heading)]">
            <Store className="w-4 h-4 text-emerald-600" />
            Shop Information & Session
          </span>
        }
      >
        <div className="space-y-3 text-xs">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)]">
              <span className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] font-bold block">
                Shop Name
              </span>
              <span className="font-bold text-[var(--text-heading)] text-xs block mt-0.5">
                {shop?.name || '—'}
              </span>
            </div>

            <div className="p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)]">
              <span className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] font-bold block">
                Category
              </span>
              <span className="font-bold text-[var(--text-heading)] text-xs block mt-0.5">
                {shop?.category || 'Food'}
              </span>
            </div>

            <div className="p-2 border border-[var(--border-subtle)] bg-[var(--bg-surface-subtle)]">
              <span className="text-[var(--text-dim)] uppercase tracking-wider text-[10px] font-bold block">
                Approval Status
              </span>
              <span className="font-bold text-xs block mt-0.5">
                <Badge
                  variant={approvalStatus === 'Approved' ? 'success' : 'warning'}
                  size="xs"
                >
                  {approvalStatus}
                </Badge>
              </span>
            </div>
          </div>

          <div className="pt-3 border-t border-[var(--border-subtle)] flex items-center justify-between">
            <div>
              <p className="font-bold text-[var(--text-heading)]">End Current Session</p>
              <p className="text-[11px] text-[var(--text-muted)]">
                You will need your shopkeeper password to sign back in
              </p>
            </div>
            <Button
              variant="danger"
              size="sm"
              icon={<LogOut className="w-3.5 h-3.5" />}
              onClick={() => setShowLogoutConfirm(true)}
            >
              Sign Out
            </Button>
          </div>
        </div>
      </Card>

      {/* Confirmation Dialog */}
      <ConfirmDialog
        open={showLogoutConfirm}
        onClose={() => setShowLogoutConfirm(false)}
        onConfirm={() => {
          setShowLogoutConfirm(false)
          onLogout()
        }}
        title="Sign Out of Shopkeeper Portal"
        description="Are you sure you want to log out? Incoming order notifications will be paused until you sign back in."
        confirmText="Sign Out"
        cancelText="Stay Signed In"
        variant="danger"
      />
    </div>
  )
}

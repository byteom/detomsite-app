import React, { useState, useEffect, FormEvent } from 'react'
import { Sliders, CreditCard, BellRing, Save, CheckCircle2, AlertCircle } from 'lucide-react'
import api from '../services/api'
import { apiError } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Input } from '../components/ui/Input'
import { Card } from '../components/ui/Card'
import { Badge } from '../components/ui/Badge'

export function SettingsPage() {
  // UPI ID Configuration
  const [upiId, setUpiId] = useState('')
  const [upiLoading, setUpiLoading] = useState(true)
  const [upiSaving, setUpiSaving] = useState(false)
  const [upiMsg, setUpiMsg] = useState('')
  const [upiErr, setUpiErr] = useState('')

  // Student Info Banner Configuration
  const [noticeText, setNoticeText] = useState('')
  const [noticeOn, setNoticeOn] = useState(false)
  const [noticeSaving, setNoticeSaving] = useState(false)
  const [noticeMsg, setNoticeMsg] = useState('')
  const [noticeErr, setNoticeErr] = useState('')

  useEffect(() => {
    Promise.all([
      api.get('/local/payment-settings').catch(() => ({ data: { upi_id: '' } })),
      api.get('/local/student-notice').catch(() => ({ data: { text: '', enabled: false } })),
    ])
      .then(([payRes, noticeRes]) => {
        setUpiId(payRes.data?.upi_id || '')
        setNoticeText(noticeRes.data?.text || '')
        setNoticeOn(Boolean(noticeRes.data?.enabled))
      })
      .finally(() => setUpiLoading(false))
  }, [])

  const handleSaveUpi = async (e: FormEvent) => {
    e.preventDefault()
    setUpiMsg('')
    setUpiErr('')
    const val = upiId.trim()
    if (!val) {
      setUpiErr('Please specify a valid UPI ID (e.g. name@bank)')
      return
    }
    setUpiSaving(true)
    try {
      await api.patch('/local/payment-settings', { upi_id: val, manual_enabled: true })
      setUpiMsg('Admin UPI ID saved & verified. Vendors will be directed here for ₹10 share settlements.')
    } catch (err: any) {
      setUpiErr(apiError(err, 'Failed to save payment settings'))
    } finally {
      setUpiSaving(false)
    }
  }

  const handleSaveNotice = async (e: FormEvent) => {
    e.preventDefault()
    setNoticeMsg('')
    setNoticeErr('')
    const val = noticeText.trim()
    if (noticeOn && !val) {
      setNoticeErr('Please enter the announcement message or toggle the banner off.')
      return
    }
    setNoticeSaving(true)
    try {
      const r = await api.patch('/local/student-notice', { enabled: noticeOn, text: val })
      setNoticeText(r.data?.text || val)
      setNoticeOn(Boolean(r.data?.enabled))
      setNoticeMsg(
        r.data?.enabled
          ? 'Campus Notice Banner is now LIVE across the Student Portal.'
          : 'Campus Notice Banner has been hidden from students.'
      )
    } catch (err: any) {
      setNoticeErr(apiError(err, 'Failed to update campus announcement'))
    } finally {
      setNoticeSaving(false)
    }
  }

  return (
    <div className="space-y-6 max-w-4xl">
      {/* Header */}
      <div className="border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
          System Configuration & Broadcasts
        </h1>
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
          Configure financial settlement accounts and campus-wide real-time student announcements
        </p>
      </div>

      {/* Admin UPI ID Settings Card */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Admin Settlement Account (₹10/order share)
          </span>
        }
        subtitle="The UPI VPA account where campus shopkeepers remit their monthly platform commission"
      >
        {upiMsg && (
          <div
            className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
            style={{ borderRadius: 0 }}
          >
            {upiMsg}
          </div>
        )}

        {upiErr && (
          <div
            className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
            style={{ borderRadius: 0 }}
          >
            {upiErr}
          </div>
        )}

        <form onSubmit={handleSaveUpi} className="space-y-4">
          <Input
            label="Admin UPI VPA ID"
            value={upiId}
            onChange={e => setUpiId(e.target.value)}
            placeholder="e.g. detomsite.admin@okhdfcbank"
            helperText="When a vendor taps 'Pay ₹10 Share' in their portal, their UPI application will target this VPA."
            required
          />

          <div className="flex items-center justify-between pt-2">
            <p className="text-xs text-gray-500 max-w-md">
              Note: Customer payments go directly to individual shopkeeper UPI VPAs. This account is
              exclusively for collecting platform commission.
            </p>

            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={upiSaving}
              icon={<Save className="w-3.5 h-3.5" />}
            >
              Save Payment Settings
            </Button>
          </div>
        </form>
      </Card>

      {/* Campus Notice Broadcast Banner */}
      <Card
        title={
          <span className="flex items-center gap-2">
            <BellRing className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
            Campus Broadcast Banner (Student Portal)
          </span>
        }
        subtitle="Display an urgent broadcast message across the top of every student's application screen"
      >
        {noticeMsg && (
          <div
            className="mb-4 p-3 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-300 dark:border-emerald-800 text-xs font-semibold text-emerald-800 dark:text-emerald-300"
            style={{ borderRadius: 0 }}
          >
            {noticeMsg}
          </div>
        )}

        {noticeErr && (
          <div
            className="mb-4 p-3 bg-red-50 dark:bg-red-950/40 border border-red-300 dark:border-red-800 text-xs font-semibold text-red-800 dark:text-red-300"
            style={{ borderRadius: 0 }}
          >
            {noticeErr}
          </div>
        )}

        <form onSubmit={handleSaveNotice} className="space-y-4">
          <label className="flex items-center gap-2.5 cursor-pointer">
            <input
              type="checkbox"
              checked={noticeOn}
              onChange={e => setNoticeOn(e.target.checked)}
              className="h-4 w-4 accent-emerald-600"
              style={{ borderRadius: 0 }}
            />
            <span className="text-xs font-bold text-gray-900 dark:text-white">
              Enable and display this announcement on the Student Portal
            </span>
          </label>

          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-gray-700 dark:text-gray-300 mb-1.5">
              Announcement Message
            </label>
            <textarea
              rows={3}
              maxLength={500}
              value={noticeText}
              onChange={e => setNoticeText(e.target.value)}
              placeholder="e.g. Campus Cafeteria closes early at 8:30 PM today for maintenance. Please place night orders before 8:00 PM."
              className="w-full bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark p-3 text-xs text-gray-900 dark:text-white outline-none focus:border-emerald-600"
              style={{ borderRadius: 0 }}
            />
            <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
              <span>Supports formatting and line breaks</span>
              <span>{noticeText.length}/500 characters</span>
            </div>
          </div>

          {/* Real-time Student Preview */}
          {noticeOn && noticeText.trim() && (
            <div className="pt-2">
              <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1.5">
                Live Student Portal Preview:
              </p>
              <div
                className="p-3 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-700 text-xs font-semibold text-emerald-800 dark:text-emerald-200 whitespace-pre-line leading-relaxed"
                style={{ borderRadius: 0 }}
              >
                📢 {noticeText.trim()}
              </div>
            </div>
          )}

          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={noticeSaving}
              icon={<Save className="w-3.5 h-3.5" />}
            >
              {noticeOn ? 'Save & Publish Banner' : 'Save (Banner Inactive)'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  )
}

import React, { useState, useEffect } from 'react'
import { TrendingUp, DollarSign, Calendar, RefreshCw, X, Download } from 'lucide-react'
import api from '../services/api'
import { fmtCurrency } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'

export function RevenuePage() {
  const [daily, setDaily] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [filterDate, setFilterDate] = useState('')

  const loadData = (date?: string) => {
    setLoading(true)
    const url = date ? `/admin/orders/date?date=${date}` : '/admin/orders/daily'
    api
      .get(url)
      .then(r => {
        if (!date) {
          setDaily(r.data || [])
          return
        }
        const list: any[] = r.data || []
        const revenue = list.reduce((s, o) => s + (o.total || 0), 0)
        setDaily([
          {
            created_at: date,
            count: list.length,
            revenue,
            service_fee: list.length * 10,
          },
        ])
      })
      .catch(() => setDaily([]))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    loadData()
  }, [])

  const totalRevenue = daily.reduce((s: number, d: any) => s + (d.revenue || 0), 0)
  const totalServiceFee = daily.reduce((s: number, d: any) => s + (d.service_fee || 0), 0)
  const totalVendorShare = Math.max(0, totalRevenue - totalServiceFee)
  const totalOrdersCount = daily.reduce((s: number, d: any) => s + (d.count || 0), 0)

  const columns: Column<any>[] = [
    {
      key: 'created_at',
      header: 'Reporting Date',
      sortable: true,
      render: (d: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">{d.created_at}</span>
      ),
    },
    {
      key: 'count',
      header: 'Orders Processed',
      sortable: true,
      align: 'center',
      render: (d: any) => (
        <span className="font-mono text-gray-800 dark:text-gray-200">{d.count} orders</span>
      ),
    },
    {
      key: 'revenue',
      header: 'Gross Volume',
      sortable: true,
      align: 'right',
      render: (d: any) => (
        <span className="font-mono font-bold text-gray-900 dark:text-white">
          ₹{(d.revenue || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      key: 'service_fee',
      header: 'Admin ₹10 Share',
      sortable: true,
      align: 'right',
      render: (d: any) => (
        <span className="font-mono font-black text-amber-600 dark:text-amber-400">
          ₹{(d.service_fee || 0).toLocaleString('en-IN')}
        </span>
      ),
    },
    {
      key: 'vendor_share',
      header: 'Vendors Net Payout',
      sortable: true,
      align: 'right',
      render: (d: any) => (
        <span className="font-mono font-bold text-emerald-700 dark:text-emerald-400">
          ₹{Math.max(0, (d.revenue || 0) - (d.service_fee || 0)).toLocaleString('en-IN')}
        </span>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-gray-200 dark:border-admin-border-dark pb-4">
        <div>
          <h1 className="text-2xl font-black text-gray-900 dark:text-white tracking-tight">
            Revenue Analytics & Daily Logs
          </h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Historical transaction turnover, platform fee collections, and vendor payout ledgers
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => loadData(filterDate || undefined)}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Logs
        </Button>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatCard
          title="Total Gross Revenue"
          value={fmtCurrency(totalRevenue)}
          subtitle={`Across ${totalOrdersCount} processed transactions`}
          icon={<TrendingUp className="w-5 h-5" />}
          variant="default"
        />

        <StatCard
          title="Admin's ₹10 Share"
          value={fmtCurrency(totalServiceFee)}
          subtitle="Fixed platform maintenance fee"
          icon={<DollarSign className="w-5 h-5" />}
          variant="gold"
        />

        <StatCard
          title="Net Vendor Share"
          value={fmtCurrency(totalVendorShare)}
          subtitle="Disbursed directly to campus shops"
          icon={<TrendingUp className="w-5 h-5" />}
          variant="emerald"
        />
      </div>

      {/* Table with Date Picker */}
      <DataTable
        columns={columns}
        data={daily}
        loading={loading}
        searchPlaceholder="Search log date..."
        searchableKeys={['created_at']}
        filterSlot={
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5 bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark px-2 py-1">
              <Calendar className="w-3.5 h-3.5 text-gray-400" />
              <input
                type="date"
                value={filterDate}
                onChange={e => {
                  setFilterDate(e.target.value)
                  loadData(e.target.value || undefined)
                }}
                className="bg-transparent text-xs text-gray-800 dark:text-gray-200 outline-none"
              />
            </div>

            {filterDate && (
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  setFilterDate('')
                  loadData()
                }}
                icon={<X className="w-3 h-3" />}
              >
                Clear Date
              </Button>
            )}
          </div>
        }
        emptyTitle="No revenue data found"
        emptyDescription="There are no settled order transactions recorded for the selected timeframe."
      />
    </div>
  )
}

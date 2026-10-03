import React, { useState, useEffect } from 'react'
import { Star, Store, Users, RefreshCw } from 'lucide-react'
import api from '../services/api'
import { fmtTime } from '../utils/formatters'
import { Button } from '../components/ui/Button'
import { Badge } from '../components/ui/Badge'
import { StatCard } from '../components/ui/StatCard'
import { DataTable, Column } from '../components/ui/DataTable'

export function ReviewsPage() {
  const [reviews, setReviews] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const loadReviews = async () => {
    setLoading(true)
    try {
      const r = await api.get('/admin/reviews')
      setReviews(r.data || [])
    } catch {}
    finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadReviews()
  }, [])

  const avgRating =
    reviews.length > 0
      ? (reviews.reduce((s: number, r: any) => s + (r.rating || 0), 0) / reviews.length).toFixed(1)
      : '0.0'

  const uniqueShops = new Set(reviews.map((r: any) => r.shop_id)).size

  const columns: Column<any>[] = [
    {
      key: 'student_name',
      header: 'Student Reviewer',
      sortable: true,
      render: (r: any) => (
        <span className="font-semibold text-gray-900 dark:text-white">
          {r.student_name || r.username || 'Anonymous'}
        </span>
      ),
    },
    {
      key: 'shop_name',
      header: 'Restaurant',
      sortable: true,
      render: (r: any) => (
        <span className="font-medium text-emerald-700 dark:text-emerald-400">
          {r.shop_name || '—'}
        </span>
      ),
    },
    {
      key: 'rating',
      header: 'Rating Score',
      sortable: true,
      align: 'center',
      render: (r: any) => (
        <div className="flex items-center justify-center gap-1 font-mono text-xs font-bold text-amber-500">
          <span>{'★'.repeat(r.rating || 0)}</span>
          <span className="text-gray-500 text-[11px]">({r.rating}/5)</span>
        </div>
      ),
    },
    {
      key: 'comment',
      header: 'Student Feedback Review',
      render: (r: any) => (
        <p className="text-xs text-gray-700 dark:text-gray-300 max-w-lg line-clamp-2" title={r.comment}>
          {r.comment || '—'}
        </p>
      ),
    },
    {
      key: 'created_at',
      header: 'Submitted',
      sortable: true,
      render: (r: any) => (
        <span className="text-gray-500 font-mono text-xs whitespace-nowrap">
          {fmtTime(r.created_at)}
        </span>
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
              Student Reviews & Ratings
            </h1>
            <Badge variant="default" size="md">
              {reviews.length} Total
            </Badge>
          </div>
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
            Campus dining experience satisfaction metrics and vendor quality monitoring
          </p>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={loadReviews}
          icon={<RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />}
        >
          Refresh Feed
        </Button>
      </div>

      {/* KPI Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <StatCard
          title="Total Student Reviews"
          value={reviews.length}
          subtitle="Cumulative verified feedback"
          icon={<Users className="w-5 h-5" />}
          variant="default"
        />

        <StatCard
          title="Average Rating"
          value={`${avgRating} / 5.0`}
          subtitle="Campus-wide vendor satisfaction"
          icon={<Star className="w-5 h-5 text-amber-500" />}
          variant="gold"
        />

        <StatCard
          title="Shops Reviewed"
          value={uniqueShops}
          subtitle="Unique kitchens with ratings"
          icon={<Store className="w-5 h-5" />}
          variant="emerald"
        />
      </div>

      {/* Reviews Table */}
      <DataTable
        columns={columns}
        data={reviews}
        loading={loading}
        searchPlaceholder="Search reviews by student, shop name, or comment..."
        searchableKeys={['student_name', 'username', 'shop_name', 'comment']}
        emptyTitle="No reviews recorded yet"
        emptyDescription="When students complete orders and leave reviews, their feedback appears here."
      />
    </div>
  )
}

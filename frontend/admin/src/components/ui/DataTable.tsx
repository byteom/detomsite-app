import React, { useState, useMemo } from 'react'
import { Search, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, ArrowUpDown, ArrowUp, ArrowDown, X, Inbox } from 'lucide-react'

export interface Column<T> {
  key: string
  header: React.ReactNode
  render?: (item: T, index: number) => React.ReactNode
  sortable?: boolean
  sortValue?: (item: T) => string | number
  align?: 'left' | 'center' | 'right'
  className?: string
  width?: string
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  keyExtractor?: (item: T, index: number) => string | number
  loading?: boolean
  searchPlaceholder?: string
  searchableKeys?: (keyof T | string)[]
  filterSlot?: React.ReactNode
  actionSlot?: React.ReactNode
  pageSize?: number
  emptyTitle?: string
  emptyDescription?: string
  emptyAction?: React.ReactNode
  className?: string
  stickyHeader?: boolean
  rowClassName?: (item: T, index: number) => string
}

export function DataTable<T extends Record<string, any>>({
  columns,
  data,
  keyExtractor = (item, index) => item.id || index,
  loading = false,
  searchPlaceholder = 'Search records...',
  searchableKeys,
  filterSlot,
  actionSlot,
  pageSize = 15,
  emptyTitle = 'No records found',
  emptyDescription = 'There are no items matching your criteria at this time.',
  emptyAction,
  className = '',
  stickyHeader = true,
  rowClassName,
}: DataTableProps<T>) {
  const [search, setSearch] = useState('')
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc')
  const [currentPage, setCurrentPage] = useState(1)

  // Filtered data based on search term
  const filteredData = useMemo(() => {
    if (!search.trim()) return data
    const query = search.toLowerCase().trim()

    return data.filter(item => {
      if (searchableKeys && searchableKeys.length > 0) {
        return searchableKeys.some(k => {
          const val = item[k as string]
          return String(val ?? '').toLowerCase().includes(query)
        })
      }
      // Fallback: search all primitive values in the object
      return Object.values(item).some(v =>
        typeof v === 'string' || typeof v === 'number'
          ? String(v).toLowerCase().includes(query)
          : false
      )
    })
  }, [data, search, searchableKeys])

  // Sorted data
  const sortedData = useMemo(() => {
    if (!sortKey) return filteredData
    const col = columns.find(c => c.key === sortKey)
    if (!col) return filteredData

    return [...filteredData].sort((a, b) => {
      let valA: any = col.sortValue ? col.sortValue(a) : a[sortKey]
      let valB: any = col.sortValue ? col.sortValue(b) : b[sortKey]

      if (valA === valB) return 0
      if (valA === undefined || valA === null) return 1
      if (valB === undefined || valB === null) return -1

      if (typeof valA === 'string' && typeof valB === 'string') {
        const res = valA.localeCompare(valB)
        return sortOrder === 'asc' ? res : -res
      }

      return sortOrder === 'asc' ? (valA > valB ? 1 : -1) : valA < valB ? 1 : -1
    })
  }, [filteredData, sortKey, sortOrder, columns])

  // Paginated data
  const totalPages = Math.ceil(sortedData.length / pageSize) || 1
  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, currentPage, pageSize])

  const handleSort = (colKey: string, sortable?: boolean) => {
    if (!sortable) return
    if (sortKey === colKey) {
      if (sortOrder === 'asc') setSortOrder('desc')
      else {
        setSortKey(null)
        setSortOrder('asc')
      }
    } else {
      setSortKey(colKey)
      setSortOrder('asc')
    }
  }

  const startRecord = (currentPage - 1) * pageSize + 1
  const endRecord = Math.min(currentPage * pageSize, sortedData.length)

  return (
    <div
      className={`border bg-white dark:bg-admin-surface-dark border-gray-200 dark:border-admin-border-dark ${className}`}
      style={{ borderRadius: 0 }}
    >
      {/* Table Toolbar */}
      {(searchPlaceholder || filterSlot || actionSlot) && (
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 p-3.5 border-b border-gray-200 dark:border-admin-border-dark bg-gray-50/60 dark:bg-admin-surface-darkSubtle/30">
          <div className="flex flex-wrap items-center gap-2.5 flex-1">
            {searchPlaceholder && (
              <div className="relative min-w-[200px] sm:min-w-[260px] flex-1 max-w-sm">
                <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="text"
                  value={search}
                  onChange={e => {
                    setSearch(e.target.value)
                    setCurrentPage(1)
                  }}
                  placeholder={searchPlaceholder}
                  className="w-full bg-white dark:bg-admin-surface-dark border border-gray-300 dark:border-admin-border-dark pl-9 pr-8 py-1.5 text-xs text-gray-900 dark:text-gray-100 placeholder-gray-400 outline-none focus:border-emerald-600 transition-colors"
                  style={{ borderRadius: 0 }}
                />
                {search && (
                  <button
                    onClick={() => setSearch('')}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            {filterSlot}
          </div>

          {actionSlot && <div className="flex items-center gap-2 shrink-0">{actionSlot}</div>}
        </div>
      )}

      {/* Table Container - smooth touch scrolling without ugly mobile scrollbar */}
      <div className="overflow-x-auto no-scrollbar w-full">
        <table className="w-full text-left text-xs border-collapse">
          <thead
            className={`${
              stickyHeader ? 'sticky top-0 z-10' : ''
            } bg-gray-100/90 dark:bg-admin-surface-darkSubtle border-b border-gray-200 dark:border-admin-border-dark uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold`}
          >
            <tr>
              {columns.map(col => {
                const isSorted = sortKey === col.key
                const alignClass =
                  col.align === 'center'
                    ? 'text-center'
                    : col.align === 'right'
                    ? 'text-right'
                    : 'text-left'

                return (
                  <th
                    key={col.key}
                    onClick={() => handleSort(col.key, col.sortable)}
                    style={{ width: col.width }}
                    className={`px-4 py-3 select-none ${alignClass} ${
                      col.sortable ? 'cursor-pointer hover:text-gray-900 dark:hover:text-white' : ''
                    } ${col.className || ''}`}
                  >
                    <div
                      className={`inline-flex items-center gap-1.5 ${
                        col.align === 'right' ? 'justify-end' : col.align === 'center' ? 'justify-center' : ''
                      }`}
                    >
                      <span>{col.header}</span>
                      {col.sortable && (
                        <span className="text-gray-400">
                          {isSorted ? (
                            sortOrder === 'asc' ? (
                              <ArrowUp className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <ArrowDown className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                            )
                          ) : (
                            <ArrowUpDown className="w-3.5 h-3.5 opacity-50" />
                          )}
                        </span>
                      )}
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>

          <tbody className="divide-y divide-gray-100 dark:divide-admin-border-darkSubtle text-gray-800 dark:text-gray-200">
            {loading ? (
              // Loading Skeleton
              Array.from({ length: 5 }).map((_, rIdx) => (
                <tr key={rIdx} className="animate-pulse">
                  {columns.map((c, cIdx) => (
                    <td key={cIdx} className="px-4 py-3.5">
                      <div className="h-3.5 bg-gray-200 dark:bg-gray-800/80 w-3/4" />
                    </td>
                  ))}
                </tr>
              ))
            ) : paginatedData.length === 0 ? (
              // Empty State
              <tr>
                <td colSpan={columns.length} className="px-4 py-12 text-center">
                  <div className="flex flex-col items-center justify-center max-w-sm mx-auto">
                    <div
                      className="p-3 bg-gray-100 dark:bg-admin-surface-darkSubtle border border-gray-200 dark:border-admin-border-dark text-gray-400 mb-3"
                      style={{ borderRadius: 0 }}
                    >
                      <Inbox className="w-8 h-8" />
                    </div>
                    <h4 className="text-sm font-bold text-gray-900 dark:text-white">
                      {emptyTitle}
                    </h4>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 leading-relaxed">
                      {emptyDescription}
                    </p>
                    {emptyAction && <div className="mt-4">{emptyAction}</div>}
                  </div>
                </td>
              </tr>
            ) : (
              // Real Data Rows
              paginatedData.map((item, index) => {
                const key = keyExtractor(item, index)
                const customRow = rowClassName ? rowClassName(item, index) : ''

                return (
                  <tr
                    key={key}
                    className={`hover:bg-gray-50/80 dark:hover:bg-admin-surface-darkHover/80 transition-colors ${customRow}`}
                  >
                    {columns.map(col => {
                      const alignClass =
                        col.align === 'center'
                          ? 'text-center'
                          : col.align === 'right'
                          ? 'text-right'
                          : 'text-left'

                      return (
                        <td
                          key={col.key}
                          className={`px-4 py-3 align-middle ${alignClass} ${col.className || ''}`}
                        >
                          {col.render ? col.render(item, index) : item[col.key] ?? '—'}
                        </td>
                      )
                    })}
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Footer */}
      {!loading && sortedData.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-gray-200 dark:border-admin-border-dark bg-gray-50/60 dark:bg-admin-surface-darkSubtle/30 text-xs text-gray-500 dark:text-gray-400">
          <div>
            Showing <span className="font-semibold text-gray-900 dark:text-white">{startRecord}</span> to{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{endRecord}</span> of{' '}
            <span className="font-semibold text-gray-900 dark:text-white">{sortedData.length}</span> entries
          </div>

          {totalPages > 1 && (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setCurrentPage(1)}
                disabled={currentPage === 1}
                className="p-1 border border-gray-300 dark:border-admin-border-dark hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                title="First Page"
              >
                <ChevronsLeft className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                disabled={currentPage === 1}
                className="p-1 border border-gray-300 dark:border-admin-border-dark hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Previous Page"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
              </button>

              <span className="px-2 font-medium text-gray-700 dark:text-gray-300">
                {currentPage} / {totalPages}
              </span>

              <button
                type="button"
                onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                disabled={currentPage === totalPages}
                className="p-1 border border-gray-300 dark:border-admin-border-dark hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Next Page"
              >
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setCurrentPage(totalPages)}
                disabled={currentPage === totalPages}
                className="p-1 border border-gray-300 dark:border-admin-border-dark hover:bg-gray-100 dark:hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed"
                title="Last Page"
              >
                <ChevronsRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

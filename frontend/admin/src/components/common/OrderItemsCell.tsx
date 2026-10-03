import React from 'react'

export function OrderItemsCell({ items }: { items?: string }) {
  const text = String(items || '').trim() || '—'
  const lines = text
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  return (
    <div className="group relative max-w-[280px]">
      <p className="truncate text-gray-700 dark:text-gray-300 font-medium" title={text}>
        {text}
      </p>

      {/* Tooltip on hover with complete item breakdown */}
      {lines.length > 0 && (
        <div
          className="pointer-events-none absolute left-0 top-full z-40 mt-1 hidden w-max max-w-xs border border-gray-300 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark px-3 py-2 shadow-xl group-hover:block"
          style={{ borderRadius: 0 }}
        >
          {lines.length > 1 ? (
            <ul className="space-y-1">
              {lines.map((l, i) => (
                <li
                  key={i}
                  className="flex items-start gap-1.5 text-xs font-semibold text-gray-800 dark:text-gray-200"
                >
                  <span
                    className="mt-1.5 h-1 w-1 shrink-0 bg-emerald-600 dark:bg-emerald-400"
                    style={{ borderRadius: 0 }}
                  />
                  <span>{l}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs font-semibold text-gray-800 dark:text-gray-200">{text}</p>
          )}
        </div>
      )}
    </div>
  )
}

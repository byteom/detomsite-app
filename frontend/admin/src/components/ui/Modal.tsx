import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: string
  children: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl'
  footer?: React.ReactNode
}

const maxWidthStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidth = 'md',
  footer,
}: ModalProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) onClose()
    }
    if (open) {
      document.body.style.overflow = 'hidden'
      window.addEventListener('keydown', handleKeyDown)
    }
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-xs transition-opacity animate-fade-in"
        onClick={onClose}
      />

      {/* Modal dialog box */}
      <div
        className={`relative w-full ${maxWidthStyles[maxWidth]} border border-gray-300 dark:border-admin-border-dark bg-white dark:bg-admin-surface-dark shadow-2xl z-10 overflow-hidden animate-slide-up`}
        style={{ borderRadius: 0 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 dark:border-admin-border-dark px-5 py-4 bg-gray-50/70 dark:bg-admin-surface-darkSubtle/40">
          <div>
            {title && (
              <h3 className="text-base font-bold text-gray-900 dark:text-white">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors p-1"
            aria-label="Close dialog"
            style={{ borderRadius: 0 }}
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content body */}
        <div className="p-5 max-h-[80vh] overflow-y-auto">{children}</div>

        {/* Footer */}
        {footer && (
          <div className="border-t border-gray-200 dark:border-admin-border-dark px-5 py-3.5 bg-gray-50 dark:bg-admin-surface-darkSubtle/40 flex items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

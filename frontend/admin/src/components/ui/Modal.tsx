import React, { useEffect } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: string
  children: React.ReactNode
  maxWidth?: 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '3xl' | '4xl'
  footer?: React.ReactNode
}

const maxWidthStyles = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '3xl': 'max-w-3xl',
  '4xl': 'max-w-4xl',
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
        className={`relative w-full ${maxWidthStyles[maxWidth]} border border-[var(--border-main)] bg-[var(--bg-surface)] text-[var(--text-body)] shadow-2xl z-10 overflow-hidden animate-slide-up`}
        style={{ borderRadius: 0 }}
      >
        {/* Header */}
        <div className="flex items-start justify-between border-b border-[var(--border-main)] px-5 py-4 bg-[var(--bg-surface-subtle)]">
          <div>
            {title && (
              <h3 className="text-base font-bold text-[var(--text-heading)]">{title}</h3>
            )}
            {description && (
              <p className="mt-1 text-xs text-[var(--text-muted)]">{description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-[var(--text-dim)] hover:text-[var(--text-heading)] transition-colors p-1"
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
          <div className="border-t border-[var(--border-main)] px-5 py-3.5 bg-[var(--bg-surface-subtle)] flex items-center justify-end gap-2.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

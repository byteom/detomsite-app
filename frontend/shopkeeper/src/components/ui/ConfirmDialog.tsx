import React from 'react'
import { Modal } from './Modal'
import { Button, ButtonVariant } from './Button'
import { AlertTriangle, AlertCircle, Info } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void | Promise<void>
  title: string
  description: React.ReactNode
  confirmText?: string
  cancelText?: string
  variant?: 'danger' | 'warning' | 'primary'
  loading?: boolean
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const icon = {
    danger: <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />,
    warning: <AlertTriangle className="w-6 h-6 text-amber-500" />,
    primary: <Info className="w-6 h-6 text-emerald-600 dark:text-emerald-400" />,
  }[variant]

  const btnVariant: ButtonVariant = {
    danger: 'danger',
    warning: 'gold',
    primary: 'primary',
  }[variant] as ButtonVariant

  return (
    <Modal
      open={open}
      onClose={loading ? () => {} : onClose}
      maxWidth="sm"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading} size="sm">
            {cancelText}
          </Button>
          <Button variant={btnVariant} onClick={onConfirm} loading={loading} size="sm">
            {confirmText}
          </Button>
        </>
      }
    >
      <div className="flex items-start gap-4">
        <div
          className="shrink-0 p-2.5 rounded-xl bg-[var(--bg-surface-subtle)] border border-[var(--border-main)]"
        >
          {icon}
        </div>
        <div className="flex-1">
          <h4 className="text-sm font-bold text-[var(--text-heading)]">{title}</h4>
          <div className="mt-1.5 text-xs text-[var(--text-body)] leading-relaxed">
            {description}
          </div>
        </div>
      </div>
    </Modal>
  )
}

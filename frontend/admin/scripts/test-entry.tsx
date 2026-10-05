import React from 'react'
import { renderToString } from 'react-dom/server'
import * as ReactRouterDOM from 'react-router-dom'
import { ThemeProvider } from '../src/context/ThemeContext'
import { AdminLayout } from '../src/components/layout/AdminLayout'
import { StatCard } from '../src/components/ui/StatCard'
import { Badge } from '../src/components/ui/Badge'
import { Button } from '../src/components/ui/Button'
import { Card } from '../src/components/ui/Card'
import { Input } from '../src/components/ui/Input'
import { DataTable } from '../src/components/ui/DataTable'
import { Modal } from '../src/components/ui/Modal'
import { ConfirmDialog } from '../src/components/ui/ConfirmDialog'

import { LoginPage } from '../src/pages/LoginPage'
import { ForgotPasswordPage } from '../src/pages/ForgotPasswordPage'
import { DashboardPage } from '../src/pages/DashboardPage'
import ApprovalsPage from '../src/pages/ApprovalsPage'
import { OrdersPage } from '../src/pages/OrdersPage'
import { VendorsPage } from '../src/pages/VendorsPage'
import { UsersPage } from '../src/pages/UsersPage'
import { UserDetailPage } from '../src/pages/UserDetailPage'
import { PaymentsPage } from '../src/pages/PaymentsPage'
import { RevenuePage } from '../src/pages/RevenuePage'
import { WhatsAppCenterPage } from '../src/pages/WhatsAppCenterPage'
import { SmsLogsPage } from '../src/pages/SmsLogsPage'
import { FeedbackPage } from '../src/pages/FeedbackPage'
import { ReviewsPage } from '../src/pages/ReviewsPage'
import { SettingsPage } from '../src/pages/SettingsPage'
import App from '../src/App'

const MemoryRouter =
  (ReactRouterDOM as any).MemoryRouter ||
  (ReactRouterDOM as any).default?.MemoryRouter ||
  ReactRouterDOM.BrowserRouter

export function runComponentSmokeTests(): { passed: number; results: string[] } {
  const results: string[] = []
  let passed = 0

  function test(name: string, fn: () => void) {
    try {
      fn()
      results.push(`PASS: ${name}`)
      passed++
    } catch (e: any) {
      results.push(`FAIL: ${name} -> ${e.message}`)
      throw e
    }
  }

  // 1. UI Primitives
  test('UI Primitives (Badge, Button, Card, Input, StatCard)', () => {
    const html = renderToString(
      <div>
        <Badge variant="success">Active</Badge>
        <Badge variant="gold">Pending</Badge>
        <Badge variant="error">Suspended</Badge>
        <Button variant="primary">Submit</Button>
        <Button variant="danger">Delete</Button>
        <Card title="Test Card" subtitle="Test Subtitle">
          <p>Card Content</p>
        </Card>
        <Input label="Username" placeholder="Enter username" />
        <StatCard title="Total Revenue" value="₹12,450" variant="emerald" />
      </div>
    )
    if (!html.includes('Active') || !html.includes('₹12,450')) {
      throw new Error('Primitives render missing expected tokens')
    }
  })

  // 2. DataTable
  test('DataTable component', () => {
    const sampleData = [
      { id: 1, name: 'Shop Alpha', orders: 42, revenue: 1200 },
      { id: 2, name: 'Shop Beta', orders: 18, revenue: 850 },
    ]
    const html = renderToString(
      <DataTable
        columns={[
          { key: 'name', header: 'Shop Name', sortable: true },
          { key: 'orders', header: 'Orders' },
          { key: 'revenue', header: 'Revenue' },
        ]}
        data={sampleData}
      />
    )
    if (!html.includes('Shop Alpha') || !html.includes('Shop Beta')) {
      throw new Error('DataTable missing row content')
    }
  })

  // 3. Modal & ConfirmDialog
  test('Modal & ConfirmDialog components', () => {
    const html = renderToString(
      <div>
        <Modal open={true} onClose={() => {}} title="Test Modal">
          <p>Modal body</p>
        </Modal>
        <ConfirmDialog
          open={true}
          onClose={() => {}}
          onConfirm={() => {}}
          title="Confirm Action"
          description="Are you sure?"
        />
      </div>
    )
    if (!html.includes('Test Modal') || !html.includes('Confirm Action')) {
      throw new Error('Modal / ConfirmDialog missing expected markup')
    }
  })

  // 4. Pages rendering in MemoryRouter
  const pages: [string, React.ReactNode][] = [
    ['LoginPage', <LoginPage />],
    ['ForgotPasswordPage', <ForgotPasswordPage />],
    ['DashboardPage', <DashboardPage />],
    ['ApprovalsPage', <ApprovalsPage />],
    ['OrdersPage', <OrdersPage />],
    ['VendorsPage', <VendorsPage />],
    ['UsersPage', <UsersPage />],
    ['UserDetailPage', <UserDetailPage />],
    ['PaymentsPage', <PaymentsPage />],
    ['RevenuePage', <RevenuePage />],
    ['WhatsAppCenterPage', <WhatsAppCenterPage />],
    ['SmsLogsPage', <SmsLogsPage />],
    ['FeedbackPage', <FeedbackPage />],
    ['ReviewsPage', <ReviewsPage />],
    ['SettingsPage', <SettingsPage />],
  ]

  for (const [pageName, component] of pages) {
    test(`Page Render: ${pageName}`, () => {
      const html = renderToString(
        <ThemeProvider>
          <MemoryRouter>{component}</MemoryRouter>
        </ThemeProvider>
      )
      if (!html || html.length < 50) {
        throw new Error(`${pageName} rendered empty markup`)
      }
    })
  }

  // 5. AdminLayout
  test('AdminLayout component', () => {
    const html = renderToString(
      <ThemeProvider>
        <MemoryRouter initialEntries={['/dashboard']}>
          <AdminLayout>
            <div>Dashboard Content</div>
          </AdminLayout>
        </MemoryRouter>
      </ThemeProvider>
    )
    if (!html.includes('DETOMSITE') || !html.includes('Dashboard Content')) {
      throw new Error('AdminLayout failed to render sidebar and content')
    }
  })

  // 6. Complete App
  test('Complete App mounting', () => {
    const html = renderToString(<App />)
    if (!html || html.length < 100) {
      throw new Error('App rendered empty markup')
    }
  })

  return { passed, results }
}

import React, { useEffect } from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
  useNavigate,
} from 'react-router-dom'
import { ThemeProvider } from './context/ThemeContext'
import { AdminLayout } from './components/layout/AdminLayout'
import ErrorBoundary from './components/ErrorBoundary'

// Modular Page Components
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import { DashboardPage } from './pages/DashboardPage'
import ApprovalsPage from './pages/ApprovalsPage'
import { OrdersPage } from './pages/OrdersPage'
import { VendorsPage } from './pages/VendorsPage'
import { UsersPage } from './pages/UsersPage'
import { UserDetailPage } from './pages/UserDetailPage'
import { PaymentsPage } from './pages/PaymentsPage'
import { RevenuePage } from './pages/RevenuePage'
import { WhatsAppCenterPage } from './pages/WhatsAppCenterPage'
import { SmsLogsPage } from './pages/SmsLogsPage'
import { FeedbackPage } from './pages/FeedbackPage'
import { ReviewsPage } from './pages/ReviewsPage'
import { SettingsPage } from './pages/SettingsPage'
import { ScrollToTop } from './components/common/ScrollToTop'

/** Auth guard: verifies administrator JWT token before rendering protected routes */
function RequireAuth({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate()
  const token = localStorage.getItem('admin_token')

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true })
    }
  }, [token, navigate])

  if (!token) return null
  return <>{children}</>
}

export default function App() {
  return (
    <ThemeProvider>
      <ErrorBoundary>
        <Router>
          <ScrollToTop />
          <Routes>
            {/* Public Authentication Routes */}
            <Route path="/login" element={<LoginPage />} />
            <Route path="/forgot-password" element={<ForgotPasswordPage />} />

            {/* Authenticated Admin Management Routes */}
            <Route
              path="/*"
              element={
                <RequireAuth>
                  <AdminLayout>
                    <Routes>
                      <Route path="/dashboard" element={<DashboardPage />} />
                      <Route path="/approvals" element={<ApprovalsPage />} />
                      <Route path="/orders" element={<OrdersPage />} />
                      {/* Standalone verify page removed — verification lives in the
                          order detail modal. Old Telegram deep links land here. */}
                      <Route path="/orders/:orderId" element={<Navigate to="/orders" replace />} />
                      <Route path="/vendors" element={<VendorsPage />} />
                      <Route path="/users" element={<UsersPage />} />
                      <Route path="/users/:userId" element={<UserDetailPage />} />
                      <Route path="/payments" element={<PaymentsPage />} />
                      <Route path="/revenue" element={<RevenuePage />} />
                      <Route path="/whatsapp" element={<WhatsAppCenterPage />} />
                      <Route path="/sms" element={<SmsLogsPage />} />
                      <Route path="/feedback" element={<FeedbackPage />} />
                      <Route path="/reviews" element={<ReviewsPage />} />
                      <Route path="/settings" element={<SettingsPage />} />
                      <Route path="*" element={<Navigate to="/dashboard" replace />} />
                    </Routes>
                  </AdminLayout>
                </RequireAuth>
              }
            />
          </Routes>
        </Router>
      </ErrorBoundary>
    </ThemeProvider>
  )
}

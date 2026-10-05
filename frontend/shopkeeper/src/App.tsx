import React from 'react'
import {
  BrowserRouter as Router,
  Routes,
  Route,
  Navigate,
} from 'react-router-dom'
import { ScrollToTop } from './components/common/ScrollToTop'
import { PortalHomePage } from './pages/PortalHomePage'
import { RegisterPage } from './pages/RegisterPage'
import { LoginPage } from './pages/LoginPage'
import { ForgotPasswordPage } from './pages/ForgotPasswordPage'
import ScanOrderPage from './ScanOrderPage'
import { VendorApp } from './pages/VendorApp'

export default function App() {
  return (
    <Router>
      <ScrollToTop />
      <Routes>
        <Route path="/" element={<PortalHomePage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/forgot-password" element={<ForgotPasswordPage />} />
        <Route path="/scan" element={<ScanOrderPage />} />
        <Route path="/mobile/*" element={<VendorApp />} />
        <Route path="/*" element={<Navigate to="/mobile" replace />} />
      </Routes>
    </Router>
  )
}

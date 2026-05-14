import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import { Login } from './components/Login'
import { Register } from './components/Register'
import { LandingPage } from './components/LandingPage'
import { ProtectedRoute } from './components/ProtectedRoute'
import { AppLayout } from './components/layout/AppLayout'
import { OverviewPage } from './components/pages/OverviewPage'
import { SubscriptionsPage } from './components/pages/SubscriptionsPage'
import { MarketsPage } from './components/pages/MarketsPage'
import { TradingPage } from './components/pages/TradingPage'
import { ChatPage } from './components/pages/ChatPage'
import { SettingsPage } from './components/pages/SettingsPage'
import { PolymarketSubscriptionsPage } from './components/pages/PolymarketSubscriptionsPage'

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<LandingPage />} />
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />

          {/* Protected — inside the app shell */}
          <Route
            element={
              <ProtectedRoute>
                <AppLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/dashboard" element={<OverviewPage />} />
            <Route path="/subscriptions" element={<SubscriptionsPage />} />
            <Route path="/polymarket-subscriptions" element={<PolymarketSubscriptionsPage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/trading" element={<TradingPage />} />
            <Route path="/chat" element={<ChatPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  )
}

export default App

import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './MainNav.css';

export const MainNav = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, logout } = useAuth();

  return (
    <div className="main-nav">
      <button
        className={`main-nav-btn ${location.pathname === '/dashboard' ? 'active' : ''}`}
        onClick={() => navigate('/dashboard')}
      >
        Dashboard
      </button>
      <button
        className={`main-nav-btn ${location.pathname === '/chat' ? 'active' : ''}`}
        onClick={() => navigate('/chat')}
      >
        Chat Dashboard
      </button>
      <button
        className={`main-nav-btn ${location.pathname === '/events' ? 'active' : ''}`}
        onClick={() => navigate('/events')}
      >
        Pollymarket Events
      </button>

      <div className="main-nav-spacer" />

      <div className="main-nav-footer">
        <div className="main-nav-user-profile">
          <div className="main-nav-user-avatar">{user?.name?.charAt(0).toUpperCase()}</div>
          <div className="main-nav-user-info">
            <div className="main-nav-user-name">{user?.name}</div>
            <div className="main-nav-user-email">{user?.email}</div>
          </div>
        </div>
        <button className="main-nav-logout-btn" onClick={logout} title="Logout">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
        </button>
      </div>
    </div>
  );
};

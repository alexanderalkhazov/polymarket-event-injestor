import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './Dashboard.css';

export const Dashboard = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="dashboard-container">
      <nav className="dashboard-nav">
        <h2>Polymarket Dashboard</h2>
        <button onClick={handleLogout} className="logout-button">
          Logout
        </button>
      </nav>

      <div className="dashboard-content">
        <div className="welcome-card">
          <h1>Welcome, {user?.name}! 👋</h1>
          <p className="user-info">
            <strong>Email:</strong> {user?.email}
          </p>
          <p className="user-info">
            <strong>User ID:</strong> {user?.id}
          </p>
        </div>

        <div className="info-card">
          <h3>You're now logged in!</h3>
          <p>
            This is a protected route that can only be accessed by authenticated users.
            Your auth token is automatically included in all API requests.
          </p>
          <div className="feature-list">
            <div className="feature-item">✓ JWT-based authentication</div>
            <div className="feature-item">✓ MongoDB user storage</div>
            <div className="feature-item">✓ Protected routes</div>
            <div className="feature-item">✓ React Context for auth state</div>
          </div>
        </div>
      </div>
    </div>
  );
};

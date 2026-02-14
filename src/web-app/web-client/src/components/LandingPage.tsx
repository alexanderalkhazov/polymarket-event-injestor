import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import './LandingPage.css';

export const LandingPage = () => {
  const navigate = useNavigate();
  const { isAuthenticated } = useAuth();

  const handleTryNow = () => {
    navigate(isAuthenticated ? '/dashboard' : '/login');
  };

  const handleSeeDashboard = () => {
    navigate(isAuthenticated ? '/dashboard' : '/register');
  };

  return (
    <div className="landing-container">
      <div className="landing-shell">
        <section className="landing-hero">
          <div className="landing-badge">Polymarket Intelligence Platform</div>
          <h1>Turn prediction market chaos into confident, faster decisions.</h1>
          <p className="landing-description">
            A modern AI command center for traders and research teams. Monitor live signals, detect hot market
            events, and act with conviction from one clean workflow.
          </p>

          <div className="landing-cta-row">
            <button className="landing-cta" onClick={handleTryNow}>
              Start Free Now
            </button>
            <button className="landing-cta secondary" onClick={handleSeeDashboard}>
              View Platform
            </button>
          </div>

          <div className="landing-metrics">
            <div className="metric-card">
              <div className="metric-value">24/7</div>
              <div className="metric-label">Live Market Monitoring</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">AI-First</div>
              <div className="metric-label">Decision Support Layer</div>
            </div>
            <div className="metric-card">
              <div className="metric-value">Real-Time</div>
              <div className="metric-label">Event Context & Conviction</div>
            </div>
          </div>
        </section>

        <section className="landing-section">
          <h2>Built to help your team execute with confidence</h2>
          <div className="landing-feature-grid">
            <article className="feature-card">
              <h3>AI Chat Dashboard</h3>
              <p>Ask complex market questions and receive contextual answers grounded in recent event flow.</p>
            </article>
            <article className="feature-card">
              <h3>Pollymarket Hot Events</h3>
              <p>Track emerging opportunities with filters for indication, volume, and recency.</p>
            </article>
            <article className="feature-card">
              <h3>Single Navigation Workflow</h3>
              <p>Move from overview to analysis to action without context switching or information loss.</p>
            </article>
          </div>
        </section>

        <section className="landing-section landing-bottom-cta">
          <h2>Ready to upgrade your market operations?</h2>
          <p>Launch your workspace and start analyzing live signals in minutes.</p>
          <button className="landing-cta" onClick={handleTryNow}>
            Try Now
          </button>
        </section>
      </div>
    </div>
  );
};

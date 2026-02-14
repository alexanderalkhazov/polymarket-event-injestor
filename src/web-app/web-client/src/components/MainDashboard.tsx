import { useNavigate } from 'react-router-dom';
import { MainNav } from './MainNav';
import './MainDashboard.css';

export const MainDashboard = () => {
  const navigate = useNavigate();

  const highlights = [
    { label: 'Live Context Streams', value: '24/7' },
    { label: 'Signal Confidence', value: 'High' },
    { label: 'Decision Speed', value: '< 10s' },
    { label: 'Workflow Coverage', value: 'End-to-End' },
  ];

  const capabilities = [
    {
      title: 'AI Market Intelligence',
      description:
        'Turn raw market activity into concise insights with assistant responses grounded in recent event flow.',
    },
    {
      title: 'Hot Event Discovery',
      description:
        'Surface conviction-driven opportunities with high-signal filters for indication, volume, and recency.',
    },
    {
      title: 'Operator-Grade Workflow',
      description:
        'Move from research to action fast with one navigation system and dedicated operational views.',
    },
  ];

  return (
    <div className="main-dashboard-layout">
      <MainNav />
      <div className="main-dashboard-content">
        <div className="main-dashboard-scroll">
          <div className="main-dashboard-hero">
            <div className="hero-badge">Polymarket Intelligence Platform</div>
            <h1>Convert market noise into clear conviction and faster decisions.</h1>
            <p>
              Your team gets a single command center for AI analysis, hot event tracking, and execution-ready
              context powered by live market data.
            </p>
            <div className="hero-actions">
              <button className="hero-btn primary" onClick={() => navigate('/chat')}>
                Launch Chat Dashboard
              </button>
              <button className="hero-btn" onClick={() => navigate('/events')}>
                Explore Pollymarket Events
              </button>
            </div>
          </div>

          <div className="main-dashboard-highlights">
            {highlights.map((item) => (
              <div key={item.label} className="highlight-card">
                <div className="highlight-value">{item.value}</div>
                <div className="highlight-label">{item.label}</div>
              </div>
            ))}
          </div>

          <div className="main-dashboard-section">
            <h2>Why teams choose this platform</h2>
            <div className="capability-grid">
              {capabilities.map((capability) => (
                <div key={capability.title} className="capability-card">
                  <h3>{capability.title}</h3>
                  <p>{capability.description}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="main-dashboard-section">
            <h2>How it works</h2>
            <div className="workflow-grid">
              <div className="workflow-step">
                <span>1</span>
                <h3>Ingest</h3>
                <p>Continuously ingest conviction and market updates from your data pipeline.</p>
              </div>
              <div className="workflow-step">
                <span>2</span>
                <h3>Analyze</h3>
                <p>Use AI chat to pressure-test positions with fresh event context already attached.</p>
              </div>
              <div className="workflow-step">
                <span>3</span>
                <h3>Execute</h3>
                <p>Move quickly from signal discovery to execution decisions with confidence.</p>
              </div>
            </div>
          </div>

          <div className="main-dashboard-cards">
            <button className="main-dashboard-card" onClick={() => navigate('/chat')}>
              <h2>Chat Dashboard</h2>
              <p>Open AI chat with streamed responses and saved conversations.</p>
            </button>

            <button className="main-dashboard-card" onClick={() => navigate('/events')}>
              <h2>Pollymarket Events</h2>
              <p>View recent hot events with indication, price, volume, and filters.</p>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

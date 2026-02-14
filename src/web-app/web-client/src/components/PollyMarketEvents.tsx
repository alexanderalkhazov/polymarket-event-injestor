import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { chatAPI } from '../services/api';
import './PollyMarketEvents.css';

interface MarketEvent {
  market_id: string;
  market_slug: string;
  question: string;
  current_price: number;
  volume: number;
  timestamp: string;
  outcome: string;
  conviction_level?: string;
}

export const PollyMarketEvents = () => {
  const countOptions = [25, 50, 100, 200];
  const timeOptions = [
    { value: 'all', label: 'All Time' },
    { value: '1h', label: 'Last 1h' },
    { value: '24h', label: 'Last 24h' },
    { value: '7d', label: 'Last 7d' },
  ];
  const navigate = useNavigate();
  const [events, setEvents] = useState<MarketEvent[]>([]);
  const [selectedCount, setSelectedCount] = useState<number>(50);
  const [searchText, setSearchText] = useState('');
  const [minVolume, setMinVolume] = useState('');
  const [selectedIndication, setSelectedIndication] = useState<'all' | 'yes' | 'no' | 'neutral'>('all');
  const [selectedTime, setSelectedTime] = useState<'all' | '1h' | '24h' | '7d'>('all');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string>('');

  const loadEvents = async (limit: number = selectedCount) => {
    try {
      setIsLoading(true);
      setError('');
      const response = await chatAPI.getMarketEvents(limit);
      if (!response.success || !response.data) {
        throw new Error('Failed to load events');
      }
      setEvents(response.data.events as MarketEvent[]);
    } catch (err: any) {
      setError(err?.message || 'Failed to load events');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadEvents(selectedCount);
  }, [selectedCount]);

  const filteredEvents = useMemo(() => {
    const now = Date.now();
    const minVolumeNumber = minVolume.trim() ? Number(minVolume) : 0;
    const search = searchText.trim().toLowerCase();

    return events.filter((event) => {
      const eventQuestion = (event.question || '').toLowerCase();
      const eventSlug = (event.market_slug || '').toLowerCase();
      const eventId = (event.market_id || '').toLowerCase();
      const eventOutcome = (event.outcome || '').toLowerCase();
      const eventVolume = Number(event.volume || 0);
      const eventTime = new Date(event.timestamp).getTime();

      if (search && !eventQuestion.includes(search) && !eventSlug.includes(search) && !eventId.includes(search)) {
        return false;
      }

      if (!Number.isNaN(minVolumeNumber) && eventVolume < minVolumeNumber) {
        return false;
      }

      if (selectedIndication === 'yes' && eventOutcome !== 'yes') {
        return false;
      }

      if (selectedIndication === 'no' && eventOutcome !== 'no') {
        return false;
      }

      if (selectedIndication === 'neutral' && (eventOutcome === 'yes' || eventOutcome === 'no')) {
        return false;
      }

      if (selectedTime !== 'all') {
        const msWindow =
          selectedTime === '1h'
            ? 60 * 60 * 1000
            : selectedTime === '24h'
              ? 24 * 60 * 60 * 1000
              : 7 * 24 * 60 * 60 * 1000;

        if (!eventTime || Number.isNaN(eventTime) || now - eventTime > msWindow) {
          return false;
        }
      }

      return true;
    });
  }, [events, minVolume, searchText, selectedIndication, selectedTime]);

  const hotEvents = useMemo(() => {
    return [...filteredEvents]
      .sort((a, b) => (b.volume || 0) - (a.volume || 0))
      .slice(0, selectedCount);
  }, [filteredEvents, selectedCount]);

  const resetFilters = () => {
    setSearchText('');
    setMinVolume('');
    setSelectedIndication('all');
    setSelectedTime('all');
  };

  const getIndication = (outcome: string) => {
    const lower = (outcome || '').toLowerCase();
    if (lower === 'yes') return { label: 'Bullish ↑', className: 'up' };
    if (lower === 'no') return { label: 'Bearish ↓', className: 'down' };
    return { label: 'Neutral →', className: 'neutral' };
  };

  return (
    <div className="events-page">
      <div className="events-header">
        <div>
          <h1>Polly Market Events</h1>
          <div className="events-subtitle">Showing {hotEvents.length} of {filteredEvents.length} filtered events</div>
        </div>
        <div className="events-actions">
          <select
            className="events-select"
            value={selectedCount}
            onChange={(e) => setSelectedCount(Number(e.target.value))}
          >
            {countOptions.map((option) => (
              <option key={option} value={option}>
                Top {option}
              </option>
            ))}
          </select>
          <button onClick={() => loadEvents(selectedCount)} className="events-btn">Refresh</button>
          <button onClick={() => navigate('/dashboard')} className="events-btn secondary">Back to Chat</button>
        </div>
      </div>

      <div className="events-filters">
        <input
          className="events-input"
          type="text"
          placeholder="Search market question/slug/id"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <input
          className="events-input"
          type="number"
          min="0"
          step="1"
          placeholder="Min volume"
          value={minVolume}
          onChange={(e) => setMinVolume(e.target.value)}
        />
        <select
          className="events-select"
          value={selectedIndication}
          onChange={(e) => setSelectedIndication(e.target.value as 'all' | 'yes' | 'no' | 'neutral')}
        >
          <option value="all">All Indications</option>
          <option value="yes">Bullish</option>
          <option value="no">Bearish</option>
          <option value="neutral">Neutral</option>
        </select>
        <select
          className="events-select"
          value={selectedTime}
          onChange={(e) => setSelectedTime(e.target.value as 'all' | '1h' | '24h' | '7d')}
        >
          {timeOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button className="events-btn secondary" onClick={resetFilters}>Reset</button>
      </div>

      {isLoading ? (
        <div className="events-state">Loading recent events...</div>
      ) : error ? (
        <div className="events-state error">{error}</div>
      ) : hotEvents.length === 0 ? (
        <div className="events-state">No events found.</div>
      ) : (
        <div className="events-table-wrap">
          <table className="events-table">
            <thead>
              <tr>
                <th>Market</th>
                <th>Indication</th>
                <th>Price</th>
                <th>Volume</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {hotEvents.map((event, idx) => {
                const indication = getIndication(event.outcome);
                const price = Number(event.current_price || 0) * 100;
                return (
                  <tr key={`${event.market_id}-${idx}`}>
                    <td>
                      <div className="market-question">{event.question || event.market_slug || event.market_id}</div>
                      <div className="market-sub">{event.market_slug || event.market_id}</div>
                    </td>
                    <td>
                      <span className={`indication ${indication.className}`}>{indication.label}</span>
                    </td>
                    <td>{price.toFixed(1)}%</td>
                    <td>${Number(event.volume || 0).toLocaleString()}</td>
                    <td>{new Date(event.timestamp).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

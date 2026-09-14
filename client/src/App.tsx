import React, { useEffect, useState, useCallback } from 'react';
import {
  Cloud,
  Database,
  Server,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Layers,
  Terminal,
  ShieldCheck,
  Cpu,
} from 'lucide-react';

interface HealthResponse {
  success: boolean;
  data?: {
    status: 'healthy' | 'degraded' | 'unhealthy';
    version: string;
    uptime: number;
    timestamp: string;
    services: {
      database: { status: string };
      redis: { status: string };
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

export const App: React.FC = () => {
  const [health, setHealth] = useState<HealthResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [lastChecked, setLastChecked] = useState<Date | null>(null);
  const [latency, setLatency] = useState<number | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchHealth = useCallback(async () => {
    setLoading(true);
    setErrorMsg(null);
    const start = performance.now();
    try {
      const res = await fetch('/api/v1/health');
      const elapsed = Math.round(performance.now() - start);
      setLatency(elapsed);

      if (!res.ok) {
        throw new Error(`HTTP ${res.status}: ${res.statusText}`);
      }

      const json: HealthResponse = await res.json();
      setHealth(json);
      setLastChecked(new Date());
    } catch (err: unknown) {
      const elapsed = Math.round(performance.now() - start);
      setLatency(elapsed);
      setErrorMsg(err instanceof Error ? err.message : 'Failed to reach API server');
      setHealth(null);
      setLastChecked(new Date());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const interval = setInterval(fetchHealth, 15000);
    return () => clearInterval(interval);
  }, [fetchHealth]);

  const formatUptime = (seconds?: number) => {
    if (seconds === undefined) return 'N/A';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) return `${hrs}h ${mins}m ${secs}s`;
    if (mins > 0) return `${mins}m ${secs}s`;
    return `${secs}s`;
  };

  const dbStatus = health?.data?.services?.database?.status || 'disconnected';
  const redisStatus = health?.data?.services?.redis?.status || 'disconnected';
  const overallStatus = errorMsg
    ? 'unhealthy'
    : health?.data?.status || 'loading';

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <Cloud size={24} />
          </div>
          <div>
            <h1 className="brand-title">DriveScale</h1>
            <p className="brand-subtitle">Cloud File Storage Platform</p>
          </div>
        </div>
        <div className="phase-pill">
          <span className="phase-dot" />
          <span>Phase 0 — Repository Initialization</span>
        </div>
      </header>

      {/* Hero Banner */}
      <section className="hero-card">
        <h2 className="hero-title">
          Self-Hosted, Enterprise-Grade <span>File Storage Architecture</span>
        </h2>
        <p className="hero-desc">
          DriveScale is engineered as a resilient modular monolith featuring large-file streaming,
          chunked resumable uploads, MinIO object storage, distributed Redis caching, and BullMQ background workers.
        </p>
        <div className="actions-bar">
          <button
            className="btn btn-primary"
            onClick={fetchHealth}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
            {loading ? 'Checking Health...' : 'Refresh Health Status'}
          </button>
          <a
            href="/api/v1/health"
            target="_blank"
            rel="noreferrer"
            className="btn btn-secondary"
          >
            <Terminal size={16} />
            Raw API Response
          </a>
        </div>
      </section>

      {/* Infrastructure Health Monitor */}
      <section>
        <div className="monitor-grid">
          {/* API Server Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <Server size={20} />
                </div>
                <h3 className="card-title">Express API</h3>
              </div>
              <span className={`status-badge ${overallStatus}`}>
                {overallStatus === 'healthy' && <CheckCircle2 size={12} />}
                {overallStatus === 'degraded' && <AlertTriangle size={12} />}
                {overallStatus === 'unhealthy' && <XCircle size={12} />}
                {overallStatus}
              </span>
            </div>

            <div className="metric-row">
              <span className="metric-label">Endpoint</span>
              <span className="metric-value">/api/v1/health</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Uptime</span>
              <span className="metric-value">{formatUptime(health?.data?.uptime)}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Latency</span>
              <span className="metric-value">{latency !== null ? `${latency} ms` : '—'}</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Version</span>
              <span className="metric-value">{health?.data?.version || '0.1.0'}</span>
            </div>
          </div>

          {/* MongoDB Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <Database size={20} />
                </div>
                <h3 className="card-title">MongoDB</h3>
              </div>
              <span className={`status-badge ${dbStatus}`}>
                {dbStatus === 'connected' ? <CheckCircle2 size={12} /> : <AlertTriangle size={12} />}
                {dbStatus}
              </span>
            </div>

            <div className="metric-row">
              <span className="metric-label">Role</span>
              <span className="metric-value">Metadata Store</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Driver</span>
              <span className="metric-value">Mongoose 8</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Port</span>
              <span className="metric-value">27017</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">State</span>
              <span className="metric-value">{dbStatus}</span>
            </div>
          </div>

          {/* Redis Card */}
          <div className="card">
            <div className="card-header">
              <div className="card-title-group">
                <div className="card-icon">
                  <Cpu size={20} />
                </div>
                <h3 className="card-title">Redis</h3>
              </div>
              <span className={`status-badge ${redisStatus}`}>
                {redisStatus === 'connected' || redisStatus === 'ready' ? (
                  <CheckCircle2 size={12} />
                ) : (
                  <AlertTriangle size={12} />
                )}
                {redisStatus}
              </span>
            </div>

            <div className="metric-row">
              <span className="metric-label">Role</span>
              <span className="metric-value">Cache & Rate Limiting</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Driver</span>
              <span className="metric-value">ioredis 5</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">Port</span>
              <span className="metric-value">6379</span>
            </div>
            <div className="metric-row">
              <span className="metric-label">State</span>
              <span className="metric-value">{redisStatus}</span>
            </div>
          </div>
        </div>
      </section>

      {/* Phase Status & Roadmap */}
      <section className="roadmap-section">
        <h3 className="section-heading">
          <Layers size={20} color="#6366F1" />
          Architecture Phase Roadmap
        </h3>
        <div className="roadmap-grid">
          <div className="phase-item active">
            <div>
              <p className="phase-item-title">Phase 0: Repository Init</p>
              <p className="phase-item-sub">Monorepo, Docker, Health API</p>
            </div>
            <span className="badge-tag active">Verified</span>
          </div>
          <div className="phase-item">
            <div>
              <p className="phase-item-title">Phase 1: Authentication</p>
              <p className="phase-item-sub">JWT, Argon2, Refresh Rotation</p>
            </div>
            <span className="badge-tag next">Upcoming</span>
          </div>
          <div className="phase-item">
            <div>
              <p className="phase-item-title">Phase 2: Folder System</p>
              <p className="phase-item-sub">Hierarchical tree & breadcrumbs</p>
            </div>
            <span className="badge-tag upcoming">Planned</span>
          </div>
          <div className="phase-item">
            <div>
              <p className="phase-item-title">Phase 3: File Storage</p>
              <p className="phase-item-sub">Streamed uploads & downloads</p>
            </div>
            <span className="badge-tag upcoming">Planned</span>
          </div>
          <div className="phase-item">
            <div>
              <p className="phase-item-title">Phase 4-5: Chunked & Resumable</p>
              <p className="phase-item-sub">Multi-part streaming upload sessions</p>
            </div>
            <span className="badge-tag upcoming">Planned</span>
          </div>
          <div className="phase-item">
            <div>
              <p className="phase-item-title">Phase 12: MinIO Storage</p>
              <p className="phase-item-sub">Self-hosted S3-compatible object store</p>
            </div>
            <span className="badge-tag upcoming">Planned</span>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="app-footer">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <ShieldCheck size={16} color="#10B981" />
          <span>Zero AWS Dependencies — Self-Hosted Architecture</span>
        </div>
        <div>
          Last checked:{' '}
          {lastChecked ? lastChecked.toLocaleTimeString() : 'Checking...'}
        </div>
      </footer>
    </div>
  );
};

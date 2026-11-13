import React, { useEffect, useState } from 'react';
import { HardDrive, RefreshCw, AlertTriangle, AlertCircle, CheckCircle2 } from 'lucide-react';
import { StorageUsageStats } from '../../types/storage.types.js';
import { storageService } from '../../services/storage.service.js';
import { formatBytes } from '../../utils/format.js';
import { useAuthStore } from '../../stores/auth.store.js';

export interface StorageUsageIndicatorProps {
  stats?: StorageUsageStats | null;
  compact?: boolean;
  showDetails?: boolean;
  className?: string;
  onRefresh?: () => void;
}

export const StorageUsageIndicator: React.FC<StorageUsageIndicatorProps> = ({
  stats: initialStats,
  compact = false,
  showDetails = true,
  className = '',
  onRefresh,
}) => {
  const { user } = useAuthStore();
  const [stats, setStats] = useState<StorageUsageStats | null>(initialStats || null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchStorageUsage = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await storageService.getStorageUsage();
      if (res.success && res.data) {
        setStats(res.data);
      } else {
        setError(res.error?.message || 'Failed to load storage statistics');
      }
    } catch {
      setError('Network error loading storage stats');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (initialStats) {
      setStats(initialStats);
    } else {
      fetchStorageUsage();
    }
  }, [initialStats]);

  // Compute fallback values from user if stats not yet loaded
  const used = stats ? stats.storageUsed : (user?.storageUsed || 0);
  const reserved = stats ? stats.storageReserved : 0;
  const quota = stats ? stats.storageQuota : (user?.storageQuota || 10737418240);
  const remaining = stats ? stats.storageRemaining : Math.max(0, quota - used - reserved);
  const percentage = stats
    ? stats.percentageUsed
    : Math.min(100, Math.round(((used + reserved) / (quota || 1)) * 1000) / 10);

  // Status thresholds
  const isDanger = percentage >= 95;
  const isWarning = percentage >= 80 && percentage < 95;

  const barColor = isDanger
    ? 'var(--accent-rose, #EF4444)'
    : isWarning
    ? 'var(--accent-amber, #F59E0B)'
    : 'linear-gradient(90deg, #6366F1 0%, #06B6D4 100%)';

  const badgeBg = isDanger
    ? 'rgba(239, 68, 68, 0.15)'
    : isWarning
    ? 'rgba(245, 158, 11, 0.15)'
    : 'rgba(99, 102, 241, 0.15)';

  const badgeText = isDanger
    ? 'var(--accent-rose, #EF4444)'
    : isWarning
    ? 'var(--accent-amber, #F59E0B)'
    : 'var(--accent-cyan, #06B6D4)';

  const handleRefreshClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (onRefresh) {
      onRefresh();
    }
    fetchStorageUsage();
  };

  if (compact) {
    return (
      <div
        className={`storage-indicator-compact ${className}`}
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.35rem',
          minWidth: '160px',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '0.75rem' }}>
          <span style={{ color: 'var(--text-secondary, #94A3B8)', display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
            <HardDrive size={13} />
            <span>Storage</span>
          </span>
          <span style={{ fontWeight: 600, color: badgeText }}>{percentage.toFixed(1)}%</span>
        </div>

        <div
          style={{
            height: '5px',
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: '999px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              height: '100%',
              width: `${Math.min(100, Math.max(1, percentage))}%`,
              background: barColor,
              borderRadius: '999px',
              transition: 'width 0.4s ease',
            }}
          />
        </div>

        <div style={{ fontSize: '0.7rem', color: 'var(--text-muted, #64748B)', textAlign: 'right' }}>
          {formatBytes(used)} / {formatBytes(quota)}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`storage-usage-card ${className}`}
      style={{
        background: 'var(--gradient-card, rgba(17, 24, 39, 0.7))',
        border: `1px solid ${isDanger ? 'rgba(239, 68, 68, 0.3)' : isWarning ? 'rgba(245, 158, 11, 0.3)' : 'var(--border-subtle, rgba(255, 255, 255, 0.08))'}`,
        borderRadius: '12px',
        padding: '1rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.75rem',
        boxShadow: isDanger
          ? '0 0 15px rgba(239, 68, 68, 0.15)'
          : isWarning
          ? '0 0 15px rgba(245, 158, 11, 0.15)'
          : 'var(--shadow-card, 0 10px 30px -10px rgba(0, 0, 0, 0.5))',
        backdropFilter: 'blur(12px)',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <div
            style={{
              width: '32px',
              height: '32px',
              borderRadius: '8px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: badgeBg,
              color: badgeText,
            }}
          >
            <HardDrive size={18} />
          </div>
          <div>
            <h4 style={{ fontSize: '0.9rem', fontWeight: 600, margin: 0, color: 'var(--text-primary, #F8FAFC)' }}>
              Storage Quota
            </h4>
            <p style={{ fontSize: '0.75rem', margin: 0, color: 'var(--text-secondary, #94A3B8)' }}>
              {formatBytes(used)} used of {formatBytes(quota)}
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span
            style={{
              padding: '0.2rem 0.55rem',
              borderRadius: '6px',
              fontSize: '0.75rem',
              fontWeight: 600,
              backgroundColor: badgeBg,
              color: badgeText,
              display: 'flex',
              alignItems: 'center',
              gap: '0.3rem',
            }}
          >
            {isDanger && <AlertCircle size={12} />}
            {isWarning && <AlertTriangle size={12} />}
            {!isDanger && !isWarning && <CheckCircle2 size={12} />}
            {percentage.toFixed(1)}%
          </span>

          <button
            onClick={handleRefreshClick}
            disabled={loading}
            title="Refresh storage quota stats"
            style={{
              background: 'transparent',
              border: 'none',
              cursor: loading ? 'default' : 'pointer',
              color: 'var(--text-muted, #64748B)',
              padding: '0.25rem',
              display: 'flex',
              alignItems: 'center',
              borderRadius: '4px',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div
        style={{
          width: '100%',
          height: '8px',
          backgroundColor: 'rgba(255, 255, 255, 0.08)',
          borderRadius: '999px',
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div
          style={{
            height: '100%',
            width: `${Math.min(100, Math.max(1, percentage))}%`,
            background: barColor,
            borderRadius: '999px',
            transition: 'width 0.4s ease',
          }}
        />
      </div>

      {/* Detail Footer */}
      {showDetails && (
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.75rem',
            color: 'var(--text-muted, #64748B)',
            paddingTop: '0.25rem',
            borderTop: '1px solid rgba(255, 255, 255, 0.05)',
          }}
        >
          <span>
            {remaining > 0 ? `${formatBytes(remaining)} remaining` : 'Storage quota full'}
          </span>
          {reserved > 0 && (
            <span style={{ color: 'var(--accent-cyan, #06B6D4)' }}>
              +{formatBytes(reserved)} reserved in uploads
            </span>
          )}
        </div>
      )}

      {error && (
        <p style={{ margin: 0, fontSize: '0.72rem', color: 'var(--accent-rose, #EF4444)' }}>
          {error}
        </p>
      )}
    </div>
  );
};

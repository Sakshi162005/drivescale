import React, { useState, useEffect, useCallback } from 'react';
import {
  X,
  Share2,
  UserPlus,
  Trash2,
  Loader2,
  AlertCircle,
  CheckCircle2,
  Shield,
} from 'lucide-react';
import { shareService } from '../../services/share.service.js';
import { ShareItem, SharePermission, ShareResourceType } from '../../types/share.types.js';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  resourceType: ShareResourceType;
  resourceId: string;
  resourceName: string;
  onShareUpdated?: () => void;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  resourceType,
  resourceId,
  resourceName,
  onShareUpdated,
}) => {
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [loadingShares, setLoadingShares] = useState<boolean>(true);
  const [emailInput, setEmailInput] = useState<string>('');
  const [selectedPermission, setSelectedPermission] = useState<SharePermission>('VIEW');
  const [submitting, setSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [updatingShareId, setUpdatingShareId] = useState<string | null>(null);
  const [revokingShareId, setRevokingShareId] = useState<string | null>(null);

  const fetchShares = useCallback(async () => {
    setLoadingShares(true);
    try {
      const res =
        resourceType === 'FILE'
          ? await shareService.getFileShares(resourceId)
          : await shareService.getFolderShares(resourceId);

      if (res.success && res.data) {
        setShares(res.data.shares || []);
      }
    } catch {
      // Ignore or set error
    } finally {
      setLoadingShares(false);
    }
  }, [resourceType, resourceId]);

  useEffect(() => {
    if (isOpen) {
      setEmailInput('');
      setSelectedPermission('VIEW');
      setError(null);
      setSuccess(null);
      fetchShares();
    }
  }, [isOpen, fetchShares]);

  if (!isOpen) return null;

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!emailInput.trim()) {
      setError('Please enter a recipient email address');
      return;
    }

    setSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const res =
        resourceType === 'FILE'
          ? await shareService.shareFile(resourceId, {
              recipientEmail: emailInput.trim(),
              permission: selectedPermission,
            })
          : await shareService.shareFolder(resourceId, {
              recipientEmail: emailInput.trim(),
              permission: selectedPermission,
            });

      if (res.success) {
        setSuccess(`Successfully shared with ${emailInput.trim()}`);
        setEmailInput('');
        fetchShares();
        onShareUpdated?.();
      } else {
        setError(res.error?.message || 'Failed to share resource');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error sharing resource');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdatePermission = async (shareId: string, newPermission: SharePermission) => {
    setUpdatingShareId(shareId);
    setError(null);
    try {
      const res =
        resourceType === 'FILE'
          ? await shareService.updateFileShare(resourceId, shareId, { permission: newPermission })
          : await shareService.updateFolderShare(resourceId, shareId, { permission: newPermission });

      if (res.success) {
        setShares((prev) =>
          prev.map((s) => (s._id === shareId ? { ...s, permission: newPermission } : s))
        );
        onShareUpdated?.();
      } else {
        setError(res.error?.message || 'Failed to update share permission');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error updating permission');
    } finally {
      setUpdatingShareId(null);
    }
  };

  const handleRevokeShare = async (shareId: string) => {
    setRevokingShareId(shareId);
    setError(null);
    try {
      const res =
        resourceType === 'FILE'
          ? await shareService.revokeFileShare(resourceId, shareId)
          : await shareService.revokeFolderShare(resourceId, shareId);

      if (res.success) {
        setShares((prev) => prev.filter((s) => s._id !== shareId));
        setSuccess('Share access revoked');
        onShareUpdated?.();
      } else {
        setError(res.error?.message || 'Failed to revoke share');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error revoking share');
    } finally {
      setRevokingShareId(null);
    }
  };

  const getPermissionBadgeColor = (perm: SharePermission) => {
    switch (perm) {
      case 'EDIT':
        return { bg: 'rgba(16, 185, 129, 0.15)', text: '#10B981', border: 'rgba(16, 185, 129, 0.3)' };
      case 'DOWNLOAD':
        return { bg: 'rgba(6, 182, 212, 0.15)', text: '#06B6D4', border: 'rgba(6, 182, 212, 0.3)' };
      case 'VIEW':
      default:
        return { bg: 'rgba(99, 102, 241, 0.15)', text: '#818CF8', border: 'rgba(99, 102, 241, 0.3)' };
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: '520px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
            <div
              style={{
                width: '32px',
                height: '32px',
                borderRadius: '8px',
                background: 'rgba(99, 102, 241, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818CF8',
              }}
            >
              <Share2 size={18} />
            </div>
            <div>
              <h3 className="modal-title" style={{ fontSize: '1rem', lineHeight: '1.2' }}>
                Share &ldquo;{resourceName}&rdquo;
              </h3>
              <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                {resourceType === 'FILE' ? 'File sharing' : 'Folder sharing (recursive inheritance)'}
              </span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {error && (
          <div
            className="auth-alert"
            style={{ marginBottom: '1rem', padding: '0.5rem 0.75rem', fontSize: '0.8125rem' }}
          >
            <AlertCircle size={16} />
            <span>{error}</span>
          </div>
        )}

        {success && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'rgba(16, 185, 129, 0.12)',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              color: '#34D399',
              borderRadius: '8px',
              padding: '0.5rem 0.75rem',
              fontSize: '0.8125rem',
              marginBottom: '1rem',
            }}
          >
            <CheckCircle2 size={16} />
            <span>{success}</span>
          </div>
        )}

        {/* Invite User Form */}
        <form onSubmit={handleShare} style={{ marginBottom: '1.5rem' }}>
          <label
            style={{
              display: 'block',
              fontSize: '0.8125rem',
              fontWeight: 500,
              color: 'var(--text-secondary)',
              marginBottom: '0.375rem',
            }}
          >
            Share with registered user:
          </label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              type="email"
              placeholder="user@example.com"
              value={emailInput}
              onChange={(e) => setEmailInput(e.target.value)}
              className="search-input"
              style={{ flex: 1, padding: '0.5rem 0.75rem', fontSize: '0.875rem' }}
              disabled={submitting}
            />
            <select
              value={selectedPermission}
              onChange={(e) => setSelectedPermission(e.target.value as SharePermission)}
              disabled={submitting}
              style={{
                background: '#1E293B',
                color: '#FFF',
                border: '1px solid var(--border-subtle)',
                borderRadius: '8px',
                padding: '0.5rem 0.75rem',
                fontSize: '0.8125rem',
                cursor: 'pointer',
              }}
            >
              <option value="VIEW">Can View</option>
              <option value="DOWNLOAD">Can Download</option>
              <option value="EDIT">Can Edit</option>
            </select>
            <button
              type="submit"
              className="btn btn-primary"
              disabled={submitting}
              style={{ padding: '0.5rem 0.875rem', fontSize: '0.8125rem' }}
            >
              {submitting ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <UserPlus size={14} />
              )}
              <span>Share</span>
            </button>
          </div>
        </form>

        {/* Permission Info Callout */}
        <div
          style={{
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid var(--border-subtle)',
            borderRadius: '8px',
            padding: '0.625rem 0.875rem',
            marginBottom: '1.25rem',
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', color: '#CBD5E1', fontWeight: 600 }}>
            <Shield size={14} color="#818CF8" />
            <span>Permission Hierarchy:</span>
          </div>
          <div>• <strong>VIEW:</strong> Read metadata & browse contents (no download or edits).</div>
          <div>• <strong>DOWNLOAD:</strong> Read and download file contents.</div>
          <div>• <strong>EDIT:</strong> Read, download, and rename / update items.</div>
        </div>

        {/* Active Shares List */}
        <div>
          <h4
            style={{
              fontSize: '0.8125rem',
              fontWeight: 600,
              color: 'var(--text-secondary)',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.75rem',
            }}
          >
            People with access ({shares.length})
          </h4>

          {loadingShares ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1.5rem' }}>
              <Loader2 size={20} className="animate-spin" color="#818CF8" />
            </div>
          ) : shares.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '1.5rem',
                background: 'rgba(0, 0, 0, 0.2)',
                borderRadius: '8px',
                border: '1px dashed var(--border-subtle)',
                color: 'var(--text-muted)',
                fontSize: '0.8125rem',
              }}
            >
              No active shares yet. Invite users above to grant access.
            </div>
          ) : (
            <div
              style={{
                maxHeight: '200px',
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.5rem',
              }}
            >
              {shares.map((share) => {
                const badgeColor = getPermissionBadgeColor(share.permission);
                const recipientName = share.recipientId?.name || 'User';
                const recipientEmail = share.recipientId?.email || '';
                const initial = recipientName.charAt(0).toUpperCase();

                return (
                  <div
                    key={share._id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '0.5rem 0.75rem',
                      background: 'rgba(255, 255, 255, 0.03)',
                      border: '1px solid var(--border-subtle)',
                      borderRadius: '8px',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.625rem' }}>
                      <div
                        style={{
                          width: '28px',
                          height: '28px',
                          borderRadius: '50%',
                          background: 'linear-gradient(135deg, #6366F1, #8B5CF6)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#FFF',
                        }}
                      >
                        {initial}
                      </div>
                      <div>
                        <div style={{ fontSize: '0.8125rem', fontWeight: 600, color: '#FFF' }}>
                          {recipientName}
                        </div>
                        <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                          {recipientEmail}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                      <select
                        value={share.permission}
                        disabled={updatingShareId === share._id || revokingShareId === share._id}
                        onChange={(e) =>
                          handleUpdatePermission(share._id, e.target.value as SharePermission)
                        }
                        style={{
                          background: badgeColor.bg,
                          color: badgeColor.text,
                          border: `1px solid ${badgeColor.border}`,
                          borderRadius: '6px',
                          padding: '0.25rem 0.5rem',
                          fontSize: '0.75rem',
                          fontWeight: 600,
                          cursor: 'pointer',
                        }}
                      >
                        <option value="VIEW">VIEW</option>
                        <option value="DOWNLOAD">DOWNLOAD</option>
                        <option value="EDIT">EDIT</option>
                      </select>

                      <button
                        type="button"
                        onClick={() => handleRevokeShare(share._id)}
                        disabled={updatingShareId === share._id || revokingShareId === share._id}
                        title="Revoke access"
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#EF4444',
                          cursor: 'pointer',
                          padding: '0.25rem',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          borderRadius: '4px',
                        }}
                      >
                        {revokingShareId === share._id ? (
                          <Loader2 size={14} className="animate-spin" />
                        ) : (
                          <Trash2 size={14} />
                        )}
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
          <button type="button" className="btn btn-secondary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
};

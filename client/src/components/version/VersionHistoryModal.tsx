import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  History,
  X,
  Download,
  RotateCcw,
  Upload,
  Loader2,
  AlertCircle,
  CheckCircle2,
  FileText,
  Clock,
  User,
  Hash,
} from 'lucide-react';
import { versionService } from '../../services/version.service.js';
import { FileVersionItem, VersionListFileSummary } from '../../types/version.types.js';

interface VersionHistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileId: string;
  fileName: string;
  canDownload?: boolean;
  canEdit?: boolean;
  onVersionChanged?: () => void;
}

export const VersionHistoryModal: React.FC<VersionHistoryModalProps> = ({
  isOpen,
  onClose,
  fileId,
  fileName,
  canDownload = true,
  canEdit = true,
  onVersionChanged,
}) => {
  const [versions, setVersions] = useState<FileVersionItem[]>([]);
  const [fileSummary, setFileSummary] = useState<VersionListFileSummary | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Action states
  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null);
  const [restoringVersionId, setRestoringVersionId] = useState<string | null>(null);
  const [confirmRestoreVersion, setConfirmRestoreVersion] = useState<FileVersionItem | null>(null);
  const [uploadingReplacement, setUploadingReplacement] = useState<boolean>(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (isoString?: string): string => {
    if (!isoString) return 'Unknown date';
    try {
      return new Date(isoString).toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return isoString;
    }
  };

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await versionService.listVersions(fileId);
      if (res.success && res.data) {
        setVersions(res.data.versions || []);
        setFileSummary(res.data.file || null);
      } else {
        setError(res.error?.message || 'Failed to load version history');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error fetching versions');
    } finally {
      setLoading(false);
    }
  }, [fileId]);

  useEffect(() => {
    if (isOpen) {
      setError(null);
      setSuccess(null);
      setConfirmRestoreVersion(null);
      fetchVersions();
    }
  }, [isOpen, fetchVersions]);

  if (!isOpen) return null;

  const handleDownload = async (version: FileVersionItem) => {
    setDownloadingVersionId(version._id);
    setError(null);
    try {
      await versionService.downloadVersion(fileId, version._id, version.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Download failed');
    } finally {
      setDownloadingVersionId(null);
    }
  };

  const handleTriggerRestore = (version: FileVersionItem) => {
    setConfirmRestoreVersion(version);
  };

  const executeRestore = async () => {
    if (!confirmRestoreVersion) return;
    const versionToRestore = confirmRestoreVersion;
    setRestoringVersionId(versionToRestore._id);
    setError(null);
    setSuccess(null);
    try {
      const res = await versionService.restoreVersion(fileId, versionToRestore._id);
      if (res.success) {
        setSuccess(
          res.message ||
            `Successfully restored version v${versionToRestore.versionNumber} as new active version!`
        );
        setConfirmRestoreVersion(null);
        await fetchVersions();
        onVersionChanged?.();
      } else {
        setError(res.error?.message || 'Failed to restore version');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error during restoration');
    } finally {
      setRestoringVersionId(null);
    }
  };

  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploadingReplacement(true);
    setError(null);
    setSuccess(null);
    try {
      const res = await versionService.uploadReplacementVersion(fileId, file);
      if (res.success) {
        setSuccess(
          res.message ||
            `Successfully uploaded replacement as new version v${res.data?.newVersion.versionNumber || ''}!`
        );
        await fetchVersions();
        onVersionChanged?.();
      } else {
        setError(res.error?.message || 'Failed to upload replacement version');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error uploading new version');
    } finally {
      setUploadingReplacement(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  const getUploaderName = (uploader?: FileVersionItem['uploadedBy']): string => {
    if (!uploader) return 'System / Unknown';
    if (typeof uploader === 'string') return uploader;
    return uploader.name || uploader.email || 'User';
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-dialog"
        style={{ maxWidth: '640px', width: '92%' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <div
              style={{
                width: '36px',
                height: '36px',
                borderRadius: '10px',
                background: 'rgba(129, 140, 248, 0.15)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#818CF8',
              }}
            >
              <History size={20} />
            </div>
            <div>
              <h3 className="modal-title" style={{ fontSize: '1.05rem', lineHeight: '1.2' }}>
                Version History
              </h3>
              <span
                style={{
                  fontSize: '0.8rem',
                  color: 'var(--text-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.35rem',
                  marginTop: '0.2rem',
                }}
              >
                <FileText size={12} />
                <span
                  style={{
                    maxWidth: '360px',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={fileSummary?.name || fileName}
                >
                  {fileSummary?.name || fileName}
                </span>
                {fileSummary && (
                  <span>
                    &bull; {fileSummary.versionCount || versions.length} {fileSummary.versionCount === 1 ? 'version' : 'versions'}
                  </span>
                )}
              </span>
            </div>
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        {/* Notifications */}
        {error && (
          <div
            className="auth-alert"
            style={{ marginBottom: '1rem', padding: '0.6rem 0.85rem', fontSize: '0.8125rem' }}
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
              padding: '0.6rem 0.85rem',
              fontSize: '0.8125rem',
              marginBottom: '1rem',
            }}
          >
            <CheckCircle2 size={16} />
            <span>{success}</span>
          </div>
        )}

        {/* Restore Confirmation Callout */}
        {confirmRestoreVersion && (
          <div
            style={{
              background: 'rgba(245, 158, 11, 0.12)',
              border: '1px solid rgba(245, 158, 11, 0.3)',
              borderRadius: '8px',
              padding: '0.875rem',
              marginBottom: '1rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.625rem' }}>
              <RotateCcw size={18} style={{ color: '#FBBF24', flexShrink: 0, marginTop: '2px' }} />
              <div style={{ flex: 1 }}>
                <p style={{ margin: 0, fontSize: '0.875rem', fontWeight: 600, color: '#FDE68A' }}>
                  Restore version v{confirmRestoreVersion.versionNumber}?
                </p>
                <p style={{ margin: '0.25rem 0 0.75rem', fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                  A new version will be created preserving the content of v{confirmRestoreVersion.versionNumber}. Previous versions remain safe and intact.
                </p>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  <button
                    className="btn btn-primary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: 'auto' }}
                    onClick={executeRestore}
                    disabled={restoringVersionId !== null}
                  >
                    {restoringVersionId === confirmRestoreVersion._id ? (
                      <>
                        <Loader2 size={13} className="spin" />
                        <span>Restoring...</span>
                      </>
                    ) : (
                      'Confirm Restore'
                    )}
                  </button>
                  <button
                    className="btn btn-secondary"
                    style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', height: 'auto' }}
                    onClick={() => setConfirmRestoreVersion(null)}
                    disabled={restoringVersionId !== null}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Replacement Header / Controls */}
        {canEdit && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              background: 'rgba(255, 255, 255, 0.03)',
              border: '1px solid var(--border-subtle)',
              borderRadius: '8px',
              padding: '0.625rem 0.875rem',
              marginBottom: '1rem',
            }}
          >
            <div>
              <p style={{ margin: 0, fontSize: '0.8125rem', fontWeight: 500, color: 'var(--text-primary)' }}>
                Upload New Version
              </p>
              <p style={{ margin: 0, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                Upload an updated file as a new sequential version
              </p>
            </div>
            <div>
              <input
                ref={fileInputRef}
                type="file"
                style={{ display: 'none' }}
                onChange={handleFileInputChange}
              />
              <button
                className="btn btn-primary"
                style={{
                  padding: '0.375rem 0.875rem',
                  fontSize: '0.75rem',
                  height: 'auto',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                }}
                disabled={uploadingReplacement || loading}
                onClick={() => fileInputRef.current?.click()}
              >
                {uploadingReplacement ? (
                  <>
                    <Loader2 size={13} className="spin" />
                    <span>Uploading...</span>
                  </>
                ) : (
                  <>
                    <Upload size={13} />
                    <span>Upload Replacement</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Versions List */}
        <div
          style={{
            maxHeight: '380px',
            overflowY: 'auto',
            border: '1px solid var(--border-subtle)',
            borderRadius: '10px',
            background: 'rgba(0, 0, 0, 0.25)',
            padding: '0.5rem',
          }}
        >
          {loading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '2.5rem 1rem',
                gap: '0.5rem',
                color: 'var(--text-muted)',
              }}
            >
              <Loader2 size={24} className="spin" />
              <span style={{ fontSize: '0.8125rem' }}>Loading versions...</span>
            </div>
          ) : versions.length === 0 ? (
            <div
              style={{
                textAlign: 'center',
                padding: '2rem 1rem',
                color: 'var(--text-muted)',
                fontSize: '0.8125rem',
              }}
            >
              No versions available for this file.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {versions.map((ver) => {
                const isCurrent = ver.isCurrent;
                const isDownloading = downloadingVersionId === ver._id;
                const isRestoring = restoringVersionId === ver._id;

                return (
                  <div
                    key={ver._id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      background: isCurrent ? 'rgba(99, 102, 241, 0.08)' : 'rgba(255, 255, 255, 0.02)',
                      border: `1px solid ${isCurrent ? 'rgba(99, 102, 241, 0.35)' : 'var(--border-subtle)'}`,
                      borderRadius: '8px',
                      padding: '0.75rem 0.875rem',
                      transition: 'background 0.15s ease',
                      gap: '0.75rem',
                    }}
                  >
                    {/* Version Details */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span
                          style={{
                            fontWeight: 700,
                            fontSize: '0.875rem',
                            color: isCurrent ? '#A5B4FC' : 'var(--text-primary)',
                          }}
                        >
                          v{ver.versionNumber}
                        </span>

                        {isCurrent ? (
                          <span
                            style={{
                              background: 'rgba(16, 185, 129, 0.15)',
                              border: '1px solid rgba(16, 185, 129, 0.35)',
                              color: '#34D399',
                              fontSize: '0.6875rem',
                              fontWeight: 600,
                              borderRadius: '4px',
                              padding: '0.1rem 0.4rem',
                              letterSpacing: '0.04em',
                            }}
                          >
                            CURRENT
                          </span>
                        ) : null}

                        <span
                          style={{
                            fontSize: '0.75rem',
                            color: 'var(--text-secondary)',
                            fontWeight: 500,
                          }}
                        >
                          {formatBytes(ver.size)}
                        </span>
                      </div>

                      {/* Metadata row */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: '0.875rem',
                          flexWrap: 'wrap',
                          marginTop: '0.3rem',
                          fontSize: '0.725rem',
                          color: 'var(--text-muted)',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <Clock size={11} />
                          {formatDate(ver.createdAt)}
                        </span>

                        <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                          <User size={11} />
                          {getUploaderName(ver.uploadedBy)}
                        </span>

                        {ver.checksum && (
                          <span
                            style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}
                            title={`Checksum: ${ver.checksum}`}
                          >
                            <Hash size={11} />
                            {ver.checksum.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    </div>

                    {/* Version Actions */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexShrink: 0 }}>
                      {/* Download Button */}
                      {canDownload && (
                        <button
                          className="icon-action-btn"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '28px',
                            height: '28px',
                          }}
                          onClick={() => handleDownload(ver)}
                          title={`Download version v${ver.versionNumber}`}
                          disabled={isDownloading}
                        >
                          {isDownloading ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <Download size={14} />
                          )}
                        </button>
                      )}

                      {/* Restore Button (only for previous non-current versions) */}
                      {!isCurrent && canEdit && (
                        <button
                          className="icon-action-btn"
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            width: '28px',
                            height: '28px',
                            color: '#FBBF24',
                          }}
                          onClick={() => handleTriggerRestore(ver)}
                          title={`Restore to version v${ver.versionNumber}`}
                          disabled={isRestoring || Boolean(confirmRestoreVersion)}
                        >
                          {isRestoring ? (
                            <Loader2 size={13} className="spin" />
                          ) : (
                            <RotateCcw size={14} />
                          )}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="modal-actions" style={{ marginTop: '1.25rem' }}>
          <button className="btn btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
};


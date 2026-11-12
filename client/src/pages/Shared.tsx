import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Users,
  Folder as FolderIcon,
  HardDrive,
  Cloud,
  LogOut,
  ChevronRight,
  Search,
  Grid,
  List,
  Download,
  Edit2,
  AlertCircle,
  Loader2,
  File as FileDocIcon,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Code,
  Shield,
  X,
  Check,
} from 'lucide-react';
import { shareService } from '../services/share.service.js';
import { fileService } from '../services/file.service.js';
import { folderService } from '../services/folder.service.js';
import { useAuthStore } from '../stores/auth.store.js';
import {
  SharedResourceItem,
  EffectivePermission,
  SharePermission,
} from '../types/share.types.js';
import { FileItem } from '../types/file.types.js';
import { Folder } from '../types/folder.types.js';

export const Shared: React.FC = () => {
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuthStore();

  const [sharedItems, setSharedItems] = useState<SharedResourceItem[]>([]);
  const [currentFolder, setCurrentFolder] = useState<Folder | null>(null);
  const [folderPermission, setFolderPermission] = useState<EffectivePermission>(null);
  const [subfolders, setSubfolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Rename modal state (for EDIT permission items)
  const [renameTarget, setRenameTarget] = useState<{
    type: 'FILE' | 'FOLDER';
    id: string;
    currentName: string;
  } | null>(null);
  const [renameVal, setRenameVal] = useState<string>('');
  const [renameLoading, setRenameLoading] = useState<boolean>(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  // Auth redirect
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (routeFolderId) {
        // Viewing contents of a specific shared folder
        const res = await shareService.getSharedFolderContents(routeFolderId);
        if (res.success && res.data) {
          setCurrentFolder(res.data.folder);
          setFolderPermission(res.data.effectivePermission);
          setSubfolders(res.data.subfolders || []);
          setFiles(res.data.files || []);
        } else {
          setError(res.error?.message || 'Failed to load shared folder contents');
        }
      } else {
        // Viewing root "Shared with me" list
        const res = await shareService.listSharedWithMe({ limit: 100 });
        if (res.success && res.data) {
          setSharedItems(res.data.items || []);
        } else {
          setError(res.error?.message || 'Failed to load shared resources');
        }
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading shared items');
    } finally {
      setLoading(false);
    }
  }, [routeFolderId]);

  useEffect(() => {
    if (isAuthenticated) {
      loadData();
    }
  }, [isAuthenticated, loadData]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const renderFileIcon = (mimeType?: string, fileName?: string) => {
    const ext = fileName?.split('.').pop()?.toLowerCase() || '';
    if (mimeType?.startsWith('image/') || ['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp'].includes(ext)) {
      return <Image size={24} color="#06B6D4" />;
    }
    if (mimeType?.startsWith('video/') || ['mp4', 'mov', 'avi', 'mkv'].includes(ext)) {
      return <Film size={24} color="#8B5CF6" />;
    }
    if (mimeType?.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'flac'].includes(ext)) {
      return <Music size={24} color="#EC4899" />;
    }
    if (mimeType === 'application/pdf' || ext === 'pdf') {
      return <FileText size={24} color="#EF4444" />;
    }
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) {
      return <Archive size={24} color="#F59E0B" />;
    }
    if (['js', 'ts', 'jsx', 'tsx', 'html', 'css', 'json', 'py', 'go', 'rs', 'c', 'cpp'].includes(ext)) {
      return <Code size={24} color="#10B981" />;
    }
    return <FileDocIcon size={24} color="#6366F1" />;
  };

  const renderPermissionBadge = (perm: SharePermission | EffectivePermission) => {
    switch (perm) {
      case 'EDIT':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: 'rgba(16, 185, 129, 0.15)',
              color: '#10B981',
              border: '1px solid rgba(16, 185, 129, 0.3)',
              borderRadius: '9999px',
              padding: '0.2rem 0.5rem',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            EDIT
          </span>
        );
      case 'DOWNLOAD':
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: 'rgba(6, 182, 212, 0.15)',
              color: '#06B6D4',
              border: '1px solid rgba(6, 182, 212, 0.3)',
              borderRadius: '9999px',
              padding: '0.2rem 0.5rem',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            DOWNLOAD
          </span>
        );
      case 'VIEW':
      default:
        return (
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              background: 'rgba(99, 102, 241, 0.15)',
              color: '#818CF8',
              border: '1px solid rgba(99, 102, 241, 0.3)',
              borderRadius: '9999px',
              padding: '0.2rem 0.5rem',
              fontSize: '0.7rem',
              fontWeight: 600,
            }}
          >
            VIEW ONLY
          </span>
        );
    }
  };

  const handleDownload = async (fileId: string, fileName: string, perm: EffectivePermission) => {
    if (perm === 'VIEW') {
      alert('You have VIEW only permission for this file. Downloading is disabled.');
      return;
    }
    await fileService.downloadFile(fileId, fileName);
  };

  const handleRenameSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!renameTarget || !renameVal.trim()) return;

    setRenameLoading(true);
    setRenameError(null);
    try {
      if (renameTarget.type === 'FILE') {
        const res = await fileService.renameFile(renameTarget.id, renameVal.trim());
        if (res.success) {
          setRenameTarget(null);
          loadData();
        } else {
          setRenameError(res.error?.message || 'Failed to rename file');
        }
      } else {
        const res = await folderService.renameFolder(renameTarget.id, renameVal.trim());
        if (res.success) {
          setRenameTarget(null);
          loadData();
        } else {
          setRenameError(res.error?.message || 'Failed to rename folder');
        }
      }
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : 'Error renaming resource');
    } finally {
      setRenameLoading(false);
    }
  };

  // Filter root items
  const filteredSharedItems = sharedItems.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Filter folder view items
  const filteredSubfolders = subfolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const sharedFolders = filteredSharedItems.filter((i) => i.resourceType === 'FOLDER');
  const sharedFiles = filteredSharedItems.filter((i) => i.resourceType === 'FILE');

  return (
    <div className="app-container">
      {/* Header */}
      <header className="app-header">
        <div className="brand-wrapper">
          <div className="brand-icon">
            <Cloud size={24} />
          </div>
          <div>
            <Link to="/" style={{ textDecoration: 'none' }}>
              <h1 className="brand-title">DriveScale</h1>
            </Link>
            <p className="brand-subtitle">Cloud File Storage Platform</p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <Link
            to="/drive"
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <HardDrive size={15} />
            <span>My Drive</span>
          </Link>

          <Link
            to="/shared"
            className="btn btn-primary"
            style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Users size={15} />
            <span>Shared with me</span>
          </Link>

          {user && (
            <div className="user-menu" style={{ marginLeft: '0.5rem' }}>
              <div className="user-badge">
                <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="user-name">{user.name}</div>
                  <div className="user-email">{user.email}</div>
                </div>
              </div>
              <button
                className="btn btn-secondary"
                onClick={() => logout()}
                title="Sign Out"
              >
                <LogOut size={16} />
                Sign Out
              </button>
            </div>
          )}
        </div>
      </header>

      {/* Title & Navigation */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Users size={24} color="#818CF8" />
            <span>{routeFolderId ? currentFolder?.name || 'Shared Folder' : 'Shared with me'}</span>
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            {routeFolderId
              ? 'Viewing contents of shared folder hierarchy'
              : 'Files and folders shared directly or hierarchically with your account'}
          </p>
        </div>
      </div>

      {/* Explorer Top Toolbar */}
      <div className="drive-toolbar">
        {/* Breadcrumbs */}
        <nav className="breadcrumbs-trail">
          <button
            className={`breadcrumb-item ${!routeFolderId ? 'active' : ''}`}
            onClick={() => navigate('/shared')}
          >
            <Users size={16} />
            <span>Shared with me</span>
          </button>

          {routeFolderId && currentFolder && (
            <>
              <ChevronRight size={14} className="breadcrumb-separator" />
              <button className="breadcrumb-item active">
                <span>{currentFolder.name}</span>
              </button>
            </>
          )}
        </nav>

        {/* Toolbar Actions */}
        <div className="drive-actions">
          <div className="drive-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search shared items..."
              className="search-input"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
          </div>

          <div className="view-toggle">
            <button
              className={`toggle-btn ${viewMode === 'grid' ? 'active' : ''}`}
              onClick={() => setViewMode('grid')}
              title="Grid View"
            >
              <Grid size={16} />
            </button>
            <button
              className={`toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
              onClick={() => setViewMode('list')}
              title="List View"
            >
              <List size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Effective Permission Alert for Folder Navigation */}
      {routeFolderId && folderPermission && (
        <div
          style={{
            background: 'rgba(99, 102, 241, 0.1)',
            border: '1px solid rgba(99, 102, 241, 0.25)',
            borderRadius: '8px',
            padding: '0.75rem 1rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Shield size={18} color="#818CF8" />
            <span style={{ fontSize: '0.875rem', color: '#CBD5E1' }}>
              Your effective permission in this shared folder:
            </span>
            {renderPermissionBadge(folderPermission)}
          </div>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
            Permissions automatically inherit to all nested subfolders and files
          </span>
        </div>
      )}

      {error && (
        <div className="auth-alert" style={{ marginBottom: '1.5rem' }}>
          <AlertCircle size={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="drive-main">
        {loading ? (
          <div className="drive-loading">
            <Loader2 size={36} className="animate-spin" color="#6366F1" />
            <p>Loading shared items...</p>
          </div>
        ) : !routeFolderId && sharedItems.length === 0 ? (
          <div className="drive-empty">
            <div className="empty-icon-wrapper">
              <Users size={48} />
            </div>
            <h3 className="empty-title">No items shared with you yet</h3>
            <p className="empty-desc">
              When other DriveScale users share files or folders with you, they will appear here.
            </p>
          </div>
        ) : routeFolderId && subfolders.length === 0 && files.length === 0 ? (
          <div className="drive-empty">
            <div className="empty-icon-wrapper">
              <FolderIcon size={48} />
            </div>
            <h3 className="empty-title">This shared folder is empty</h3>
            <p className="empty-desc">
              The owner has not uploaded any files or subfolders to this directory.
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* When viewing root Shared list: Folders */}
            {!routeFolderId && sharedFolders.length > 0 && (
              <div>
                <h3 className="section-title">Shared Folders ({sharedFolders.length})</h3>
                <div className="folder-grid">
                  {sharedFolders.map((item) => (
                    <div
                      key={item.shareId}
                      className="folder-card"
                      onDoubleClick={() => navigate(`/shared/${item.resourceId}`)}
                    >
                      <div
                        className="folder-card-clickable"
                        onClick={() => navigate(`/shared/${item.resourceId}`)}
                      >
                        <div className="folder-icon-box">
                          <FolderIcon size={24} />
                        </div>
                        <div className="folder-info">
                          <h4 className="folder-name" title={item.name}>
                            {item.name}
                          </h4>
                          <span className="folder-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                            {renderPermissionBadge(item.effectivePermission || item.permission)}
                            <span>by {item.owner.name}</span>
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* When viewing root Shared list: Files */}
            {!routeFolderId && sharedFiles.length > 0 && (
              <div>
                <h3 className="section-title">Shared Files ({sharedFiles.length})</h3>
                <div className="folder-grid">
                  {sharedFiles.map((item) => {
                    const canDownload = item.effectivePermission !== 'VIEW';
                    const canEdit = item.effectivePermission === 'EDIT' || item.effectivePermission === 'OWNER';

                    return (
                      <div key={item.shareId} className="folder-card file-card">
                        <div
                          className="folder-card-clickable"
                          onClick={() => handleDownload(item.resourceId, item.name, item.effectivePermission)}
                          title={canDownload ? 'Click to download' : 'View only access (download disabled)'}
                        >
                          <div className="folder-icon-box file-icon-box">
                            {renderFileIcon(item.mimeType, item.name)}
                          </div>
                          <div className="folder-info">
                            <h4 className="folder-name" title={item.name}>
                              {item.name}
                            </h4>
                            <span className="folder-meta" style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginTop: '0.25rem' }}>
                              {renderPermissionBadge(item.effectivePermission || item.permission)}
                              <span>{formatBytes(item.size || 0)}</span>
                            </span>
                            <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                              by {item.owner.name}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem' }}>
                          {canDownload && (
                            <button
                              className="folder-menu-btn"
                              onClick={() => handleDownload(item.resourceId, item.name, item.effectivePermission)}
                              title="Download"
                            >
                              <Download size={15} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              className="folder-menu-btn"
                              onClick={() => {
                                setRenameTarget({ type: 'FILE', id: item.resourceId, currentName: item.name });
                                setRenameVal(item.name);
                              }}
                              title="Rename (Edit permission)"
                            >
                              <Edit2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* When viewing folder contents: Subfolders */}
            {routeFolderId && filteredSubfolders.length > 0 && (
              <div>
                <h3 className="section-title">Subfolders ({filteredSubfolders.length})</h3>
                <div className="folder-grid">
                  {filteredSubfolders.map((subfolder) => (
                    <div
                      key={subfolder._id}
                      className="folder-card"
                      onDoubleClick={() => navigate(`/shared/${subfolder._id}`)}
                    >
                      <div
                        className="folder-card-clickable"
                        onClick={() => navigate(`/shared/${subfolder._id}`)}
                      >
                        <div className="folder-icon-box">
                          <FolderIcon size={24} />
                        </div>
                        <div className="folder-info">
                          <h4 className="folder-name" title={subfolder.name}>
                            {subfolder.name}
                          </h4>
                          <span className="folder-meta">
                            {new Date(subfolder.updatedAt).toLocaleDateString()}
                          </span>
                        </div>
                      </div>

                      {(folderPermission === 'EDIT' || folderPermission === 'OWNER') && (
                        <div style={{ padding: '0.5rem' }}>
                          <button
                            className="folder-menu-btn"
                            onClick={() => {
                              setRenameTarget({ type: 'FOLDER', id: subfolder._id, currentName: subfolder.name });
                              setRenameVal(subfolder.name);
                            }}
                            title="Rename"
                          >
                            <Edit2 size={15} />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* When viewing folder contents: Files */}
            {routeFolderId && filteredFiles.length > 0 && (
              <div>
                <h3 className="section-title">Files ({filteredFiles.length})</h3>
                <div className="folder-grid">
                  {filteredFiles.map((file) => {
                    const canDownload = folderPermission !== 'VIEW';
                    const canEdit = folderPermission === 'EDIT' || folderPermission === 'OWNER';

                    return (
                      <div key={file._id} className="folder-card file-card">
                        <div
                          className="folder-card-clickable"
                          onClick={() => handleDownload(file._id, file.name, folderPermission)}
                          title={canDownload ? 'Click to download' : 'View only access (download disabled)'}
                        >
                          <div className="folder-icon-box file-icon-box">
                            {renderFileIcon(file.mimeType, file.name)}
                          </div>
                          <div className="folder-info">
                            <h4 className="folder-name" title={file.name}>
                              {file.name}
                            </h4>
                            <span className="folder-meta">
                              {formatBytes(file.size)} • {new Date(file.updatedAt).toLocaleDateString()}
                            </span>
                          </div>
                        </div>

                        <div style={{ display: 'flex', gap: '0.25rem', padding: '0.5rem' }}>
                          {canDownload && (
                            <button
                              className="folder-menu-btn"
                              onClick={() => handleDownload(file._id, file.name, folderPermission)}
                              title="Download"
                            >
                              <Download size={15} />
                            </button>
                          )}
                          {canEdit && (
                            <button
                              className="folder-menu-btn"
                              onClick={() => {
                                setRenameTarget({ type: 'FILE', id: file._id, currentName: file.name });
                                setRenameVal(file.name);
                              }}
                              title="Rename"
                            >
                              <Edit2 size={15} />
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="file-list-view">
            <div className="file-list-header">
              <div style={{ flex: 2 }}>Name</div>
              <div style={{ flex: 1 }}>Owner</div>
              <div style={{ flex: 1 }}>Permission</div>
              <div style={{ flex: 1 }}>Size</div>
              <div style={{ flex: 1 }}>Date Shared</div>
              <div style={{ width: '80px', textAlign: 'right' }}>Actions</div>
            </div>

            {!routeFolderId ? (
              filteredSharedItems.map((item) => {
                const isFolder = item.resourceType === 'FOLDER';
                const canDownload = !isFolder && item.effectivePermission !== 'VIEW';
                const canEdit = item.effectivePermission === 'EDIT' || item.effectivePermission === 'OWNER';

                return (
                  <div
                    key={item.shareId}
                    className="file-list-row"
                    onClick={() => {
                      if (isFolder) navigate(`/shared/${item.resourceId}`);
                      else handleDownload(item.resourceId, item.name, item.effectivePermission);
                    }}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      {isFolder ? <FolderIcon size={20} color="#F59E0B" /> : renderFileIcon(item.mimeType, item.name)}
                      <span style={{ fontWeight: 600, color: '#FFF' }}>{item.name}</span>
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>
                      {item.owner.name}
                    </div>
                    <div style={{ flex: 1 }}>
                      {renderPermissionBadge(item.effectivePermission || item.permission)}
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {isFolder ? '—' : formatBytes(item.size || 0)}
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {new Date(item.createdAt).toLocaleDateString()}
                    </div>
                    <div style={{ width: '80px', display: 'flex', justifyContent: 'flex-end', gap: '0.25rem' }}>
                      {canDownload && (
                        <button
                          className="folder-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDownload(item.resourceId, item.name, item.effectivePermission);
                          }}
                          title="Download"
                        >
                          <Download size={14} />
                        </button>
                      )}
                      {canEdit && (
                        <button
                          className="folder-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameTarget({
                              type: isFolder ? 'FOLDER' : 'FILE',
                              id: item.resourceId,
                              currentName: item.name,
                            });
                            setRenameVal(item.name);
                          }}
                          title="Rename"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })
            ) : (
              <>
                {filteredSubfolders.map((subfolder) => (
                  <div
                    key={subfolder._id}
                    className="file-list-row"
                    onClick={() => navigate(`/shared/${subfolder._id}`)}
                    style={{ cursor: 'pointer' }}
                  >
                    <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                      <FolderIcon size={20} color="#F59E0B" />
                      <span style={{ fontWeight: 600, color: '#FFF' }}>{subfolder.name}</span>
                    </div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>Folder</div>
                    <div style={{ flex: 1 }}>{renderPermissionBadge(folderPermission)}</div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>—</div>
                    <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                      {new Date(subfolder.updatedAt).toLocaleDateString()}
                    </div>
                    <div style={{ width: '80px', display: 'flex', justifyContent: 'flex-end' }}>
                      {(folderPermission === 'EDIT' || folderPermission === 'OWNER') && (
                        <button
                          className="folder-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenameTarget({ type: 'FOLDER', id: subfolder._id, currentName: subfolder.name });
                            setRenameVal(subfolder.name);
                          }}
                          title="Rename"
                        >
                          <Edit2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                ))}

                {filteredFiles.map((file) => {
                  const canDownload = folderPermission !== 'VIEW';
                  const canEdit = folderPermission === 'EDIT' || folderPermission === 'OWNER';

                  return (
                    <div
                      key={file._id}
                      className="file-list-row"
                      onClick={() => handleDownload(file._id, file.name, folderPermission)}
                      style={{ cursor: 'pointer' }}
                    >
                      <div style={{ flex: 2, display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                        {renderFileIcon(file.mimeType, file.name)}
                        <span style={{ fontWeight: 600, color: '#FFF' }}>{file.name}</span>
                      </div>
                      <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-secondary)' }}>File</div>
                      <div style={{ flex: 1 }}>{renderPermissionBadge(folderPermission)}</div>
                      <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {formatBytes(file.size)}
                      </div>
                      <div style={{ flex: 1, fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
                        {new Date(file.updatedAt).toLocaleDateString()}
                      </div>
                      <div style={{ width: '80px', display: 'flex', justifyContent: 'flex-end', gap: '0.25rem' }}>
                        {canDownload && (
                          <button
                            className="folder-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDownload(file._id, file.name, folderPermission);
                            }}
                            title="Download"
                          >
                            <Download size={14} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            className="folder-menu-btn"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRenameTarget({ type: 'FILE', id: file._id, currentName: file.name });
                              setRenameVal(file.name);
                            }}
                            title="Rename"
                          >
                            <Edit2 size={14} />
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        )}
      </main>

      {/* Rename Modal */}
      {renameTarget && (
        <div className="modal-backdrop" onClick={() => setRenameTarget(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Rename {renameTarget.type === 'FILE' ? 'File' : 'Folder'}</h3>
              <button className="modal-close-btn" onClick={() => setRenameTarget(null)}>
                <X size={18} />
              </button>
            </div>
            {renameError && (
              <div className="auth-alert" style={{ marginBottom: '1rem' }}>
                <AlertCircle size={16} />
                <span>{renameError}</span>
              </div>
            )}
            <form onSubmit={handleRenameSubmit}>
              <div className="input-group">
                <input
                  type="text"
                  className="auth-input"
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  placeholder="New name..."
                  autoFocus
                  required
                />
              </div>
              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setRenameTarget(null)}
                  disabled={renameLoading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={renameLoading}>
                  {renameLoading ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
                  <span>Save</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

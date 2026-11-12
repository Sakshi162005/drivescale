import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import {
  Trash2,
  Folder as FolderIcon,
  RotateCcw,
  AlertTriangle,
  Loader2,
  HardDrive,
  Cloud,
  LogOut,
  Users,
  Grid,
  List,
  Search,
  File as FileDocIcon,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Code,
  CheckCircle2,
  X,
} from 'lucide-react';
import { trashService } from '../services/trash.service.js';
import { useAuthStore } from '../stores/auth.store.js';
import { TrashItem, TrashPaginationMeta } from '../types/trash.types.js';

export const Trash: React.FC = () => {
  const navigate = useNavigate();
  const { user, isAuthenticated, isLoading: authLoading, logout, initAuth } = useAuthStore();

  const [items, setItems] = useState<TrashItem[]>([]);
  const [pagination, setPagination] = useState<TrashPaginationMeta>({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 1,
    hasNextPage: false,
    hasPrevPage: false,
  });

  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  const [typeFilter, setTypeFilter] = useState<'all' | 'file' | 'folder'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [currentPage, setCurrentPage] = useState(1);

  // Modals state
  const [showEmptyTrashModal, setShowEmptyTrashModal] = useState(false);
  const [itemToDeletePermanently, setItemToDeletePermanently] = useState<TrashItem | null>(null);

  // Check auth
  useEffect(() => {
    initAuth();
  }, [initAuth]);

  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Fetch trash items
  const fetchTrashItems = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await trashService.listTrash({
        type: typeFilter,
        page: currentPage,
        limit: 50,
      });

      if (res.success && res.data) {
        setItems(res.data.items);
        setPagination(res.data.pagination);
      } else {
        setError(res.error?.message || 'Failed to load trash items');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error connecting to server');
    } finally {
      setLoading(false);
    }
  }, [typeFilter, currentPage]);

  useEffect(() => {
    if (isAuthenticated) {
      fetchTrashItems();
    }
  }, [isAuthenticated, fetchTrashItems]);

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatDate = (dateStr: string): string => {
    try {
      const date = new Date(dateStr);
      return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
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

  // Handle Restore
  const handleRestore = async (item: TrashItem) => {
    setActionLoading(true);
    setNotification(null);
    try {
      const res = await trashService.restoreItem(item._id);
      if (res.success) {
        setNotification({
          type: 'success',
          message: `"${item.name}" restored to ${item.originalLocationName || 'My Drive'}.`,
        });
        await fetchTrashItems();
        // Refresh auth profile for storage stats update
        await initAuth();
      } else {
        setNotification({
          type: 'error',
          message: res.error?.message || `Failed to restore "${item.name}".`,
        });
      }
    } catch (err: unknown) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error restoring item.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Permanent Delete Item
  const handlePermanentDelete = async () => {
    if (!itemToDeletePermanently) return;
    setActionLoading(true);
    setNotification(null);
    try {
      const res = await trashService.permanentlyDeleteItem(itemToDeletePermanently._id);
      if (res.success) {
        setNotification({
          type: 'success',
          message: `"${itemToDeletePermanently.name}" has been permanently deleted.`,
        });
        setItemToDeletePermanently(null);
        await fetchTrashItems();
        await initAuth();
      } else {
        setNotification({
          type: 'error',
          message: res.error?.message || `Failed to permanently delete "${itemToDeletePermanently.name}".`,
        });
      }
    } catch (err: unknown) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error permanently deleting item.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Handle Empty Trash
  const handleEmptyTrash = async () => {
    setActionLoading(true);
    setNotification(null);
    try {
      const res = await trashService.emptyTrash();
      if (res.success) {
        setNotification({
          type: 'success',
          message: 'Trash emptied successfully. All items permanently deleted.',
        });
        setShowEmptyTrashModal(false);
        await fetchTrashItems();
        await initAuth();
      } else {
        setNotification({
          type: 'error',
          message: res.error?.message || 'Failed to empty trash.',
        });
      }
    } catch (err: unknown) {
      setNotification({
        type: 'error',
        message: err instanceof Error ? err.message : 'Error emptying trash.',
      });
    } finally {
      setActionLoading(false);
    }
  };

  // Filter items by client search query
  const filteredItems = items.filter((item) => {
    if (!searchQuery.trim()) return true;
    return item.name.toLowerCase().includes(searchQuery.toLowerCase().trim());
  });

  return (
    <div className="app-container">
      {/* Top Header */}
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
            className="btn btn-secondary"
            style={{ fontSize: '0.8125rem', display: 'flex', alignItems: 'center', gap: '0.4rem' }}
          >
            <Users size={15} />
            <span>Shared with me</span>
          </Link>

          <Link
            to="/trash"
            className="btn btn-secondary"
            style={{
              fontSize: '0.8125rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
              borderColor: 'var(--accent-rose)',
              color: '#F87171',
            }}
          >
            <Trash2 size={15} />
            <span>Trash</span>
          </Link>

          <Link to="/" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
            System Status
          </Link>

          {user && (
            <div className="user-menu">
              <div className="user-badge">
                <div className="user-avatar">{user.name.charAt(0).toUpperCase()}</div>
                <div>
                  <div className="user-name">{user.name}</div>
                  <div className="user-email">
                    {formatBytes(user.storageUsed || 0)} used of {formatBytes(user.storageQuota || 10737418240)}
                  </div>
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

      {/* Page Title & Actions */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div>
          <h2 style={{ fontSize: '1.5rem', color: '#FFF', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Trash2 size={24} color="#EF4444" />
            <span>Trash</span>
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
            Items in trash are automatically deleted after 30 days. You can restore them to your drive or permanently delete them.
          </p>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <button
            className="btn"
            style={{
              background: 'rgba(239, 68, 68, 0.15)',
              color: '#F87171',
              border: '1px solid rgba(239, 68, 68, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: '0.4rem',
            }}
            onClick={() => setShowEmptyTrashModal(true)}
            disabled={items.length === 0 || loading || actionLoading}
          >
            <Trash2 size={16} />
            <span>Empty Trash</span>
          </button>
        </div>
      </div>

      {/* Notifications */}
      {notification && (
        <div
          style={{
            padding: '0.75rem 1rem',
            borderRadius: '8px',
            background: notification.type === 'success' ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)',
            border: `1px solid ${notification.type === 'success' ? 'rgba(16, 185, 129, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
            color: notification.type === 'success' ? '#34D399' : '#F87171',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: '0.875rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            {notification.type === 'success' ? <CheckCircle2 size={18} /> : <AlertTriangle size={18} />}
            <span>{notification.message}</span>
          </div>
          <button
            onClick={() => setNotification(null)}
            style={{ background: 'transparent', border: 'none', color: 'inherit', cursor: 'pointer' }}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {/* Filter and View Toolbar */}
      <div className="drive-toolbar">
        {/* Type Filter Pills */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <button
            className={`btn ${typeFilter === 'all' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}
            onClick={() => {
              setTypeFilter('all');
              setCurrentPage(1);
            }}
          >
            All Items
          </button>
          <button
            className={`btn ${typeFilter === 'folder' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}
            onClick={() => {
              setTypeFilter('folder');
              setCurrentPage(1);
            }}
          >
            Folders
          </button>
          <button
            className={`btn ${typeFilter === 'file' ? 'btn-primary' : 'btn-secondary'}`}
            style={{ fontSize: '0.8125rem', padding: '0.35rem 0.75rem' }}
            onClick={() => {
              setTypeFilter('file');
              setCurrentPage(1);
            }}
          >
            Files
          </button>
        </div>

        {/* Search & View Toggle */}
        <div className="drive-actions">
          <div className="drive-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search in trash..."
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

      {/* Content Area */}
      <main className="drive-main" style={{ minHeight: '320px' }}>
        {loading ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '4rem 0' }}>
            <Loader2 size={36} className="animate-spin" color="var(--accent-primary)" />
          </div>
        ) : error ? (
          <div
            style={{
              padding: '2rem',
              textAlign: 'center',
              background: 'rgba(239, 68, 68, 0.1)',
              border: '1px solid rgba(239, 68, 68, 0.25)',
              borderRadius: '12px',
            }}
          >
            <AlertTriangle size={32} color="#EF4444" style={{ margin: '0 auto 0.75rem' }} />
            <p style={{ color: '#F87171', fontWeight: 500 }}>{error}</p>
            <button
              className="btn btn-secondary"
              style={{ marginTop: '1rem' }}
              onClick={() => fetchTrashItems()}
            >
              Retry
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '5rem 1rem',
              textAlign: 'center',
              background: 'var(--bg-card)',
              border: '1px dashed var(--border-subtle)',
              borderRadius: '16px',
            }}
          >
            <div
              style={{
                width: '64px',
                height: '64px',
                borderRadius: '50%',
                background: 'rgba(255, 255, 255, 0.03)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                marginBottom: '1rem',
              }}
            >
              <Trash2 size={32} color="var(--text-muted)" />
            </div>
            <h3 style={{ fontSize: '1.125rem', color: '#FFF', marginBottom: '0.25rem' }}>
              {searchQuery ? 'No matching items in trash' : 'Trash is empty'}
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--text-muted)', maxWidth: '360px' }}>
              {searchQuery
                ? `No trashed files or folders match "${searchQuery}".`
                : 'Items that you delete will show up here before they are permanently purged.'}
            </p>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
              gap: '1rem',
            }}
          >
            {filteredItems.map((item) => (
              <div
                key={item._id}
                className="folder-card file-card"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  padding: '1.25rem',
                  borderLeft: item.type === 'folder' ? '3px solid #818CF8' : '3px solid #6366F1',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: '0.75rem', marginBottom: '0.75rem' }}>
                    <div
                      className="file-icon-box"
                      style={{
                        padding: '0.5rem',
                        borderRadius: '10px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      {item.type === 'folder' ? (
                        <FolderIcon size={24} color="#818CF8" />
                      ) : (
                        renderFileIcon(item.mimeType, item.name)
                      )}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <h4
                        className="folder-name"
                        title={item.name}
                        style={{ fontSize: '0.9375rem', marginBottom: '0.2rem' }}
                      >
                        {item.name}
                      </h4>
                      <span
                        style={{
                          display: 'inline-block',
                          fontSize: '0.7rem',
                          fontWeight: 600,
                          textTransform: 'uppercase',
                          color: item.type === 'folder' ? '#A5B4FC' : '#94A3B8',
                          background: 'rgba(255, 255, 255, 0.05)',
                          padding: '0.15rem 0.4rem',
                          borderRadius: '4px',
                        }}
                      >
                        {item.type}
                      </span>
                    </div>
                  </div>

                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                    <div>
                      <span>Original location: </span>
                      <strong style={{ color: 'var(--text-secondary)' }}>{item.originalLocationName}</strong>
                    </div>
                    <div>
                      <span>Deleted: </span>
                      <span>{formatDate(item.deletedAt)}</span>
                    </div>
                    {item.type === 'file' && (
                      <div>
                        <span>Size: </span>
                        <span>{formatBytes(item.size)}</span>
                      </div>
                    )}
                  </div>
                </div>

                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'flex-end',
                    gap: '0.5rem',
                    marginTop: '1rem',
                    paddingTop: '0.75rem',
                    borderTop: '1px solid var(--border-subtle)',
                  }}
                >
                  <button
                    className="btn btn-secondary"
                    style={{ fontSize: '0.75rem', padding: '0.35rem 0.65rem', display: 'flex', alignItems: 'center', gap: '0.3rem' }}
                    onClick={() => handleRestore(item)}
                    disabled={actionLoading}
                    title="Restore item to original location"
                  >
                    <RotateCcw size={14} />
                    <span>Restore</span>
                  </button>

                  <button
                    className="btn"
                    style={{
                      fontSize: '0.75rem',
                      padding: '0.35rem 0.65rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.3rem',
                      background: 'rgba(239, 68, 68, 0.12)',
                      color: '#F87171',
                      border: '1px solid rgba(239, 68, 68, 0.25)',
                    }}
                    onClick={() => setItemToDeletePermanently(item)}
                    disabled={actionLoading}
                    title="Permanently delete this item"
                  >
                    <Trash2 size={14} />
                    <span>Delete Forever</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="folder-list">
            <div
              className="folder-list-header"
              style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 160px' }}
            >
              <div>Name</div>
              <div>Original Location</div>
              <div>Deleted Date</div>
              <div>Size</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            {filteredItems.map((item) => (
              <div
                key={item._id}
                className="folder-list-row"
                style={{ gridTemplateColumns: '2fr 1.5fr 1fr 1fr 160px' }}
              >
                <div className="list-name-col">
                  {item.type === 'folder' ? (
                    <FolderIcon size={18} color="#818CF8" />
                  ) : (
                    renderFileIcon(item.mimeType, item.name)
                  )}
                  <span className="list-folder-name" title={item.name}>
                    {item.name}
                  </span>
                  <span
                    style={{
                      fontSize: '0.65rem',
                      textTransform: 'uppercase',
                      padding: '0.1rem 0.35rem',
                      borderRadius: '4px',
                      background: 'rgba(255, 255, 255, 0.06)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {item.type}
                  </span>
                </div>

                <div className="list-date-col" style={{ color: 'var(--text-secondary)' }}>
                  {item.originalLocationName}
                </div>

                <div className="list-date-col">
                  {formatDate(item.deletedAt)}
                </div>

                <div className="list-date-col">
                  {item.type === 'file' ? formatBytes(item.size) : '—'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '0.4rem' }}>
                  <button
                    className="icon-action-btn"
                    onClick={() => handleRestore(item)}
                    disabled={actionLoading}
                    title="Restore item"
                    style={{ color: '#818CF8' }}
                  >
                    <RotateCcw size={15} />
                  </button>
                  <button
                    className="icon-action-btn danger"
                    onClick={() => setItemToDeletePermanently(item)}
                    disabled={actionLoading}
                    title="Permanently delete item"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination Controls */}
        {pagination.totalPages > 1 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: '1.5rem',
              paddingTop: '1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontSize: '0.8125rem',
              color: 'var(--text-muted)',
            }}
          >
            <div>
              Showing Page {pagination.page} of {pagination.totalPages} ({pagination.total} total items)
            </div>
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                disabled={!pagination.hasPrevPage || loading}
                onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              >
                Previous
              </button>
              <button
                className="btn btn-secondary"
                disabled={!pagination.hasNextPage || loading}
                onClick={() => setCurrentPage((p) => p + 1)}
                style={{ fontSize: '0.75rem', padding: '0.35rem 0.75rem' }}
              >
                Next
              </button>
            </div>
          </div>
        )}
      </main>

      {/* Empty Trash Confirmation Modal */}
      {showEmptyTrashModal && (
        <div className="modal-backdrop" onClick={() => setShowEmptyTrashModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={20} color="#EF4444" />
                <h3 className="modal-title">Empty Trash?</h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setShowEmptyTrashModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Are you sure you want to empty the trash? All items, including historical file versions and subfolders, will be permanently deleted and cannot be recovered.
            </p>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setShowEmptyTrashModal(false)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="btn"
                style={{
                  background: 'var(--accent-rose)',
                  color: '#FFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
                onClick={handleEmptyTrash}
                disabled={actionLoading}
              >
                {actionLoading && <Loader2 size={15} className="animate-spin" />}
                <span>Empty Trash</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Permanently Delete Item Modal */}
      {itemToDeletePermanently && (
        <div className="modal-backdrop" onClick={() => setItemToDeletePermanently(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <AlertTriangle size={20} color="#EF4444" />
                <h3 className="modal-title">Delete Permanently?</h3>
              </div>
              <button
                className="modal-close-btn"
                onClick={() => setItemToDeletePermanently(null)}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '1.25rem' }}>
              Are you sure you want to permanently delete{' '}
              <strong style={{ color: '#FFF' }}>"{itemToDeletePermanently.name}"</strong>?
              {itemToDeletePermanently.type === 'folder'
                ? ' This folder and all its contents will be permanently erased.'
                : ' All data and version history for this file will be permanently erased.'}{' '}
              This action cannot be undone.
            </p>

            <div className="modal-actions">
              <button
                className="btn btn-secondary"
                onClick={() => setItemToDeletePermanently(null)}
                disabled={actionLoading}
              >
                Cancel
              </button>
              <button
                className="btn"
                style={{
                  background: 'var(--accent-rose)',
                  color: '#FFF',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                }}
                onClick={handlePermanentDelete}
                disabled={actionLoading}
              >
                {actionLoading && <Loader2 size={15} className="animate-spin" />}
                <span>Delete Permanently</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

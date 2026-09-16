import React, { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  Folder as FolderIcon,
  FolderPlus,
  ChevronRight,
  MoreVertical,
  Edit2,
  FolderInput,
  Trash2,
  Grid,
  List,
  Search,
  AlertCircle,
  Loader2,
  HardDrive,
  Cloud,
  LogOut,
  X,
  Check,
} from 'lucide-react';
import { folderService } from '../services/folder.service.js';
import { useAuthStore } from '../stores/auth.store.js';
import { Folder, BreadcrumbItem } from '../types/folder.types.js';

export const Drive: React.FC = () => {
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const activeFolderId = routeFolderId || 'root';
  const navigate = useNavigate();

  const { user, isAuthenticated, isLoading: authLoading, logout } = useAuthStore();

  const [currentFolder, setCurrentFolder] = useState<{ _id: string; name: string; isRoot?: boolean } | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [childFolders, setChildFolders] = useState<Folder[]>([]);
  const [allUserFolders, setAllUserFolders] = useState<Folder[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [renameVal, setRenameVal] = useState('');
  const [renameLoading, setRenameLoading] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);

  const [folderToMove, setFolderToMove] = useState<Folder | null>(null);
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null);
  const [moveLoading, setMoveLoading] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);

  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Authentication check
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Load folder details and children
  const loadFolderData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [folderRes, childrenRes] = await Promise.all([
        folderService.getFolder(activeFolderId),
        folderService.getFolderChildren(activeFolderId),
      ]);

      if (folderRes.success && folderRes.data) {
        setCurrentFolder(folderRes.data.folder);
        setBreadcrumbs(folderRes.data.breadcrumbs || []);
      } else {
        setError(folderRes.error?.message || 'Folder not found');
      }

      if (childrenRes.success && childrenRes.data) {
        setChildFolders(childrenRes.data.folders || []);
      } else {
        setError(childrenRes.error?.message || 'Failed to load child folders');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Error loading folder data');
    } finally {
      setLoading(false);
    }
  }, [activeFolderId]);

  useEffect(() => {
    if (isAuthenticated) {
      loadFolderData();
    }
  }, [isAuthenticated, loadFolderData]);

  // Load all user folders for move destination picker
  const loadAllFolders = async () => {
    try {
      const res = await folderService.getAllFolders();
      if (res.success && res.data) {
        setAllUserFolders(res.data.folders || []);
      }
    } catch {
      // Fallback
    }
  };

  // Create folder handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreateLoading(true);
    setCreateError(null);
    try {
      const res = await folderService.createFolder({
        name: newFolderName.trim(),
        parentId: activeFolderId === 'root' ? null : activeFolderId,
      });

      if (res.success) {
        setShowCreateModal(false);
        setNewFolderName('');
        loadFolderData();
      } else {
        setCreateError(res.error?.message || 'Failed to create folder');
      }
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : 'Error creating folder');
    } finally {
      setCreateLoading(false);
    }
  };

  // Rename folder handler
  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderToRename || !renameVal.trim()) return;
    setRenameLoading(true);
    setRenameError(null);
    try {
      const res = await folderService.renameFolder(folderToRename._id, renameVal.trim());
      if (res.success) {
        setFolderToRename(null);
        loadFolderData();
      } else {
        setRenameError(res.error?.message || 'Failed to rename folder');
      }
    } catch (err: unknown) {
      setRenameError(err instanceof Error ? err.message : 'Error renaming folder');
    } finally {
      setRenameLoading(false);
    }
  };

  // Move folder handler
  const handleMoveFolder = async () => {
    if (!folderToMove) return;
    setMoveLoading(true);
    setMoveError(null);
    try {
      const res = await folderService.moveFolder(
        folderToMove._id,
        selectedTargetId === 'root' ? null : selectedTargetId
      );

      if (res.success) {
        setFolderToMove(null);
        loadFolderData();
      } else {
        setMoveError(res.error?.message || 'Failed to move folder');
      }
    } catch (err: unknown) {
      setMoveError(err instanceof Error ? err.message : 'Error moving folder');
    } finally {
      setMoveLoading(false);
    }
  };

  // Delete folder handler
  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;
    setDeleteLoading(true);
    setDeleteError(null);
    try {
      const res = await folderService.deleteFolder(folderToDelete._id);
      if (res.success) {
        setFolderToDelete(null);
        loadFolderData();
      } else {
        setDeleteError(res.error?.message || 'Failed to delete folder');
      }
    } catch (err: unknown) {
      setDeleteError(err instanceof Error ? err.message : 'Error deleting folder');
    } finally {
      setDeleteLoading(false);
    }
  };

  // Filtered children
  const filteredFolders = childFolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Compute all descendant folder IDs to prevent moving into self or subfolders
  const invalidDestinationIds = React.useMemo(() => {
    if (!folderToMove) return new Set<string>();
    const descendants = new Set<string>([folderToMove._id]);
    const queue = [folderToMove._id];
    while (queue.length > 0) {
      const current = queue.shift()!;
      for (const f of allUserFolders) {
        if (f.parentId === current && !descendants.has(f._id)) {
          descendants.add(f._id);
          queue.push(f._id);
        }
      }
    }
    return descendants;
  }, [folderToMove, allUserFolders]);

  return (
    <div className="app-container" onClick={() => setOpenDropdownId(null)}>
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

        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link to="/" className="btn btn-secondary" style={{ fontSize: '0.8125rem' }}>
            System Status
          </Link>

          {user && (
            <div className="user-menu">
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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h2 style={{ fontSize: '1.5rem', color: '#FFF' }}>
          {currentFolder?.name || 'My Drive'}
        </h2>
      </div>

      {/* Explorer Top Toolbar */}
      <div className="drive-toolbar">
        {/* Breadcrumbs */}
        <nav className="breadcrumbs-trail">
          <button
            className={`breadcrumb-item ${activeFolderId === 'root' ? 'active' : ''}`}
            onClick={() => navigate('/drive')}
          >
            <HardDrive size={16} />
            <span>My Drive</span>
          </button>

          {breadcrumbs.map((crumb, idx) => (
            <React.Fragment key={crumb._id}>
              <ChevronRight size={14} className="breadcrumb-separator" />
              <button
                className={`breadcrumb-item ${idx === breadcrumbs.length - 1 ? 'active' : ''}`}
                onClick={() => navigate(`/drive/${crumb._id}`)}
              >
                <span>{crumb.name}</span>
              </button>
            </React.Fragment>
          ))}
        </nav>

        {/* Toolbar Actions */}
        <div className="drive-actions">
          <div className="drive-search">
            <Search size={16} className="search-icon" />
            <input
              type="text"
              placeholder="Search folders..."
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

          <button
            className="btn btn-primary"
            onClick={(e) => {
              e.stopPropagation();
              setShowCreateModal(true);
            }}
          >
            <FolderPlus size={16} />
            <span>New Folder</span>
          </button>
        </div>
      </div>

      {/* Main Content Area */}
      <main className="drive-main">
        {error && (
          <div className="auth-alert" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}

        {loading ? (
          <div className="drive-loading">
            <Loader2 size={36} className="animate-spin" color="#6366F1" />
            <p>Loading folders...</p>
          </div>
        ) : filteredFolders.length === 0 ? (
          <div className="drive-empty">
            <div className="empty-icon-wrapper">
              <FolderIcon size={48} />
            </div>
            <h3 className="empty-title">
              {searchQuery ? 'No matching folders found' : 'This folder is empty'}
            </h3>
            <p className="empty-desc">
              {searchQuery
                ? 'Try a different search query'
                : 'Create folders to organize and structure your files.'}
            </p>
            {!searchQuery && (
              <button
                className="btn btn-primary"
                onClick={() => setShowCreateModal(true)}
              >
                <FolderPlus size={16} />
                Create New Folder
              </button>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="folder-grid">
            {filteredFolders.map((folder) => (
              <div
                key={folder._id}
                className="folder-card"
                onDoubleClick={() => navigate(`/drive/${folder._id}`)}
              >
                <div
                  className="folder-card-clickable"
                  onClick={() => navigate(`/drive/${folder._id}`)}
                >
                  <div className="folder-icon-box">
                    <FolderIcon size={24} />
                  </div>
                  <div className="folder-info">
                    <h4 className="folder-name" title={folder.name}>
                      {folder.name}
                    </h4>
                    <span className="folder-meta">
                      {new Date(folder.updatedAt).toLocaleDateString(undefined, {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>

                <div className="folder-dropdown-container">
                  <button
                    className="folder-menu-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenDropdownId(openDropdownId === folder._id ? null : folder._id);
                    }}
                    title="Folder options"
                  >
                    <MoreVertical size={16} />
                  </button>

                  {openDropdownId === folder._id && (
                    <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setFolderToRename(folder);
                          setRenameVal(folder.name);
                          setOpenDropdownId(null);
                        }}
                      >
                        <Edit2 size={14} />
                        <span>Rename</span>
                      </button>
                      <button
                        className="dropdown-item"
                        onClick={() => {
                          setFolderToMove(folder);
                          setSelectedTargetId(folder.parentId || 'root');
                          loadAllFolders();
                          setOpenDropdownId(null);
                        }}
                      >
                        <FolderInput size={14} />
                        <span>Move</span>
                      </button>
                      <button
                        className="dropdown-item danger"
                        onClick={() => {
                          setFolderToDelete(folder);
                          setOpenDropdownId(null);
                        }}
                      >
                        <Trash2 size={14} />
                        <span>Delete</span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        ) : (
          /* List View */
          <div className="folder-list">
            <div className="folder-list-header">
              <span>Name</span>
              <span>Modified</span>
              <span>Actions</span>
            </div>
            {filteredFolders.map((folder) => (
              <div
                key={folder._id}
                className="folder-list-row"
                onDoubleClick={() => navigate(`/drive/${folder._id}`)}
              >
                <div
                  className="list-name-col"
                  onClick={() => navigate(`/drive/${folder._id}`)}
                >
                  <FolderIcon size={18} className="list-folder-icon" />
                  <span className="list-folder-name">{folder.name}</span>
                </div>
                <div className="list-date-col">
                  {new Date(folder.updatedAt).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                    year: 'numeric',
                  })}
                </div>
                <div className="list-actions-col">
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFolderToRename(folder);
                      setRenameVal(folder.name);
                    }}
                    title="Rename"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFolderToMove(folder);
                      setSelectedTargetId(folder.parentId || 'root');
                      loadAllFolders();
                    }}
                    title="Move"
                  >
                    <FolderInput size={14} />
                  </button>
                  <button
                    className="icon-action-btn danger"
                    onClick={() => setFolderToDelete(folder)}
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Modal: Create Folder */}
      {showCreateModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New Folder</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowCreateModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {createError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{createError}</span>
              </div>
            )}

            <form onSubmit={handleCreateFolder}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" htmlFor="folderName">
                  Folder Name
                </label>
                <input
                  id="folderName"
                  type="text"
                  className="form-input"
                  placeholder="e.g. Project Assets"
                  value={newFolderName}
                  onChange={(e) => setNewFolderName(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowCreateModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createLoading || !newFolderName.trim()}
                >
                  {createLoading ? 'Creating...' : 'Create Folder'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Rename Folder */}
      {folderToRename && (
        <div className="modal-backdrop" onClick={() => setFolderToRename(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Rename Folder</h3>
              <button
                className="modal-close-btn"
                onClick={() => setFolderToRename(null)}
              >
                <X size={18} />
              </button>
            </div>

            {renameError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{renameError}</span>
              </div>
            )}

            <form onSubmit={handleRenameFolder}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" htmlFor="renameInput">
                  Folder Name
                </label>
                <input
                  id="renameInput"
                  type="text"
                  className="form-input"
                  value={renameVal}
                  onChange={(e) => setRenameVal(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFolderToRename(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={renameLoading || !renameVal.trim()}
                >
                  {renameLoading ? 'Renaming...' : 'Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Move Folder */}
      {folderToMove && (
        <div className="modal-backdrop" onClick={() => setFolderToMove(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Move &quot;{folderToMove.name}&quot;</h3>
              <button
                className="modal-close-btn"
                onClick={() => setFolderToMove(null)}
              >
                <X size={18} />
              </button>
            </div>

            {moveError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{moveError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Select the destination folder:
            </p>

            <div className="destination-tree">
              <div
                className={`destination-item ${selectedTargetId === 'root' || selectedTargetId === null ? 'selected' : ''}`}
                onClick={() => setSelectedTargetId('root')}
              >
                <HardDrive size={16} />
                <span>My Drive (Root)</span>
                {(selectedTargetId === 'root' || selectedTargetId === null) && <Check size={14} />}
              </div>

              {allUserFolders
                .filter((f) => !invalidDestinationIds.has(f._id))
                .map((target) => (
                  <div
                    key={target._id}
                    className={`destination-item ${selectedTargetId === target._id ? 'selected' : ''}`}
                    onClick={() => setSelectedTargetId(target._id)}
                  >
                    <FolderIcon size={16} />
                    <span>{target.name}</span>
                    {selectedTargetId === target._id && <Check size={14} />}
                  </div>
                ))}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFolderToMove(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleMoveFolder}
                disabled={moveLoading}
              >
                {moveLoading ? 'Moving...' : 'Move Here'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Confirmation */}
      {folderToDelete && (
        <div className="modal-backdrop" onClick={() => setFolderToDelete(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-rose)' }}>
                Delete Folder
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setFolderToDelete(null)}
              >
                <X size={18} />
              </button>
            </div>

            {deleteError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{deleteError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Are you sure you want to delete <strong>&quot;{folderToDelete.name}&quot;</strong>?
            </p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              This will also delete all subfolders contained inside it.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFolderToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--accent-rose)' }}
                onClick={handleDeleteFolder}
                disabled={deleteLoading}
              >
                {deleteLoading ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

import React, { useEffect, useState, useCallback, useRef } from 'react';
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
  Upload,
  Download,
  File as FileDocIcon,
  FileText,
  Image,
  Film,
  Music,
  Archive,
  Code,
} from 'lucide-react';
import { folderService } from '../services/folder.service.js';
import { fileService } from '../services/file.service.js';
import { useAuthStore } from '../stores/auth.store.js';
import { Folder, BreadcrumbItem } from '../types/folder.types.js';
import { FileItem } from '../types/file.types.js';

export const Drive: React.FC = () => {
  const { folderId: routeFolderId } = useParams<{ folderId?: string }>();
  const activeFolderId = routeFolderId || 'root';
  const navigate = useNavigate();

  const { user, isAuthenticated, isLoading: authLoading, logout, initAuth } = useAuthStore();

  const [currentFolder, setCurrentFolder] = useState<{ _id: string; name: string; isRoot?: boolean } | null>(null);
  const [breadcrumbs, setBreadcrumbs] = useState<BreadcrumbItem[]>([]);
  const [childFolders, setChildFolders] = useState<Folder[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [allUserFolders, setAllUserFolders] = useState<Folder[]>([]);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');

  // Upload state
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadLoading, setUploadLoading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Folder modals state
  const [showCreateFolderModal, setShowCreateFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [createFolderLoading, setCreateFolderLoading] = useState(false);
  const [createFolderError, setCreateFolderError] = useState<string | null>(null);

  const [folderToRename, setFolderToRename] = useState<Folder | null>(null);
  const [renameFolderVal, setRenameFolderVal] = useState('');
  const [renameFolderLoading, setRenameFolderLoading] = useState(false);
  const [renameFolderError, setRenameFolderError] = useState<string | null>(null);

  const [folderToMove, setFolderToMove] = useState<Folder | null>(null);
  const [selectedFolderTargetId, setSelectedFolderTargetId] = useState<string | null>(null);
  const [moveFolderLoading, setMoveFolderLoading] = useState(false);
  const [moveFolderError, setMoveFolderError] = useState<string | null>(null);

  const [folderToDelete, setFolderToDelete] = useState<Folder | null>(null);
  const [deleteFolderLoading, setDeleteFolderLoading] = useState(false);
  const [deleteFolderError, setDeleteFolderError] = useState<string | null>(null);

  // File modals state
  const [fileToRename, setFileToRename] = useState<FileItem | null>(null);
  const [renameFileVal, setRenameFileVal] = useState('');
  const [renameFileLoading, setRenameFileLoading] = useState(false);
  const [renameFileError, setRenameFileError] = useState<string | null>(null);

  const [fileToMove, setFileToMove] = useState<FileItem | null>(null);
  const [selectedFileTargetId, setSelectedFileTargetId] = useState<string | null>(null);
  const [moveFileLoading, setMoveFileLoading] = useState(false);
  const [moveFileError, setMoveFileError] = useState<string | null>(null);

  const [fileToDelete, setFileToDelete] = useState<FileItem | null>(null);
  const [deleteFileLoading, setDeleteFileLoading] = useState(false);
  const [deleteFileError, setDeleteFileError] = useState<string | null>(null);

  const [openDropdownId, setOpenDropdownId] = useState<string | null>(null);

  // Authentication check
  useEffect(() => {
    if (!authLoading && !isAuthenticated) {
      navigate('/login');
    }
  }, [authLoading, isAuthenticated, navigate]);

  // Load folder details, children folders, and files
  const loadFolderData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [folderRes, childrenRes, filesRes] = await Promise.all([
        folderService.getFolder(activeFolderId),
        folderService.getFolderChildren(activeFolderId),
        fileService.listFiles({ folderId: activeFolderId, limit: 100 }),
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

      if (filesRes.success && filesRes.data) {
        setFiles(filesRes.data.files || []);
      } else {
        setError(filesRes.error?.message || 'Failed to load files');
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

  // Upload file handler
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;

    setUploadLoading(true);
    setUploadError(null);
    try {
      const res = await fileService.uploadFile(selectedFile, activeFolderId);
      if (res.success) {
        // Refresh folder files and user storage
        await Promise.all([loadFolderData(), initAuth()]);
      } else {
        setUploadError(res.error?.message || 'Failed to upload file');
      }
    } catch (err: unknown) {
      setUploadError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploadLoading(false);
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    }
  };

  // Download file handler
  const handleDownloadFile = async (file: FileItem) => {
    try {
      await fileService.downloadFile(file._id, file.name);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  };

  // Create folder handler
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    setCreateFolderLoading(true);
    setCreateFolderError(null);
    try {
      const res = await folderService.createFolder({
        name: newFolderName.trim(),
        parentId: activeFolderId === 'root' ? null : activeFolderId,
      });

      if (res.success) {
        setShowCreateFolderModal(false);
        setNewFolderName('');
        loadFolderData();
      } else {
        setCreateFolderError(res.error?.message || 'Failed to create folder');
      }
    } catch (err: unknown) {
      setCreateFolderError(err instanceof Error ? err.message : 'Error creating folder');
    } finally {
      setCreateFolderLoading(false);
    }
  };

  // Rename folder handler
  const handleRenameFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!folderToRename || !renameFolderVal.trim()) return;
    setRenameFolderLoading(true);
    setRenameFolderError(null);
    try {
      const res = await folderService.renameFolder(folderToRename._id, renameFolderVal.trim());
      if (res.success) {
        setFolderToRename(null);
        loadFolderData();
      } else {
        setRenameFolderError(res.error?.message || 'Failed to rename folder');
      }
    } catch (err: unknown) {
      setRenameFolderError(err instanceof Error ? err.message : 'Error renaming folder');
    } finally {
      setRenameFolderLoading(false);
    }
  };

  // Move folder handler
  const handleMoveFolder = async () => {
    if (!folderToMove) return;
    setMoveFolderLoading(true);
    setMoveFolderError(null);
    try {
      const res = await folderService.moveFolder(
        folderToMove._id,
        selectedFolderTargetId === 'root' ? null : selectedFolderTargetId
      );

      if (res.success) {
        setFolderToMove(null);
        loadFolderData();
      } else {
        setMoveFolderError(res.error?.message || 'Failed to move folder');
      }
    } catch (err: unknown) {
      setMoveFolderError(err instanceof Error ? err.message : 'Error moving folder');
    } finally {
      setMoveFolderLoading(false);
    }
  };

  // Delete folder handler
  const handleDeleteFolder = async () => {
    if (!folderToDelete) return;
    setDeleteFolderLoading(true);
    setDeleteFolderError(null);
    try {
      const res = await folderService.deleteFolder(folderToDelete._id);
      if (res.success) {
        setFolderToDelete(null);
        loadFolderData();
      } else {
        setDeleteFolderError(res.error?.message || 'Failed to delete folder');
      }
    } catch (err: unknown) {
      setDeleteFolderError(err instanceof Error ? err.message : 'Error deleting folder');
    } finally {
      setDeleteFolderLoading(false);
    }
  };

  // Rename file handler
  const handleRenameFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fileToRename || !renameFileVal.trim()) return;
    setRenameFileLoading(true);
    setRenameFileError(null);
    try {
      const res = await fileService.renameFile(fileToRename._id, renameFileVal.trim());
      if (res.success) {
        setFileToRename(null);
        loadFolderData();
      } else {
        setRenameFileError(res.error?.message || 'Failed to rename file');
      }
    } catch (err: unknown) {
      setRenameFileError(err instanceof Error ? err.message : 'Error renaming file');
    } finally {
      setRenameFileLoading(false);
    }
  };

  // Move file handler
  const handleMoveFile = async () => {
    if (!fileToMove) return;
    setMoveFileLoading(true);
    setMoveFileError(null);
    try {
      const res = await fileService.moveFile(
        fileToMove._id,
        selectedFileTargetId === 'root' ? null : selectedFileTargetId
      );

      if (res.success) {
        setFileToMove(null);
        loadFolderData();
      } else {
        setMoveFileError(res.error?.message || 'Failed to move file');
      }
    } catch (err: unknown) {
      setMoveFileError(err instanceof Error ? err.message : 'Error moving file');
    } finally {
      setMoveFileLoading(false);
    }
  };

  // Delete file handler
  const handleDeleteFile = async () => {
    if (!fileToDelete) return;
    setDeleteFileLoading(true);
    setDeleteFileError(null);
    try {
      const res = await fileService.deleteFile(fileToDelete._id);
      if (res.success) {
        setFileToDelete(null);
        await Promise.all([loadFolderData(), initAuth()]);
      } else {
        setDeleteFileError(res.error?.message || 'Failed to delete file');
      }
    } catch (err: unknown) {
      setDeleteFileError(err instanceof Error ? err.message : 'Error deleting file');
    } finally {
      setDeleteFileLoading(false);
    }
  };

  // Filter items
  const filteredFolders = childFolders.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );
  const filteredFiles = files.filter((f) =>
    f.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Compute invalid destinations for folder move
  const invalidFolderDestinationIds = React.useMemo(() => {
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

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const renderFileIcon = (mimeType: string, fileName: string) => {
    if (mimeType.startsWith('image/')) return <Image size={22} color="#38BDF8" />;
    if (mimeType.startsWith('video/')) return <Film size={22} color="#F472B6" />;
    if (mimeType.startsWith('audio/')) return <Music size={22} color="#A78BFA" />;
    if (mimeType.includes('zip') || mimeType.includes('tar') || mimeType.includes('compressed')) return <Archive size={22} color="#FBBF24" />;
    if (mimeType.includes('pdf')) return <FileText size={22} color="#EF4444" />;
    if (mimeType.includes('json') || mimeType.includes('javascript') || mimeType.includes('typescript') || fileName.endsWith('.ts') || fileName.endsWith('.js')) return <Code size={22} color="#34D399" />;
    return <FileDocIcon size={22} color="#94A3B8" />;
  };

  const isEmpty = filteredFolders.length === 0 && filteredFiles.length === 0;

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

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
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
              placeholder="Search in folder..."
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

          {/* Hidden File Input */}
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: 'none' }}
            onChange={handleFileUpload}
          />

          <button
            className="btn btn-primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadLoading}
          >
            {uploadLoading ? (
              <Loader2 size={16} className="animate-spin" />
            ) : (
              <Upload size={16} />
            )}
            <span>{uploadLoading ? 'Uploading...' : 'Upload File'}</span>
          </button>

          <button
            className="btn btn-secondary"
            onClick={(e) => {
              e.stopPropagation();
              setShowCreateFolderModal(true);
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

        {uploadError && (
          <div className="auth-alert" style={{ marginBottom: '1.5rem' }}>
            <AlertCircle size={18} />
            <span>{uploadError}</span>
          </div>
        )}

        {loading ? (
          <div className="drive-loading">
            <Loader2 size={36} className="animate-spin" color="#6366F1" />
            <p>Loading folder contents...</p>
          </div>
        ) : isEmpty ? (
          <div className="drive-empty">
            <div className="empty-icon-wrapper">
              <HardDrive size={48} />
            </div>
            <h3 className="empty-title">
              {searchQuery ? 'No matching items found' : 'This folder is empty'}
            </h3>
            <p className="empty-desc">
              {searchQuery
                ? 'Try adjusting your search query.'
                : 'Upload files or create subfolders to start organizing your cloud storage.'}
            </p>
            {!searchQuery && (
              <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <Upload size={16} />
                  Upload First File
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowCreateFolderModal(true)}
                >
                  <FolderPlus size={16} />
                  New Folder
                </button>
              </div>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div style={{ display: 'flex', flexDirection: 'column', gap: '2rem' }}>
            {/* Folders Section */}
            {filteredFolders.length > 0 && (
              <div>
                <h3 className="section-title">Folders ({filteredFolders.length})</h3>
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
                            {new Date(folder.updatedAt).toLocaleDateString()}
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
                                setRenameFolderVal(folder.name);
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
                                setSelectedFolderTargetId(folder.parentId || 'root');
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
              </div>
            )}

            {/* Files Section */}
            {filteredFiles.length > 0 && (
              <div>
                <h3 className="section-title">Files ({filteredFiles.length})</h3>
                <div className="folder-grid">
                  {filteredFiles.map((file) => (
                    <div key={file._id} className="folder-card file-card">
                      <div
                        className="folder-card-clickable"
                        onClick={() => handleDownloadFile(file)}
                        title="Click to download"
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

                      <div className="folder-dropdown-container">
                        <button
                          className="folder-menu-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenDropdownId(openDropdownId === file._id ? null : file._id);
                          }}
                          title="File options"
                        >
                          <MoreVertical size={16} />
                        </button>

                        {openDropdownId === file._id && (
                          <div className="dropdown-menu" onClick={(e) => e.stopPropagation()}>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                handleDownloadFile(file);
                                setOpenDropdownId(null);
                              }}
                            >
                              <Download size={14} />
                              <span>Download</span>
                            </button>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                setFileToRename(file);
                                setRenameFileVal(file.name);
                                setOpenDropdownId(null);
                              }}
                            >
                              <Edit2 size={14} />
                              <span>Rename</span>
                            </button>
                            <button
                              className="dropdown-item"
                              onClick={() => {
                                setFileToMove(file);
                                setSelectedFileTargetId(file.folderId || 'root');
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
                                setFileToDelete(file);
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
              </div>
            )}
          </div>
        ) : (
          /* List View */
          <div className="folder-list">
            <div className="folder-list-header">
              <span>Name</span>
              <span>Size / Items</span>
              <span>Modified</span>
              <span>Actions</span>
            </div>

            {/* Folders in List */}
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
                <div className="list-date-col">Folder</div>
                <div className="list-date-col">
                  {new Date(folder.updatedAt).toLocaleDateString()}
                </div>
                <div className="list-actions-col">
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFolderToRename(folder);
                      setRenameFolderVal(folder.name);
                    }}
                    title="Rename"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFolderToMove(folder);
                      setSelectedFolderTargetId(folder.parentId || 'root');
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

            {/* Files in List */}
            {filteredFiles.map((file) => (
              <div key={file._id} className="folder-list-row">
                <div
                  className="list-name-col"
                  onClick={() => handleDownloadFile(file)}
                >
                  {renderFileIcon(file.mimeType, file.name)}
                  <span className="list-folder-name">{file.name}</span>
                </div>
                <div className="list-date-col">{formatBytes(file.size)}</div>
                <div className="list-date-col">
                  {new Date(file.updatedAt).toLocaleDateString()}
                </div>
                <div className="list-actions-col">
                  <button
                    className="icon-action-btn"
                    onClick={() => handleDownloadFile(file)}
                    title="Download"
                  >
                    <Download size={14} />
                  </button>
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFileToRename(file);
                      setRenameFileVal(file.name);
                    }}
                    title="Rename"
                  >
                    <Edit2 size={14} />
                  </button>
                  <button
                    className="icon-action-btn"
                    onClick={() => {
                      setFileToMove(file);
                      setSelectedFileTargetId(file.folderId || 'root');
                      loadAllFolders();
                    }}
                    title="Move"
                  >
                    <FolderInput size={14} />
                  </button>
                  <button
                    className="icon-action-btn danger"
                    onClick={() => setFileToDelete(file)}
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
      {showCreateFolderModal && (
        <div className="modal-backdrop" onClick={() => setShowCreateFolderModal(false)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Create New Folder</h3>
              <button
                className="modal-close-btn"
                onClick={() => setShowCreateFolderModal(false)}
              >
                <X size={18} />
              </button>
            </div>

            {createFolderError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{createFolderError}</span>
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
                  onClick={() => setShowCreateFolderModal(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={createFolderLoading || !newFolderName.trim()}
                >
                  {createFolderLoading ? 'Creating...' : 'Create Folder'}
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

            {renameFolderError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{renameFolderError}</span>
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
                  value={renameFolderVal}
                  onChange={(e) => setRenameFolderVal(e.target.value)}
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
                  disabled={renameFolderLoading || !renameFolderVal.trim()}
                >
                  {renameFolderLoading ? 'Renaming...' : 'Save Name'}
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

            {moveFolderError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{moveFolderError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Select the destination folder:
            </p>

            <div className="destination-tree">
              <div
                className={`destination-item ${selectedFolderTargetId === 'root' || selectedFolderTargetId === null ? 'selected' : ''}`}
                onClick={() => setSelectedFolderTargetId('root')}
              >
                <HardDrive size={16} />
                <span>My Drive (Root)</span>
                {(selectedFolderTargetId === 'root' || selectedFolderTargetId === null) && <Check size={14} />}
              </div>

              {allUserFolders
                .filter((f) => !invalidFolderDestinationIds.has(f._id))
                .map((target) => (
                  <div
                    key={target._id}
                    className={`destination-item ${selectedFolderTargetId === target._id ? 'selected' : ''}`}
                    onClick={() => setSelectedFolderTargetId(target._id)}
                  >
                    <FolderIcon size={16} />
                    <span>{target.name}</span>
                    {selectedFolderTargetId === target._id && <Check size={14} />}
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
                disabled={moveFolderLoading}
              >
                {moveFolderLoading ? 'Moving...' : 'Move Here'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete Folder Confirmation */}
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

            {deleteFolderError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{deleteFolderError}</span>
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
                disabled={deleteFolderLoading}
              >
                {deleteFolderLoading ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Rename File */}
      {fileToRename && (
        <div className="modal-backdrop" onClick={() => setFileToRename(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Rename File</h3>
              <button
                className="modal-close-btn"
                onClick={() => setFileToRename(null)}
              >
                <X size={18} />
              </button>
            </div>

            {renameFileError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{renameFileError}</span>
              </div>
            )}

            <form onSubmit={handleRenameFile}>
              <div className="form-group" style={{ marginBottom: '1.25rem' }}>
                <label className="form-label" htmlFor="renameFileInput">
                  File Name
                </label>
                <input
                  id="renameFileInput"
                  type="text"
                  className="form-input"
                  value={renameFileVal}
                  onChange={(e) => setRenameFileVal(e.target.value)}
                  autoFocus
                  required
                />
              </div>

              <div className="modal-actions">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setFileToRename(null)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={renameFileLoading || !renameFileVal.trim()}
                >
                  {renameFileLoading ? 'Renaming...' : 'Save Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modal: Move File */}
      {fileToMove && (
        <div className="modal-backdrop" onClick={() => setFileToMove(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Move &quot;{fileToMove.name}&quot;</h3>
              <button
                className="modal-close-btn"
                onClick={() => setFileToMove(null)}
              >
                <X size={18} />
              </button>
            </div>

            {moveFileError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{moveFileError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.875rem', color: 'var(--text-secondary)', marginBottom: '0.75rem' }}>
              Select destination folder:
            </p>

            <div className="destination-tree">
              <div
                className={`destination-item ${selectedFileTargetId === 'root' || selectedFileTargetId === null ? 'selected' : ''}`}
                onClick={() => setSelectedFileTargetId('root')}
              >
                <HardDrive size={16} />
                <span>My Drive (Root)</span>
                {(selectedFileTargetId === 'root' || selectedFileTargetId === null) && <Check size={14} />}
              </div>

              {allUserFolders.map((target) => (
                <div
                  key={target._id}
                  className={`destination-item ${selectedFileTargetId === target._id ? 'selected' : ''}`}
                  onClick={() => setSelectedFileTargetId(target._id)}
                >
                  <FolderIcon size={16} />
                  <span>{target.name}</span>
                  {selectedFileTargetId === target._id && <Check size={14} />}
                </div>
              ))}
            </div>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFileToMove(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                onClick={handleMoveFile}
                disabled={moveFileLoading}
              >
                {moveFileLoading ? 'Moving...' : 'Move Here'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal: Delete File Confirmation */}
      {fileToDelete && (
        <div className="modal-backdrop" onClick={() => setFileToDelete(null)}>
          <div className="modal-dialog" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title" style={{ color: 'var(--accent-rose)' }}>
                Delete File
              </h3>
              <button
                className="modal-close-btn"
                onClick={() => setFileToDelete(null)}
              >
                <X size={18} />
              </button>
            </div>

            {deleteFileError && (
              <div className="auth-alert">
                <AlertCircle size={16} />
                <span>{deleteFileError}</span>
              </div>
            )}

            <p style={{ fontSize: '0.9375rem', color: 'var(--text-primary)', marginBottom: '0.5rem' }}>
              Are you sure you want to delete <strong>&quot;{fileToDelete.name}&quot;</strong> ({formatBytes(fileToDelete.size)})?
            </p>
            <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
              This will free up storage space in your account.
            </p>

            <div className="modal-actions">
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() => setFileToDelete(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className="btn btn-primary"
                style={{ background: 'var(--accent-rose)' }}
                onClick={handleDeleteFile}
                disabled={deleteFileLoading}
              >
                {deleteFileLoading ? 'Deleting...' : 'Delete File'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

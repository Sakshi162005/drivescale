import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Search as SearchIcon,
  X,
  Folder as FolderIcon,
  FileText,
  File as FileDocIcon,
  Image,
  Film,
  Music,
  Archive,
  Code,
  Download,
  ExternalLink,
  Users,
  HardDrive,
  Loader2,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { searchService } from '../../services/search.service.js';
import { fileService } from '../../services/file.service.js';
import { SearchResultItem } from '../../types/search.types.js';
import { formatBytes } from '../../utils/format.js';

export interface SearchResultsModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialQuery?: string;
}

export const SearchResultsModal: React.FC<SearchResultsModalProps> = ({
  isOpen,
  onClose,
  initialQuery = '',
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState(initialQuery);
  const [activeType, setActiveType] = useState<'all' | 'file' | 'folder'>('all');
  const [results, setResults] = useState<SearchResultItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalCount, setTotalCount] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  // Sync initial query when opened
  useEffect(() => {
    if (isOpen) {
      if (initialQuery) {
        setQuery(initialQuery);
      }
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [isOpen, initialQuery]);

  const executeSearch = useCallback(
    async (searchQuery: string, typeFilter: 'all' | 'file' | 'folder', searchPage = 1) => {
      const trimmed = searchQuery.trim();
      if (!trimmed) {
        setResults([]);
        setTotalCount(0);
        setTotalPages(1);
        return;
      }

      setLoading(true);
      setError(null);
      try {
        const res = await searchService.search({
          q: trimmed,
          type: typeFilter,
          page: searchPage,
          limit: 15,
          sortBy: 'updatedAt',
          sortOrder: 'desc',
        });

        if (res.success && res.data) {
          setResults(res.data.items || []);
          setTotalCount(res.data.pagination.total);
          setTotalPages(res.data.pagination.totalPages);
          setPage(res.data.pagination.page);
        } else {
          setError(res.error?.message || 'Failed to execute search');
        }
      } catch {
        setError('Network error performing search');
      } finally {
        setLoading(false);
      }
    },
    []
  );

  // Debounced search when typing
  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      executeSearch(query, activeType, 1);
    }, 250);
    return () => clearTimeout(timer);
  }, [isOpen, query, activeType, executeSearch]);

  const handlePageChange = (newPage: number) => {
    if (newPage < 1 || newPage > totalPages || newPage === page) return;
    executeSearch(query, activeType, newPage);
  };

  const handleItemClick = (item: SearchResultItem) => {
    onClose();
    if (item.type === 'folder') {
      navigate(`/drive/${item._id}`);
    } else {
      // If the file belongs to a folder, navigate to it; otherwise go to root
      if (item.folderId) {
        navigate(`/drive/${item.folderId}`);
      } else {
        navigate('/drive');
      }
    }
  };

  const handleDownload = async (e: React.MouseEvent, item: SearchResultItem) => {
    e.stopPropagation();
    if (item.type !== 'file') return;
    try {
      await fileService.downloadFile(item._id, item.name);
    } catch {
      alert('Failed to download file');
    }
  };

  const renderIcon = (item: SearchResultItem) => {
    if (item.type === 'folder') {
      return <FolderIcon size={20} color="#FBBF24" />;
    }
    const mime = item.mimeType || '';
    if (mime.startsWith('image/')) return <Image size={20} color="#38BDF8" />;
    if (mime.startsWith('video/')) return <Film size={20} color="#F472B6" />;
    if (mime.startsWith('audio/')) return <Music size={20} color="#A78BFA" />;
    if (mime.includes('zip') || mime.includes('tar') || mime.includes('compressed'))
      return <Archive size={20} color="#FBBF24" />;
    if (mime.includes('pdf')) return <FileText size={20} color="#EF4444" />;
    if (mime.includes('json') || mime.includes('javascript') || mime.includes('typescript') || item.name.endsWith('.ts') || item.name.endsWith('.js'))
      return <Code size={20} color="#34D399" />;
    return <FileDocIcon size={20} color="#94A3B8" />;
  };

  if (!isOpen) return null;

  return (
    <div
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(8, 11, 17, 0.85)',
        backdropFilter: 'blur(8px)',
        zIndex: 1000,
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '3rem 1rem',
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '720px',
          backgroundColor: '#0F1623',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          borderRadius: '16px',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.7)',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
          maxHeight: '85vh',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search Header Bar */}
        <div
          style={{
            padding: '1rem 1.25rem',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            backgroundColor: 'rgba(17, 24, 39, 0.6)',
          }}
        >
          <SearchIcon size={20} color="var(--accent-cyan, #06B6D4)" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Search all files and folders across Drive..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{
              flex: 1,
              background: 'transparent',
              border: 'none',
              outline: 'none',
              fontSize: '1rem',
              color: 'var(--text-primary, #F8FAFC)',
            }}
          />
          {loading && <Loader2 size={18} className="animate-spin" color="var(--accent-cyan, #06B6D4)" />}
          {query && !loading && (
            <button
              onClick={() => setQuery('')}
              style={{
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: 'var(--text-muted, #64748B)',
                padding: '0.2rem',
                display: 'flex',
              }}
            >
              <X size={16} />
            </button>
          )}
          <button
            onClick={onClose}
            style={{
              background: 'rgba(255, 255, 255, 0.05)',
              border: '1px solid rgba(255, 255, 255, 0.1)',
              borderRadius: '6px',
              padding: '0.3rem 0.6rem',
              cursor: 'pointer',
              color: 'var(--text-secondary, #94A3B8)',
              fontSize: '0.75rem',
            }}
          >
            Esc
          </button>
        </div>

        {/* Filter Bar */}
        <div
          style={{
            padding: '0.6rem 1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            borderBottom: '1px solid rgba(255, 255, 255, 0.05)',
            backgroundColor: 'rgba(15, 22, 35, 0.95)',
          }}
        >
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(['all', 'file', 'folder'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setActiveType(t)}
                style={{
                  padding: '0.25rem 0.75rem',
                  borderRadius: '20px',
                  fontSize: '0.75rem',
                  fontWeight: 500,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: activeType === t ? 'var(--accent-primary, #6366F1)' : 'rgba(255, 255, 255, 0.08)',
                  backgroundColor: activeType === t ? 'rgba(99, 102, 241, 0.2)' : 'transparent',
                  color: activeType === t ? '#F8FAFC' : 'var(--text-secondary, #94A3B8)',
                  transition: 'all 0.15s ease',
                  textTransform: 'capitalize',
                }}
              >
                {t === 'all' ? 'All Items' : t === 'file' ? 'Files' : 'Folders'}
              </button>
            ))}
          </div>

          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted, #64748B)' }}>
            {totalCount > 0 ? `${totalCount} item${totalCount !== 1 ? 's' : ''} found` : ''}
          </div>
        </div>

        {/* Results List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '0.5rem 0' }}>
          {error && (
            <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--accent-rose, #EF4444)' }}>
              {error}
            </div>
          )}

          {!loading && !query.trim() && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted, #64748B)' }}>
              <SearchIcon size={36} style={{ margin: '0 auto 0.75rem', opacity: 0.4 }} />
              <p style={{ fontSize: '0.9rem', margin: 0 }}>Type to search files and folders</p>
              <p style={{ fontSize: '0.75rem', marginTop: '0.35rem', opacity: 0.7 }}>
                Searches your personal drive and items shared with you
              </p>
            </div>
          )}

          {!loading && query.trim() && results.length === 0 && (
            <div style={{ padding: '3rem 1.5rem', textAlign: 'center', color: 'var(--text-muted, #64748B)' }}>
              <p style={{ fontSize: '0.9rem', margin: 0 }}>No items match &quot;{query}&quot;</p>
              <p style={{ fontSize: '0.75rem', marginTop: '0.35rem', opacity: 0.7 }}>
                Check spelling or try a different keyword
              </p>
            </div>
          )}

          {results.map((item) => (
            <div
              key={`${item.type}-${item._id}`}
              onClick={() => handleItemClick(item)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '0.65rem 1.25rem',
                cursor: 'pointer',
                borderBottom: '1px solid rgba(255, 255, 255, 0.03)',
                transition: 'background-color 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(255, 255, 255, 0.04)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', minWidth: 0, flex: 1 }}>
                <div style={{ flexShrink: 0 }}>{renderIcon(item)}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      fontSize: '0.875rem',
                      fontWeight: 500,
                      color: 'var(--text-primary, #F8FAFC)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {item.name}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.6rem',
                      fontSize: '0.72rem',
                      color: 'var(--text-secondary, #94A3B8)',
                      marginTop: '0.15rem',
                    }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                      {item.isOwner ? (
                        <>
                          <HardDrive size={11} />
                          <span>{item.locationName}</span>
                        </>
                      ) : (
                        <>
                          <Users size={11} color="var(--accent-cyan, #06B6D4)" />
                          <span style={{ color: 'var(--accent-cyan, #06B6D4)' }}>
                            Shared by {item.owner.name || item.owner.email}
                          </span>
                        </>
                      )}
                    </span>
                    {item.size !== undefined && <span>• {formatBytes(item.size)}</span>}
                    <span>• {new Date(item.updatedAt).toLocaleDateString()}</span>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
                {!item.isOwner && item.effectivePermission && (
                  <span
                    style={{
                      padding: '0.15rem 0.45rem',
                      borderRadius: '4px',
                      fontSize: '0.65rem',
                      fontWeight: 600,
                      backgroundColor: 'rgba(6, 182, 212, 0.12)',
                      color: 'var(--accent-cyan, #06B6D4)',
                    }}
                  >
                    {item.effectivePermission}
                  </span>
                )}

                {item.type === 'file' && (
                  <button
                    onClick={(e) => handleDownload(e, item)}
                    title="Download file"
                    style={{
                      background: 'rgba(255, 255, 255, 0.05)',
                      border: '1px solid rgba(255, 255, 255, 0.08)',
                      borderRadius: '6px',
                      padding: '0.35rem',
                      cursor: 'pointer',
                      color: 'var(--text-secondary, #94A3B8)',
                      display: 'flex',
                      alignItems: 'center',
                    }}
                  >
                    <Download size={14} />
                  </button>
                )}

                <div style={{ color: 'var(--text-muted, #64748B)', padding: '0.2rem' }}>
                  <ExternalLink size={13} />
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Footer with Pagination */}
        {totalPages > 1 && (
          <div
            style={{
              padding: '0.6rem 1.25rem',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              backgroundColor: 'rgba(15, 22, 35, 0.95)',
              fontSize: '0.75rem',
              color: 'var(--text-secondary, #94A3B8)',
            }}
          >
            <span>
              Page {page} of {totalPages}
            </span>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button
                disabled={page <= 1}
                onClick={() => handlePageChange(page - 1)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '0.25rem 0.5rem',
                  cursor: page <= 1 ? 'default' : 'pointer',
                  opacity: page <= 1 ? 0.4 : 1,
                  color: 'var(--text-primary, #F8FAFC)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => handlePageChange(page + 1)}
                style={{
                  background: 'rgba(255, 255, 255, 0.05)',
                  border: '1px solid rgba(255, 255, 255, 0.1)',
                  borderRadius: '4px',
                  padding: '0.25rem 0.5rem',
                  cursor: page >= totalPages ? 'default' : 'pointer',
                  opacity: page >= totalPages ? 0.4 : 1,
                  color: 'var(--text-primary, #F8FAFC)',
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

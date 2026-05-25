import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Archive, BookOpen, Database, Edit3, FileUp, HardDrive, LibraryBig, Search, Star, Trash2, UploadCloud, X } from 'lucide-react';
import { Link } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { MetricCard } from '../components/MetricCard';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { notifyDataChanged, serverApi, type LibraryBook } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { clearLibraryCache, getLibraryCacheSummary } from '../features/library/cache';

type BookDraft = {
  title: string;
  author: string;
  category: string;
  tags: string;
  isFavorite: boolean;
  isArchived: boolean;
};

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function statusText(status: string) {
  if (status === 'ready') return '已索引';
  if (status === 'processing') return '索引中';
  if (status === 'pending') return '等待索引';
  if (status === 'empty') return '无可检索文本';
  if (status === 'failed') return '索引失败';
  return status || '未知';
}

function statusClass(status: string) {
  if (status === 'ready') return 'border-emerald-200 bg-emerald-50 text-emerald-700';
  if (status === 'failed') return 'border-rose-200 bg-rose-50 text-rose-700';
  if (status === 'processing' || status === 'pending') return 'border-amber-200 bg-amber-50 text-amber-700';
  return 'border-slate-200 bg-slate-50 text-slate-600';
}

function draftFromBook(book: LibraryBook): BookDraft {
  return {
    title: book.title,
    author: book.author,
    category: book.category,
    tags: book.tags.join(', '),
    isFavorite: book.isFavorite,
    isArchived: book.isArchived,
  };
}

export function LibraryPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [sort, setSort] = useState('recent');
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [uploadCategory, setUploadCategory] = useState('');
  const [tags, setTags] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState<BookDraft | null>(null);
  const [cacheSummary, setCacheSummary] = useState<{ fileCount: number; textCount: number; totalBytes: number } | null>(null);
  const [toast, setToast] = useState('');

  const booksQuery = useQuery({
    queryKey: queryKeys.libraryBooks(search, category, sort),
    queryFn: () => serverApi.getLibraryBooks({ search, category, sort }),
  });

  const books = booksQuery.data?.items ?? [];
  const readOnly = Boolean(booksQuery.data?.readOnly);
  const readyCount = books.filter((book) => book.textStatus === 'ready').length;
  const totalSize = books.reduce((sum, book) => sum + book.fileSize, 0);
  const activeCategories = useMemo(() => booksQuery.data?.categories ?? [], [booksQuery.data?.categories]);

  const refreshCacheSummary = async () => {
    try {
      setCacheSummary(await getLibraryCacheSummary());
    } catch {
      setCacheSummary(null);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void refreshCacheSummary();
    }, 0);
    return () => window.clearTimeout(timeoutId);
  }, []);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const submitSearch = () => setSearch(searchInput.trim());

  const uploadBook = async () => {
    if (readOnly) return;
    if (!file) return alert('请先选择要上传的资料文件');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim() || file.name.replace(/\.[^.]+$/, ''));
    formData.append('author', author.trim());
    formData.append('category', uploadCategory.trim() || '未分类');
    formData.append('tags', tags.trim());
    setUploading(true);
    setUploadProgress(0);
    try {
      await serverApi.uploadLibraryBook(formData, setUploadProgress);
      setFile(null);
      setTitle('');
      setAuthor('');
      setUploadCategory('');
      setTags('');
      setUploadProgress(0);
      notifyDataChanged();
      await queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
      showToast('资料已上传，后台正在建立检索索引');
    } catch {
      showToast('上传失败，请检查文件格式或稍后重试');
    } finally {
      setUploading(false);
    }
  };

  const startEdit = (book: LibraryBook) => {
    setEditingId(book.id);
    setDraft(draftFromBook(book));
  };

  const saveDraft = async () => {
    if (!draft || editingId === null) return;
    try {
      await serverApi.saveLibraryBook({ id: editingId, ...draft, tags: draft.tags.split(/[,，\s]+/).filter(Boolean) });
      notifyDataChanged();
      await queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
      setEditingId(null);
      setDraft(null);
      showToast('资料信息已保存');
    } catch {
      showToast('保存失败，请稍后再试');
    }
  };

  const removeBook = async (book: LibraryBook) => {
    if (!confirm(`确定删除《${book.title}》吗？服务器上的原文件、索引和笔记都会删除。`)) return;
    try {
      await serverApi.removeLibraryBook(book.id);
      notifyDataChanged();
      await queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
      showToast('资料已删除');
    } catch {
      showToast('删除失败，请稍后再试');
    }
  };

  const clearCache = async () => {
    if (!confirm('确定清空本浏览器的图书缓存吗？服务器资料不会被删除。')) return;
    await clearLibraryCache();
    await refreshCacheSummary();
    showToast('浏览器缓存已清空');
  };

  return (
    <Page title="资料图书馆" subtitle="上传 PDF、EPUB、TXT 或 Markdown，服务器保存原文件，浏览器缓存最近阅读内容。">
      <div className="grid gap-4 md:grid-cols-4">
        <MetricCard label="资料数量" value={`${books.length} 本`} icon={<LibraryBig size={18} />} />
        <MetricCard label="已建立索引" value={`${readyCount} 本`} hint="支持标题、笔记和正文检索" icon={<Search size={18} />} />
        <MetricCard label="服务器文件" value={formatBytes(totalSize)} icon={<HardDrive size={18} />} />
        <MetricCard label="本机缓存" value={formatBytes(cacheSummary?.totalBytes ?? 0)} hint={`${cacheSummary?.fileCount ?? 0} 个文件缓存`} icon={<Database size={18} />} />
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[320px_1fr]">
        <aside className="space-y-5">
          <div className="card p-5">
            <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950"><FileUp size={18} />上传资料</h2>
            <input
              className="field mt-4"
              type="file"
              accept=".pdf,.epub,.txt,.md,.markdown,application/pdf,application/epub+zip,text/plain,text/markdown"
              disabled={readOnly || uploading}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] ?? null;
                setFile(nextFile);
                if (nextFile && !title.trim()) setTitle(nextFile.name.replace(/\.[^.]+$/, ''));
              }}
            />
            <label className="label mt-4">标题</label>
            <input className="field" value={title} disabled={readOnly} onChange={(event) => setTitle(event.target.value)} placeholder="默认使用文件名" />
            <label className="label mt-4">作者 / 来源</label>
            <input className="field" value={author} disabled={readOnly} onChange={(event) => setAuthor(event.target.value)} placeholder="可选" />
            <label className="label mt-4">分类</label>
            <input className="field" value={uploadCategory} disabled={readOnly} onChange={(event) => setUploadCategory(event.target.value)} placeholder="例如 数学、英语、真题" />
            <label className="label mt-4">标签</label>
            <input className="field" value={tags} disabled={readOnly} onChange={(event) => setTags(event.target.value)} placeholder="逗号或空格分隔" />
            {uploading ? (
              <div className="mt-4 h-2 overflow-hidden rounded bg-slate-100">
                <div className="h-full rounded bg-blue-600 transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            ) : null}
            <button className="btn btn-primary mt-4 w-full" disabled={readOnly || uploading} onClick={uploadBook}>
              <UploadCloud size={16} />{uploading ? '上传中...' : '上传并索引'}
            </button>
          </div>

          <div className="card p-5">
            <h2 className="text-base font-semibold text-slate-950">筛选与缓存</h2>
            <div className="mt-4 flex gap-2">
              <input
                className="field"
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Enter') submitSearch(); }}
                placeholder="搜索标题、作者、标签"
              />
              <button className="btn btn-soft shrink-0" onClick={submitSearch}><Search size={16} /></button>
            </div>
            <select className="field mt-3" value={category} onChange={(event) => setCategory(event.target.value)}>
              <option value="">全部分类</option>
              {activeCategories.map((item) => <option key={item.category} value={item.category}>{item.category} ({item.count})</option>)}
            </select>
            <select className="field mt-3" value={sort} onChange={(event) => setSort(event.target.value)}>
              <option value="recent">最近阅读 / 更新</option>
              <option value="uploaded">最近上传</option>
              <option value="title">标题排序</option>
              <option value="progress">阅读进度</option>
            </select>
            <button className="btn btn-soft mt-4 w-full" onClick={clearCache}><X size={16} />清空本机缓存</button>
          </div>
        </aside>

        <section className="space-y-4">
          {booksQuery.isLoading ? <EmptyState title="资料列表加载中" description="稍等一下，正在读取服务器图书馆。" /> : null}
          {!booksQuery.isLoading && !books.length ? <EmptyState title="还没有资料" description="先从左侧上传一本 PDF、EPUB 或文本资料。" /> : null}

          {books.map((book) => {
            const isEditing = editingId === book.id && draft;
            return (
              <article key={book.id} className="card p-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="grid gap-3 md:grid-cols-2">
                        <input className="field md:col-span-2" value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} />
                        <input className="field" value={draft.author} onChange={(event) => setDraft({ ...draft, author: event.target.value })} placeholder="作者 / 来源" />
                        <input className="field" value={draft.category} onChange={(event) => setDraft({ ...draft, category: event.target.value })} placeholder="分类" />
                        <input className="field md:col-span-2" value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} placeholder="标签" />
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate text-lg font-semibold text-slate-950">{book.title}</h2>
                          {book.isFavorite ? <Star size={16} className="fill-amber-400 text-amber-400" /> : null}
                          <span className={`rounded-full border px-2.5 py-1 text-xs font-semibold ${statusClass(book.textStatus)}`}>{statusText(book.textStatus)}</span>
                        </div>
                        <p className="mt-2 text-sm text-slate-500">
                          {book.author ? `${book.author} · ` : ''}{book.category || '未分类'} · {book.fileType.toUpperCase()} · {formatBytes(book.fileSize)}
                        </p>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {book.tags.length ? book.tags.map((tag) => <span key={tag} className="rounded bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">{tag}</span>) : <span className="text-sm text-slate-400">暂无标签</span>}
                        </div>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {isEditing ? (
                      <>
                        <button className="btn btn-primary" onClick={saveDraft}>保存</button>
                        <button className="btn btn-soft" onClick={() => { setEditingId(null); setDraft(null); }}>取消</button>
                      </>
                    ) : (
                      <>
                        <Link className="btn btn-primary" to={`/library/${book.id}/read`}><BookOpen size={16} />阅读</Link>
                        <button className="btn btn-soft" disabled={readOnly} onClick={() => startEdit(book)}><Edit3 size={16} />编辑</button>
                        <button className="btn btn-danger" disabled={readOnly} onClick={() => removeBook(book)}><Trash2 size={16} />删除</button>
                      </>
                    )}
                  </div>
                </div>

                <div className="mt-5">
                  <div className="flex items-center justify-between text-xs text-slate-500">
                    <span>阅读进度</span>
                    <span>{Math.round(book.progressPercent || 0)}%</span>
                  </div>
                  <div className="mt-2 h-2 overflow-hidden rounded bg-slate-100">
                    <div className="h-full rounded bg-blue-600" style={{ width: `${Math.min(100, Math.max(0, book.progressPercent || 0))}%` }} />
                  </div>
                </div>

                {book.textStatus === 'failed' ? <p className="mt-3 text-sm text-rose-600">索引失败：{book.textError || '服务器未能提取文本，但仍可打开原文件阅读。'}</p> : null}
                {book.isArchived ? <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Archive size={15} />这本资料已归档</p> : null}
              </article>
            );
          })}
        </section>
      </div>
      {toast ? <Toast message={toast} /> : null}
    </Page>
  );
}

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Bookmark, BookmarkPlus, ChevronLeft, ChevronRight, Download, FileText, HardDriveDownload, NotebookPen, Save, Trash2 } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { notifyDataChanged, serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { getCachedLibraryFile, getCachedLibraryText, libraryCacheVersion, putCachedLibraryFile, putCachedLibraryText } from '../features/library/cache';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function textStatusHint(status?: string, error?: string) {
  if (status === 'ready') return '正文索引已完成，可以全文阅读和检索。';
  if (status === 'processing' || status === 'pending') return '服务器正在提取正文，稍后刷新即可看到文本版。';
  if (status === 'empty') return '这份资料没有可直接提取的文字，通常是扫描版或图片版 PDF，可以使用原文件阅读。';
  if (status === 'failed') return `正文提取失败：${error || '未知原因'}。原文件仍可阅读。`;
  return '';
}

function parsePageLocator(locator = '') {
  const match = locator.match(/^page:(\d+)$/);
  return match ? Math.max(1, Number(match[1]) || 1) : 1;
}

function clampPage(value: string | number, totalPages?: number | null) {
  const parsed = Math.max(1, Math.round(Number(value) || 1));
  return totalPages ? Math.min(parsed, totalPages) : parsed;
}

function pageProgressPercent(page: number, totalPages?: number | null) {
  if (!totalPages) return 0;
  return Math.max(0, Math.min(100, Math.round((page / totalPages) * 1000) / 10));
}

function withPdfPage(url: string, page: number) {
  if (!url) return '';
  return `${url.split('#')[0]}#page=${page}`;
}

export function LibraryReaderPage() {
  const params = useParams();
  const bookId = Number(params.id || 0);
  const [objectUrl, setObjectUrl] = useState('');
  const [cachedSource, setCachedSource] = useState(false);
  const [cachedChunks, setCachedChunks] = useState<Awaited<ReturnType<typeof getCachedLibraryText>>>(null);
  const [pageDraft, setPageDraft] = useState<{ bookId: number; value: string } | null>(null);
  const [bookmarkTitle, setBookmarkTitle] = useState('');
  const [note, setNote] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');

  const detailQuery = useQuery({
    queryKey: queryKeys.libraryBook(bookId),
    queryFn: () => serverApi.getLibraryBook(bookId),
    enabled: bookId > 0,
  });

  const book = detailQuery.data?.book ?? null;
  const readOnly = Boolean(detailQuery.data?.readOnly);
  const textQuery = useQuery({
    queryKey: queryKeys.libraryText(bookId, 0, 300),
    queryFn: () => serverApi.getLibraryText(bookId, 0, 300),
    enabled: Boolean(book && book.textStatus === 'ready'),
  });

  const textChunks = textQuery.data?.chunks?.length ? textQuery.data.chunks : cachedChunks ?? [];
  const serverFileUrl = book ? serverApi.libraryFileUrl(book.id) : '';
  const totalPages = book?.pageCount || null;
  const savedPage = book ? parsePageLocator(book.lastLocator) : 1;
  const pageInputValue = pageDraft?.bookId === bookId ? pageDraft.value : String(savedPage);
  const currentPage = clampPage(pageInputValue || savedPage, totalPages);
  const pdfSourceUrl = objectUrl || serverFileUrl;
  const readerUrl = book?.fileType === 'pdf' ? withPdfPage(pdfSourceUrl, currentPage) : pdfSourceUrl;

  useEffect(() => {
    if (!book) return;
    let revokedUrl = '';
    let cancelled = false;
    const version = libraryCacheVersion(book);
    getCachedLibraryFile(book.id, version)
      .then((blob) => {
        if (cancelled) return;
        if (!blob) {
          setCachedSource(false);
          setObjectUrl('');
          return;
        }
        const url = URL.createObjectURL(blob);
        revokedUrl = url;
        if (cancelled) {
          URL.revokeObjectURL(url);
          return;
        }
        setCachedSource(true);
        setObjectUrl(url);
      })
      .catch(() => {
        if (cancelled) return;
        setCachedSource(false);
        setObjectUrl('');
      });
    void getCachedLibraryText(book.id, version).then(setCachedChunks).catch(() => setCachedChunks(null));
    return () => {
      cancelled = true;
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [book, serverFileUrl]);

  useEffect(() => {
    if (book && textQuery.data?.chunks?.length) {
      void putCachedLibraryText(book.id, libraryCacheVersion(book), textQuery.data.chunks, book.title);
    }
  }, [book, textQuery.data?.chunks]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const saveCurrentPage = async () => {
    if (!book || readOnly) return;
    const page = clampPage(pageInputValue, totalPages);
    try {
      await serverApi.saveLibraryProgress({
        bookId: book.id,
        progressPercent: pageProgressPercent(page, totalPages),
        locator: `page:${page}`,
      });
      setPageDraft({ bookId: book.id, value: String(page) });
      notifyDataChanged();
      await queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
      showToast(`已保存到第 ${page} 页`);
    } catch {
      showToast('页码保存失败');
    }
  };

  const goToPage = (page: number) => {
    if (!book) return;
    const nextPage = clampPage(page, totalPages);
    setPageDraft({ bookId: book.id, value: String(nextPage) });
    if (!readOnly) {
      void serverApi.saveLibraryProgress({
        bookId: book.id,
        progressPercent: pageProgressPercent(nextPage, totalPages),
        locator: `page:${nextPage}`,
      }).then(() => {
        notifyDataChanged();
        void queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
      }).catch(() => undefined);
    }
  };

  const addBookmark = async () => {
    if (!book || readOnly) return;
    try {
      await serverApi.saveLibraryBookmark({
        bookId: book.id,
        pageNumber: currentPage,
        title: bookmarkTitle.trim() || `第 ${currentPage} 页`,
      });
      setBookmarkTitle('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryBook(book.id) });
      showToast('书签已添加');
    } catch {
      showToast('书签添加失败');
    }
  };

  const removeBookmark = async (id: number) => {
    if (!book || readOnly) return;
    try {
      await serverApi.removeLibraryBookmark(id);
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryBook(book.id) });
      showToast('书签已删除');
    } catch {
      showToast('书签删除失败');
    }
  };

  const cacheCurrentFile = async () => {
    if (!book) return;
    try {
      const response = await fetch(serverFileUrl);
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      await putCachedLibraryFile(book.id, libraryCacheVersion(book), blob, book.title);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      const url = URL.createObjectURL(blob);
      setObjectUrl(url);
      setCachedSource(true);
      showToast('已缓存到这台浏览器');
    } catch {
      showToast('缓存失败，请稍后再试');
    }
  };

  const submitNote = async () => {
    if (!book || readOnly) return;
    const content = note.trim();
    if (!content) return alert('请先写一点笔记内容');
    setSaving(true);
    try {
      await serverApi.saveLibraryNote({ bookId: book.id, title: noteTitle.trim(), content, locator: `page:${currentPage}` });
      setNote('');
      setNoteTitle('');
      await queryClient.invalidateQueries({ queryKey: queryKeys.libraryBook(book.id) });
      showToast('笔记已保存');
    } catch {
      showToast('笔记保存失败');
    } finally {
      setSaving(false);
    }
  };

  if (!bookId) {
    return (
      <Page title="资料阅读" subtitle="没有找到资料编号。">
        <EmptyState title="资料不存在" description="请回到资料图书馆重新打开。" />
      </Page>
    );
  }

  return (
    <Page title={book?.title ?? '资料阅读'} subtitle={book ? `${book.fileType.toUpperCase()} · ${formatBytes(book.fileSize)} · ${textStatusHint(book.textStatus, book.textError)}` : '正在加载资料'}>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/library" className="btn btn-soft"><ArrowLeft size={16} />返回图书馆</Link>
        {book ? (
          <div className="flex flex-wrap gap-2">
            <a className="btn btn-soft" href={book.fileType === 'pdf' ? readerUrl : serverFileUrl} target="_blank" rel="noreferrer"><Download size={16} />打开原文件</a>
            <button className="btn btn-primary" onClick={cacheCurrentFile}><HardDriveDownload size={16} />{cachedSource ? '更新本机缓存' : '缓存到本机'}</button>
          </div>
        ) : null}
      </div>

      {detailQuery.isLoading ? <EmptyState title="资料加载中" description="正在读取服务器上的图书信息。" /> : null}
      {!detailQuery.isLoading && !book ? <EmptyState title="资料不存在" description="可能已经被删除或归档。" /> : null}

      {book ? (
        <div className="grid gap-5 xl:grid-cols-[1fr_320px]">
          <section className="space-y-5">
            <div className="card p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-700">当前页码</p>
                  <p className="mt-1 text-sm text-slate-500">{cachedSource ? '当前使用本浏览器缓存文件' : '当前读取服务器文件'}</p>
                </div>
                <span className="text-2xl font-semibold text-slate-950">
                  {book.pageCount ? `${currentPage}/${book.pageCount}` : `第 ${currentPage} 页`}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap items-center gap-3">
                <button className="btn btn-soft" disabled={currentPage <= 1} onClick={() => goToPage(currentPage - 1)}>
                  <ChevronLeft size={16} />上一页
                </button>
                <input
                  className="field max-w-40"
                  type="number"
                  min={1}
                  max={totalPages ?? undefined}
                  value={pageInputValue}
                  onChange={(event) => setPageDraft({ bookId: book.id, value: event.target.value })}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      goToPage(clampPage(event.currentTarget.value, totalPages));
                      if (!readOnly) void saveCurrentPage();
                    }
                  }}
                />
                {totalPages ? <span className="text-sm text-slate-500">/ {totalPages} 页</span> : null}
                <button className="btn btn-soft" onClick={() => goToPage(currentPage)}>
                  跳转
                </button>
                <button className="btn btn-soft" disabled={Boolean(totalPages && currentPage >= totalPages)} onClick={() => goToPage(currentPage + 1)}>
                  下一页<ChevronRight size={16} />
                </button>
                <button className="btn btn-primary" disabled={readOnly} onClick={() => void saveCurrentPage()}>
                  <Save size={16} />保存页码
                </button>
              </div>
            </div>

            {book.fileType === 'pdf' ? (
              <div className="card overflow-hidden p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="text-sm text-slate-500">
                    系统 PDF 阅读器 · 第 {currentPage} 页
                  </div>
                  <span className="text-xs text-slate-400">页码和书签只负责单向跳转；在 PDF 内滚动不会反向同步</span>
                </div>
                <div className="rounded bg-slate-100 p-3">
                  <iframe
                    key={readerUrl}
                    className="h-[78vh] w-full rounded bg-white shadow-sm"
                    src={readerUrl}
                    title={`${book.title} 系统 PDF 阅读器`}
                  />
                </div>
              </div>
            ) : null}

            {book.fileType !== 'pdf' ? (
              <div className="card p-5">
                <div className="mb-4 flex items-center gap-2 text-base font-semibold text-slate-950"><FileText size={18} />文本阅读</div>
                {textQuery.isLoading && !textChunks.length ? <EmptyState title="正文加载中" /> : null}
                {!textQuery.isLoading && !textChunks.length ? (
                  <EmptyState title="暂无文本版" description="可以点击上方“打开原文件”阅读，或等待服务器完成索引。" />
                ) : (
                  <div className="prose prose-slate max-w-none">
                    {textChunks.map((chunk) => (
                      <section key={chunk.id} className="border-b border-slate-100 py-5 last:border-0">
                        <h3 className="mb-3 text-sm font-semibold text-slate-500">{chunk.title || chunk.locator}</h3>
                        <p className="whitespace-pre-wrap leading-8 text-slate-800">{chunk.text}</p>
                      </section>
                    ))}
                  </div>
                )}
              </div>
            ) : null}
          </section>

          <aside className="space-y-5">
            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950"><Bookmark size={18} />书签</h2>
              <div className="mt-4 flex gap-2">
                <input
                  className="field"
                  value={bookmarkTitle}
                  disabled={readOnly}
                  onChange={(event) => setBookmarkTitle(event.target.value)}
                  placeholder={`第 ${currentPage} 页`}
                />
                <button className="btn btn-primary shrink-0" disabled={readOnly} onClick={() => void addBookmark()}>
                  <BookmarkPlus size={16} />
                </button>
              </div>
              <div className="mt-4 space-y-2">
                {detailQuery.data?.bookmarks?.length ? detailQuery.data.bookmarks.map((item) => (
                  <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <button className="w-full text-left" onClick={() => goToPage(item.pageNumber)}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-slate-800">{item.title || `第 ${item.pageNumber} 页`}</span>
                        <span className="text-xs font-semibold text-blue-600">跳转 P{item.pageNumber}</span>
                      </div>
                    </button>
                    <div className="mt-2 flex justify-end">
                      <button className="rounded p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600" disabled={readOnly} onClick={() => void removeBookmark(item.id)} title="删除书签">
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </article>
                )) : <EmptyState title="还没有书签" description="把容易回看的页码标在这里。" />}
              </div>
            </div>

            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950"><NotebookPen size={18} />阅读笔记</h2>
              <input className="field mt-4" value={noteTitle} disabled={readOnly} onChange={(event) => setNoteTitle(event.target.value)} placeholder="笔记标题，可选" />
              <textarea className="field mt-3 min-h-32" value={note} disabled={readOnly} onChange={(event) => setNote(event.target.value)} placeholder="摘录、想法、待复习点..." />
              <button className="btn btn-primary mt-3 w-full" disabled={readOnly || saving} onClick={submitNote}><Save size={16} />保存笔记</button>
            </div>

            <div className="card p-5">
              <h2 className="flex items-center gap-2 text-base font-semibold text-slate-950"><BookOpen size={18} />历史笔记</h2>
              <div className="mt-4 space-y-3">
                {detailQuery.data?.notes.length ? detailQuery.data.notes.map((item) => (
                  <article key={item.id} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-slate-800">{item.title || '无标题笔记'}</h3>
                      <span className="text-xs text-slate-400">{item.updatedAt.slice(0, 10)}</span>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">{item.content}</p>
                  </article>
                )) : <EmptyState title="还没有笔记" description="读到重点时可以随手记在这里。" />}
              </div>
            </div>
          </aside>
        </div>
      ) : null}
      {toast ? <Toast message={toast} /> : null}
    </Page>
  );
}

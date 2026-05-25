import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, BookOpen, Download, FileText, HardDriveDownload, NotebookPen, Save } from 'lucide-react';
import { Link, useParams } from 'react-router-dom';
import { EmptyState } from '../components/EmptyState';
import { Page } from '../components/Page';
import { Toast } from '../components/Toast';
import { notifyDataChanged, serverApi } from '../api/client';
import { queryClient, queryKeys } from '../api/queryClient';
import { getCachedLibraryFile, getCachedLibraryText, putCachedLibraryFile, putCachedLibraryText } from '../features/library/cache';

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
  if (status === 'empty') return '这份资料没有提取到可读文本，可以使用原文件阅读。';
  if (status === 'failed') return `正文提取失败：${error || '未知原因'}。原文件仍可阅读。`;
  return '';
}

export function LibraryReaderPage() {
  const params = useParams();
  const bookId = Number(params.id || 0);
  const [objectUrl, setObjectUrl] = useState('');
  const [cachedSource, setCachedSource] = useState(false);
  const [cachedChunks, setCachedChunks] = useState<Awaited<ReturnType<typeof getCachedLibraryText>>>(null);
  const [progressDraft, setProgressDraft] = useState<{ bookId: number; value: number } | null>(null);
  const [note, setNote] = useState('');
  const [noteTitle, setNoteTitle] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState('');
  const progressTimer = useRef<number | null>(null);

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
  const readerUrl = objectUrl || serverFileUrl;
  const progress = progressDraft?.bookId === bookId ? progressDraft.value : Math.round(book?.progressPercent || 0);

  useEffect(() => {
    if (!book) return;
    let revokedUrl = '';
    getCachedLibraryFile(book.id, book.updatedAt)
      .then((blob) => {
        if (!blob) {
          setCachedSource(false);
          setObjectUrl('');
          return;
        }
        const url = URL.createObjectURL(blob);
        revokedUrl = url;
        setCachedSource(true);
        setObjectUrl(url);
      })
      .catch(() => {
        setCachedSource(false);
        setObjectUrl('');
      });
    void getCachedLibraryText(book.id, book.updatedAt).then(setCachedChunks).catch(() => setCachedChunks(null));
    return () => {
      if (revokedUrl) URL.revokeObjectURL(revokedUrl);
    };
  }, [book]);

  useEffect(() => {
    if (book && textQuery.data?.chunks?.length) {
      void putCachedLibraryText(book.id, book.updatedAt, textQuery.data.chunks, book.title);
    }
  }, [book, textQuery.data?.chunks]);

  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 1800);
  };

  const saveProgress = (nextProgress = progress, locator = '') => {
    if (!book || readOnly) return;
    if (progressTimer.current) window.clearTimeout(progressTimer.current);
    progressTimer.current = window.setTimeout(() => {
      void serverApi.saveLibraryProgress({ bookId: book.id, progressPercent: nextProgress, locator })
        .then(() => {
          notifyDataChanged();
          void queryClient.invalidateQueries({ queryKey: ['server', 'library'] });
        })
        .catch(() => undefined);
    }, 500);
  };

  const cacheCurrentFile = async () => {
    if (!book) return;
    try {
      const response = await fetch(serverFileUrl);
      if (!response.ok) throw new Error('Fetch failed');
      const blob = await response.blob();
      await putCachedLibraryFile(book.id, book.updatedAt, blob, book.title);
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
      await serverApi.saveLibraryNote({ bookId: book.id, title: noteTitle.trim(), content, locator: `progress:${progress}` });
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
            <a className="btn btn-soft" href={serverFileUrl} target="_blank" rel="noreferrer"><Download size={16} />打开原文件</a>
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
                  <p className="text-sm font-semibold text-slate-700">阅读进度</p>
                  <p className="mt-1 text-sm text-slate-500">{cachedSource ? '当前使用本浏览器缓存文件' : '当前读取服务器文件'}</p>
                </div>
                <span className="text-2xl font-semibold text-slate-950">{progress}%</span>
              </div>
              <input
                className="mt-4 w-full accent-blue-600"
                type="range"
                min={0}
                max={100}
                value={progress}
                disabled={readOnly}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  setProgressDraft({ bookId: book.id, value: next });
                  saveProgress(next, `progress:${next}`);
                }}
              />
            </div>

            {book.fileType === 'pdf' ? (
              <div className="card overflow-hidden">
                <iframe title={book.title} src={readerUrl} className="h-[78vh] w-full border-0 bg-white" />
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

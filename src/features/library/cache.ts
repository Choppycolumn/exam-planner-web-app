import type { LibraryTextChunk } from '../../api/client';
import type { LibraryBook } from '../../api/client';

const DB_NAME = 'examPlanner.libraryCache.v1';
const DB_VERSION = 1;
const FILE_STORE = 'files';
const TEXT_STORE = 'texts';
const MAX_CACHED_FILES = 5;

type CachedMeta = {
  key: string;
  bookId: number;
  version: string;
  title?: string;
  sizeBytes: number;
  updatedAt: number;
};

type CachedFile = CachedMeta & { blob: Blob };
type CachedText = CachedMeta & { chunks: LibraryTextChunk[] };

function cacheKey(bookId: number, version: string) {
  return `${bookId}:${version || 'v1'}`;
}

export function libraryCacheVersion(book: Pick<LibraryBook, 'originalFileName' | 'fileSize' | 'createdAt'>) {
  return `${book.originalFileName}:${book.fileSize}:${book.createdAt}`;
}

function openCacheDb(): Promise<IDBDatabase> {
  return new Promise((resolveDb, rejectDb) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(FILE_STORE)) {
        const store = db.createObjectStore(FILE_STORE, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
      }
      if (!db.objectStoreNames.contains(TEXT_STORE)) {
        const store = db.createObjectStore(TEXT_STORE, { keyPath: 'key' });
        store.createIndex('updatedAt', 'updatedAt');
      }
    };
    request.onsuccess = () => resolveDb(request.result);
    request.onerror = () => rejectDb(request.error ?? new Error('IndexedDB open failed'));
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolveRequest, rejectRequest) => {
    request.onsuccess = () => resolveRequest(request.result);
    request.onerror = () => rejectRequest(request.error ?? new Error('IndexedDB request failed'));
  });
}

async function getAll<T>(storeName: string): Promise<T[]> {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(storeName, 'readonly');
    return await requestToPromise<T[]>(transaction.objectStore(storeName).getAll());
  } finally {
    db.close();
  }
}

async function putValue<T>(storeName: string, value: T) {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(value);
    await new Promise<void>((resolveTx, rejectTx) => {
      transaction.oncomplete = () => resolveTx();
      transaction.onerror = () => rejectTx(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close();
  }
}

async function deleteKeys(storeName: string, keys: string[]) {
  if (!keys.length) return;
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    keys.forEach((key) => store.delete(key));
    await new Promise<void>((resolveTx, rejectTx) => {
      transaction.oncomplete = () => resolveTx();
      transaction.onerror = () => rejectTx(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close();
  }
}

export async function getCachedLibraryFile(bookId: number, version: string): Promise<Blob | null> {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(FILE_STORE, 'readonly');
    const item = await requestToPromise<CachedFile | undefined>(transaction.objectStore(FILE_STORE).get(cacheKey(bookId, version)));
    return item?.blob ?? null;
  } finally {
    db.close();
  }
}

export async function putCachedLibraryFile(bookId: number, version: string, blob: Blob, title?: string) {
  await putValue<CachedFile>(FILE_STORE, {
    key: cacheKey(bookId, version),
    bookId,
    version,
    title,
    blob,
    sizeBytes: blob.size,
    updatedAt: Date.now(),
  });
  await trimLibraryCache(MAX_CACHED_FILES);
}

export async function getCachedLibraryText(bookId: number, version: string): Promise<LibraryTextChunk[] | null> {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction(TEXT_STORE, 'readonly');
    const item = await requestToPromise<CachedText | undefined>(transaction.objectStore(TEXT_STORE).get(cacheKey(bookId, version)));
    return item?.chunks ?? null;
  } finally {
    db.close();
  }
}

export async function putCachedLibraryText(bookId: number, version: string, chunks: LibraryTextChunk[], title?: string) {
  await putValue<CachedText>(TEXT_STORE, {
    key: cacheKey(bookId, version),
    bookId,
    version,
    title,
    chunks,
    sizeBytes: new Blob([JSON.stringify(chunks)]).size,
    updatedAt: Date.now(),
  });
}

export async function trimLibraryCache(maxItems = MAX_CACHED_FILES) {
  const files = await getAll<CachedMeta>(FILE_STORE);
  const sorted = files.sort((a, b) => b.updatedAt - a.updatedAt);
  await deleteKeys(FILE_STORE, sorted.slice(maxItems).map((item) => item.key));
}

export async function clearLibraryCache() {
  const db = await openCacheDb();
  try {
    const transaction = db.transaction([FILE_STORE, TEXT_STORE], 'readwrite');
    transaction.objectStore(FILE_STORE).clear();
    transaction.objectStore(TEXT_STORE).clear();
    await new Promise<void>((resolveTx, rejectTx) => {
      transaction.oncomplete = () => resolveTx();
      transaction.onerror = () => rejectTx(transaction.error ?? new Error('IndexedDB transaction failed'));
    });
  } finally {
    db.close();
  }
}

export async function getLibraryCacheSummary() {
  const [files, texts] = await Promise.all([getAll<CachedMeta>(FILE_STORE), getAll<CachedMeta>(TEXT_STORE)]);
  const items = [...files, ...texts].sort((a, b) => b.updatedAt - a.updatedAt);
  return {
    fileCount: files.length,
    textCount: texts.length,
    totalBytes: items.reduce((sum, item) => sum + Number(item.sizeBytes || 0), 0),
    items,
  };
}

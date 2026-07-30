const DB_NAME = 'paperscope-pdf-library-v1';
const DB_VERSION = 2;
const LEGACY_STORE = 'pdfs';
const DOCUMENT_STORE = 'pdfDocuments';
const TEXT_STORE = 'pdfTextPages';
const ANNOTATION_STORE = 'pdfAnnotations';
const IMPORT_STORE = 'pdfImportJobs';

let databasePromise = null;

function requestResult(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB 请求失败'));
  });
}

function migrateLegacyStore(transaction) {
  if (!transaction.db.objectStoreNames.contains(LEGACY_STORE)) return;
  const legacy = transaction.objectStore(LEGACY_STORE);
  const documents = transaction.objectStore(DOCUMENT_STORE);
  const textPages = transaction.objectStore(TEXT_STORE);
  const annotations = transaction.objectStore(ANNOTATION_STORE);
  legacy.openCursor().onsuccess = event => {
    const cursor = event.target.result;
    if (!cursor) return;
    const value = cursor.value || {};
    const attachmentId = value.attachmentId || `primary:${value.paperId}`;
    documents.put({
      attachmentId,
      paperId: value.paperId,
      primary: true,
      schemaVersion: 3,
      fileName: value.fileName || 'paper.pdf',
      size: Number(value.size || value.blob?.size || 0),
      type: value.type || 'application/pdf',
      pageCount: Number(value.pageCount || value.pages?.length || 0),
      metadata: value.metadata || {},
      extractionErrors: value.extractionErrors || {},
      importedAt: value.importedAt || new Date().toISOString(),
      fingerprint: value.fingerprint || null,
      blob: value.blob
    });
    (value.pages || []).forEach((text, index) => {
      textPages.put({
        attachmentId,
        paperId: value.paperId,
        pageNumber: index + 1,
        text: String(text || ''),
        ocr: value.ocrPages?.[index + 1] || null
      });
    });
    annotations.put({ attachmentId, paperId: value.paperId, items: value.annotations || [] });
    cursor.continue();
  };
}

export function openPdfDatabase() {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const transaction = request.transaction;
      if (!db.objectStoreNames.contains(LEGACY_STORE)) db.createObjectStore(LEGACY_STORE, { keyPath: 'paperId' });
      if (!db.objectStoreNames.contains(DOCUMENT_STORE)) {
        const store = db.createObjectStore(DOCUMENT_STORE, { keyPath: 'attachmentId' });
        store.createIndex('paperId', 'paperId', { unique: false });
        store.createIndex('fingerprint', 'fingerprint', { unique: false });
      }
      if (!db.objectStoreNames.contains(TEXT_STORE)) {
        const store = db.createObjectStore(TEXT_STORE, { keyPath: ['attachmentId', 'pageNumber'] });
        store.createIndex('paperId', 'paperId', { unique: false });
        store.createIndex('attachmentId', 'attachmentId', { unique: false });
      }
      if (!db.objectStoreNames.contains(ANNOTATION_STORE)) {
        const store = db.createObjectStore(ANNOTATION_STORE, { keyPath: 'attachmentId' });
        store.createIndex('paperId', 'paperId', { unique: false });
      }
      if (!db.objectStoreNames.contains(IMPORT_STORE)) {
        const store = db.createObjectStore(IMPORT_STORE, { keyPath: 'id' });
        store.createIndex('status', 'status', { unique: false });
      }
      if (request.oldVersion < 2) migrateLegacyStore(transaction);
    };
    request.onblocked = () => reject(new Error('PDF 数据库升级被其他标签页阻塞，请关闭其他 PaperScope 页面后重试'));
    request.onerror = () => {
      databasePromise = null;
      reject(request.error || new Error('无法打开本地 PDF 数据库'));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onversionchange = () => {
        db.close();
        databasePromise = null;
      };
      resolve(db);
    };
  });
  return databasePromise;
}

async function transactionResult(storeNames, mode, operation) {
  const db = await openPdfDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeNames, mode);
    const stores = Object.fromEntries(storeNames.map(name => [name, transaction.objectStore(name)]));
    let result;
    let operationError;
    try {
      result = operation(stores, transaction);
    } catch (error) {
      operationError = error;
      transaction.abort();
    }
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || operationError || new Error('PDF 数据事务失败'));
    transaction.onabort = () => reject(transaction.error || operationError || new Error('PDF 数据事务已中止'));
  });
}

function attachmentIdFor(bundle) {
  return bundle.attachmentId || `primary:${bundle.paperId}`;
}

export async function putPdfBundle(bundle) {
  const attachmentId = attachmentIdFor(bundle);
  const pages = Array.isArray(bundle.pages) ? bundle.pages : [];
  await transactionResult([DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE], 'readwrite', stores => {
    stores[DOCUMENT_STORE].put({
      attachmentId,
      paperId: bundle.paperId,
      primary: bundle.primary !== false,
      schemaVersion: 3,
      fileName: bundle.fileName,
      size: Number(bundle.size || bundle.blob?.size || 0),
      type: bundle.type || 'application/pdf',
      pageCount: Number(bundle.pageCount || pages.length),
      metadata: bundle.metadata || {},
      extractionErrors: bundle.extractionErrors || {},
      importedAt: bundle.importedAt || new Date().toISOString(),
      fingerprint: bundle.fingerprint || null,
      blob: bundle.blob
    });
    const range = IDBKeyRange.bound([attachmentId, 0], [attachmentId, Number.MAX_SAFE_INTEGER]);
    stores[TEXT_STORE].delete(range);
    pages.forEach((text, index) => stores[TEXT_STORE].put({
      attachmentId,
      paperId: bundle.paperId,
      pageNumber: index + 1,
      text: String(text || ''),
      ocr: bundle.ocrPages?.[index + 1] || null
    }));
    stores[ANNOTATION_STORE].put({
      attachmentId,
      paperId: bundle.paperId,
      items: Array.isArray(bundle.annotations) ? bundle.annotations : []
    });
  });
  return attachmentId;
}

async function documentForPaper(paperId, preferredAttachmentId) {
  const db = await openPdfDatabase();
  const transaction = db.transaction(DOCUMENT_STORE, 'readonly');
  const store = transaction.objectStore(DOCUMENT_STORE);
  if (preferredAttachmentId) {
    const preferred = await requestResult(store.get(preferredAttachmentId));
    if (preferred?.paperId === paperId) return preferred;
  }
  const documents = await requestResult(store.index('paperId').getAll(paperId));
  return documents.sort((a, b) => Number(b.primary) - Number(a.primary) || new Date(b.importedAt) - new Date(a.importedAt))[0] || null;
}

export async function getPdfBundle(paperId, preferredAttachmentId = null) {
  const document = await documentForPaper(paperId, preferredAttachmentId);
  if (!document) return null;
  const db = await openPdfDatabase();
  const transaction = db.transaction([TEXT_STORE, ANNOTATION_STORE], 'readonly');
  const textStore = transaction.objectStore(TEXT_STORE);
  const annotationStore = transaction.objectStore(ANNOTATION_STORE);
  const [pageRows, annotationRow] = await Promise.all([
    requestResult(textStore.index('attachmentId').getAll(document.attachmentId)),
    requestResult(annotationStore.get(document.attachmentId))
  ]);
  const pages = Array.from({ length: document.pageCount }, () => '');
  const ocrPages = {};
  for (const row of pageRows) {
    pages[row.pageNumber - 1] = row.text || '';
    if (row.ocr) ocrPages[row.pageNumber] = row.ocr;
  }
  return {
    ...document,
    pages,
    ocrPages,
    annotations: annotationRow?.items || []
  };
}

export async function putPdfAnnotations(paperId, attachmentId, annotations) {
  await transactionResult([ANNOTATION_STORE], 'readwrite', stores => {
    stores[ANNOTATION_STORE].put({
      attachmentId,
      paperId,
      items: Array.isArray(annotations) ? annotations : []
    });
  });
}

export async function putPdfTextState(bundle) {
  const attachmentId = attachmentIdFor(bundle);
  await transactionResult([DOCUMENT_STORE, TEXT_STORE], 'readwrite', stores => {
    const documentRequest = stores[DOCUMENT_STORE].get(attachmentId);
    documentRequest.onsuccess = () => {
      if (documentRequest.result) {
        stores[DOCUMENT_STORE].put({
          ...documentRequest.result,
          extractionErrors: bundle.extractionErrors || {},
          pageCount: bundle.pageCount
        });
      }
    };
    (bundle.pages || []).forEach((text, index) => stores[TEXT_STORE].put({
      attachmentId,
      paperId: bundle.paperId,
      pageNumber: index + 1,
      text: String(text || ''),
      ocr: bundle.ocrPages?.[index + 1] || null
    }));
  });
}

export async function deletePdfAttachment(paperId, attachmentId = null) {
  const document = await documentForPaper(paperId, attachmentId);
  if (!document) return;
  const id = document.attachmentId;
  await transactionResult([DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, LEGACY_STORE], 'readwrite', stores => {
    stores[DOCUMENT_STORE].delete(id);
    stores[TEXT_STORE].delete(IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]));
    stores[ANNOTATION_STORE].delete(id);
    if (!attachmentId || id === `primary:${paperId}`) stores[LEGACY_STORE].delete(paperId);
  });
}

export async function deleteAllPdfAttachments(paperId) {
  const removed = { documents: 0, textPages: 0, annotations: 0, importJobs: 0 };
  await transactionResult([DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, IMPORT_STORE, LEGACY_STORE], 'readwrite', stores => {
    const deleteByPaper = (store, counter) => {
      const request = store.index('paperId').openCursor(IDBKeyRange.only(paperId));
      request.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        cursor.delete();
        removed[counter] += 1;
        cursor.continue();
      };
    };
    deleteByPaper(stores[DOCUMENT_STORE], 'documents');
    deleteByPaper(stores[TEXT_STORE], 'textPages');
    deleteByPaper(stores[ANNOTATION_STORE], 'annotations');
    const jobs = stores[IMPORT_STORE].openCursor();
    jobs.onsuccess = event => {
      const cursor = event.target.result;
      if (!cursor) return;
      const job = cursor.value || {};
      if ([job.paperId, job.matchedPaperId, job.resultPaperId].includes(paperId)) {
        cursor.delete();
        removed.importJobs += 1;
      }
      cursor.continue();
    };
    stores[LEGACY_STORE].delete(paperId);
  });
  return removed;
}

export async function movePdfAttachment(sourcePaperId, targetPaperId, attachmentId = null, { primary = true } = {}) {
  const bundle = await getPdfBundle(sourcePaperId, attachmentId);
  if (!bundle) return null;
  bundle.paperId = targetPaperId;
  bundle.primary = primary;
  await transactionResult([DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, LEGACY_STORE], 'readwrite', stores => {
    if (primary) {
      const cursorRequest = stores[DOCUMENT_STORE].index('paperId').openCursor(IDBKeyRange.only(targetPaperId));
      cursorRequest.onsuccess = event => {
        const cursor = event.target.result;
        if (!cursor) return;
        if (cursor.value.attachmentId !== bundle.attachmentId && cursor.value.primary) {
          cursor.update({ ...cursor.value, primary: false });
        }
        cursor.continue();
      };
    }
    stores[DOCUMENT_STORE].put({
      attachmentId: bundle.attachmentId,
      paperId: targetPaperId,
      primary,
      schemaVersion: 3,
      fileName: bundle.fileName,
      size: Number(bundle.size || bundle.blob?.size || 0),
      type: bundle.type || 'application/pdf',
      pageCount: Number(bundle.pageCount || bundle.pages?.length || 0),
      metadata: bundle.metadata || {},
      extractionErrors: bundle.extractionErrors || {},
      importedAt: bundle.importedAt || new Date().toISOString(),
      fingerprint: bundle.fingerprint || null,
      blob: bundle.blob
    });
    stores[TEXT_STORE].delete(IDBKeyRange.bound([bundle.attachmentId, 0], [bundle.attachmentId, Number.MAX_SAFE_INTEGER]));
    (bundle.pages || []).forEach((text, index) => stores[TEXT_STORE].put({
      attachmentId: bundle.attachmentId,
      paperId: targetPaperId,
      pageNumber: index + 1,
      text: String(text || ''),
      ocr: bundle.ocrPages?.[index + 1] || null
    }));
    stores[ANNOTATION_STORE].put({
      attachmentId: bundle.attachmentId,
      paperId: targetPaperId,
      items: Array.isArray(bundle.annotations) ? bundle.annotations : []
    });
    if (bundle.attachmentId === `primary:${sourcePaperId}`) stores[LEGACY_STORE].delete(sourcePaperId);
  });
  return bundle;
}

export async function searchPdfTextIndex(query) {
  const normalized = String(query || '').trim().toLocaleLowerCase();
  if (!normalized) return new Set();
  const db = await openPdfDatabase();
  const rows = await requestResult(db.transaction(TEXT_STORE, 'readonly').objectStore(TEXT_STORE).getAll());
  return new Set(rows.filter(row => String(row.text || '').toLocaleLowerCase().includes(normalized)).map(row => row.paperId));
}

export async function savePdfImportJob(job) {
  await transactionResult([IMPORT_STORE], 'readwrite', stores => {
    stores[IMPORT_STORE].put({ ...job, updatedAt: new Date().toISOString() });
  });
}

export async function deletePdfImportJob(id) {
  await transactionResult([IMPORT_STORE], 'readwrite', stores => stores[IMPORT_STORE].delete(id));
}

export async function loadPendingPdfImportJobs() {
  const db = await openPdfDatabase();
  const rows = await requestResult(db.transaction(IMPORT_STORE, 'readonly').objectStore(IMPORT_STORE).getAll());
  return rows.filter(row => ['queued', 'processing', 'failed'].includes(row.status));
}

export async function listPdfDocuments() {
  const db = await openPdfDatabase();
  return requestResult(db.transaction(DOCUMENT_STORE, 'readonly').objectStore(DOCUMENT_STORE).getAll());
}

export async function estimateStorage() {
  if (!navigator.storage?.estimate) return null;
  const estimate = await navigator.storage.estimate();
  return {
    usage: Number(estimate.usage || 0),
    quota: Number(estimate.quota || 0),
    persisted: navigator.storage.persisted ? await navigator.storage.persisted() : false
  };
}

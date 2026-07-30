export function normalizedTitle(value = '') {
  return String(value)
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function recordHasNotes(record) {
  return Boolean(record?.note || record?.highlights?.length || record?.pdfAttachment?.annotationCount);
}

export function isRecordRead(record) {
  return Boolean(record?.readAt || Number(record?.progress || 0) >= 100);
}

export function setRecordRead(record, read, now = new Date().toISOString()) {
  if (!record) return record;
  if (read) {
    record.readAt ||= now;
    record.progress = 100;
  } else {
    record.readAt = null;
    if (Number(record.progress || 0) >= 100) record.progress = 0;
  }
  return record;
}

export function isLibraryRecord(record) {
  if (!record?.paper) return false;
  return Boolean(
    record.savedAt
    || record.queueAt
    || record.readAt
    || Number(record.progress || 0) > 0
    || record.note
    || record.tags?.length
    || record.highlights?.length
    || record.collections?.length
    || record.pdfAttachment
    || record.pdfAttachments?.length
    || record.archivedAt
    || record.trashAt
  );
}

export function isActiveRecord(record) {
  return isLibraryRecord(record) && !record.archivedAt && !record.trashAt;
}

function normalizedCollection(collection, fallbackName, order) {
  return {
    name: String(collection?.name || fallbackName).trim().slice(0, 60) || fallbackName,
    parentId: collection?.parentId || null,
    color: /^#[0-9a-f]{6}$/i.test(collection?.color || '') ? collection.color : '#116347',
    icon: String(collection?.icon || 'folder').slice(0, 24),
    description: String(collection?.description || '').trim().slice(0, 180),
    order: Number.isFinite(Number(collection?.order)) ? Number(collection.order) : order,
    createdAt: collection?.createdAt || null
  };
}

export function validateCollectionTree(collections = {}) {
  const normalized = {};
  for (const [index, [id, collection]] of Object.entries(collections || {}).entries()) {
    if (!id || !collection || typeof collection !== 'object') continue;
    normalized[id] = normalizedCollection(collection, `分类 ${index + 1}`, index);
  }
  for (const [id, collection] of Object.entries(normalized)) {
    if (!normalized[collection.parentId] || collection.parentId === id) collection.parentId = null;
  }
  for (const id of Object.keys(normalized)) {
    const path = new Set([id]);
    let cursor = normalized[id].parentId;
    while (cursor) {
      if (path.has(cursor)) {
        normalized[id].parentId = null;
        break;
      }
      path.add(cursor);
      cursor = normalized[cursor]?.parentId || null;
    }
  }
  return normalized;
}

function migratedRecord(record = {}) {
  return {
    ...record,
    savedAt: record.savedAt || null,
    queueAt: record.queueAt || null,
    readAt: record.readAt || null,
    lastOpenedAt: record.lastOpenedAt || record.readAt || null,
    archivedAt: record.archivedAt || null,
    trashAt: record.trashAt || null,
    progress: Number(record.progress || (record.readAt ? 100 : 0)),
    tags: Array.isArray(record.tags) ? [...new Set(record.tags.filter(Boolean))] : [],
    highlights: Array.isArray(record.highlights) ? record.highlights : [],
    collections: Array.isArray(record.collections) ? [...new Set(record.collections.filter(Boolean))] : [],
    pdfAttachments: Array.isArray(record.pdfAttachments)
      ? record.pdfAttachments
      : record.pdfAttachment
        ? [record.pdfAttachment]
        : []
  };
}

export function migrateLibraryData(value, defaults, now = new Date().toISOString()) {
  const source = value && typeof value === 'object' ? value : {};
  const base = typeof defaults === 'function' ? defaults() : structuredClone(defaults || {});
  const collections = validateCollectionTree(source.collections || {});
  const records = Object.fromEntries(Object.entries(source.records || {})
    .filter(([, record]) => record?.paper)
    .map(([id, record]) => {
      const migrated = migratedRecord(record);
      migrated.collections = migrated.collections.filter(collectionId => collections[collectionId]);
      return [id, migrated];
    }));
  const recent = Object.fromEntries(Object.entries(source.recent || {})
    .filter(([, item]) => item?.paper && item?.lastOpenedAt)
    .map(([id, item]) => [id, { paper: item.paper, lastOpenedAt: item.lastOpenedAt }]));
  return {
    ...base,
    ...source,
    version: 4,
    migratedAt: Number(source.version || 0) < 4 ? now : source.migratedAt || null,
    profile: { ...(base.profile || {}), ...(source.profile || {}) },
    records,
    recent,
    collections,
    savedVenues: Array.isArray(source.savedVenues) ? [...new Set(source.savedVenues.filter(Boolean))] : [],
    dailyProgress: source.dailyProgress && typeof source.dailyProgress === 'object' ? source.dailyProgress : {},
    vocabulary: source.vocabulary && typeof source.vocabulary === 'object' ? source.vocabulary : {}
  };
}

export function applyBatchAction(library, ids, action, payload = {}, now = new Date().toISOString()) {
  let changed = 0;
  for (const id of [...new Set(ids || [])]) {
    const record = library?.records?.[id];
    if (!record?.paper) continue;
    if (!['trash', 'restore'].includes(action) && record.trashAt) record.trashAt = null;
    if (!['archive', 'trash', 'restore'].includes(action) && record.archivedAt) record.archivedAt = null;
    if (action === 'read') setRecordRead(record, true, now);
    else if (action === 'unread') setRecordRead(record, false, now);
    else if (action === 'queue') record.queueAt ||= now;
    else if (action === 'unqueue') record.queueAt = null;
    else if (action === 'save') record.savedAt ||= now;
    else if (action === 'unsave') record.savedAt = null;
    else if (action === 'archive') { record.archivedAt = now; record.trashAt = null; }
    else if (action === 'trash') { record.trashAt = now; record.archivedAt = null; }
    else if (action === 'restore') { record.trashAt = null; record.archivedAt = null; }
    else if (action === 'collection-add' && payload.collectionId) {
      record.collections = [...new Set([...(record.collections || []), payload.collectionId])];
    } else if (action === 'collection-remove' && payload.collectionId) {
      record.collections = (record.collections || []).filter(id => id !== payload.collectionId);
    } else {
      continue;
    }
    changed += 1;
  }
  return changed;
}

export function libraryStatistics(library, publicationStatus) {
  const records = Object.values(library?.records || {}).filter(isActiveRecord);
  return {
    saved: records.filter(record => record.savedAt).length,
    queue: records.filter(record => record.queueAt).length,
    read: records.filter(isRecordRead).length,
    notes: records.filter(recordHasNotes).length,
    published: records.filter(record => record.savedAt && publicationStatus(record) === 'published').length,
    terms: Object.keys(library?.vocabulary || {}).length
  };
}

export function parsePdfAuthors(rawAuthor = '') {
  const value = String(rawAuthor || '').trim();
  if (!value || /^(anonymous|unknown|none)$/i.test(value)) return [];
  const separator = /[;；]|\s+\band\b\s+/i;
  if (separator.test(value)) return [...new Set(value.split(separator).map(item => item.trim()).filter(Boolean))];
  if ((value.match(/,/g) || []).length >= 2) return [...new Set(value.split(',').map(item => item.trim()).filter(Boolean))];
  return [value];
}

export function derivePdfMetadata(stored, file) {
  const rawTitle = String(stored?.metadata?.title || '').trim();
  const lines = (stored?.pages || []).flatMap(text => String(text || '').split(/\r?\n/)).map(value => value.trim());
  const firstLine = lines.find(value => value.length >= 8 && value.length <= 220 && !/^(journal|proceedings|arxiv|copyright)\b/i.test(value));
  const title = rawTitle && !/^(untitled|document|unknown|microsoft word)$/i.test(rawTitle)
    ? rawTitle
    : firstLine || String(file?.name || stored?.fileName || '本地论文').replace(/\.pdf$/i, '');
  const excerpt = (stored?.pages || []).find(Boolean)?.replace(/\s+/g, ' ').slice(0, 2400) || '';
  const arxivId = excerpt.match(/\barXiv:\s*(\d{4}\.\d{4,5})(?:v\d+)?\b/i)?.[1] || null;
  const doiCandidates = [...excerpt.matchAll(/\b10\.\d{4,9}\/[-._;()/:A-Z0-9]+\b/gi)]
    .map(match => match[0].replace(/[.,;)\]]+$/, ''));
  return {
    title,
    authors: parsePdfAuthors(stored?.metadata?.author),
    excerpt: excerpt.slice(0, 1500),
    doi: doiCandidates[0] || null,
    arxivId
  };
}

export function findPdfPaperMatch(metadata, papers) {
  const doi = String(metadata?.doi || '').toLocaleLowerCase();
  const arxivId = String(metadata?.arxivId || '').replace(/v\d+$/i, '').toLocaleLowerCase();
  const title = normalizedTitle(metadata?.title);
  let best = null;
  for (const paper of papers || []) {
    const paperDoi = String(paper?.doi || '').toLocaleLowerCase();
    const paperArxiv = String(paper?.arxivId || '').replace(/v\d+$/i, '').toLocaleLowerCase();
    const paperTitle = normalizedTitle(paper?.title);
    let confidence = 0;
    let reason = '';
    if (doi && paperDoi && doi === paperDoi) {
      confidence = 1;
      reason = 'DOI 完全一致';
    } else if (arxivId && paperArxiv && arxivId === paperArxiv) {
      confidence = .99;
      reason = 'arXiv ID 完全一致';
    } else if (title && paperTitle && title === paperTitle) {
      confidence = .96;
      reason = '标题完全一致';
    } else if (title.length >= 18 && paperTitle.length >= 18) {
      const a = new Set(title.split(' '));
      const b = new Set(paperTitle.split(' '));
      confidence = 2 * [...a].filter(token => b.has(token)).length / (a.size + b.size);
      if (confidence >= .82) reason = '标题高度相似';
    }
    if (confidence && (!best || confidence > best.confidence)) best = { paper, confidence, reason };
  }
  return best;
}

export async function pdfFileFingerprint(file) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, '0')).join('');
}

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

export function libraryStatistics(library, publicationStatus) {
  const records = Object.values(library?.records || {}).filter(record => record?.paper);
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

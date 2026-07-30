import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBatchAction,
  derivePdfMetadata,
  findPdfPaperMatch,
  isActiveRecord,
  isLibraryRecord,
  isRecordRead,
  libraryStatistics,
  migrateLibraryData,
  normalizedTitle,
  parsePdfAuthors,
  pdfFileFingerprint,
  recordHasNotes,
  setRecordRead,
  validateCollectionTree
} from '../library-logic.js';

test('read state keeps progress and timestamp consistent', () => {
  const record = { progress: 25, readAt: null };
  setRecordRead(record, true, '2026-07-29T00:00:00.000Z');
  assert.equal(record.progress, 100);
  assert.equal(record.readAt, '2026-07-29T00:00:00.000Z');
  assert.equal(isRecordRead(record), true);
  setRecordRead(record, false);
  assert.equal(record.progress, 0);
  assert.equal(record.readAt, null);
});

test('PDF annotations count as notes in statistics', () => {
  const library = {
    records: {
      one: { paper: { id: 'one' }, savedAt: 'x', pdfAttachment: { annotationCount: 2 }, progress: 0 },
      two: { paper: { id: 'two' }, progress: 100 }
    },
    vocabulary: { term: {} }
  };
  assert.equal(recordHasNotes(library.records.one), true);
  assert.deepEqual(libraryStatistics(library, () => 'unchecked'), {
    saved: 1, queue: 0, read: 1, notes: 1, published: 0, terms: 1
  });
});

test('metadata parsing does not turn the file timestamp into publication time', () => {
  const stored = {
    metadata: { title: 'A Reliable PDF System', author: 'Ada Lovelace; Alan Turing' },
    pages: ['A Reliable PDF System\narXiv: 2607.01234\nDOI 10.1234/TEST.42\nAbstract text']
  };
  const result = derivePdfMetadata(stored, { name: 'fallback.pdf', lastModified: 1 });
  assert.equal(result.title, 'A Reliable PDF System');
  assert.deepEqual(result.authors, ['Ada Lovelace', 'Alan Turing']);
  assert.equal(result.doi, '10.1234/TEST.42');
  assert.equal(result.arxivId, '2607.01234');
});

test('matching prioritizes DOI, arXiv and normalized title', () => {
  const papers = [
    { id: 'doi', title: 'Different', doi: '10.1234/test.42' },
    { id: 'title', title: 'A Reliable PDF System' }
  ];
  assert.equal(findPdfPaperMatch({ title: 'Other', doi: '10.1234/TEST.42' }, papers).paper.id, 'doi');
  assert.equal(findPdfPaperMatch({ title: 'A  reliable—PDF system' }, papers).paper.id, 'title');
  assert.equal(normalizedTitle('  多模态：推理  '), '多模态 推理');
  assert.deepEqual(parsePdfAuthors('Grace Hopper'), ['Grace Hopper']);
});

test('PDF fingerprint is content based and independent of file name', async () => {
  const first = new Blob(['same PDF bytes'], { type: 'application/pdf' });
  const renamed = new Blob(['same PDF bytes'], { type: 'application/pdf' });
  const different = new Blob(['different PDF bytes'], { type: 'application/pdf' });
  assert.equal(await pdfFileFingerprint(first), await pdfFileFingerprint(renamed));
  assert.notEqual(await pdfFileFingerprint(first), await pdfFileFingerprint(different));
});

test('library membership excludes history-only, archived and trashed records from active statistics', () => {
  const historyOnly = { paper: { id: 'history' }, lastOpenedAt: '2026-07-29T00:00:00.000Z' };
  const active = { paper: { id: 'active' }, savedAt: 'x', progress: 100 };
  const archived = { paper: { id: 'archived' }, savedAt: 'x', archivedAt: '2026-07-29T00:00:00.000Z' };
  const trashed = { paper: { id: 'trashed' }, note: 'keep', trashAt: '2026-07-29T00:00:00.000Z' };
  assert.equal(isLibraryRecord(historyOnly), false);
  assert.equal(isActiveRecord(active), true);
  assert.equal(isActiveRecord(archived), false);
  assert.equal(isActiveRecord(trashed), false);
  assert.deepEqual(libraryStatistics({ records: { active, archived, trashed }, vocabulary: {} }, () => 'unchecked'), {
    saved: 1, queue: 0, read: 1, notes: 0, published: 0, terms: 0
  });
});

test('batch actions support category, archive, trash and restore lifecycle', () => {
  const library = {
    records: {
      one: { paper: { id: 'one' }, savedAt: 'x', collections: [], progress: 0 },
      two: { paper: { id: 'two' }, savedAt: 'x', collections: [], progress: 0 }
    }
  };
  assert.equal(applyBatchAction(library, ['one', 'two'], 'collection-add', { collectionId: 'research' }, 'now'), 2);
  assert.deepEqual(library.records.one.collections, ['research']);
  applyBatchAction(library, ['one'], 'archive', {}, 'archive-time');
  assert.equal(library.records.one.archivedAt, 'archive-time');
  applyBatchAction(library, ['one'], 'trash', {}, 'trash-time');
  assert.equal(library.records.one.archivedAt, null);
  assert.equal(library.records.one.trashAt, 'trash-time');
  applyBatchAction(library, ['one'], 'restore');
  assert.equal(library.records.one.trashAt, null);
  assert.equal(library.records.one.archivedAt, null);
});

test('collection validation removes missing parents and breaks cycles', () => {
  const collections = validateCollectionTree({
    a: { name: 'A', parentId: 'b' },
    b: { name: 'B', parentId: 'a' },
    c: { name: 'C', parentId: 'missing' },
    self: { name: 'Self', parentId: 'self' }
  });
  const parentChain = id => {
    const seen = new Set();
    while (id) {
      assert.equal(seen.has(id), false, 'collection tree must not contain a cycle');
      seen.add(id);
      id = collections[id]?.parentId || null;
    }
  };
  for (const id of Object.keys(collections)) parentChain(id);
  assert.equal(collections.c.parentId, null);
  assert.equal(collections.self.parentId, null);
});

test('v3 migration preserves user data and adds v4 lifecycle defaults', () => {
  const migrated = migrateLibraryData({
    version: 3,
    profile: { name: 'Ada' },
    records: {
      paper: { paper: { id: 'paper', title: 'Paper' }, savedAt: 'x', collections: ['valid', 'missing'] }
    },
    collections: { valid: { name: 'Valid' } },
    vocabulary: { term: { source: 'term' } }
  }, () => ({
    version: 4,
    profile: { name: '研究者', focus: '' },
    records: {},
    recent: {},
    collections: {},
    savedVenues: [],
    dailyProgress: {},
    vocabulary: {}
  }), '2026-07-30T00:00:00.000Z');
  assert.equal(migrated.version, 4);
  assert.equal(migrated.profile.name, 'Ada');
  assert.deepEqual(migrated.records.paper.collections, ['valid']);
  assert.equal(migrated.records.paper.archivedAt, null);
  assert.equal(migrated.records.paper.trashAt, null);
  assert.equal(migrated.vocabulary.term.source, 'term');
  assert.equal(migrated.migratedAt, '2026-07-30T00:00:00.000Z');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePdfMetadata,
  findPdfPaperMatch,
  isRecordRead,
  libraryStatistics,
  normalizedTitle,
  parsePdfAuthors,
  pdfFileFingerprint,
  recordHasNotes,
  setRecordRead
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

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, storage, manifest] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../pdf-storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8').then(JSON.parse)
]);

for (const id of [
  'pdf-import-modal',
  'pdf-import-dropzone',
  'pdf-import-queue',
  'local-pdf-directory',
  'appearance-modal',
  'library-tab-select'
]) assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);

assert.match(html, /id="local-pdf-file"[^>]*multiple/, 'PDF picker must support multiple files');
assert.doesNotMatch(html.slice(html.lastIndexOf('<style>')), /\.page-head \.page-actions\s*\{\s*display:none/, 'final responsive overrides must keep page actions visible');
assert.match(storage, /const DOCUMENT_STORE = 'pdfDocuments'/);
assert.match(storage, /const TEXT_STORE = 'pdfTextPages'/);
assert.match(storage, /const ANNOTATION_STORE = 'pdfAnnotations'/);
assert.match(storage, /transactionResult\(\[DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, LEGACY_STORE\]/, 'attachment moves must be atomic');
assert.match(app, /putPdfAnnotations\(state\.pdfPaperId/, 'annotation persistence must use the annotation store');
assert.match(app, /searchPdfTextIndex\(query\)/, 'library search must use the text-only index');
assert.match(app, /sourceDocuments[\s\S]+movePdfAttachment\(sourceId, targetId, document\.attachmentId/, 'duplicate merges must move every attachment');
assert.ok(Array.isArray(manifest.file_handlers) && manifest.file_handlers[0].accept['application/pdf'].includes('.pdf'));

console.log('Application contract checks passed.');

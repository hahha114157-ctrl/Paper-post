import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, storage, uiLogic, manifest] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../pdf-storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../ui-logic.js', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8').then(JSON.parse)
]);

for (const id of [
  'pdf-import-modal',
  'pdf-import-dropzone',
  'pdf-import-queue',
  'local-pdf-directory',
  'appearance-modal',
  'library-tab-select',
  'view-settings',
  'batch-collection-select',
  'batch-trash',
  'batch-restore',
  'batch-delete-permanent',
  'empty-trash',
  'pdf-import-collection',
  'news-group',
  'pdf-toolbar-config',
  'pdf-sidebar-controls-slot',
  'pdf-text-mode',
  'pdf-translate-page',
  'appearance-reader-controls',
  'appearance-reader-text'
]) assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);

assert.match(html, /id="local-pdf-file"[^>]*multiple/, 'PDF picker must support multiple files');
assert.match(html, /id="mobile-more"[^>]*aria-haspopup="menu"[^>]*aria-controls="mobile-more-menu"/, 'More button must expose menu semantics');
assert.match(html, /class="nav-group-label">工作台/, 'desktop navigation must expose grouped sections');
assert.match(html, /class="nav-group-label">研究内容/, 'research routes must have a distinct navigation section');
assert.match(html, /class="nav-group-label">资料与动态/, 'library and news routes must have a distinct navigation section');
assert.match(html, /id="library-batchbar"[^>]*class="batchbar hidden"|class="batchbar hidden"[^>]*id="library-batchbar"/, 'batch toolbar must be hidden until selection');
assert.match(html, /\.paper-title:hover h3[\s\S]+text-decoration-color:currentColor/, 'paper titles must expose hover feedback');
assert.match(html, /\.library-row\.selected[\s\S]+box-shadow:inset 4px 0 var\(--green\)/, 'selected library rows need a persistent visual state');
assert.doesNotMatch(html.slice(html.lastIndexOf('<style>')), /\.page-head \.page-actions\s*\{\s*display:none/, 'final responsive overrides must keep page actions visible');
assert.match(storage, /const DOCUMENT_STORE = 'pdfDocuments'/);
assert.match(storage, /const TEXT_STORE = 'pdfTextPages'/);
assert.match(storage, /const ANNOTATION_STORE = 'pdfAnnotations'/);
assert.match(storage, /transactionResult\(\[DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, LEGACY_STORE\]/, 'attachment moves must be atomic');
assert.match(storage, /export async function deleteAllPdfAttachments\(paperId\)/, 'permanent deletion must clear every PDF store');
assert.match(app, /putPdfAnnotations\(state\.pdfPaperId/, 'annotation persistence must use the annotation store');
assert.match(app, /searchPdfTextIndex\(query\)/, 'library search must use the text-only index');
assert.match(app, /sourceDocuments[\s\S]+movePdfAttachment\(sourceId, targetId, document\.attachmentId/, 'duplicate merges must move every attachment');
assert.match(app, /const STORAGE_KEY = 'paperscope-library-v4'/, 'library schema v4 must be active');
assert.match(app, /function moveRecordsToTrash\(/, 'soft delete with undo must exist');
assert.match(app, /function permanentlyDeleteRecords\(/, 'permanent delete workflow must exist');
assert.match(app, /groupNewsItems\(filtered, groupMode\)/, 'news must be ordered into meaningful groups');
assert.match(app, /function renderPdfPageText\(/, 'PDF side text must have structured rendering');
assert.match(app, /function placePdfReaderControls\(/, 'PDF controls must support top and sidebar placement');
assert.match(uiLogic, /export function segmentReaderText\(/, 'reader text segmentation must remain independently testable');
assert.match(uiLogic, /export function groupNewsItems\(/, 'news grouping must remain independently testable');
assert.match(app, /event\.key === 'Escape'[\s\S]+closeMobileMore/, 'More menu must close with Escape');
assert.ok(Array.isArray(manifest.file_handlers) && manifest.file_handlers[0].accept['application/pdf'].includes('.pdf'));

console.log('Application contract checks passed.');

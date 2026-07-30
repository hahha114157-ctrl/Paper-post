import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, storage, uiLogic, manifest, buildScript] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../pdf-storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../ui-logic.js', import.meta.url), 'utf8'),
  readFile(new URL('../manifest.webmanifest', import.meta.url), 'utf8').then(JSON.parse),
  readFile(new URL('./build-static.mjs', import.meta.url), 'utf8')
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
  'pdf-snapshot-selection',
  'pdf-snapshot-page',
  'pdf-snapshot-layer',
  'pdf-snipping-hint',
  'pdf-pane-notes',
  'pdf-workspace-editor',
  'pdf-note-add-image',
  'pdf-note-add-snapshot',
  'pdf-note-export',
  'install-app-state',
  'appearance-note-font'
]) assert.match(html, new RegExp(`id="${id}"`), `${id} must exist`);

assert.match(html, /id="local-pdf-file"[^>]*multiple/, 'PDF picker must support multiple files');
assert.match(html, /id="mobile-more"[^>]*aria-haspopup="menu"[^>]*aria-controls="mobile-more-menu"/, 'More button must expose menu semantics');
assert.match(html, /class="nav-group-label">工作台/, 'desktop navigation must expose grouped sections');
assert.match(html, /class="nav-group-label">研究内容/, 'research routes must have a distinct navigation section');
assert.match(html, /class="nav-group-label">资料与动态/, 'library and news routes must have a distinct navigation section');
const moreMenu = html.slice(html.indexOf('<div class="mobile-more-menu"'), html.indexOf('<main class="main">'));
assert.match(moreMenu, /id="install-app"/, 'app installation must live in More');
assert.doesNotMatch(moreMenu, /data-route="settings"|翻译历史|快捷键与帮助/, 'More must not duplicate settings or expose dead-end helpers');
assert.match(html, /id="library-batchbar"[^>]*class="batchbar hidden"|class="batchbar hidden"[^>]*id="library-batchbar"/, 'batch toolbar must be hidden until selection');
assert.match(html, /\.paper-title:hover h3[\s\S]+text-decoration-color:currentColor/, 'paper titles must expose hover feedback');
assert.match(html, /\.paper-title h3[\s\S]+cursor:pointer/, 'paper title text must keep link cursor semantics');
assert.match(html, /\.news-card:hover \.news-extra[\s\S]+grid-template-rows:1fr/, 'news cards must expand supplemental content without runtime fetching');
assert.ok(html.indexOf('id="detail-link"') < html.indexOf('<div class="drawer-actions">'), 'original paper link must stay above secondary drawer actions');
assert.match(html, /\.library-row\.selected[\s\S]+box-shadow:inset 4px 0 var\(--green\)/, 'selected library rows need a persistent visual state');
assert.doesNotMatch(html.slice(html.lastIndexOf('<style>')), /\.page-head \.page-actions\s*\{\s*display:none/, 'final responsive overrides must keep page actions visible');
assert.doesNotMatch(html, /id="pdf-page-text"|data-pdf-pane-tab="text"/, 'redundant PDF page-text panel must be removed');
assert.ok(html.indexOf('<summary>更多工具</summary>') < html.indexOf('id="pdf-ocr-page"'), 'OCR must live inside the secondary tools menu');
assert.match(storage, /const DOCUMENT_STORE = 'pdfDocuments'/);
assert.match(storage, /const TEXT_STORE = 'pdfTextPages'/);
assert.match(storage, /const ANNOTATION_STORE = 'pdfAnnotations'/);
assert.match(storage, /const WORKSPACE_STORE = 'pdfWorkspaceNotes'/);
assert.match(storage, /transactionResult\(\[DOCUMENT_STORE, TEXT_STORE, ANNOTATION_STORE, WORKSPACE_STORE, LEGACY_STORE\]/, 'attachment moves must include notes atomically');
assert.match(storage, /export async function deleteAllPdfAttachments\(paperId\)/, 'permanent deletion must clear every PDF store');
assert.match(app, /putPdfAnnotations\(paperId, pdfRecord\.attachmentId/, 'annotation persistence must use the annotation store');
assert.match(app, /putPdfWorkspaceNote\(paperId, pdfRecord\.attachmentId/, 'reading notebook must use the dedicated IndexedDB store');
assert.match(app, /searchPdfTextIndex\(query\)/, 'library search must use the text-only index');
assert.match(app, /sourceDocuments[\s\S]+movePdfAttachment\(sourceId, targetId, document\.attachmentId/, 'duplicate merges must move every attachment');
assert.match(app, /const STORAGE_KEY = 'paperscope-library-v4'/, 'library schema v4 must be active');
assert.match(app, /function moveRecordsToTrash\(/, 'soft delete with undo must exist');
assert.match(app, /function permanentlyDeleteRecords\(/, 'permanent delete workflow must exist');
assert.match(app, /groupNewsItems\(filtered, groupMode\)/, 'news must be ordered into meaningful groups');
assert.match(app, /function renderPdfWorkspaceNote\(/, 'PDF reader must expose a persistent notebook');
assert.match(app, /function placePdfReaderControls\([\s\S]+sideSlot\.append\(config\)/, 'PDF controls must stay in the left sidebar');
assert.match(app, /function createPdfSnapshot\([\s\S]+canvas\.toBlob[\s\S]+URL\.createObjectURL[\s\S]+blob/, 'PDF screenshot selections must remain available for floating comparison and notes');
assert.match(app, /pdfSnapshots\.length >= 4/, 'temporary screenshot windows must remain bounded');
assert.match(app, /PDF_NOTE_MAX_IMAGES = 12[\s\S]+PDF_NOTE_MAX_BYTES = 8 \* 1024 \* 1024/, 'image notes must have explicit capacity limits');
assert.doesNotMatch(app, /TRANSLATION_HISTORY_KEY|rememberTranslation|translationHistory/, 'redundant translation history persistence must be removed');
assert.match(uiLogic, /export function segmentReaderText\(/, 'reader text segmentation must remain independently testable');
assert.match(uiLogic, /export function groupNewsItems\(/, 'news grouping must remain independently testable');
assert.match(uiLogic, /export function limitTranslationCache\(/, 'translation cache capacity must remain independently testable');
for (const source of ['NVIDIA Developer', 'AWS AI', 'GitHub AI']) assert.match(buildScript, new RegExp(source), `${source} official feed must be configured`);
assert.match(app, /event\.key === 'Escape'[\s\S]+closeMobileMore/, 'More menu must close with Escape');
assert.ok(Array.isArray(manifest.file_handlers) && manifest.file_handlers[0].accept['application/pdf'].includes('.pdf'));

console.log('Application contract checks passed.');

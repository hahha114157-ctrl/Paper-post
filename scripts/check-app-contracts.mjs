import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [app, html, storage, uiLogic, notePdf, manifest, buildScript] = await Promise.all([
  readFile(new URL('../app.js', import.meta.url), 'utf8'),
  readFile(new URL('../index.html', import.meta.url), 'utf8'),
  readFile(new URL('../pdf-storage.js', import.meta.url), 'utf8'),
  readFile(new URL('../ui-logic.js', import.meta.url), 'utf8'),
  readFile(new URL('../note-pdf-export.js', import.meta.url), 'utf8'),
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
  'pdf-pane-resizer',
  'pdf-search-clear',
  'pdf-workspace-editor',
  'pdf-note-add-image',
  'pdf-note-add-snapshot',
  'pdf-note-font-size',
  'pdf-note-undo',
  'pdf-note-redo',
  'pdf-note-export',
  'note-export-modal',
  'note-export-format',
  'note-export-font',
  'note-export-font-size',
  'note-export-metadata',
  'note-export-images',
  'translation-dock',
  'top-translation-dock-host',
  'pdf-translation-dock-host',
  'pdf-zoom-range',
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
assert.match(html, /\.news-card:hover \.news-extra[\s\S]+visibility:visible/, 'news cards must reveal supplemental content without runtime fetching');
assert.match(html, /\.news-extra\{display:grid;grid-template-rows:0fr/, 'news details must slide open inside the hovered card');
assert.match(html, /\.news-card:hover \.news-extra[\s\S]+grid-template-rows:1fr/, 'news hover must expand details with the original sliding interaction');
assert.match(html, /html\{overflow-y:scroll;scrollbar-gutter:stable\}/, 'route changes must reserve scrollbar width and keep the library header stable');
assert.match(html, /\.news-cluster-grid\{[^}]*align-items:start/, 'news grid must not stretch an inactive sibling when one card expands');
assert.match(html, /\.news-column\{[^}]*align-content:start/, 'news columns must expand independently');
assert.match(app, /原文预览图[\s\S]+中文速览/, 'expanded news must combine original imagery with a Chinese overview');
assert.ok(html.indexOf('id="detail-link"') < html.indexOf('<div class="drawer-actions">'), 'original paper link must stay above secondary drawer actions');
assert.match(html, /\.library-row\.selected[\s\S]+box-shadow:inset 4px 0 var\(--green\)/, 'selected library rows need a persistent visual state');
assert.match(html, /\.batchbar\{position:fixed!important/, 'batch actions must float without shifting library rows');
assert.match(html, /library-membership-popover/, 'library titles must reveal membership details on hover');
const libraryView = html.slice(html.indexOf('id="view-library"'), html.indexOf('id="view-news"'));
assert.doesNotMatch(libraryView, /<option value="published">|<option value="smart">|data-tab="published"|data-tab="smart"/, 'unclear published and smart tabs must be removed');
assert.doesNotMatch(html, /id="translation-context-section"|id="translation-context"/, 'translation popover must not expose redundant context');
assert.doesNotMatch(html.slice(html.lastIndexOf('<style>')), /\.page-head \.page-actions\s*\{\s*display:none/, 'final responsive overrides must keep page actions visible');
assert.doesNotMatch(html, /id="pdf-page-text"|data-pdf-pane-tab="text"/, 'redundant PDF page-text panel must be removed');
assert.ok(html.indexOf('<summary>更多工具</summary>') < html.indexOf('id="pdf-ocr-page"'), 'OCR must live inside the secondary tools menu');
assert.match(html, /\.pdf-text-pane \.pdf-export-menu>div\{position:absolute/, 'secondary PDF tools must overlay instead of consuming notebook space');
assert.match(html, /\.pdf-export-menu,[^{]+\{user-select:none/, 'secondary PDF tool labels must not become text selections during rapid clicks');
assert.match(html, /id="pdf-zoom" type="number"[\s\S]+id="pdf-zoom-output"/, 'PDF zoom must support typed percentages and a live slider value');
assert.match(html, /class="small pdf-tool-button"[\s\S]+<kbd>H<\/kbd>/, 'annotation shortcuts must be visually separated from tool labels');
assert.match(html, /\.pdf-search-results\{position:absolute/, 'PDF search results must overlay instead of consuming notebook space');
assert.match(html, /id="pdf-pane-resizer"[^>]*role="separator"/, 'reader pane must expose an accessible resize handle');
assert.doesNotMatch(html, /id="pdf-note-images"/, 'notebook images must stay inline with text instead of using a bottom gallery');
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
assert.match(app, /function insertPdfWorkspaceFigure\([\s\S]+range\.startContainer[\s\S]+block\.after\(figure, paragraph\)/, 'notebook images must be inserted at the active document position');
assert.match(app, /figure\.dataset\.pdfNoteWidth[\s\S]+clampPdfNoteImageWidth/, 'inline notebook images must preserve an adjustable width');
assert.match(app, /function applyPdfZoomPercent\([\s\S]+PDF_ZOOM_KEY/, 'typed PDF zoom must be bounded and persisted');
assert.match(app, /PDF 标注已删除[\s\S]+actionLabel: '撤销'/, 'PDF annotation deletion must be immediate and undoable');
assert.doesNotMatch(app, /action === 'delete' && confirm\('删除这条 PDF 标注/, 'PDF annotation deletion must not use a browser confirmation dialog');
assert.match(app, /pdf-highlight-surface/, 'PDF highlights must share one compositing surface so overlaps do not darken repeatedly');
assert.match(app, /function sanitizePdfWorkspaceHtml\(/, 'rich notebook persistence must sanitize stored HTML');
assert.match(app, /function commitPdfNoteHistory\([\s\S]+pdfWorkspaceEditorHtml/, 'notebook must keep a custom history that includes inserted images');
assert.match(app, /function undoPdfWorkspaceNote\([\s\S]+restorePdfNoteHistory/, 'notebook history must support undo');
assert.match(app, /function updatePdfNoteCommandStates\([\s\S]+queryCommandState/, 'notebook format buttons must reflect the active selection');
assert.match(app, /event\.key === 'Tab'[\s\S]+execCommand\('insertText'[\s\S]+commitPdfNoteHistory/, 'notebook Tab indentation must be undoable');
assert.match(app, /buildNoteDocx\([\s\S]+application\/vnd\.openxmlformats-officedocument\.wordprocessingml\.document/, 'notebook export must generate a real Word document');
assert.match(app, /buildNotePdf\([\s\S]+application\/pdf/, 'notebook export must generate a real PDF document');
assert.match(notePdf, /const drawMetadataRow[\s\S]+textAlign = 'right'[\s\S]+fillText\(lines\[index\], valueX/, 'PDF metadata labels and values must use aligned columns');
assert.match(app, /api\.mymemory\.translated\.net\/get/, 'online refine must have a working public fallback');
assert.match(app, /const text = payload\?\.source[\s\S]+SpeechSynthesisUtterance\(text\)[\s\S]+utterance\.lang = 'en-US'/, 'speech must read the English source');
assert.match(app, /function moveTranslationPopoverToDock\([\s\S]+host\.append\(popover\)/, 'translation integration must move into a real title-bar host');
assert.match(app, /function dismissIndependentTranslation\([\s\S]+!translationSettings\.docked/, 'only independent translation windows should dismiss on unrelated clicks');
assert.match(app, /modal\.id !== 'pdf-modal'/, 'clicking the reader backdrop must not close the PDF reader');
assert.match(app, /function applyPdfPaneWidth\([\s\S]+PDF_PANE_WIDTH_KEY/, 'reader pane resizing must be bounded and persisted');
assert.match(app, /function pdfSearchMatchesForPage\([\s\S]+while \(query[\s\S]+matches\.push/, 'PDF search must retain every exact normalized occurrence');
assert.match(app, /function renderPdfSearchHighlightsForStack\([\s\S]+pdf-search-mark/, 'PDF search matches must be highlighted on the rendered page');
assert.match(app, /function placePdfReaderControls\([\s\S]+sideSlot\.append\(config\)/, 'PDF controls must stay in the left sidebar');
assert.match(app, /function createPdfSnapshot\([\s\S]+canvas\.toBlob[\s\S]+URL\.createObjectURL[\s\S]+blob/, 'PDF screenshot selections must remain available for floating comparison and notes');
assert.match(app, /pdfSnapshots\.length >= 4/, 'temporary screenshot windows must remain bounded');
assert.match(app, /PDF_NOTE_MAX_IMAGES = 12[\s\S]+PDF_NOTE_MAX_BYTES = 8 \* 1024 \* 1024/, 'image notes must have explicit capacity limits');
assert.match(storage, /html: String\(note\?\.html \|\| ''\)/, 'rich notebook HTML must be persisted in its dedicated store');
assert.doesNotMatch(app, /TRANSLATION_HISTORY_KEY|rememberTranslation|translationHistory/, 'redundant translation history persistence must be removed');
assert.match(uiLogic, /export function segmentReaderText\(/, 'reader text segmentation must remain independently testable');
assert.match(uiLogic, /export function groupNewsItems\(/, 'news grouping must remain independently testable');
assert.match(uiLogic, /export function limitTranslationCache\(/, 'translation cache capacity must remain independently testable');
assert.match(uiLogic, /export function clampPdfZoomPercent\(/, 'typed PDF zoom bounds must remain independently testable');
for (const source of ['NVIDIA Developer', 'AWS AI', 'GitHub AI']) assert.match(buildScript, new RegExp(source), `${source} official feed must be configured`);
assert.match(app, /event\.key === 'Escape'[\s\S]+closeMobileMore/, 'More menu must close with Escape');
assert.ok(Array.isArray(manifest.file_handlers) && manifest.file_handlers[0].accept['application/pdf'].includes('.pdf'));

console.log('Application contract checks passed.');

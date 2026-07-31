import test from 'node:test';
import assert from 'node:assert/strict';
import { buildNoteDocx, crc32 } from '../note-export.js';

function zipEntries(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  const entries = new Map();
  let offset = 0;
  while (offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50) {
    const size = view.getUint32(offset + 18, true);
    const nameLength = view.getUint16(offset + 26, true);
    const extraLength = view.getUint16(offset + 28, true);
    const nameStart = offset + 30;
    const dataStart = nameStart + nameLength + extraLength;
    const name = decoder.decode(bytes.slice(nameStart, nameStart + nameLength));
    entries.set(name, bytes.slice(dataStart, dataStart + size));
    offset = dataStart + size;
  }
  return entries;
}

test('crc32 matches the standard ZIP checksum vector', () => {
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
});

test('Word export is a readable OOXML package with metadata, formatting and images', () => {
  const png = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10);
  const bytes = buildNoteDocx({
    title: '安全智能体研究',
    exportedAt: '2026-07-31T12:00:00.000Z',
    metadata: [
      { label: '作者', value: '测试作者' },
      { label: 'DOI', value: '10.1000/test' }
    ],
    blocks: [
      { type: 'paragraph', runs: [{ text: '关键结论', bold: true }, { text: '与补充说明', italic: true }] },
      { type: 'image', imageIndex: 0 }
    ],
    images: [{ bytes: png, width: 800, height: 600, displayWidth: 75, caption: '原论文第 3 页截图' }]
  });
  assert.equal(new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true), 0x04034b50);
  const entries = zipEntries(bytes);
  for (const name of ['[Content_Types].xml', '_rels/.rels', 'word/document.xml', 'word/styles.xml', 'word/_rels/document.xml.rels', 'word/media/note-image-1.png']) {
    assert.ok(entries.has(name), `${name} should exist`);
  }
  const document = new TextDecoder().decode(entries.get('word/document.xml'));
  assert.match(document, /安全智能体研究/);
  assert.match(document, /测试作者/);
  assert.match(document, /10\.1000\/test/);
  assert.match(document, /<w:b\/>/);
  assert.match(document, /<w:i\/>/);
  assert.match(document, /r:embed="rId10"/);
});

test('Word export applies one configured font and can omit source metadata and images', () => {
  const bytes = buildNoteDocx({
    title: '统一字体',
    metadata: [{ label: '作者', value: '不应出现' }],
    blocks: [{ type: 'paragraph', runs: [{ text: '统一正文' }] }, { type: 'image', imageIndex: 0 }],
    images: [{ bytes: Uint8Array.of(1, 2, 3), width: 10, height: 10 }],
    options: { fontFamily: 'SimSun', fontSize: 14, includeMetadata: false, includeImages: false, pageSize: 'letter', margin: 'wide' }
  });
  const entries = zipEntries(bytes);
  const document = new TextDecoder().decode(entries.get('word/document.xml'));
  const styles = new TextDecoder().decode(entries.get('word/styles.xml'));
  assert.doesNotMatch(document, /不应出现/);
  assert.doesNotMatch(document, /r:embed=/);
  assert.equal([...entries.keys()].some(name => name.startsWith('word/media/')), false);
  assert.match(styles, /w:ascii="SimSun" w:eastAsia="SimSun" w:hAnsi="SimSun"/);
  assert.match(styles, /w:sz w:val="28"/);
  assert.match(document, /w:pgSz w:w="12240" w:h="15840"/);
});

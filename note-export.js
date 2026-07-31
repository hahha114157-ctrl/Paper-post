const encoder = new TextEncoder();

function xmlEscape(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function utf8(value) {
  return encoder.encode(String(value));
}

function concatBytes(parts) {
  const size = parts.reduce((total, part) => total + part.length, 0);
  const output = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function uint16(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255);
}

function uint32(value) {
  return Uint8Array.of(value & 255, (value >>> 8) & 255, (value >>> 16) & 255, (value >>> 24) & 255);
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) value = (value & 1) ? (0xedb88320 ^ (value >>> 1)) : (value >>> 1);
    table[index] = value >>> 0;
  }
  return table;
})();

export function crc32(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) value = CRC_TABLE[(value ^ byte) & 255] ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

export function createStoredZip(entries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  for (const entry of entries) {
    const name = utf8(entry.name);
    const data = typeof entry.data === 'string' ? utf8(entry.data) : new Uint8Array(entry.data);
    const checksum = crc32(data);
    const local = concatBytes([
      uint32(0x04034b50), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(checksum), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), name, data
    ]);
    localParts.push(local);
    centralParts.push(concatBytes([
      uint32(0x02014b50), uint16(20), uint16(20), uint16(0x0800), uint16(0), uint16(0), uint16(0),
      uint32(checksum), uint32(data.length), uint32(data.length), uint16(name.length), uint16(0), uint16(0),
      uint16(0), uint16(0), uint32(0), uint32(offset), name
    ]));
    offset += local.length;
  }
  const central = concatBytes(centralParts);
  const end = concatBytes([
    uint32(0x06054b50), uint16(0), uint16(0), uint16(entries.length), uint16(entries.length),
    uint32(central.length), uint32(offset), uint16(0)
  ]);
  return concatBytes([...localParts, central, end]);
}

function runXml(run = {}, options = {}) {
  const properties = [
    `<w:rFonts w:ascii="${xmlEscape(options.fontFamily)}" w:eastAsia="${xmlEscape(options.fontFamily)}" w:hAnsi="${xmlEscape(options.fontFamily)}" w:cs="${xmlEscape(options.fontFamily)}"/>`,
    `<w:sz w:val="${Math.round(options.fontSize * 2)}"/><w:szCs w:val="${Math.round(options.fontSize * 2)}"/>`,
    run.bold ? '<w:b/>' : '',
    run.italic ? '<w:i/>' : '',
    run.underline ? '<w:u w:val="single"/>' : ''
  ].join('');
  const chunks = String(run.text || '').split('\n');
  return chunks.map((chunk, index) => `${index ? '<w:r><w:br/></w:r>' : ''}<w:r>${properties ? `<w:rPr>${properties}</w:rPr>` : ''}<w:t xml:space="preserve">${xmlEscape(chunk)}</w:t></w:r>`).join('');
}

function paragraphXml(block = {}, options = {}) {
  const style = block.type === 'title' ? 'Title'
    : block.type === 'heading' ? 'Heading2'
      : block.type === 'quote' ? 'Quote'
        : 'Normal';
  const prefix = block.type === 'bullet' ? '• ' : block.type === 'number' ? `${block.index || 1}. ` : '';
  const runs = prefix ? [{ text: prefix, bold: true }, ...(block.runs || [])] : (block.runs || []);
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/></w:pPr>${runs.map(run => runXml(run, options)).join('')}</w:p>`;
}

function imageXml(image, relationshipId, index) {
  const maxWidth = 5_943_600;
  const maxHeight = 7_315_200;
  const sourceWidth = Math.max(1, Number(image.width) || 1200);
  const sourceHeight = Math.max(1, Number(image.height) || 800);
  const requestedWidth = Math.max(20, Math.min(100, Number(image.displayWidth) || 100)) / 100;
  let width = Math.round(maxWidth * requestedWidth);
  let height = Math.round(width * sourceHeight / sourceWidth);
  if (height > maxHeight) {
    width = Math.round(width * maxHeight / height);
    height = maxHeight;
  }
  const alt = xmlEscape(image.alt || image.caption || `阅读笔记图片 ${index + 1}`);
  return `<w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${width}" cy="${height}"/><wp:docPr id="${index + 1}" name="Note image ${index + 1}" descr="${alt}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name="note-image-${index + 1}.png"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${relationshipId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${width}" cy="${height}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>${image.caption ? `<w:p><w:pPr><w:pStyle w:val="Caption"/><w:jc w:val="center"/></w:pPr><w:r><w:t>${xmlEscape(image.caption)}</w:t></w:r></w:p>` : ''}`;
}

export function buildNoteDocx({
  title = '阅读笔记',
  metadata = [],
  blocks = [],
  images = [],
  exportedAt = new Date().toISOString(),
  options = {}
} = {}) {
  const fontFamily = String(options.fontFamily || 'Microsoft YaHei').slice(0, 80);
  const fontSize = Math.max(9, Math.min(24, Number(options.fontSize) || 11));
  const includeMetadata = options.includeMetadata !== false;
  const includeImages = options.includeImages !== false;
  const pageSize = options.pageSize === 'letter' ? 'letter' : 'a4';
  const margin = ['narrow', 'wide'].includes(options.margin) ? options.margin : 'standard';
  const includedImages = includeImages ? images : [];
  const includedBlocks = includeImages ? blocks : blocks.filter(block => block.type !== 'image');
  const page = pageSize === 'letter' ? { width: 12240, height: 15840 } : { width: 11906, height: 16838 };
  const marginTwips = margin === 'narrow' ? 720 : margin === 'wide' ? 1701 : 1134;
  const textOptions = { fontFamily, fontSize };
  const imageRelationships = includedImages.map((image, index) => ({
    id: `rId${index + 10}`,
    target: `media/note-image-${index + 1}.png`,
    image
  }));
  const body = [
    paragraphXml({ type: 'title', runs: [{ text: `${title} · 阅读笔记` }] }, textOptions),
    ...(includeMetadata ? metadata.filter(item => item?.value).map(item => paragraphXml({ runs: [{ text: `${item.label}：`, bold: true }, { text: String(item.value) }] }, textOptions)) : []),
    paragraphXml({ runs: [{ text: `导出时间：`, bold: true }, { text: String(exportedAt) }] }, textOptions),
    '<w:p><w:pPr><w:pBdr><w:bottom w:val="single" w:sz="6" w:space="1" w:color="DDE5DF"/></w:pBdr></w:pPr></w:p>',
    ...(includedBlocks.length ? includedBlocks.map(block => block.type === 'image'
      ? imageXml(includedImages[block.imageIndex], imageRelationships[block.imageIndex].id, block.imageIndex)
      : paragraphXml(block, textOptions)) : [paragraphXml({ runs: [{ text: '暂无阅读笔记', italic: true }] }, textOptions)]),
    `<w:sectPr><w:pgSz w:w="${page.width}" w:h="${page.height}"/><w:pgMar w:top="${marginTwips}" w:right="${marginTwips}" w:bottom="${marginTwips}" w:left="${marginTwips}" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>`
  ].join('');
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>`;
  const rootRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>`;
  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>${imageRelationships.map(item => `<Relationship Id="${item.id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="${item.target}"/>`).join('')}</Relationships>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><w:body>${body}</w:body></w:document>`;
  const fontXml = xmlEscape(fontFamily);
  const normalSize = Math.round(fontSize * 2);
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="${fontXml}" w:eastAsia="${fontXml}" w:hAnsi="${fontXml}" w:cs="${fontXml}"/><w:sz w:val="${normalSize}"/><w:szCs w:val="${normalSize}"/><w:lang w:val="zh-CN" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="360" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style><w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${fontXml}" w:eastAsia="${fontXml}" w:hAnsi="${fontXml}"/><w:b/><w:color w:val="116347"/><w:sz w:val="${Math.round(fontSize * 3.2)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="Heading 2"/><w:basedOn w:val="Normal"/><w:rPr><w:rFonts w:ascii="${fontXml}" w:eastAsia="${fontXml}" w:hAnsi="${fontXml}"/><w:b/><w:color w:val="116347"/><w:sz w:val="${Math.round(fontSize * 2.55)}"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="420"/><w:spacing w:before="120" w:after="120"/></w:pPr><w:rPr><w:i/><w:color w:val="59675F"/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="Caption"><w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:rPr><w:i/><w:color w:val="6D7B73"/><w:sz w:val="${Math.max(16, normalSize - 4)}"/></w:rPr></w:style></w:styles>`;
  const core = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xmlEscape(title)} · 阅读笔记</dc:title><dc:creator>PaperScope</dc:creator><cp:lastModifiedBy>PaperScope</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${xmlEscape(exportedAt)}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${xmlEscape(exportedAt)}</dcterms:modified></cp:coreProperties>`;
  const app = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>PaperScope</Application><AppVersion>6.11</AppVersion></Properties>`;
  const entries = [
    { name: '[Content_Types].xml', data: contentTypes },
    { name: '_rels/.rels', data: rootRelationships },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/_rels/document.xml.rels', data: documentRelationships },
    { name: 'docProps/core.xml', data: core },
    { name: 'docProps/app.xml', data: app },
    ...imageRelationships.map((item, index) => ({ name: `word/media/note-image-${index + 1}.png`, data: item.image.bytes }))
  ];
  return createStoredZip(entries);
}

import { writeFile } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/create-import-fixture.mjs <output.pdf>');

const pdf = await PDFDocument.create();
pdf.setTitle('PaperScope Import Queue Verification');
pdf.setAuthor('PaperScope Test; Quality Engineering');
pdf.setSubject('Deterministic local PDF import fixture');
const font = await pdf.embedFont(StandardFonts.Helvetica);
for (let pageNumber = 1; pageNumber <= 3; pageNumber += 1) {
  const page = pdf.addPage([595.28, 841.89]);
  page.drawText('PaperScope Import Queue Verification', { x: 60, y: 770, size: 20, font, color: rgb(.05, .35, .24) });
  page.drawText(`Page ${pageNumber} of 3`, { x: 60, y: 735, size: 12, font });
  page.drawText('This deterministic PDF validates multi-file queueing, metadata extraction, page text indexing, and persistence.', { x: 60, y: 700, size: 11, font, maxWidth: 470, lineHeight: 16 });
  page.drawText('DOI 10.9999/paperscope.import.fixture', { x: 60, y: 650, size: 11, font });
}
await writeFile(output, await pdf.save());
console.log(output);

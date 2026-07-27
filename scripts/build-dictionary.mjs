import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const input = process.argv[2];
const output = path.resolve(process.argv[3] || 'data/dictionary');
const limit = Number(process.argv[4] || 60_000);

if (!input) {
  console.error('Usage: node scripts/build-dictionary.mjs <ecdict.csv> [output-dir] [entry-limit]');
  process.exit(1);
}

function *parseCsv(text) {
  let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ',') { row.push(field); field = ''; }
    else if (char === '\n') {
      row.push(field.replace(/\r$/, '')); yield row; row = []; field = '';
    } else field += char;
  }
  if (field || row.length) { row.push(field); yield row; }
}

function parts(value, max = 8) {
  return String(value || '').split(/\\n|\r?\n/).map(item => item.trim()).filter(Boolean).slice(0, max);
}

function score(entry) {
  const collins = Number(entry.collins || 0);
  const bnc = Number(entry.bnc || 0);
  const frequency = Number(entry.frq || 0);
  return (
    (entry.oxford ? 220_000 : 0) +
    (entry.tag ? 150_000 : 0) +
    collins * 25_000 +
    (bnc > 0 ? Math.max(0, 130_000 - bnc) : 0) +
    (frequency > 0 ? Math.max(0, 100_000 - frequency) : 0) +
    (entry.definition ? 800 : 0) -
    Math.max(0, entry.word.length - 22) * 10
  );
}

const csv = await readFile(path.resolve(input), 'utf8');
const rows = parseCsv(csv);
const header = rows.next().value;
const columns = Object.fromEntries(header.map((name, index) => [name.replace(/^\uFEFF/, ''), index]));
const get = (row, name) => row[columns[name]] || '';
const ranked = [];

for (const row of rows) {
  const word = get(row, 'word').trim();
  const translation = get(row, 'translation').trim();
  if (!translation || !/[\u3400-\u9fff]/.test(translation)) continue;
  if (!/^[A-Za-z][A-Za-z0-9 .,'’()/-]{0,79}$/.test(word) || word.split(/\s+/).length > 4) continue;
  const entry = {
    word,
    phonetic: get(row, 'phonetic').trim(),
    definition: get(row, 'definition').trim(),
    translation,
    pos: get(row, 'pos').trim(),
    collins: get(row, 'collins').trim(),
    oxford: get(row, 'oxford').trim(),
    tag: get(row, 'tag').trim(),
    bnc: get(row, 'bnc').trim(),
    frq: get(row, 'frq').trim(),
    exchange: get(row, 'exchange').trim()
  };
  ranked.push({ ...entry, rank: score(entry) });
}

ranked.sort((a, b) => b.rank - a.rank || a.word.localeCompare(b.word, 'en'));
const selected = ranked.slice(0, limit);
const shards = new Map();

for (const entry of selected) {
  const key = entry.word.toLocaleLowerCase('en-US');
  const shardName = /^[a-z]/.test(key) ? key[0] : '_';
  if (!shards.has(shardName)) shards.set(shardName, {});
  shards.get(shardName)[key] = {
    w: entry.word,
    p: entry.phonetic,
    t: parts(entry.translation, 10),
    d: parts(entry.definition, 8),
    pos: entry.pos,
    x: entry.exchange
  };
}

await mkdir(output, { recursive: true });
const names = [...shards.keys()].sort();
const version = `ecdict-c4ade63-${selected.length}`;
await Promise.all(names.map(name => writeFile(
  path.join(output, `${name}.json`),
  JSON.stringify({ version, entries: shards.get(name) })
)));
await writeFile(path.join(output, 'manifest.json'), JSON.stringify({
  version,
  source: 'skywind3000/ECDICT',
  sourceUrl: 'https://github.com/skywind3000/ECDICT',
  license: 'MIT',
  entries: selected.length,
  shards: names
}, null, 2));

console.log(`Generated ${selected.length} entries in ${names.length} shards at ${output}`);

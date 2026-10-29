/**
 * 构建考研真题例句表。
 *
 * 数据源：exam-data/NETEMVocabulary（数据 CC BY-NC-SA 4.0）
 *   https://github.com/exam-data/NETEMVocabulary
 *   netem_full_list.json 的「例句 / 例句翻译 / 例句来源 / 真题次数」字段。
 *   仅保留「例句来源」以「真题」开头的条目（其余为 AI 生成短句，不在本表内）。
 *
 * 运行：node scripts/build-examples.mjs
 * 产物：src/assets/exam-vocab/exam-examples.json
 *   { "word": { "en": "...", "zh": "...", "source": "2011 英语一 Text 2", "count": 6 } }
 *
 * 注意：真题原句多被整理为短语（如 "a bedroom carpet"），UI 统一称「真题语境」，
 * 不夸大为完整长句。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(__dirname, '../src/assets/exam-vocab/main-wordlist.tsv');
const OUT_PATH = join(__dirname, '../src/assets/exam-vocab/exam-examples.json');
const CACHE_DIR = join(tmpdir(), 'easysail-exam-examples');
const CACHE_FILE = join(CACHE_DIR, 'netem_full_list.json');
const URL = 'https://cdn.jsdelivr.net/gh/exam-data/NETEMVocabulary@master/netem_full_list.json';

function readWordlist() {
  const tsv = readFileSync(TSV_PATH, 'utf8');
  const words = [];
  const seen = new Set();
  for (const line of tsv.split(/\r?\n/)) {
    const w = (line.split('\t')[0] || '').trim().toLowerCase();
    if (!w || w === '单词' || seen.has(w)) continue;
    seen.add(w);
    words.push(w);
  }
  return words;
}

async function download() {
  if (existsSync(CACHE_FILE) && readFileSync(CACHE_FILE).length > 1000) return CACHE_FILE;
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log('[build-examples] 下载 NETEMVocabulary 数据…');
  const res = await fetch(URL);
  if (!res.ok) throw new Error(`下载失败：HTTP ${res.status}`);
  writeFileSync(CACHE_FILE, await res.text(), 'utf8');
  return CACHE_FILE;
}

/** "真题 2011英一·T2" → "2011 英语一 Text 2"；"真题 2005·T2" → "2005 Text 2" */
function formatSource(raw) {
  const s = String(raw || '').replace(/^真题\s*/, '').trim();
  return s
    .replace(/英一/g, '英语一')
    .replace(/英二/g, '英语二')
    .replace(/·T(\d+)/g, ' Text $1')
    .replace(/^(\d{4})(?=\S)/, '$1 ');
}

const path = await download();
const data = JSON.parse(readFileSync(path, 'utf8'));
const rows = data[Object.keys(data)[0]];
if (!Array.isArray(rows)) throw new Error('NETEMVocabulary 数据结构异常');

const wordSet = new Set(readWordlist());
const out = {};
let real = 0;
let skippedNoExample = 0;

for (const row of rows) {
  const word = String(row['单词'] || '').trim().toLowerCase();
  if (!word || !wordSet.has(word)) continue;
  const source = String(row['例句来源'] || '');
  const en = String(row['例句'] || '').trim();
  const zh = String(row['例句翻译'] || '').trim();
  if (!source.startsWith('真题') || !en) { skippedNoExample++; continue; }
  if (out[word]) continue;
  out[word] = {
    en,
    zh,
    source: formatSource(source),
    count: Number(row['真题次数']) || 0,
  };
  real++;
}

writeFileSync(OUT_PATH, JSON.stringify(out) + '\n', 'utf8');
console.log(`[build-examples] 词表 ${wordSet.size} 词，命中真题语境 ${real} 词（跳过 ${skippedNoExample} 条非真题/空例句）`);
console.log(`[build-examples] 已写入 ${OUT_PATH}`);
for (const w of ['contemporary', 'abandon', 'hypothesis', 'economy', 'presume']) {
  console.log(w, '→', JSON.stringify(out[w] ?? null));
}

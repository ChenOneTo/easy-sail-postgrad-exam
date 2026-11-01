/**
 * 构建考研真题例句表。
 *
 * 两个数据源：
 *  1. exam-data/NETEMVocabulary（CC BY-NC-SA 4.0）
 *     https://github.com/exam-data/NETEMVocabulary
 *     netem_full_list.json 的「例句 / 例句翻译 / 例句来源 / 真题次数」字段。
 *     仅保留「例句来源」以「真题」开头的条目（其余为 AI 生成短句，不在本表内）。
 *     该源多为短语级摘录（如 "a bedroom carpet"），覆盖 2005–2023。
 *  2. 本地英语（二）真题语料 scripts/.exam-corpus/corpus.json
 *     由 scripts/extract-exam-corpus.py 从 2022–2026 试题 PDF 提取的完整句子。
 *     完整句优于短语，同词同时命中时以语料句为准；语料缺失时回退到源 1。
 *
 * 运行：node scripts/build-examples.mjs
 * 前置（可选）：python3 scripts/extract-exam-corpus.py
 * 产物：src/assets/exam-vocab/exam-examples.json
 *   { "word": { "en": "...", "zh": "...", "source": "2011 英语一 Text 2", "count": 6 } }
 *
 * 注意：zh 为译文，只有人工补录（scripts/exam-example-zh.json）后才有；
 * 缺失时前端只显示英文语境，不显示中文行。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(__dirname, '../src/assets/exam-vocab/main-wordlist.tsv');
const OUT_PATH = join(__dirname, '../src/assets/exam-vocab/exam-examples.json');
const CORPUS_PATH = join(__dirname, '.exam-corpus/corpus.json');
const ZH_PATH = join(__dirname, 'exam-example-zh.json');
const CACHE_DIR = join(tmpdir(), 'easysail-exam-examples');
const CACHE_FILE = join(CACHE_DIR, 'netem_full_list.json');
const URL = 'https://cdn.jsdelivr.net/gh/exam-data/NETEMVocabulary@master/netem_full_list.json';

/** 语料年份权重：官方试题卷（2025/2026）OCR 质量最好，扫描件年份降权。 */
const YEAR_WEIGHT = { 2026: 4, 2025: 3, 2024: 1, 2023: 2, 2022: 1 };

/** 词条加常见屈折形式，用于在句子里找该词。 */
function inflections(word) {
  const set = new Set([word]);
  const add = (w) => w && set.add(w);
  const last = word.slice(-1);
  add(`${word}s`);
  add(`${word}es`);
  add(`${word}d`);
  add(`${word}ed`);
  add(`${word}ing`);
  add(`${word}ly`);
  add(`${word}er`);
  add(`${word}est`);
  if (last === 'e') {
    add(`${word.slice(0, -1)}ing`);
    add(`${word.slice(0, -1)}ed`);
    add(`${word.slice(0, -1)}er`);
    add(`${word.slice(0, -1)}est`);
  }
  if (last === 'y') {
    add(`${word.slice(0, -1)}ies`);
    add(`${word.slice(0, -1)}ied`);
    add(`${word.slice(0, -1)}ier`);
    add(`${word.slice(0, -1)}iest`);
    add(`${word.slice(0, -1)}ily`);
  }
  if ('bdgklmnprt'.includes(last)) {
    add(`${word}${last}ed`);
    add(`${word}${last}ing`);
    add(`${word}${last}er`);
  }
  if (word === 'be') ['am', 'is', 'are', 'was', 'were', 'been', 'being'].forEach(add);
  if (word === 'have') ['has', 'had', 'having'].forEach(add);
  if (word === 'do') ['does', 'did', 'done', 'doing'].forEach(add);
  return set;
}

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

/** 句子打分：长度适中、近年份、同句多词复用者更优。 */
function scoreSentence({ words, occurrences, year }) {
  let score = 0;
  if (words >= 8 && words <= 20) score += 10;
  else if (words >= 6 && words <= 26) score += 6;
  else if (words <= 32) score += 2;
  score += YEAR_WEIGHT[year] ?? 0;
  score += Math.min(occurrences, 3) * 2;
  return score;
}

/** 从真题语料里为词表每个词挑一句最佳语境。 */
function pickFromCorpus(words, corpus) {
  const forms = new Map();
  for (const w of words) forms.set(w, inflections(w));

  // 预切分语料，统计每句包含哪些词表词
  const sentences = corpus.map((row) => {
    const tokens = row.text.toLowerCase().match(/[a-z][a-z'-]*/g) ?? [];
    const counts = new Map();
    for (const t of tokens) counts.set(t, (counts.get(t) ?? 0) + 1);
    return { ...row, tokens, counts, wordCount: tokens.length };
  });

  const picks = new Map();
  const total = new Map();
  for (const w of words) {
    const fs = forms.get(w);
    let best = null;
    let freq = 0;
    for (const s of sentences) {
      let hits = 0;
      for (const f of fs) hits += s.counts.get(f) ?? 0;
      if (!hits) continue;
      freq += hits;
      const score = scoreSentence({ words: s.wordCount, occurrences: hits, year: s.year });
      if (!best || score > best.score) best = { score, row: s, hits };
    }
    if (best) {
      picks.set(w, {
        en: best.row.text,
        zh: '',
        source: `${best.row.year} 英语二 · ${best.row.section}`,
        count: 0,
      });
      total.set(w, freq);
    }
  }
  for (const [w, n] of total) {
    const pick = picks.get(w);
    if (pick) pick.count = n;
  }
  return picks;
}

const wordSet = new Set(readWordlist());
const hasCorpus = existsSync(CORPUS_PATH);

// 源 1：NETEMVocabulary 的真题短语；下载不可用时回退到现有产物，保证离线可重跑
async function loadLegacy() {
  try {
    const path = await download();
    const data = JSON.parse(readFileSync(path, 'utf8'));
    const rows = data[Object.keys(data)[0]];
    if (!Array.isArray(rows)) throw new Error('NETEMVocabulary 数据结构异常');
    const map = {};
    for (const row of rows) {
      const word = String(row['单词'] || '').trim().toLowerCase();
      if (!word || !wordSet.has(word)) continue;
      const source = String(row['例句来源'] || '');
      const en = String(row['例句'] || '').trim();
      const zh = String(row['例句翻译'] || '').trim();
      if (!source.startsWith('真题') || !en || map[word]) continue;
      map[word] = { en, zh, source: formatSource(source), count: Number(row['真题次数']) || 0 };
    }
    return map;
  } catch (err) {
    if (!existsSync(OUT_PATH)) throw err;
    console.warn(`[build-examples] 下载失败（${err.message}），改用现有产物作为旧源`);
    const prev = JSON.parse(readFileSync(OUT_PATH, 'utf8'));
    if (!hasCorpus) return prev;
    // 本次要重建语料条目，先剔除现有产物里的语料条目，避免撤换年份后残留
    const map = {};
    for (const [word, entry] of Object.entries(prev)) {
      if (String(entry.source).includes('英语二 ·')) continue;
      map[word] = entry;
    }
    return map;
  }
}

const out = await loadLegacy();
const legacyCount = Object.keys(out).length;

// 源 2：本地英语（二）真题完整句，优先级高于源 1
let corpusCount = 0;
if (hasCorpus) {
  const corpus = JSON.parse(readFileSync(CORPUS_PATH, 'utf8'));
  const picks = pickFromCorpus([...wordSet], corpus);
  for (const [word, example] of picks) {
    out[word] = example;
    corpusCount++;
  }
  console.log(`[build-examples] 真题语料 ${corpus.length} 句 → 覆盖 ${corpusCount} 词`);
} else {
  console.log('[build-examples] 未找到 scripts/.exam-corpus/corpus.json，跳过英语二真题语料');
}

// 人工补录译文（可选）：键为英文语境的前缀，按规范化文本做前缀匹配
if (existsSync(ZH_PATH)) {
  const zhTable = JSON.parse(readFileSync(ZH_PATH, 'utf8'));
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').replace(/\s+/g, ' ').trim();
  const keys = Object.keys(zhTable)
    .map((k) => ({ key: norm(k), zh: zhTable[k] }))
    .sort((a, b) => b.key.length - a.key.length);
  let filled = 0;
  for (const entry of Object.values(out)) {
    if (entry.zh) continue;
    const text = norm(entry.en);
    const hit = keys.find((k) => text.startsWith(k.key));
    if (hit) {
      entry.zh = hit.zh;
      filled++;
    }
  }
  console.log(`[build-examples] 译文表 ${keys.length} 条，补全 ${filled} 条语境的中文`);
}

const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]));
writeFileSync(OUT_PATH, `${JSON.stringify(sorted)}\n`, 'utf8');
console.log(`[build-examples] 词表 ${wordSet.size} 词 → 语境 ${Object.keys(sorted).length} 条（旧源 ${legacyCount} 条，语料 ${corpusCount} 条）`);
console.log(`[build-examples] 已写入 ${OUT_PATH}`);
for (const w of ['sustainable', 'bottleneck', 'commission', 'underappreciated', 'subsidy']) {
  console.log(w, '→', JSON.stringify(sorted[w] ?? null));
}

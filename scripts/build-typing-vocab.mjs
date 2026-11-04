/**
 * 生成「打字背单词」模块的内置词库 `src/assets/typing-vocab/kaoyan.json`。
 *
 * 该模块刻意与背单词模块零依赖：词库单独落一份文件，运行时只读本文件，
 * 不读 exam-vocab 目录下的 TSV/音标/例句。数据来源（一次性合并）：
 *   - 主词表 `src/assets/exam-vocab/main-wordlist.tsv`（词/释义/单元/序号）
 *   - 音标 `src/assets/exam-vocab/phonetics.json`（英/美）
 *   - 真题例句 `src/assets/exam-vocab/exam-examples.json`
 *
 * 输出为「字段名 + 二维数组」的紧凑格式，避免每个词重复写 8 个 key：
 *   { key, name, description, fields: [...], words: [[...], ...] }
 *
 * 用法：npm run build:typing-vocab
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SRC_DIR = join(ROOT, 'src/assets/exam-vocab');
const OUT_DIR = join(ROOT, 'src/assets/typing-vocab');
const OUT_PATH = join(OUT_DIR, 'kaoyan.json');

const fields = ['word', 'meaning', 'unit', 'seq', 'uk', 'us', 'en', 'zh'];

const tsv = readFileSync(join(SRC_DIR, 'main-wordlist.tsv'), 'utf8');
const phonetics = JSON.parse(readFileSync(join(SRC_DIR, 'phonetics.json'), 'utf8'));
const examples = JSON.parse(readFileSync(join(SRC_DIR, 'exam-examples.json'), 'utf8'));

const words = [];
const seen = new Set();
for (const line of tsv.split(/\r?\n/)) {
  if (!line.trim()) continue;
  const cols = line.split('\t');
  if (cols.length < 4) continue;
  const [rawWord, rawMeaning, rawUnit, rawSeq] = cols;
  const word = rawWord.trim();
  const unit = rawUnit.trim().toUpperCase();
  const seq = Number.parseInt(rawSeq, 10);
  if (!word || !/^U\d{2}$/.test(unit) || !Number.isFinite(seq)) continue;
  if (seen.has(word)) continue;
  seen.add(word);

  const key = word.toLowerCase();
  const p = phonetics[key] ?? {};
  const ex = examples[key] ?? {};
  words.push([
    word,
    rawMeaning.trim(),
    unit,
    seq,
    p.uk ?? '',
    p.us ?? '',
    ex.en ?? '',
    ex.zh ?? '',
  ]);
}

if (words.length === 0) {
  throw new Error('主词表解析结果为空，检查 main-wordlist.tsv 格式');
}

const payload = {
  key: 'kaoyan',
  name: '考研英语核心',
  description: '考研英语二主词表，按 U01–U26 单元编排，含英美音标与真题例句',
  fields,
  words,
};

mkdirSync(OUT_DIR, { recursive: true });
writeFileSync(OUT_PATH, JSON.stringify(payload), 'utf8');
console.log(`[build-typing-vocab] 已生成 ${words.length} 词 → ${OUT_PATH}`);

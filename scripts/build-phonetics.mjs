/**
 * 构建英美双音标表。
 *
 * 数据源（均为 MIT 许可，构建期下载并缓存到系统临时目录）：
 *   1. ipa-dict（open-dict-data/ipa-dict）en_US / en_UK：覆盖广，作为美音主源与英音回退。
 *   2. Britfone（JoseLlarena/Britfone）英式 RP：约 1.6 万高频词，重音位置符合词典习惯，
 *      优先作为英音来源。
 *
 * 运行：node scripts/build-phonetics.mjs
 * 产物：src/assets/exam-vocab/phonetics.json —— { "word": { "uk": "/.../", "us": "/.../" } }
 *
 * 统一处理：
 *   - ɹ→r、ɫ→l；美音 ɝ→ɜr、ɚ→ər；英音 ɛ→e；
 *   - ipa-dict 英音用 ɐ 表弱读 schwa，Britfone 用 ɐ 表 STRUT /ʌ/，按来源分别映射；
 *   - 保留数据源自带的重音位置（已接近词典标注），仅对单音节词去掉重音符；
 *   - 剔除 (ɹ) 等可选音、括号与音节分隔点。
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = join(__dirname, '../src/assets/exam-vocab/main-wordlist.tsv');
const OUT_PATH = join(__dirname, '../src/assets/exam-vocab/phonetics.json');
const CACHE_DIR = join(tmpdir(), 'easysail-exam-phonetics');

const SOURCES = {
  us: {
    url: 'https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_US.txt',
    file: 'en_US.txt',
  },
  uk: {
    url: 'https://cdn.jsdelivr.net/gh/open-dict-data/ipa-dict@master/data/en_UK.txt',
    file: 'en_UK.txt',
  },
  britfone: {
    url: 'https://cdn.jsdelivr.net/gh/JoseLlarena/Britfone@master/britfone.main.3.0.1.csv',
    file: 'britfone.csv',
  },
};

// —— IPA 符号与重音处理 ——

/** 多字符音素，按长度从长到短匹配 */
const MULTI = [
  'tʃ', 'dʒ', 'aɪ', 'aʊ', 'eɪ', 'əʊ', 'oʊ', 'ɔɪ', 'ɪə', 'eə', 'ʊə',
  'ɑː', 'ɔː', 'ɜː', 'iː', 'uː', 'ɜr', 'ər',
].sort((a, b) => b.length - a.length);

const VOWEL_CHARS = new Set(['i', 'ɪ', 'e', 'ɛ', 'æ', 'ɑ', 'ɒ', 'ɔ', 'o', 'ə', 'ɜ', 'ʌ', 'u', 'ʊ', 'a', 'ɐ', 'ɝ', 'ɚ']);

/** 英语合法音节首辅音丛（用于把重音符移到音节开头） */
const ONSETS = new Set([
  'b', 'd', 'ð', 'dʒ', 'f', 'ɡ', 'g', 'h', 'j', 'k', 'l', 'm', 'n', 'ŋ', 'p', 'r', 's', 'ʃ', 't', 'tʃ', 'θ', 'v', 'w', 'z', 'ʒ',
  'pr', 'br', 'tr', 'dr', 'kr', 'ɡr', 'gr', 'fr', 'θr', 'ʃr',
  'pl', 'bl', 'kl', 'ɡl', 'gl', 'fl', 'sl',
  'sp', 'st', 'sk', 'sm', 'sn', 'sf', 'sw', 'tw', 'kw', 'dw', 'ɡw', 'gw',
  'pj', 'bj', 'tj', 'dj', 'kj', 'ɡj', 'gj', 'fj', 'vj', 'mj', 'nj', 'hj', 'lj', 'sj', 'θj', 'zj',
  'spl', 'spr', 'str', 'skr', 'skw', 'spj', 'stj', 'skj', 'smj',
]);

const isStress = (t) => t === 'ˈ' || t === 'ˌ';
const isVowel = (t) => t.includes('\u0329') || VOWEL_CHARS.has(t[0]);

/** IPA 字符串 → 音素 token（含重音符、音节分隔点已剔除） */
function tokenize(ipa) {
  const s = ipa.replace(/[./[\]]/g, '').trim();
  const tokens = [];
  for (let i = 0; i < s.length;) {
    const ch = s[i];
    if (/[\u0300-\u036f]/.test(ch) || ch === 'ː' || ch === 'ˑ') {
      if (tokens.length) tokens[tokens.length - 1] += ch;
      i++;
      continue;
    }
    if (isStress(ch)) { tokens.push(ch); i++; continue; }
    const multi = MULTI.find((m) => s.startsWith(m, i));
    if (multi) { tokens.push(multi); i += multi.length; continue; }
    if (ch.trim()) tokens.push(ch);
    i++;
  }
  return tokens;
}

/**
 * 把重音符从「元音前」移到「重读音节的音节首」，与牛津/剑桥标注一致。
 * 取前一元音与重读元音之间的全部辅音，取最长合法音节首作为起点。
 * 例如 k ə n t ˈɛ m p → k ə n ˈt ɛ m p（nt 不是合法音节首，取 t）。
 */
function moveStress(tokens) {
  const marks = tokens
    .map((t, i) => (isStress(t) ? i : -1))
    .filter((i) => i >= 0);
  if (marks.length === 0) return tokens;

  const targets = [];
  for (const i of marks) {
    let vowelIdx = -1;
    for (let k = i + 1; k < tokens.length; k++) {
      if (isVowel(tokens[k])) { vowelIdx = k; break; }
    }
    if (vowelIdx < 0) { targets.push({ mark: tokens[i], target: i }); continue; }

    let prevVowel = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (isVowel(tokens[k])) { prevVowel = k; break; }
    }
    // 记录辅音及其原始下标：onset 起点要按原始下标算，不能把重音符本身算进去
    const cluster = [];
    for (let k = prevVowel + 1; k < vowelIdx; k++) {
      if (!isStress(tokens[k])) cluster.push({ tok: tokens[k], idx: k });
    }
    let onsetLen = 0;
    for (let n = Math.min(3, cluster.length); n >= 1; n--) {
      if (ONSETS.has(cluster.slice(-n).map((c) => c.tok).join(''))) { onsetLen = n; break; }
    }
    const target = onsetLen > 0 ? cluster[cluster.length - onsetLen].idx : i;
    targets.push({ mark: tokens[i], target });
  }

  const clean = tokens.filter((t) => !isStress(t));
  const inserts = new Map();
  for (const { mark, target } of targets) {
    const boundary = tokens.slice(0, target).filter((t) => !isStress(t)).length;
    const list = inserts.get(boundary) ?? [];
    list.push(mark);
    inserts.set(boundary, list);
  }

  const out = [];
  for (let b = 0; b <= clean.length; b++) {
    if (inserts.has(b)) out.push(...inserts.get(b));
    if (b < clean.length) out.push(clean[b]);
  }
  return out;
}

/** 单音节词不标重音（与主流词典一致） */
function stripMonosyllableStress(tokens) {
  const nuclei = tokens.filter(isVowel).length;
  return nuclei <= 1 ? tokens.filter((t) => !isStress(t)) : tokens;
}

/**
 * 美音 r 化元音：ɚ 一律 ər；ɝ 按重读与否区分 ɜr / ər。
 * 判断方式：向左找最近的元音，途中遇到重音符即为重读。
 */
function normalizeUsRhotics(tokens) {
  return tokens.flatMap((t, i) => {
    if (t === 'ɚ') return ['ər'];
    if (t !== 'ɝ') return [t];
    let stressed = false;
    for (let k = i - 1; k >= 0; k--) {
      if (isStress(tokens[k])) { stressed = true; break; }
      if (isVowel(tokens[k])) break;
    }
    return stressed ? ['ɜr'] : ['ər'];
  });
}

/**
 * 规范化一组音标变体。
 * @param {string} raw 原始 IPA（可含 / /、变体逗号、括号、点）
 * @param {'uk'|'us'} accent
 * @param {'britfone'|'ipa'} source 决定 ɐ 的含义
 * @returns {{ ipa: string, nucleus: number }[]} nucleus = 主重音前有几个元音，用于英美变体对齐
 */
function normalizeVariants(raw, accent, source) {
  if (!raw) return [];
  return raw
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
    .map((variant) => {
      let s = variant.replace(/^\/+|\/+$/g, '');
      // 可选音：英音不发音的 r 直接删掉，美音补成 r；其余括号去掉保留内容
      s = s.replace(/\(ɹ\)|\(r\)/g, accent === 'uk' ? '' : 'r');
      s = s.replace(/[()]/g, '');
      s = s.replace(/ɹ/g, 'r').replace(/ɫ/g, 'l').replace(/\./g, '');
      if (accent === 'us') {
        s = s.replace(/ɐ/g, 'ə');
      } else {
        s = s.replace(/ɛ/g, 'e');
        s = source === 'britfone' ? s.replace(/ɐ/g, 'ʌ') : s.replace(/ɐ/g, 'ə');
      }
      let rawTokens = tokenize(s);
      if (accent === 'us') rawTokens = normalizeUsRhotics(rawTokens);
      const tokens = stripMonosyllableStress(moveStress(rawTokens));
      if (!tokens.length) return null;
      const primary = tokens.indexOf('ˈ');
      const nucleus = primary >= 0
        ? tokens.slice(0, primary).filter(isVowel).length
        : -1;
      const secondary = tokens.filter((t) => t === 'ˌ').length;
      return { ipa: `/${tokens.join('')}/`, nucleus, secondary };
    })
    .filter(Boolean);
}



// —— 词表与数据源 ——

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

async function downloadSource(key) {
  const { url, file } = SOURCES[key];
  const path = join(CACHE_DIR, file);
  if (existsSync(path)) {
    const size = readFileSync(path).length;
    if (size > 1000) return path;
  }
  mkdirSync(CACHE_DIR, { recursive: true });
  console.log(`[build-phonetics] 下载 ${key}: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载失败 ${key}: HTTP ${res.status}`);
  const text = await res.text();
  writeFileSync(path, text, 'utf8');
  return path;
}

/** ipa-dict：word<TAB>/ipa/, /ipa/（保留全部变体，供同形异音词对齐） */
function parseIpaDict(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const tab = line.indexOf('\t');
    if (tab <= 0) continue;
    const word = line.slice(0, tab).trim().toLowerCase();
    const list = map.get(word) ?? [];
    list.push(line.slice(tab + 1).trim());
    map.set(word, list);
  }
  return map;
}

/** Britfone：word, k ə n t ˈɛ m p ə ɹ ə ɹ i（音素以空格分隔，同一词可有多条 (1)(2) 变体） */
function parseBritfone(path) {
  const map = new Map();
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const sep = line.indexOf(', ');
    if (sep <= 0) continue;
    const word = line.slice(0, sep).trim().toLowerCase().replace(/\(\d+\)$/, '');
    if (!/^[a-z-]+$/.test(word)) continue;
    const ipa = line.slice(sep + 2).trim().replace(/\s+/g, '');
    const list = map.get(word) ?? [];
    list.push(ipa);
    map.set(word, list);
  }
  return map;
}

// 英式拼写 → 美式拼写（用于在美音源中查英式词）
const TO_US = [
  [/isation$/, 'ization'], [/ised$/, 'ized'], [/ising$/, 'izing'],
  [/isable$/, 'izable'], [/iser$/, 'izer'], [/ise$/, 'ize'],
  [/our$/, 'or'], [/([^aeiou])re$/, '$1er'],
  [/ysed$/, 'yzed'], [/ysing$/, 'yzing'], [/yser$/, 'yzer'], [/yse$/, 'yze'],
  [/ogue$/, 'og'], [/mme$/, 'm'],
];

// 美式拼写 → 英式拼写（用于在英音源中查美式词）
const TO_UK = [
  [/ization$/, 'isation'], [/ized$/, 'ised'], [/izing$/, 'ising'],
  [/izable$/, 'isable'], [/izer$/, 'iser'], [/ize$/, 'ise'],
  [/or$/, 'our'], [/er$/, 're'],
  [/yzed$/, 'ysed'], [/yzing$/, 'ysing'], [/yzer$/, 'yser'], [/yze$/, 'yse'],
  [/og$/, 'ogue'], [/m$/, 'mme'],
];

const EXACT_US = {
  aeroplane: 'airplane', gaol: 'jail', maths: 'math', despatch: 'dispatch',
  waggon: 'wagon', gasolene: 'gasoline', cigaret: 'cigarette',
  appal: 'appall', jewellery: 'jewelry', favourable: 'favorable',
  manoeuvre: 'maneuver', instalment: 'installment', highjack: 'hijack',
  reflexion: 'reflection', trolly: 'trolley',
};

const EXACT_UK = {
  appall: 'appal', jewelry: 'jewellery', favorable: 'favourable',
  maneuver: 'manoeuvre', installment: 'instalment', hijack: 'highjack',
  reflection: 'reflexion', trolley: 'trolly',
};

/** 在某个源里查词的全部变体：原词 → 精确映射 → 拼写转换 → 去连字符 */
function lookupAll(map, word, side) {
  const raws = [];
  const collect = (list) => { if (list) raws.push(...list); };
  collect(map.get(word));
  const exact = side === 'us' ? EXACT_US : EXACT_UK;
  if (exact[word]) collect(map.get(exact[word]));
  const rules = side === 'us' ? TO_US : TO_UK;
  for (const [re, rep] of rules) {
    if (re.test(word)) {
      const cand = word.replace(re, rep);
      collect(map.get(cand));
    }
  }
  if (word.includes('-')) collect(map.get(word.replace(/-/g, '')));
  return [...new Set(raws)];
}

/** 规范化一组原始条目并去重，附带来源标记 */
function pickVariants(raws, accent, source) {
  const seen = new Set();
  const out = [];
  for (const raw of raws) {
    for (const v of normalizeVariants(raw, accent, source)) {
      if (seen.has(v.ipa)) continue;
      seen.add(v.ipa);
      out.push({ ...v, source });
    }
  }
  return out;
}

/** 主重音落在弱读元音上的音标不可信（如 conduct 的 /kɑnˈdəkt/） */
function plausibleStress(v) {
  const tokens = tokenize(v.ipa.slice(1, -1));
  const idx = tokens.indexOf('ˈ');
  if (idx < 0) return true;
  let k = idx + 1;
  while (k < tokens.length && !isVowel(tokens[k])) k++;
  return !(tokens[k] === 'ə' || tokens[k] === 'ɚ');
}

const words = readWordlist();
const [usPath, ukPath, britPath] = await Promise.all([
  downloadSource('us'),
  downloadSource('uk'),
  downloadSource('britfone'),
]);
const usMap = parseIpaDict(usPath);
const ukMap = parseIpaDict(ukPath);
const britMap = parseBritfone(britPath);

const out = {};
const stats = { us: 0, ukBrit: 0, ukIpa: 0, ukMiss: 0, usMiss: 0 };
const missing = { us: [], uk: [] };

for (const word of words) {
  // 英音：Britfone 优先（重音/音节划分更接近词典），ipa-dict 兜底；保留全部变体
  const ukAll = [
    ...pickVariants(lookupAll(britMap, word, 'uk'), 'uk', 'britfone'),
    ...pickVariants(lookupAll(ukMap, word, 'uk'), 'uk', 'ipa'),
  ];
  const seenUk = new Set();
  const uks = ukAll.filter((v) => {
    if (seenUk.has(v.ipa)) return false;
    seenUk.add(v.ipa);
    return true;
  });

  let usVariants = pickVariants(lookupAll(usMap, word, 'us'), 'us', 'ipa');
  const plausible = usVariants.filter(plausibleStress);
  if (plausible.length > 0) usVariants = plausible;

  // 同形异音词对齐：
  // 1) 先按英音的主重音位置挑美音变体，同位置时优先少一个次重音的（adequate 取形容词）；
  // 2) 美音没有匹配位置时，反过来按美音位置挑英音变体（conduct 取名词）。
  let ukPick = uks[0] ?? null;
  let usPick = usVariants[0] ?? null;
  if (ukPick) {
    const sameNucleus = usVariants.filter((v) => v.nucleus === ukPick.nucleus);
    if (sameNucleus.length > 0) {
      sameNucleus.sort((a, b) => a.secondary - b.secondary);
      usPick = sameNucleus[0];
    } else if (usPick) {
      const matchedUk = uks.find((v) => v.nucleus === usPick.nucleus);
      if (matchedUk) ukPick = matchedUk;
    }
  }

  if (ukPick) {
    if (ukPick.source === 'britfone') stats.ukBrit++;
    else stats.ukIpa++;
  } else {
    stats.ukMiss++;
    missing.uk.push(word);
  }
  if (usPick) stats.us++;
  else { stats.usMiss++; missing.us.push(word); }

  const uk = ukPick?.ipa ?? null;
  const us = usPick?.ipa ?? null;
  if (uk || us) out[word] = { uk, us };
}

writeFileSync(OUT_PATH, JSON.stringify(out, null, 0) + '\n', 'utf8');

console.log(`[build-phonetics] 词表 ${words.length} 词，输出 ${Object.keys(out).length} 条`);
console.log(`[build-phonetics] 美音命中 ${stats.us}，缺失 ${stats.usMiss}`);
console.log(`[build-phonetics] 英音命中 ${stats.ukBrit + stats.ukIpa}（Britfone ${stats.ukBrit} + ipa-dict ${stats.ukIpa}），缺失 ${stats.ukMiss}`);
if (missing.us.length) console.log('[build-phonetics] 美音缺失（前 20）:', missing.us.slice(0, 20).join(', '));
if (missing.uk.length) console.log('[build-phonetics] 英音缺失（前 20）:', missing.uk.slice(0, 20).join(', '));

for (const w of ['contemporary', 'presume', 'abandon', 'abstract', 'schedule', 'carpet', 'report', 'perfect', 'conduct', 'either', 'privacy', 'vitamin', 'tomato', 'university']) {
  console.log(w, '→', JSON.stringify(out[w]));
}

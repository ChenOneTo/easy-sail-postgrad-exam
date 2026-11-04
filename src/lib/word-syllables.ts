/**
 * 单词音节切分（记忆卡展示用，不追求严格的音系学切分）。
 *
 * 思路「一元一辅」：每个音节以一个元音（含常见元音组合）为核心，
 * 从词尾往前走、逐个元音核切分，相邻音节之间用「·」连接，便于长单词分块记忆。
 *
 * - 连续元音（ea / ou / ai，以及 nation 里的 io 等）视为一个元音核；
 * - qu 里的 u、词首的 y、与元音相邻的 y（day / player）不算元音；
 * - 两个元音核之间的辅音串按「最长合法首音」分配：能整体作首音的归后一个
 *   音节（ta·ble / se·cret），否则最后一个辅音起首（com·put·er）；
 * - 三个及以上辅音时至少留一个给前一个音节（in·stru·ment / mon·ster）；
 * - 词尾哑音 e 不单独成音节（de·clare / lan·guage）。
 *
 * 纯规则实现：不调 AI、不依赖网络，切分结果稳定，也不增加 AI 调用成本。
 */

const VOWEL_LETTERS = 'aeiou';

/** 可作音节首的辅音串（最长 3 个字母） */
const ONSETS = new Set([
  // 双辅音
  'bl', 'br', 'ch', 'cl', 'cr', 'dr', 'dw', 'fl', 'fr', 'gl', 'gr', 'kn', 'ph', 'pl', 'pr', 'qu',
  'sc', 'sh', 'sk', 'sl', 'sm', 'sn', 'sp', 'st', 'sw', 'th', 'tr', 'tw', 'wh', 'wr',
  // 三辅音
  'scr', 'shr', 'spl', 'spr', 'squ', 'str', 'thr',
]);

/** 该位置是否为元音核（只处理小写词） */
function isVowel(word: string, index: number): boolean {
  const ch = word[index];
  if (ch === 'y') {
    if (index === 0) return false;
    const prev = word[index - 1];
    const next = word[index + 1];
    if (VOWEL_LETTERS.includes(prev)) return false;
    if (next && VOWEL_LETTERS.includes(next)) return false;
    return true;
  }
  if (!VOWEL_LETTERS.includes(ch)) return false;
  // qu 中的 u 与 q 一起发 /kw/，不单独成核（quick / question）
  if (ch === 'u' && index > 0 && word[index - 1] === 'q') return false;
  return true;
}

/** 元音核之间那段辅音串里，应归后一个音节（作首音）的字母数 */
function onsetSize(cluster: string): number {
  const k = cluster.length;
  if (k <= 1) return k;
  if (k === 2) {
    // 可整体作首音时归后一个音节（ta·ble / se·cret）；
    // 以 s 开头的组合（st / sp / sk）仍把 s 留给前一个音节（ques·tion / sys·tem）
    return ONSETS.has(cluster) && cluster[0] !== 's' ? 2 : 1;
  }
  // 三辅音及以上：至少留一个给前一个音节，再从长到短取合法首音
  for (let size = Math.min(3, k - 1); size >= 1; size -= 1) {
    if (ONSETS.has(cluster.slice(-size))) return size;
  }
  return 1;
}

/**
 * 把单词切成音节块（保留原始大小写）。
 *
 * 单音节词、含连字符/空格的词组、非字母内容原样返回单块，调用方按
 * `parts.length > 1` 判断是否值得展示切分。
 */
export function splitSyllables(raw: string): string[] {
  const word = raw.trim();
  if (!word) return [];
  if (!/^[A-Za-z]+$/.test(word)) return [word];

  const lower = word.toLowerCase();
  const n = lower.length;
  if (n <= 3) return [word];

  // 1. 找出所有元音核，连续元音合并成一个
  const nuclei: [number, number][] = [];
  for (let i = 0; i < n; i += 1) {
    if (!isVowel(lower, i)) continue;
    let end = i;
    while (end + 1 < n && isVowel(lower, end + 1)) end += 1;
    nuclei.push([i, end]);
    i = end;
  }
  if (nuclei.length <= 1) return [word];

  // 2. 词尾哑音 e 并入前一个音节；「辅音 + le」结尾除外（ta·ble / sim·ple 自成一拍）
  const tail = nuclei[nuclei.length - 1];
  const isConsonantLe = /[^aeiouy]le$/.test(lower);
  if (tail[0] === n - 1 && lower[n - 1] === 'e' && !isConsonantLe) nuclei.pop();
  if (nuclei.length <= 1) return [word];

  // 3. 从后往前切：逐个元音核确定下一个音节的起点
  const cuts: number[] = new Array<number>(nuclei.length).fill(0);
  for (let i = nuclei.length - 2; i >= 0; i -= 1) {
    const clusterStart = nuclei[i][1] + 1;
    const clusterEnd = nuclei[i + 1][0] - 1;
    const cluster = lower.slice(clusterStart, clusterEnd + 1);
    // -tion / -sion 里的 n 归本音节（na·tion·al 而不是 na·tio·nal）
    const isIon = cluster === 'n'
      && lower.slice(nuclei[i][0], nuclei[i][1] + 1) === 'io'
      && (lower[nuclei[i][0] - 1] === 't' || lower[nuclei[i][0] - 1] === 's');
    cuts[i + 1] = isIon ? clusterEnd + 1 : clusterStart + cluster.length - onsetSize(cluster);
  }
  cuts[0] = 0;

  const bounds = [...cuts, n];
  const parts: string[] = [];
  for (let i = 0; i < bounds.length - 1; i += 1) {
    const part = word.slice(bounds[i], bounds[i + 1]);
    if (part) parts.push(part);
  }
  return parts.length > 0 ? parts : [word];
}

/**
 * 「打字背单词」词库文件解析。
 *
 * 支持两种格式：
 * 1. JSON：`{ name, words: [[word, meaning, unit?, seq?, uk?, us?, en?, zh?]] }`
 *    或 `{ name, words: [{ word, meaning, ... }] }`，也接受纯数组。
 * 2. 纯文本：每行「单词 + Tab / 逗号 / 两个以上空格 + 释义」。
 *
 * 放在 lib 而不是组件文件里：组件文件只导出组件，避免 Fast Refresh 失效。
 */
import type { TypingWordSeed } from './typing-vocab-db';

export function parseTypingWordFile(text: string, fileName: string): { name: string; seeds: TypingWordSeed[] } {
  const fallbackName = fileName.replace(/\.[^.]+$/, '') || '自定义词库';
  const trimmed = text.trim();
  if (!trimmed) throw new Error('文件内容为空');

  const toSeed = (
    word: string,
    meaning: string,
    index: number,
    extra?: Partial<TypingWordSeed>,
  ): TypingWordSeed | null => {
    const w = word.trim();
    const m = meaning.trim();
    if (!w || !m) return null;
    return {
      word: w,
      meaning: m,
      unit: extra?.unit ?? '',
      seq: extra?.seq ?? index + 1,
      uk: extra?.uk ?? '',
      us: extra?.us ?? '',
      en: extra?.en ?? '',
      zh: extra?.zh ?? '',
    };
  };

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as unknown;
    const container = Array.isArray(parsed) ? { words: parsed } : (parsed as Record<string, unknown>);
    const rawWords = Array.isArray(container.words) ? container.words : null;
    if (!rawWords) throw new Error('JSON 词库缺少 words 数组');
    const name = typeof container.name === 'string' && container.name.trim()
      ? container.name.trim()
      : fallbackName;
    const seeds: TypingWordSeed[] = [];
    rawWords.forEach((entry, index) => {
      if (Array.isArray(entry)) {
        const seed = toSeed(String(entry[0] ?? ''), String(entry[1] ?? ''), index, {
          unit: String(entry[2] ?? ''),
          seq: Number(entry[3]) || index + 1,
          uk: String(entry[4] ?? ''),
          us: String(entry[5] ?? ''),
          en: String(entry[6] ?? ''),
          zh: String(entry[7] ?? ''),
        });
        if (seed) seeds.push(seed);
        return;
      }
      if (entry && typeof entry === 'object') {
        const record = entry as Record<string, unknown>;
        const seed = toSeed(
          String(record.word ?? record.name ?? ''),
          String(record.meaning ?? record.translation ?? record.zh ?? ''),
          index,
          {
            unit: String(record.unit ?? ''),
            seq: Number(record.seq) || index + 1,
            uk: String(record.uk ?? record.phoneticUk ?? ''),
            us: String(record.us ?? record.phoneticUs ?? ''),
            en: String(record.en ?? record.example ?? ''),
            zh: String(record.exampleZh ?? ''),
          },
        );
        if (seed) seeds.push(seed);
      }
    });
    if (seeds.length === 0) throw new Error('JSON 中没有解析到有效单词');
    return { name, seeds };
  }

  const seeds: TypingWordSeed[] = [];
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = line
      .split(/\t|\s*[,，]\s*|\s{2,}|\s*[-—–]\s+/)
      .map((c) => c.trim())
      .filter(Boolean);
    if (cols.length < 2) continue;
    if (/^(单词|word|英文)$/i.test(cols[0])) continue;
    const seed = toSeed(cols[0], cols.slice(1).join('；'), seeds.length);
    if (seed) seeds.push(seed);
  }
  if (seeds.length === 0) throw new Error('未解析到有效单词，请按「单词<Tab>释义」每行一个');
  return { name: fallbackName, seeds };
}

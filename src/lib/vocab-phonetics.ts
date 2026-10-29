/**
 * 背单词英美音标查表。
 *
 * 数据由 scripts/build-phonetics.mjs 构建，运行时仅查表：
 *   - 英音：Britfone（MIT，Copyright (c) 2017 Jose Llarena）
 *     https://github.com/JoseLlarena/Britfone
 *   - 英/美音：ipa-dict（MIT，Copyright (c) 2016 open-dict-data）
 *     https://github.com/open-dict-data/ipa-dict
 * 构建期统一符号（ɹ→r、ɝ→ɜr、ɚ→ər、ɛ→e 等）并把重音符移到音节首，
 * 单音节词不标重音。
 *
 * JSON 结构：{ "word": { "uk": "/.../", "us": "/.../" } }，
 * 个别词只有英音或美音，调用方需容忍 null。
 *
 * 用 ?raw 取字符串再 JSON.parse，避免 TS 对 5000+ 项对象做整表字面量类型推断。
 */
import raw from '../assets/exam-vocab/phonetics.json?raw';

interface PhoneticEntry {
  uk?: string | null;
  us?: string | null;
}

export interface WordPhonetics {
  uk: string | null;
  us: string | null;
}

const table: Record<string, PhoneticEntry> = JSON.parse(raw);

/** 取词的英/美音标；词表外或缺失的语种返回 null。输入会小写化后查表。 */
export function getPhonetics(word: string): WordPhonetics {
  if (!word) return { uk: null, us: null };
  const entry = table[word.toLowerCase()];
  if (!entry) return { uk: null, us: null };
  return {
    uk: entry.uk || null,
    us: entry.us || null,
  };
}

/** 兼容旧调用：优先返回美音，没有则用英音。新代码建议直接用 getPhonetics。 */
export function getPhonetic(word: string): string | null {
  const p = getPhonetics(word);
  return p.us ?? p.uk;
}

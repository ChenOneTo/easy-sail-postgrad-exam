/**
 * 考研真题语境查表。
 *
 * 数据由 scripts/build-examples.mjs 合并两个来源：
 *  1. exam-data/NETEMVocabulary（CC BY-NC-SA 4.0）中标注为 2005–2023 真题的条目，
 *     多为短语级摘录（如 "a bedroom carpet"）。
 *  2. 本地英语（二）真题语料（scripts/extract-exam-corpus.py 从 2025/2026 官方试题卷
 *     提取的完整句子），同词命中时优先，故取值年份以 2025–2026 为主。
 * 真题原文常被整理为短语，UI 因此称「真题语境」而非完整长句。
 *
 * 结构：{ "word": { "en": "...", "zh": "...", "source": "2026 英语二 · Text 1", "count": 6 } }
 */
import raw from '../assets/exam-vocab/exam-examples.json?raw';

export interface ExamExample {
  en: string;
  zh: string;
  /** 年份 + 卷别 + 篇目，如 "2026 英语二 · Text 1"、"2011 英语一 Text 2" */
  source: string;
  /** 真题出现次数：语料条目为近五年英语二语料内的命中次数，旧源为 2005–2023 词表次数 */
  count: number;
}

const table: Record<string, ExamExample> = JSON.parse(raw);

/** 取词的考研真题语境；词表外或没有真题来源时返回 null。 */
export function getExamExample(word: string): ExamExample | null {
  if (!word) return null;
  return table[word.toLowerCase()] ?? null;
}

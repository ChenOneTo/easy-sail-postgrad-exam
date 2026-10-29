/**
 * 考研真题语境查表。
 *
 * 数据由 scripts/build-examples.mjs 从 exam-data/NETEMVocabulary（CC BY-NC-SA 4.0）
 * 筛选而来：仅保留「例句来源」标注为 2005–2023 考研真题的条目，其余 AI 短句不收录。
 * 真题原文常被整理为短语（如 "a bedroom carpet"），UI 因此称「真题语境」而非完整长句。
 *
 * 结构：{ "word": { "en": "...", "zh": "...", "source": "2011 英语一 Text 2", "count": 6 } }
 */
import raw from '../assets/exam-vocab/exam-examples.json?raw';

export interface ExamExample {
  en: string;
  zh: string;
  /** 年份 + 卷别 + 篇目，如 "2011 英语一 Text 2" */
  source: string;
  /** 2005–2023 真题词表中的出现次数 */
  count: number;
}

const table: Record<string, ExamExample> = JSON.parse(raw);

/** 取词的考研真题语境；词表外或没有真题来源时返回 null。 */
export function getExamExample(word: string): ExamExample | null {
  if (!word) return null;
  return table[word.toLowerCase()] ?? null;
}

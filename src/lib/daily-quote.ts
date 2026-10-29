/**
 * 每日激励语（AI 生成）
 *
 * 每天首次打开应用时调用大模型生成一句激励语，结果按日期缓存到 localStorage，
 * 当天内重复打开不再请求；支持手动刷新强制重新生成。
 */

import { canUseAi, chatCompletion } from './ai';

const QUOTE_CACHE_KEY = 'easysail-exam-daily-quote-cache';
const QUOTE_ENABLED_KEY = 'easysail-exam-daily-quote-enabled';

interface DailyQuoteCache {
  date: string;
  text: string;
}

/** 本地日期（激励语按用户本地的"今天"滚动，不用 UTC） */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 是否启用每日激励语（默认开启） */
export function isDailyQuoteEnabled(): boolean {
  return localStorage.getItem(QUOTE_ENABLED_KEY) !== 'false';
}

export function setDailyQuoteEnabled(enabled: boolean): void {
  localStorage.setItem(QUOTE_ENABLED_KEY, enabled ? 'true' : 'false');
}

/** 读取当天的缓存激励语，缓存过期（非当天）返回 null */
export function getCachedDailyQuote(): string | null {
  try {
    const raw = localStorage.getItem(QUOTE_CACHE_KEY);
    if (!raw) return null;
    const cache: DailyQuoteCache = JSON.parse(raw);
    if (cache.date === todayStr() && cache.text) return cache.text;
  } catch { /* ignore */ }
  return null;
}

function setCachedDailyQuote(text: string): void {
  const cache: DailyQuoteCache = { date: todayStr(), text };
  localStorage.setItem(QUOTE_CACHE_KEY, JSON.stringify(cache));
}

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function buildDailyQuotePrompt(): string {
  const now = new Date();
  return [
    '你是一位激励语作者。请为任务管理应用的用户写一句今日激励语。',
    '要求：中文，16~40 个字，积极务实，鼓励行动与专注，避免口号式空话和陈词滥调。',
    '不要引号、不要表情符号、不要解释，只输出这一句话本身。',
    `今天是 ${todayStr()}，星期${WEEKDAYS[now.getDay()]}。可以自然结合日期或星期的氛围，但不是必须。`,
  ].join('\n');
}

// 同一时刻只发一个请求（React StrictMode 双挂载、多处同时读取时复用同一 Promise）
let inflight: Promise<string> | null = null;

/**
 * 获取今日激励语：优先返回当天缓存，否则调用大模型生成并写入缓存。
 * @param force 为 true 时忽略缓存，强制重新生成
 */
export async function fetchDailyQuote(force = false): Promise<string> {
  if (!canUseAi()) throw new Error('AI 未开启或未配置');

  if (!force) {
    const cached = getCachedDailyQuote();
    if (cached) return cached;
  }
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const text = await chatCompletion([
        { role: 'system', content: '你只输出一句话，不包含任何其他内容。' },
        { role: 'user', content: buildDailyQuotePrompt() },
      ], { temperature: 0.9 });
      const cleaned = text.trim().replace(/^["'“”「『]+|["'“”」』]+$/g, '').trim();
      if (!cleaned) throw new Error('生成结果为空');
      setCachedDailyQuote(cleaned);
      return cleaned;
    } finally {
      inflight = null;
    }
  })();
  return inflight;
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { RefreshCw, Sparkles } from 'lucide-react';
import { canUseAi } from '../lib/ai';
import { fetchDailyQuote, getCachedDailyQuote, isDailyQuoteEnabled } from '../lib/daily-quote';


/**
 * 每日激励语：读当天缓存，无缓存则调用大模型生成一次（每天仅一次，结果缓存）。
 * AI 未开启/未配置或用户在设置中关闭时不渲染任何内容。
 */
export function DailyQuote() {
  const [quote, setQuote] = useState<string | null>(getCachedDailyQuote);
  const [loading, setLoading] = useState(false);
  // 自动生成只尝试一次，失败不无限重试；手动刷新不受限
  const attemptedRef = useRef(false);
  // 待触发的自动生成定时器（卸载时清理）
  const pendingRef = useRef<number | null>(null);

  const load = useCallback(async (force: boolean) => {
    if (!canUseAi()) return;
    setLoading(true);
    try {
      setQuote(await fetchDailyQuote(force));
    } catch (err) {
      console.warn('[DailyQuote] 生成失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  // 卸载时清理尚未触发的自动生成
  useEffect(() => () => {
    if (pendingRef.current !== null) {
      window.clearTimeout(pendingRef.current);
      pendingRef.current = null;
    }
  }, []);

  // 不带依赖数组：设置弹窗关闭等任何重渲染后都会重查条件，
  // 覆盖"启动时 AI 未配置、会话中途才配好"的场景。
  // 自动生成放到定时器里异步触发，避免在 effect 中同步 setState。
  useEffect(() => {
    if (attemptedRef.current) return;
    if (!isDailyQuoteEnabled() || !canUseAi()) return;
    attemptedRef.current = true;
    if (getCachedDailyQuote()) return;
    pendingRef.current = window.setTimeout(() => {
      pendingRef.current = null;
      void load(false);
    }, 0);
  });

  if (!isDailyQuoteEnabled() || !canUseAi()) return null;
  if (!quote && !loading) return null;

  return (
    <div className="daily-quote" title={quote ?? undefined}>
      <Sparkles size={13} className="daily-quote-icon" />
      <span className="daily-quote-text">
        {quote ?? '正在生成今日激励语…'}
      </span>
      <button
        className="daily-quote-refresh"
        onClick={() => void load(true)}
        disabled={loading}
        title="换一句"
      >
        <RefreshCw size={12} className={loading ? 'spin' : undefined} />
      </button>
    </div>
  );
}

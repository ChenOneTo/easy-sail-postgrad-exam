import { useEffect, useState } from 'react';
import { localDateStr } from '../lib/utils';

/** 跨天轮询间隔：只为一次字符串比较，取 30 秒保证零点后很快切到新的一天 */
const TICK_MS = 30_000;

/**
 * 当前本地日期（YYYY-MM-DD），跨天自动触发重渲染。
 *
 * 桌面端应用常驻不退出，组件只在挂载时读一次 localDateStr() 的话，
 * 过了零点「今日已通过关数」「距考试天数」仍按昨天的口径继续算。
 * 这里定时轮询，并在窗口重新获得焦点/重新可见时立即校准。
 */
export function useToday(): string {
  const [today, setToday] = useState(() => localDateStr());

  useEffect(() => {
    const sync = () => {
      const next = localDateStr();
      setToday((prev) => (prev === next ? prev : next));
    };
    const timer = window.setInterval(sync, TICK_MS);
    window.addEventListener('focus', sync);
    document.addEventListener('visibilitychange', sync);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', sync);
      document.removeEventListener('visibilitychange', sync);
    };
  }, []);

  return today;
}

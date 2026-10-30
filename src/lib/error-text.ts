/**
 * 异常文本提取
 *
 * Tauri 插件的错误以字符串 reject（如 tauri-plugin-sql 把 sqlx 错误序列化为
 * Display 文本），不是 Error 实例，直接用 `err instanceof Error` 判断会丢掉
 * 真实原因。这里统一把各种形态的异常转成可读文本。
 */

/** 把任意异常值转成可读文本 */
export function errText(err: unknown): string {
  if (err === null || err === undefined) return '未知错误';
  if (typeof err === 'string') return err;
  if (err instanceof Error) return err.message || String(err);
  if (typeof err === 'object') {
    const obj = err as Record<string, unknown>;
    for (const key of ['message', 'error', 'data', 'reason', 'code']) {
      const v = obj[key];
      if (typeof v === 'string' && v) return v;
      if (v && typeof v === 'object') {
        const inner = errText(v);
        if (inner !== '未知错误') return inner;
      }
    }
    try {
      return JSON.stringify(err);
    } catch {
      return String(err);
    }
  }
  return String(err);
}

/**
 * Tauri 运行环境检测与类型声明
 *
 * 统一处理 window.__TAURI_INTERNALS__ 的类型与访问，
 * 消除各处 `window as any` 导致的 eslint no-explicit-any 报错。
 */

interface TauriWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

/** 判断当前是否运行在 Tauri 桌面端 */
export function isTauri(): boolean {
  return !!(window as TauriWindow).__TAURI_INTERNALS__;
}

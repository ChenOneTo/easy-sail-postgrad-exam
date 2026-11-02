/**
 * 开机自启动
 *
 * 规则：仅**首次**启动时默认开启一次，之后完全以用户在设置中的选择为准。
 * 早期版本每次启动都强制 `enable()`，导致「关掉自启动后重启又被打开」。
 */

import { isTauri } from './tauri';

const PREF_KEY = 'easysail-exam-autostart-pref';

/** 读取用户选择：true / false，从未选择过返回 null */
function getPref(): boolean | null {
  const value = localStorage.getItem(PREF_KEY);
  if (value === 'on') return true;
  if (value === 'off') return false;
  return null;
}

function setPref(enabled: boolean): void {
  localStorage.setItem(PREF_KEY, enabled ? 'on' : 'off');
}

/** 读取系统实际状态（非 Tauri 环境恒为 false） */
export async function isAutoStartEnabled(): Promise<boolean> {
  if (!isTauri()) return false;
  const { isEnabled } = await import('@tauri-apps/plugin-autostart');
  return isEnabled();
}

/**
 * 写入系统自启动配置并记录用户选择。
 * @returns 回读的系统实际状态，供 UI 校正
 */
export async function setAutoStartEnabled(enabled: boolean): Promise<boolean> {
  if (!isTauri()) return false;
  const { enable, disable, isEnabled } = await import('@tauri-apps/plugin-autostart');
  if (enabled) await enable();
  else await disable();
  setPref(enabled);
  // 回读真实状态：写入可能被系统拒绝（权限、路径失效等）
  return isEnabled();
}

/** 应用启动时调用：只有从未选择过时才默认开启一次，之后不再改动系统设置 */
export async function initAutoStart(): Promise<void> {
  if (!isTauri()) return;
  if (getPref() !== null) return;
  try {
    const { isEnabled, enable } = await import('@tauri-apps/plugin-autostart');
    if (!(await isEnabled())) await enable();
    setPref(true);
  } catch {
    // 系统调用失败不影响启动，下次启动再试
  }
}

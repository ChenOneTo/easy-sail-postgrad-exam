/**
 * 主窗口与悬浮单词卡片之间的会话交接。
 *
 * 两个窗口各有独立的 JS 上下文（zustand 状态不共享），但同源 localStorage 共享，
 * 因此用一次性 key 传递序列化后的 GameSession：
 * - 主窗口 → 悬浮卡片：打开悬浮窗前写入 `TO_ORB`，悬浮卡片启动时读取；
 * - 悬浮卡片 → 主窗口：关闭悬浮窗前写入 `TO_MAIN` 并广播事件，主窗口收到后读取。
 */
import type { GameSession } from '../stores/vocab-game-store';

const TO_ORB_KEY = 'easysail-vocab-orb-incoming';
const TO_MAIN_KEY = 'easysail-vocab-orb-return';

/** 悬浮卡片把会话交还主窗口时广播的事件名 */
export const VOCAB_ORB_RETURN_EVENT = 'vocab-orb:return';

/**
 * 交接前整理会话：预生成任务随原窗口退出而中止，残留的 loading 永远不会落地，
 * 统一改成 error，让卡片显示「点击重试」而不是一直转圈。
 */
function normalize(session: GameSession): GameSession {
  const mnemonics: GameSession['mnemonics'] = {};
  for (const [id, entry] of Object.entries(session.mnemonics ?? {})) {
    mnemonics[Number(id)] = entry.status === 'loading' ? { status: 'error' } : entry;
  }
  return { ...session, mnemonics, busy: false, lastError: '' };
}

function stash(key: string, session: GameSession | null): void {
  try {
    if (session) localStorage.setItem(key, JSON.stringify(session));
    else localStorage.removeItem(key);
  } catch {
    // 隐私模式或超出配额：放弃交接，悬浮卡片会重新开一关
  }
}

function take(key: string): GameSession | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    localStorage.removeItem(key);
    const parsed = JSON.parse(raw) as GameSession;
    return parsed && Array.isArray(parsed.words) ? normalize(parsed) : null;
  } catch {
    localStorage.removeItem(key);
    return null;
  }
}

/** 主窗口打开悬浮卡片前暂存当前会话；传 null 表示清空 */
export function stashSessionForOrb(session: GameSession | null): void {
  stash(TO_ORB_KEY, session);
}

/** 只读查看是否有待接管的会话（不删除），用于首帧决定展开还是收起 */
export function peekSessionForOrb(): boolean {
  try {
    return !!localStorage.getItem(TO_ORB_KEY);
  } catch {
    return false;
  }
}

/** 悬浮卡片启动时取出主窗口暂存的会话 */
export function takeSessionForOrb(): GameSession | null {
  return take(TO_ORB_KEY);
}

/** 悬浮卡片关闭前把未完成的会话交还主窗口 */
export function stashSessionForMain(session: GameSession | null): void {
  stash(TO_MAIN_KEY, session);
}

/** 主窗口收到交还事件后取出会话 */
export function takeSessionForMain(): GameSession | null {
  return take(TO_MAIN_KEY);
}

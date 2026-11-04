/**
 * 「打字背单词」的记忆调度（模块内自实现，不复用背单词模块的 FSRS）。
 *
 * 采用简化的间隔重复：
 * - 阶段 0–7 对应复习间隔 0/1/2/4/7/15/30/60 天；
 * - 一次打对（无错键）→ 进一阶，按新阶段间隔安排下次；
 * - 有错但最终改对 → 阶段不变，次日再练；
 * - 打错 / 放弃 → 降两阶，10 分钟后重新出现（当天错词优先重练）；
 * - 阶段 ≥5 且「一次全对」累计 3 次 → 自动标记已掌握。
 *
 * 时间统一存 UTC ISO 字符串，与库中其它模块一致。
 */
import type { TypingOutcome } from './typing-vocab-db';

/** 各阶段间隔（天），索引即阶段 */
export const STAGE_INTERVALS_DAYS = [0, 1, 2, 4, 7, 15, 30, 60];
export const MAX_STAGE = STAGE_INTERVALS_DAYS.length - 1;
/** 答错后多久重新出现（分钟） */
export const RELEARN_MINUTES = 10;
/** 自动判为「已掌握」所需的一次全对次数 */
export const MASTER_PERFECT_COUNT = 3;
/** 自动判为「已掌握」所需的最低阶段 */
export const MASTER_MIN_STAGE = 5;

export interface TypingScheduleState {
  stage: number;
  perfectCount: number;
  mastered: boolean;
}

export interface TypingScheduleResult {
  stage: number;
  dueAt: string;
  mastered: boolean;
  perfectCount: number;
}

function addDays(from: Date, days: number): string {
  return new Date(from.getTime() + days * 86400000).toISOString();
}

function addMinutes(from: Date, minutes: number): string {
  return new Date(from.getTime() + minutes * 60000).toISOString();
}

/**
 * 根据本次作答结果算出新的记忆状态。
 * outcome=perfect 表示全程零错键，correct 表示有错键但最终拼对，wrong 表示未通过。
 */
export function scheduleTypingAnswer(
  state: TypingScheduleState,
  outcome: TypingOutcome,
  now = new Date(),
): TypingScheduleResult {
  const currentStage = Math.min(MAX_STAGE, Math.max(0, Math.round(state.stage) || 0));

  if (outcome === 'perfect') {
    const stage = Math.min(MAX_STAGE, currentStage + 1);
    const perfectCount = Math.max(0, state.perfectCount) + 1;
    return {
      stage,
      perfectCount,
      dueAt: addDays(now, STAGE_INTERVALS_DAYS[stage]),
      mastered: stage >= MASTER_MIN_STAGE && perfectCount >= MASTER_PERFECT_COUNT,
    };
  }

  if (outcome === 'correct') {
    return {
      stage: currentStage,
      perfectCount: Math.max(0, state.perfectCount),
      // 有错键说明还不够熟，至少隔一天再复习
      dueAt: addDays(now, Math.max(1, STAGE_INTERVALS_DAYS[currentStage])),
      mastered: false,
    };
  }

  const stage = Math.max(0, currentStage - 2);
  return {
    stage,
    perfectCount: 0,
    dueAt: addMinutes(now, RELEARN_MINUTES),
    mastered: false,
  };
}



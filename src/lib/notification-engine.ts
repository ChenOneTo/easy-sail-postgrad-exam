/**
 * 提醒通知引擎
 *
 * 单例轮询，每 30 秒检查一次是否有到期的提醒任务。
 * 触发后通过 Tauri 原生通知插件发送系统通知，并写入通知历史。
 */

import type { Task } from './types';
import { calculateNextReminder } from './utils';
import { useTaskStore } from '../stores/task-store';
import { useReminderHistoryStore } from '../stores/reminder-history-store';
import { isTauri } from './tauri';

const POLL_INTERVAL_MS = 30_000; // 30 秒轮询间隔

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * 启动提醒引擎。返回停止函数。
 * 幂等：重复调用不会创建多个定时器。
 */
export async function startReminderEngine(): Promise<() => void> {
  if (_running) return stopReminderEngine;
  _running = true;

  // 请求通知权限（仅 Tauri 环境）
  if (isTauri()) {
    try {
      const { isPermissionGranted, requestPermission } = await import('@tauri-apps/plugin-notification');
      const granted = await isPermissionGranted();
      if (!granted) {
        await requestPermission();
      }
    } catch {
      // 权限请求失败不阻塞引擎
    }
  }

  // 立即执行一次检查，然后进入轮询
  checkAndFire();
  _timer = setInterval(checkAndFire, POLL_INTERVAL_MS);

  return stopReminderEngine;
}

/** 停止提醒引擎 */
export function stopReminderEngine(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _running = false;
}

/** 检查所有任务，触发到期提醒 */
function checkAndFire(): void {
  const now = new Date();
  const tasks = useTaskStore.getState().tasks;

  for (const task of tasks) {
    if (!shouldFire(task, now)) continue;

    // 防重复：本轮已通知过则跳过
    if (task.lastNotifiedAt) {
      const last = new Date(task.lastNotifiedAt);
      // 同一分钟内不重复触发
      if (now.getTime() - last.getTime() < 60_000) continue;
    }

    void fireReminder(task, now);
  }
}

/** 判断任务是否应在当前时刻触发提醒 */
function shouldFire(task: Task, now: Date): boolean {
  if (!task.reminderEnabled) return false;
  if (task.completed) return false;
  if (!task.reminderAt) return false;

  // 检查 snooze
  if (task.snoozedUntil) {
    const snooze = new Date(task.snoozedUntil);
    if (snooze > now) return false; // 还在 snooze 期间
  }

  const reminderTime = new Date(task.reminderAt);
  return reminderTime <= now;
}

/** 触发单个提醒 */
async function fireReminder(task: Task, now: Date): Promise<void> {
  const nowIso = now.toISOString();

  // 1. 更新 lastNotifiedAt（防重复）
  await useTaskStore.getState().updateTask(task.id, { lastNotifiedAt: nowIso });

  // 2. 写入通知历史
  useReminderHistoryStore.getState().addRecord({
    taskId: task.id,
    taskTitle: task.title,
    triggeredAt: nowIso,
  });

  // 3. 发送系统通知
  await triggerNotification(task);

  // 4. 处理重复提醒
  if (task.recurrence && task.recurrence.type !== 'none') {
    const nextAt = calculateNextReminder(task.reminderAt!, task.recurrence);
    if (nextAt) {
      // 更新下次提醒时间，清除 snooze
      await useTaskStore.getState().updateTask(task.id, {
        reminderAt: nextAt,
        snoozedUntil: null,
        lastNotifiedAt: null,
      });
    } else {
      // 超出重复截止日期，停止提醒
      await useTaskStore.getState().updateTask(task.id, {
        reminderEnabled: false,
        snoozedUntil: null,
      });
    }
  }
}

/**
 * 发送系统通知。
 * Tauri 环境使用原生通知，否则回退到浏览器 Notification API。
 */
export async function triggerNotification(task: Task): Promise<void> {
  const title = '⏰ 任务提醒';
  const body = task.reminderText || task.title;

  if (isTauri()) {
    try {
      const { sendNotification } = await import('@tauri-apps/plugin-notification');
      sendNotification({ title, body });
      return;
    } catch {
      // 回退到浏览器通知
    }
  }

  // 浏览器 Notification API 回退
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    try {
      new Notification(title, { body });
    } catch {
      // 忽略
    }
  }
}

/**
 * 稍后提醒（Snooze）。
 * 设置 snoozedUntil 为 now + minutes，引擎会在该时间后再次触发。
 */
export async function snoozeTask(taskId: number, minutes: number): Promise<void> {
  const until = new Date();
  until.setMinutes(until.getMinutes() + minutes);
  await useTaskStore.getState().updateTask(taskId, {
    snoozedUntil: until.toISOString(),
    lastNotifiedAt: null, // 清除通知标记，允许再次触发
  });
}

/**
 * 清除任务的稍后提醒，恢复原始提醒时间触发。
 */
export async function clearSnooze(taskId: number): Promise<void> {
  await useTaskStore.getState().updateTask(taskId, {
    snoozedUntil: null,
    lastNotifiedAt: null,
  });
}

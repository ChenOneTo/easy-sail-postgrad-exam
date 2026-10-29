import type { Task, SectionId, RecurrenceRule } from './types';
import { TASK_TYPES } from './types';

const KNOWN_TYPE_IDS = TASK_TYPES.map(t => t.id);

/** 本地日期格式化 YYYY-MM-DD（避免 toISOString 的 UTC 时区偏移问题） */
export function localDateStr(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** 将任意日期值归一化为 YYYY-MM-DD 字符串（兼容 ISO/带时间/Date） */
export function toDateStr(value: string | null | undefined): string | null {
  if (!value) return null;
  // 已经是 YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  // 截取 ISO 字符串前 10 位
  const sliced = String(value).slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return sliced;
  // 尝试 Date 解析（按本地时区取日期）
  const d = new Date(value);
  if (!isNaN(d.getTime())) return localDateStr(d);
  return null;
}

/** 按关键词搜索任务（匹配标题、备注、标签） */
export function searchTasks(tasks: Task[], query: string): Task[] {
  const q = query.trim().toLowerCase();
  if (!q) return tasks;
  return tasks.filter(t =>
    t.title.toLowerCase().includes(q) ||
    t.notes.toLowerCase().includes(q) ||
    t.tags.some(tag => tag.toLowerCase().includes(q)) ||
    t.dueDate?.includes(q)
  );
}

export function filterTasksBySection(tasks: Task[], section: SectionId): Task[] {
  const today = localDateStr();

  switch (section) {
    case 'inbox':
      return tasks;
    case 'today':
      return tasks.filter((t) => toDateStr(t.dueDate) === today);
    case 'project-work':
    case 'project-study':
    case 'project-life':
      return tasks.filter((t) => t.projectId === section || !KNOWN_TYPE_IDS.includes(t.projectId));
    case 'tag-urgent':
      return tasks.filter((t) => t.tags.includes('tag-urgent'));
    case 'tag-important':
      return tasks.filter((t) => t.tags.includes('tag-important'));
    default:
      return tasks;
  }
}

export function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

export function getDateClass(dateStr: string, completed: boolean): string {
  const today = localDateStr();
  if (completed) return '';
  if (dateStr < today) return 'overdue';
  if (dateStr === today) return 'today';
  return 'upcoming';
}

export type StatRange = 'today' | 'week' | 'month' | 'quarter' | 'year';

const toStr = (d: Date) => localDateStr(d);

export function filterTasksByRange(tasks: Task[], range: StatRange): Task[] {
  const now = new Date();
  const todayStr = toStr(now);

  if (range === 'today') {
    return tasks.filter(t => toDateStr(t.dueDate) === todayStr);
  }

  let start: Date;
  let end: Date;

  if (range === 'week') {
    start = new Date(now);
    start.setDate(now.getDate() - now.getDay());
    end = new Date(start);
    end.setDate(start.getDate() + 6);
  } else if (range === 'month') {
    start = new Date(now.getFullYear(), now.getMonth(), 1);
    end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  } else if (range === 'quarter') {
    const q = Math.floor(now.getMonth() / 3);
    start = new Date(now.getFullYear(), q * 3, 1);
    end = new Date(now.getFullYear(), q * 3 + 3, 0);
  } else {
    start = new Date(now.getFullYear(), 0, 1);
    end = new Date(now.getFullYear(), 11, 31);
  }

  const startStr = toStr(start);
  const endStr = toStr(end);
  return tasks.filter(t => {
    const d = toDateStr(t.dueDate);
    return d && d >= startStr && d <= endStr;
  });
}

/** 月末兜底：如果目标月份没有该日期，返回该月最后一天 */
function clampDay(year: number, month: number, day: number): Date {
  const d = new Date(year, month, day);
  if (d.getMonth() !== month) {
    // 溢出，回退到上月最后一天
    return new Date(year, month, 0);
  }
  return d;
}

/**
 * 根据重复规则计算下次提醒时间。
 * 返回 ISO 字符串；如果超出 endDate 或规则为 none，返回 null。
 */
export function calculateNextReminder(
  currentReminderAt: string,
  recurrence: RecurrenceRule | null,
): string | null {
  if (!recurrence || recurrence.type === 'none') return null;

  const base = new Date(currentReminderAt);
  if (isNaN(base.getTime())) return null;

  const interval = Math.max(1, recurrence.interval || 1);
  let next: Date;

  switch (recurrence.type) {
    case 'daily':
      next = new Date(base);
      next.setDate(next.getDate() + interval);
      break;
    case 'weekly':
      next = new Date(base);
      next.setDate(next.getDate() + interval * 7);
      break;
    case 'monthly': {
      const year = base.getFullYear();
      const month = base.getMonth() + interval;
      const day = base.getDate();
      next = clampDay(year, month, day);
      break;
    }
    case 'yearly': {
      const y = base.getFullYear() + interval;
      const m = base.getMonth();
      const d = base.getDate();
      next = clampDay(y, m, d);
      break;
    }
    default:
      return null;
  }

  // 检查是否超出重复截止日期
  if (recurrence.endDate) {
    const end = new Date(recurrence.endDate);
    end.setHours(23, 59, 59, 999);
    if (next > end) return null;
  }

  return next.toISOString();
}

/** 格式化日期时间为可读字符串 "M月D日 HH:mm" */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** 生成相对现在的 ISO 时间（用于预设） */
export function offsetMinutes(minutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + minutes);
  return d.toISOString();
}

/** 明天早上9点的 ISO 时间 */
export function tomorrowMorning9(): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(9, 0, 0, 0);
  return d.toISOString();
}

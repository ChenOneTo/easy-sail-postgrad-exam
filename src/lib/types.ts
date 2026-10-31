export type KanbanStatus = 'todo' | 'doing' | 'done';

export type ViewMode = 'calendar' | 'kanban' | 'ai';

export type SectionId =
  | 'inbox'
  | 'today'
  | 'project-work'
  | 'project-study'
  | 'project-life'
  | 'tag-urgent'
  | 'tag-important'
  | 'exam'
  | 'exam-vocab'
  | 'exam-vocab-game'
  | 'exam-reading'
  | 'ai';

/** 重复提醒类型 */
export type RecurrenceType = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';

/** 重复规则 */
export interface RecurrenceRule {
  type: RecurrenceType;
  interval?: number;          // 重复间隔，默认 1（如每2天）
  endDate?: string | null;    // 重复截止日期（可选）
}

export interface Task {
  id: number;
  title: string;
  notes: string;
  projectId: string;
  kanban: KanbanStatus;
  starred: boolean;
  completed: boolean;
  completedAt: string | null;
  dueDate: string | null;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  startDate: string | null;           // 开始日期 YYYY-MM-DD，null = 从未开始
  // —— 提醒通知 ——
  reminderAt: string | null;          // ISO 日期时间 "YYYY-MM-DDTHH:mm:ss"，null = 无提醒
  reminderEnabled: boolean;           // 是否启用提醒
  reminderText: string | null;        // 提醒正文（默认用 title）
  recurrence: RecurrenceRule | null;  // 重复规则
  snoozedUntil: string | null;        // 稍后提醒的时间点
  lastNotifiedAt: string | null;      // 上次通知触发时间（防重复）
}

export interface TaskType {
  id: string;
  name: string;
  icon: string;
  color: string;
}

export const TASK_TYPES: TaskType[] = [
  { id: 'project-work', name: '工作', icon: '💼', color: '#2563EB' },
  { id: 'project-study', name: '学习', icon: '📚', color: '#9333EA' },
  { id: 'project-life', name: '生活', icon: '🏠', color: '#059669' },
];

export const TAG_MAP: Record<string, { class: string; label: string }> = {
  'tag-urgent': { class: 'tag-red', label: '紧急' },
  'tag-important': { class: 'tag-orange', label: '重要' },
};

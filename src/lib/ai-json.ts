import { PROJECT_IDS, TAG_IDS, KANBAN_IDS, type ProjectId, type TagId, type KanbanId } from './prompts';
import type { RecurrenceRule } from './types';

export interface AiTaskDraft {
  title: string;
  dueDate: string | null;
  dueTimeText: string | null;
  reminderAt: string | null;       // ISO 日期时间，AI 解析的具体提醒时间
  recurrence: RecurrenceRule | null; // 重复规则
  projectId: ProjectId | null;
  tags: TagId[];
  notes: string;
}

export interface AiSubtaskDraft {
  title: string;
  notes: string;
  dueDate: string | null;
  projectId: ProjectId | null;
  tags: TagId[];
}

export interface AiBreakdownDraft {
  subtasks: AiSubtaskDraft[];
}

export interface AiChatDraft {
  reply: string;
  taskDraft: AiTaskDraft | null;
  taskPatch: AiTaskPatchDraft | null;
}

export interface AiTaskPatchDraft {
  taskId: number;
  title?: string;
  notes?: string;
  dueDate?: string | null;
  projectId?: ProjectId;
  tags?: TagId[];
  starred?: boolean;
  completed?: boolean;
  kanban?: KanbanId;
  reason: string;
}

export interface AiClassifySuggestion {
  taskId: number;
  projectId: ProjectId | null;
  tags: TagId[];
  reason: string;
}

export interface AiClassifyDraft {
  suggestions: AiClassifySuggestion[];
}

function extractJson(text: string): string {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject >= 0 && lastObject > firstObject) {
    return trimmed.slice(firstObject, lastObject + 1);
  }

  throw new Error('AI 未返回 JSON');
}

export function parseAiJson<T>(text: string): T {
  return JSON.parse(extractJson(text)) as T;
}

function normalizeDate(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const sliced = text.slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(sliced)) return sliced;
  return null;
}

/** 安全解析 ISO 日期时间 */
function normalizeDateTime(value: unknown): string | null {
  if (!value) return null;
  const text = String(value).trim();
  const d = new Date(text);
  if (!isNaN(d.getTime())) return d.toISOString();
  return null;
}

/** 安全解析重复规则 */
function normalizeRecurrence(value: unknown): RecurrenceRule | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const type = obj.type as string | undefined;
  if (!type || !['daily', 'weekly', 'monthly', 'yearly'].includes(type)) return null;
  const interval = Number(obj.interval);
  return {
    type: type as RecurrenceRule['type'],
    interval: Number.isFinite(interval) && interval > 0 ? interval : 1,
    endDate: typeof obj.endDate === 'string' ? obj.endDate : null,
  };
}

function normalizeProjectId(value: unknown): ProjectId | null {
  return PROJECT_IDS.includes(value as ProjectId) ? value as ProjectId : null;
}

function normalizeKanban(value: unknown): KanbanId | null {
  return KANBAN_IDS.includes(value as KanbanId) ? value as KanbanId : null;
}

function normalizeTags(value: unknown): TagId[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(TAG_IDS);
  return [...new Set(value.filter(tag => allowed.has(String(tag))).map(tag => String(tag) as TagId))];
}

function limitText(value: unknown, max: number): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : '';
}

export function normalizeAiTaskDraft(raw: unknown): AiTaskDraft {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const title = limitText(obj.title, 80);
  if (!title) throw new Error('AI 结果缺少任务标题');

  return {
    title,
    dueDate: normalizeDate(obj.dueDate),
    dueTimeText: limitText(obj.dueTimeText, 20) || null,
    reminderAt: normalizeDateTime(obj.reminderAt),
    recurrence: normalizeRecurrence(obj.recurrence),
    projectId: normalizeProjectId(obj.projectId),
    tags: normalizeTags(obj.tags),
    notes: limitText(obj.notes, 500),
  };
}

export function normalizeAiBreakdownDraft(raw: unknown, fallbackProjectId: string): AiBreakdownDraft {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const subtasksRaw = Array.isArray(obj.subtasks) ? obj.subtasks.slice(0, 8) : [];
  const fallback = normalizeProjectId(fallbackProjectId);
  const subtasks = subtasksRaw
    .map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const title = limitText(record.title, 80);
      if (!title) return null;
      return {
        title,
        notes: limitText(record.notes, 500),
        dueDate: normalizeDate(record.dueDate),
        projectId: normalizeProjectId(record.projectId) ?? fallback,
        tags: normalizeTags(record.tags),
      };
    })
    .filter((item): item is AiSubtaskDraft => item !== null);

  if (subtasks.length === 0) throw new Error('AI 未返回可用子任务');
  return { subtasks };
}

export function normalizeAiChatDraft(raw: unknown): AiChatDraft {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const reply = limitText(obj.reply, 1200) || '我没有得到可用回复。';
  let taskDraft: AiTaskDraft | null = null;
  let taskPatch: AiTaskPatchDraft | null = null;

  if (obj.taskDraft && typeof obj.taskDraft === 'object') {
    try {
      taskDraft = normalizeAiTaskDraft(obj.taskDraft);
    } catch {
      taskDraft = null;
    }
  }

  if (obj.taskPatch && typeof obj.taskPatch === 'object') {
    taskPatch = normalizeAiTaskPatchDraft(obj.taskPatch);
  }

  return { reply, taskDraft, taskPatch };
}

function normalizeAiTaskPatchDraft(raw: unknown): AiTaskPatchDraft | null {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const taskId = Number(obj.taskId);
  if (!Number.isFinite(taskId)) return null;

  const patch: AiTaskPatchDraft = {
    taskId,
    reason: limitText(obj.reason, 160) || '根据你的指令建议修改',
  };

  const title = limitText(obj.title, 80);
  if (title) patch.title = title;

  if ('notes' in obj) patch.notes = limitText(obj.notes, 800);
  if ('dueDate' in obj) patch.dueDate = normalizeDate(obj.dueDate);

  const projectId = normalizeProjectId(obj.projectId);
  if (projectId) patch.projectId = projectId;

  if ('tags' in obj) patch.tags = normalizeTags(obj.tags);
  if (typeof obj.starred === 'boolean') patch.starred = obj.starred;
  if (typeof obj.completed === 'boolean') patch.completed = obj.completed;

  const kanban = normalizeKanban(obj.kanban);
  if (kanban) patch.kanban = kanban;

  const hasChange = Object.keys(patch).some(key => !['taskId', 'reason'].includes(key));
  return hasChange ? patch : null;
}

export function normalizeAiClassifyDraft(raw: unknown, allowedTaskIds: number[]): AiClassifyDraft {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const suggestionsRaw = Array.isArray(obj.suggestions) ? obj.suggestions.slice(0, 30) : [];
  const allowed = new Set(allowedTaskIds);
  const seen = new Set<number>();
  const suggestions = suggestionsRaw
    .map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const taskId = Number(record.taskId);
      if (!Number.isFinite(taskId) || !allowed.has(taskId) || seen.has(taskId)) return null;
      seen.add(taskId);

      return {
        taskId,
        projectId: normalizeProjectId(record.projectId),
        tags: normalizeTags(record.tags),
        reason: limitText(record.reason, 160) || '根据标题和备注建议归类',
      };
    })
    .filter((item): item is AiClassifySuggestion => item !== null)
    .filter(item => item.projectId !== null || item.tags.length > 0);

  if (suggestions.length === 0) throw new Error('AI 未返回可用归类建议');
  return { suggestions };
}

// —— 考研周计划（独立于主对话 schema） ——

export interface AiExamPlanItem {
  title: string;
  notes: string;
  planDate: string | null;
}

export interface AiExamPlanDraft {
  plans: AiExamPlanItem[];
}

export function normalizeExamPlanDraft(raw: unknown): AiExamPlanDraft {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const plansRaw = Array.isArray(obj.plans) ? obj.plans.slice(0, 20) : [];
  const plans = plansRaw
    .map(item => {
      const record = item && typeof item === 'object' ? item as Record<string, unknown> : {};
      const title = limitText(record.title, 80);
      if (!title) return null;
      return {
        title,
        notes: limitText(record.notes, 500),
        planDate: normalizeDate(record.planDate),
      };
    })
    .filter((item): item is AiExamPlanItem => item !== null);

  if (plans.length === 0) throw new Error('AI 未返回可用学习计划');
  return { plans };
}

// —— 考研单词 AI 助记 ——

export interface AiMnemonicDraft {
  /** 词根拆解或谐音口诀 */
  mnemonic: string;
  roots: string;
  /** 记忆法类型：谐音 / 词根 / 拆分 / 画面 / 故事 */
  method: string;
  /** 生动、夸张、具体的画面或小故事 */
  scene: string;
  sentence: string;
  /** sentence 的中文翻译（旧记录/脏数据可为空串） */
  sentenceZh: string;
}

/** 校验 AI 助记草稿字段存在性，脏数据降级丢弃不抛错（返回 null） */
export function normalizeMnemonicDraft(raw: unknown): AiMnemonicDraft | null {
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {};
  const mnemonic = limitText(obj.mnemonic, 200);
  if (!mnemonic) return null;
  return {
    mnemonic,
    roots: limitText(obj.roots, 80),
    method: limitText(obj.method, 20),
    scene: limitText(obj.scene, 200),
    sentence: limitText(obj.sentence, 200),
    sentenceZh: limitText(obj.sentenceZh, 200),
  };
}

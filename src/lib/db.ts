import Database from '@tauri-apps/plugin-sql';
import type { Task, KanbanStatus, RecurrenceRule } from './types';
import { localDateStr } from './utils';
import { insertRows } from './sql-util';

let _db: Database | null = null;
const DB_URL = 'sqlite:easy-sail-postgrad-exam.db';

/** 获取本地 SQLite 数据库实例 */
export async function getDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load(DB_URL);
  }
  return _db;
}

/** 安全解析 tags JSON 字符串，损坏时回退为空数组 */
function safeParseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** 安全解析 recurrence JSON，损坏时回退为 null */
function safeParseRecurrence(raw: unknown): RecurrenceRule | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as RecurrenceRule;
    }
    return null;
  } catch {
    return null;
  }
}

/** 将 SQLite 行转换为前端 Task 对象 */
function rowToTask(row: Record<string, unknown>): Task {
  return {
    id: row.id as number,
    title: row.title as string,
    notes: (row.notes as string) || '',
    projectId: (row.project_id as string) || 'inbox',
    kanban: (row.kanban as KanbanStatus) || 'todo',
    starred: !!(row.starred as number),
    completed: !!(row.completed as number),
    completedAt: (row.completed_at as string) || null,
    dueDate: (row.due_date as string) || null,
    tags: safeParseTags(row.tags),
    sortOrder: (row.sort_order as number) || 0,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
    startDate: (row.start_date as string) || null,
    // —— 提醒通知 ——
    reminderAt: (row.reminder_at as string) || null,
    reminderEnabled: !!(row.reminder_enabled as number),
    reminderText: (row.reminder_text as string) || null,
    recurrence: safeParseRecurrence(row.recurrence),
    snoozedUntil: (row.snoozed_until as string) || null,
    lastNotifiedAt: (row.last_notified_at as string) || null,
  };
}

// ========== CRUD 操作 ==========

/** 获取所有任务 */
export async function dbFetchAll(): Promise<Task[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM tasks ORDER BY sort_order ASC, created_at DESC'
  );
  return rows.map(rowToTask);
}

/** 新增任务 */
export async function dbInsert(
  title: string,
  projectId = 'inbox',
  dueDate?: string,
  reminderAt?: string | null,
  reminderEnabled?: boolean,
  reminderText?: string | null,
  recurrence?: RecurrenceRule | null,
): Promise<Task> {
  const db = await getDb();
  const today = localDateStr();
  const result = await db.execute(
    `INSERT INTO tasks (title, project_id, due_date, tags,
        reminder_at, reminder_enabled, reminder_text, recurrence)
     VALUES ($1, $2, $3, '[]', $4, $5, $6, $7)`,
    [
      title,
      projectId,
      dueDate || today,
      reminderAt || null,
      reminderEnabled ? 1 : 0,
      reminderText || null,
      recurrence ? JSON.stringify(recurrence) : null,
    ]
  );
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM tasks WHERE id = $1',
    [result.lastInsertId]
  );
  return rowToTask(rows[0]);
}

/** 更新任务（部分字段） */
export async function dbUpdate(id: number, updates: Partial<Task>): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    title: 'title',
    notes: 'notes',
    projectId: 'project_id',
    kanban: 'kanban',
    starred: 'starred',
    completed: 'completed',
    completedAt: 'completed_at',
    dueDate: 'due_date',
    tags: 'tags',
    sortOrder: 'sort_order',
    startDate: 'start_date',
    reminderAt: 'reminder_at',
    reminderEnabled: 'reminder_enabled',
    reminderText: 'reminder_text',
    recurrence: 'recurrence',
    snoozedUntil: 'snoozed_until',
    lastNotifiedAt: 'last_notified_at',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates) {
      let val = (updates as Record<string, unknown>)[key];
      if (key === 'tags') val = JSON.stringify(val);
      if (key === 'starred' || key === 'completed' || key === 'reminderEnabled') val = val ? 1 : 0;
      if (key === 'recurrence') val = val ? JSON.stringify(val) : null;
      sets.push(`${col} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  values.push(id);

  await db.execute(
    `UPDATE tasks SET ${sets.join(', ')} WHERE id = $${idx + 1}`,
    values
  );
}

/** 删除任务 */
export async function dbDelete(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM tasks WHERE id = $1', [id]);
}

/**
 * 批量写入任务（云盘恢复用）。
 *
 * 不用 BEGIN/COMMIT：tauri-plugin-sql 底层是连接池，BEGIN 与后续语句可能落到
 * 不同连接，会留下未提交事务（后续报 cannot start a transaction within a transaction
 * 或 database is locked）。改为先删后批量插入的 autocommit 写入。
 */
export async function dbReplaceAll(tasks: Task[]): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM tasks');
  await insertRows(
    db,
    `INSERT INTO tasks (id, title, notes, project_id, kanban, starred, completed,
       completed_at, due_date, tags, sort_order, created_at, updated_at,
       reminder_at, reminder_enabled, reminder_text, recurrence,
       snoozed_until, last_notified_at, start_date) VALUES`,
    20,
    tasks.map((t) => [
      t.id, t.title, t.notes, t.projectId, t.kanban,
      t.starred ? 1 : 0, t.completed ? 1 : 0,
      t.completedAt, t.dueDate, JSON.stringify(t.tags),
      t.sortOrder, t.createdAt, t.updatedAt,
      t.reminderAt || null,
      t.reminderEnabled ? 1 : 0,
      t.reminderText || null,
      t.recurrence ? JSON.stringify(t.recurrence) : null,
      t.snoozedUntil || null,
      t.lastNotifiedAt || null,
      t.startDate || null,
    ]),
  );
}

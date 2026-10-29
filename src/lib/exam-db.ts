import Database from '@tauri-apps/plugin-sql';

let _db: Database | null = null;

/** 获取考试计划模块的数据库实例（与 tasks 共用同一 SQLite 文件，表完全独立） */
export async function getExamDb(): Promise<Database> {
  if (!_db) {
    _db = await Database.load('sqlite:easy-sail-postgrad-exam.db');
  }
  return _db;
}

// ========== 类型 ==========

export interface ExamProfile {
  examDate: string | null;      // YYYY-MM-DD
  targetNote: string;
  dailyGoalMinutes: number;
}

export interface ExamSubject {
  id: number;
  key: string;
  name: string;
  color: string;
  sortOrder: number;
  archived: boolean;
}

export interface ExamPhase {
  id: number;
  subjectId: number;
  name: string;
  startDate: string;
  endDate: string;
  goal: string;
  sortOrder: number;
}

export type ExamTaskStatus = 'todo' | 'doing' | 'done';

export interface ExamTask {
  id: number;
  subjectKey: string;
  title: string;
  notes: string;
  status: ExamTaskStatus;
  planDate: string | null;
  startedDate: string | null;
  completedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

/** 云盘备份/恢复的完整快照 */
export interface ExamCloudSnapshot {
  profile: ExamProfile;
  subjects: ExamSubject[];
  phases: ExamPhase[];
  tasks: ExamTask[];
}

// ========== 行转换（容错） ==========

function rowToProfile(row: Record<string, unknown>): ExamProfile {
  return {
    examDate: (row.exam_date as string) || null,
    targetNote: (row.target_note as string) || '',
    dailyGoalMinutes: (row.daily_goal_minutes as number) ?? 120,
  };
}

function rowToSubject(row: Record<string, unknown>): ExamSubject {
  return {
    id: row.id as number,
    key: row.key as string,
    name: row.name as string,
    color: (row.color as string) || '#3B82F6',
    sortOrder: (row.sort_order as number) || 0,
    archived: !!(row.archived as number),
  };
}

function rowToPhase(row: Record<string, unknown>): ExamPhase {
  return {
    id: row.id as number,
    subjectId: row.subject_id as number,
    name: row.name as string,
    startDate: (row.start_date as string) || '',
    endDate: (row.end_date as string) || '',
    goal: (row.goal as string) || '',
    sortOrder: (row.sort_order as number) || 0,
  };
}

function rowToTask(row: Record<string, unknown>): ExamTask {
  const status = row.status as ExamTaskStatus;
  return {
    id: row.id as number,
    subjectKey: row.subject_key as string,
    title: row.title as string,
    notes: (row.notes as string) || '',
    status: status === 'doing' || status === 'done' ? status : 'todo',
    planDate: (row.plan_date as string) || null,
    startedDate: (row.started_date as string) || null,
    completedAt: (row.completed_at as string) || null,
    sortOrder: (row.sort_order as number) || 0,
    createdAt: (row.created_at as string) || '',
    updatedAt: (row.updated_at as string) || '',
  };
}

// ========== Profile ==========

export async function fetchExamProfile(): Promise<ExamProfile> {
  const db = await getExamDb();
  const rows = await db.select<Record<string, unknown>[]>('SELECT * FROM exam_profile WHERE id = 1');
  if (rows.length === 0) return { examDate: '2026-12-19', targetNote: '', dailyGoalMinutes: 120 };
  return rowToProfile(rows[0]);
}

export async function updateExamProfile(updates: Partial<Omit<ExamProfile, 'examDate'> & { examDate: string | null }>): Promise<void> {
  const db = await getExamDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if ('examDate' in updates) { sets.push(`exam_date = $${idx++}`); values.push(updates.examDate ?? null); }
  if ('targetNote' in updates) { sets.push(`target_note = $${idx++}`); values.push(updates.targetNote ?? ''); }
  if ('dailyGoalMinutes' in updates) { sets.push(`daily_goal_minutes = $${idx++}`); values.push(updates.dailyGoalMinutes ?? 120); }
  sets.push(`updated_at = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(1);
  await db.execute(`UPDATE exam_profile SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

// ========== Subjects ==========

export async function fetchExamSubjects(): Promise<ExamSubject[]> {
  const db = await getExamDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_subjects WHERE archived = 0 ORDER BY sort_order ASC'
  );
  return rows.map(rowToSubject);
}

// ========== Phases ==========

export async function fetchExamPhases(): Promise<ExamPhase[]> {
  const db = await getExamDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_phases ORDER BY subject_id ASC, sort_order ASC'
  );
  return rows.map(rowToPhase);
}

export async function updateExamPhase(id: number, updates: Partial<Pick<ExamPhase, 'name' | 'startDate' | 'endDate' | 'goal'>>): Promise<void> {
  const db = await getExamDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  if ('name' in updates) { sets.push(`name = $${idx++}`); values.push(updates.name ?? ''); }
  if ('startDate' in updates) { sets.push(`start_date = $${idx++}`); values.push(updates.startDate ?? ''); }
  if ('endDate' in updates) { sets.push(`end_date = $${idx++}`); values.push(updates.endDate ?? ''); }
  if ('goal' in updates) { sets.push(`goal = $${idx++}`); values.push(updates.goal ?? ''); }
  if (sets.length === 0) return;
  values.push(id);
  await db.execute(`UPDATE exam_phases SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

// ========== Tasks ==========

export async function fetchExamTasks(): Promise<ExamTask[]> {
  const db = await getExamDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_tasks ORDER BY sort_order ASC, created_at DESC'
  );
  return rows.map(rowToTask);
}

export async function insertExamTask(input: {
  subjectKey: string;
  title: string;
  notes?: string;
  planDate?: string | null;
}): Promise<ExamTask> {
  const db = await getExamDb();
  const result = await db.execute(
    `INSERT INTO exam_tasks (subject_key, title, notes, plan_date)
     VALUES ($1, $2, $3, $4)`,
    [input.subjectKey, input.title.trim(), input.notes || '', input.planDate ?? null]
  );
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM exam_tasks WHERE id = $1',
    [result.lastInsertId]
  );
  return rowToTask(rows[0]);
}

export interface ExamTaskPatch {
  title?: string;
  notes?: string;
  status?: ExamTaskStatus;
  planDate?: string | null;
  startedDate?: string | null;
  completedAt?: string | null;
}

const TASK_FIELD_MAP: Record<string, string> = {
  title: 'title',
  notes: 'notes',
  status: 'status',
  planDate: 'plan_date',
  startedDate: 'started_date',
  completedAt: 'completed_at',
};

export async function updateExamTask(id: number, updates: ExamTaskPatch): Promise<void> {
  const db = await getExamDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;
  for (const [key, col] of Object.entries(TASK_FIELD_MAP)) {
    if (key in updates) {
      sets.push(`${col} = $${idx++}`);
      values.push((updates as Record<string, unknown>)[key] ?? null);
    }
  }
  sets.push(`updated_at = $${idx++}`);
  values.push(new Date().toISOString());
  values.push(id);
  await db.execute(`UPDATE exam_tasks SET ${sets.join(', ')} WHERE id = $${idx}`, values);
}

export async function deleteExamTask(id: number): Promise<void> {
  const db = await getExamDb();
  await db.execute('DELETE FROM exam_tasks WHERE id = $1', [id]);
}

// ========== 云盘备份恢复 ==========

/**
 * 用云端快照整体覆盖本地考试数据（事务保证原子性）。
 * 科目按 key 合并（保留本地自增 id，阶段 subject_id 自动重映射），
 * 阶段/任务全量替换，profile 单例行更新。
 */
export async function replaceExamData(snapshot: ExamCloudSnapshot): Promise<void> {
  const db = await getExamDb();
  await db.execute('BEGIN TRANSACTION');
  try {
    // 1. 科目按 key 合并（不删除本地已有科目，避免破坏其他引用）
    for (const s of snapshot.subjects) {
      await db.execute(
        'UPDATE exam_subjects SET name = $1, color = $2, sort_order = $3, archived = 0 WHERE key = $4',
        [s.name, s.color, s.sortOrder ?? 0, s.key]
      );
      await db.execute(
        'INSERT OR IGNORE INTO exam_subjects (key, name, color, sort_order) VALUES ($1, $2, $3, $4)',
        [s.key, s.name, s.color, s.sortOrder ?? 0]
      );
    }

    // 2. 云端科目 id → 本地科目 id 重映射（经由 key）
    const localRows = await db.select<Record<string, unknown>[]>('SELECT id, key FROM exam_subjects');
    const localIdByKey = new Map(localRows.map(r => [r.key as string, r.id as number]));
    const cloudIdToLocal = new Map<number, number>();
    for (const s of snapshot.subjects) {
      const localId = localIdByKey.get(s.key);
      if (localId !== undefined) cloudIdToLocal.set(s.id, localId);
    }

    // 3. 阶段全量替换（重映射 subject_id）
    await db.execute('DELETE FROM exam_phases');
    let phaseOrder = 0;
    for (const p of snapshot.phases) {
      const subjectId = cloudIdToLocal.get(p.subjectId);
      if (subjectId === undefined) continue;
      await db.execute(
        `INSERT INTO exam_phases (subject_id, name, start_date, end_date, goal, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [subjectId, p.name, p.startDate, p.endDate, p.goal || '', p.sortOrder ?? phaseOrder]
      );
      phaseOrder++;
    }

    // 4. 任务全量替换
    await db.execute('DELETE FROM exam_tasks');
    for (const t of snapshot.tasks) {
      await db.execute(
        `INSERT INTO exam_tasks (subject_key, title, notes, status, plan_date, started_date,
           completed_at, sort_order, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          t.subjectKey, t.title, t.notes || '',
          t.status === 'doing' || t.status === 'done' ? t.status : 'todo',
          t.planDate ?? null, t.startedDate ?? null, t.completedAt ?? null,
          t.sortOrder ?? 0,
          t.createdAt || new Date().toISOString(),
          t.updatedAt || new Date().toISOString(),
        ]
      );
    }

    // 5. Profile 单例行更新
    await db.execute(
      `UPDATE exam_profile SET exam_date = $1, target_note = $2, daily_goal_minutes = $3, updated_at = $4 WHERE id = 1`,
      [snapshot.profile.examDate ?? null, snapshot.profile.targetNote || '', snapshot.profile.dailyGoalMinutes ?? 120, new Date().toISOString()]
    );

    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }
}

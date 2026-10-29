/**
 * 灵感（Inspiration）的 SQLite 持久化层
 *
 * 表结构见 src-tauri/src/lib.rs migration v3。
 */

import { getDb } from './db';
import type { Inspiration } from './types';

/** 安全解析 tags JSON 字符串，损坏时回退为空数组 */
function safeParseTags(raw: unknown): string[] {
  if (typeof raw !== 'string' || !raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

/** SQLite datetime('now') 返回 "YYYY-MM-DD HH:MM:SS"（UTC），转为 ISO 便于前端解析 */
function normalizeSqliteDateTime(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) return `${raw.replace(' ', 'T')}Z`;
  return raw;
}

/** 将 SQLite 行转换为前端 Inspiration 对象 */
function rowToInspiration(row: Record<string, unknown>): Inspiration {
  return {
    id: row.id as number,
    content: row.content as string,
    title: (row.title as string) || '',
    polished: (row.polished as string) || '',
    tags: safeParseTags(row.tags),
    createdAt: normalizeSqliteDateTime(row.created_at),
    updatedAt: normalizeSqliteDateTime(row.updated_at),
  };
}

/** 获取所有灵感（最新在前） */
export async function dbFetchInspirations(): Promise<Inspiration[]> {
  const db = await getDb();
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM inspirations ORDER BY created_at DESC, id DESC'
  );
  return rows.map(rowToInspiration);
}

/** 新增一条灵感 */
export async function dbInsertInspiration(content: string): Promise<Inspiration> {
  const db = await getDb();
  const result = await db.execute(
    'INSERT INTO inspirations (content) VALUES ($1)',
    [content]
  );
  const rows = await db.select<Record<string, unknown>[]>(
    'SELECT * FROM inspirations WHERE id = $1',
    [result.lastInsertId]
  );
  return rowToInspiration(rows[0]);
}

/** 更新灵感（部分字段） */
export async function dbUpdateInspiration(
  id: number,
  updates: Partial<Pick<Inspiration, 'content' | 'title' | 'polished' | 'tags'>>
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  const fieldMap: Record<string, string> = {
    content: 'content',
    title: 'title',
    polished: 'polished',
    tags: 'tags',
  };

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates) {
      let val = (updates as Record<string, unknown>)[key];
      if (key === 'tags') val = JSON.stringify(val);
      sets.push(`${col} = $${idx}`);
      values.push(val);
      idx++;
    }
  }

  if (sets.length === 0) return;

  sets.push(`updated_at = $${idx}`);
  values.push(new Date().toISOString());
  values.push(id);

  await db.execute(
    `UPDATE inspirations SET ${sets.join(', ')} WHERE id = $${idx + 1}`,
    values
  );
}

/** 删除灵感 */
export async function dbDeleteInspiration(id: number): Promise<void> {
  const db = await getDb();
  await db.execute('DELETE FROM inspirations WHERE id = $1', [id]);
}

/** 批量替换所有灵感（导入/云盘加载，事务保证原子性） */
export async function dbReplaceAllInspirations(inspirations: Inspiration[]): Promise<void> {
  const db = await getDb();
  await db.execute('BEGIN TRANSACTION');
  try {
    await db.execute('DELETE FROM inspirations');
    for (const ins of inspirations) {
      await db.execute(
        `INSERT INTO inspirations (id, content, title, polished, tags, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [
          ins.id,
          ins.content,
          ins.title || '',
          ins.polished || '',
          JSON.stringify(Array.isArray(ins.tags) ? ins.tags : []),
          ins.createdAt || new Date().toISOString(),
          ins.updatedAt || new Date().toISOString(),
        ]
      );
    }
    await db.execute('COMMIT');
  } catch (err) {
    await db.execute('ROLLBACK');
    throw err;
  }
}

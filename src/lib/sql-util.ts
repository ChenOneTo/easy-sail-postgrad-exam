/**
 * SQLite 写入工具（tauri-plugin-sql 适配）
 *
 * 重要约定：**不要用 BEGIN / COMMIT 手动事务**。
 * tauri-plugin-sql 底层是 sqlx 连接池，`db.execute()` 每次可能取到池中不同连接：
 * - BEGIN 落在连接 A、后续语句落在连接 B 时，事务形同虚设；
 * - 连接 A 归还池时仍带着未提交事务，之后任何 BEGIN 都会报
 *   `(code: 1) cannot start a transaction within a transaction`；
 * - 该未提交事务持有的写锁还会让其它连接报 `(code: 5) database is locked`。
 *
 * 因此统一按 autocommit 逐条/批量写入，靠「先删后插 + 失败用旧快照还原」保证可用性。
 */
import type Database from '@tauri-apps/plugin-sql';
import { errText } from './error-text';

/** 每批拼多少行（100 行 × 约 13 列 ≈ 1300 个绑定变量，远低于 SQLite 变量上限） */
export const SQL_BATCH_SIZE = 100;

/**
 * 执行写语句，遇到数据库被占用（SQLITE_BUSY，多连接写冲突）时退避重试。
 * 恢复全量数据时容易与通知引擎等其它连接的写入撞锁。
 */
export async function execWithRetry(
  db: Database,
  sql: string,
  values: unknown[],
  attempts = 4,
): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await db.execute(sql, values);
      return;
    } catch (err) {
      const msg = errText(err);
      if (attempt >= attempts || !/locked|busy/i.test(msg)) throw err;
      await new Promise((r) => setTimeout(r, 300 * attempt));
    }
  }
}

/**
 * 批量插入：把多行拼成一条多值 INSERT，减少 IPC 往返。
 * 逐条 insert 上万行会让写入持续数分钟，期间不断与其它连接抢写锁。
 *
 * @param prefix 形如 `INSERT INTO t (a, b) VALUES`
 * @param columns 每行的列数
 */
export async function insertRows(
  db: Database,
  prefix: string,
  columns: number,
  rows: unknown[][],
  batchSize = SQL_BATCH_SIZE,
): Promise<void> {
  for (let i = 0; i < rows.length; i += batchSize) {
    const slice = rows.slice(i, i + batchSize);
    const tuples: string[] = [];
    const values: unknown[] = [];
    for (const row of slice) {
      const start = values.length + 1;
      tuples.push(`(${Array.from({ length: columns }, (_, c) => `$${start + c}`).join(',')})`);
      values.push(...row);
    }
    await execWithRetry(db, `${prefix} ${tuples.join(',')}`, values);
  }
}

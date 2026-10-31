import { isTauri } from './tauri';

export type UpdateCheckResult =
  | { status: 'not-supported' }
  | { status: 'no-update' }
  | { status: 'updated'; version: string };

export interface DownloadProgress {
  /** 已下载字节；total 为 0 表示未知（部分服务器不返回 content-length） */
  downloaded: number;
  total: number;
}

export async function checkForUpdate(): Promise<{ version: string } | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  return update ? { version: update.version } : null;
}

export async function checkAndInstallUpdate(
  onProgress?: (p: DownloadProgress) => void,
): Promise<UpdateCheckResult> {
  if (!isTauri()) return { status: 'not-supported' };

  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ]);

  const update = await check();
  if (!update) return { status: 'no-update' };

  let total = 0;
  let downloaded = 0;

  await update.downloadAndInstall(progress => {
    if (progress.event === 'Started') {
      total = progress.data.contentLength ?? 0;
    } else if (progress.event === 'Progress') {
      downloaded += progress.data.chunkLength;
      onProgress?.({ downloaded, total });
    }
  });
  await relaunch();

  return { status: 'updated', version: update.version };
}

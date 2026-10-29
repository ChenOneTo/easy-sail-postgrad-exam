import { isTauri } from './tauri';

export type UpdateCheckResult =
  | { status: 'not-supported' }
  | { status: 'no-update' }
  | { status: 'updated'; version: string };

export async function checkForUpdate(): Promise<{ version: string } | null> {
  if (!isTauri()) return null;
  const { check } = await import('@tauri-apps/plugin-updater');
  const update = await check();
  return update ? { version: update.version } : null;
}

export async function checkAndInstallUpdate(): Promise<UpdateCheckResult> {
  if (!isTauri()) return { status: 'not-supported' };

  const [{ check }, { relaunch }] = await Promise.all([
    import('@tauri-apps/plugin-updater'),
    import('@tauri-apps/plugin-process'),
  ]);

  const update = await check();
  if (!update) return { status: 'no-update' };

  await update.downloadAndInstall();
  await relaunch();

  return { status: 'updated', version: update.version };
}

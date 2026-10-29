import { useEffect, useState } from 'react';
import { isTauri } from '../lib/tauri';
import { checkAndInstallUpdate, checkForUpdate } from '../lib/updater';

export function UpdatePrompt() {
  const [version, setVersion] = useState('');
  const [downloading, setDownloading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!isTauri()) return;

    const timer = window.setTimeout(() => {
      checkForUpdate()
        .then(update => {
          if (update) setVersion(update.version);
        })
        .catch(err => {
          console.warn('[Updater] 自动检查失败:', err);
        });
    }, 5000);

    return () => window.clearTimeout(timer);
  }, []);

  const handleInstall = async () => {
    setDownloading(true);
    try {
      const result = await checkAndInstallUpdate();
      if (result.status === 'no-update' || result.status === 'not-supported') {
        setDismissed(true);
      }
    } catch (err) {
      console.warn('[Updater] 安装失败:', err);
      setDownloading(false);
    }
  };

  if (!version || dismissed) return null;

  return (
    <div className="update-prompt">
      <div>
        <div className="update-prompt-title">发现新版本 v{version}</div>
        <div className="update-prompt-desc">安装完成后将自动重启应用</div>
      </div>
      <div className="update-prompt-actions">
        <button onClick={() => setDismissed(true)} disabled={downloading}>稍后</button>
        <button className="primary" onClick={handleInstall} disabled={downloading}>
          {downloading ? '安装中...' : '立即更新'}
        </button>
      </div>
    </div>
  );
}

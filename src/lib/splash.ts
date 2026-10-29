export type SplashMode = 'first-install' | 'next-launch' | 'always';

const SPLASH_SEEN_KEY = 'easysail-exam-splash-seen';
const SPLASH_MODE_KEY = 'easysail-exam-splash-mode';

export const SPLASH_MODE_OPTIONS: { value: SplashMode; label: string; desc: string }[] = [
  { value: 'first-install', label: '仅首次安装后显示', desc: '默认设置，用户进入应用后不再重复显示启动页' },
  { value: 'next-launch', label: '下次启动显示一次', desc: '适合测试启动页；下次启动显示后自动恢复默认设置' },
  { value: 'always', label: '每次启动都显示', desc: '每次打开应用都会显示启动页' },
];

export function getSplashMode(): SplashMode {
  const value = localStorage.getItem(SPLASH_MODE_KEY);
  if (value === 'next-launch' || value === 'always') return value;
  return 'first-install';
}

export function setSplashMode(mode: SplashMode) {
  localStorage.setItem(SPLASH_MODE_KEY, mode);
}

export function markSplashSeen() {
  localStorage.setItem(SPLASH_SEEN_KEY, '1');
}

export function shouldShowSplashOnLaunch(): boolean {
  const mode = getSplashMode();
  if (mode === 'always') return true;
  if (mode === 'next-launch') {
    setSplashMode('first-install');
    return true;
  }

  return !localStorage.getItem(SPLASH_SEEN_KEY);
}

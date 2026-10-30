import { useEffect, useState } from 'react';
import {
  BarChart3,
  Bot,
  Cloud,
  FileText,
  LayoutDashboard,
  ListChecks,
  Sparkles,
} from 'lucide-react';
import { markSplashSeen } from '../lib/splash';

const FEATURE_POINTS = [
  { icon: <ListChecks size={22} />, title: '任务管理', desc: '待办、项目、标签、星标与截止日期，AI 语义识别快速建任务' },
  { icon: <LayoutDashboard size={22} />, title: '多视图工作台', desc: '列表、看板、日历三种视图切换，适配不同整理习惯' },
  { icon: <Bot size={22} />, title: 'AI 助手', desc: '对话式建任务、智能拆解、备注润色，每天一句 AI 激励语' },
  { icon: <BarChart3 size={22} />, title: '智能复盘', desc: 'AI 生成日报、周报、月报，任务数据统计一目了然' },
  { icon: <FileText size={22} />, title: '文章创作', desc: 'Markdown 写作、多主题排版、图床上传，一键复制到公众号' },
  { icon: <Cloud size={22} />, title: '本地与云盘', desc: '本地数据优先，支持导入导出和自选云盘目录同步' },
];

export function SplashScreen({ onEnter }: { onEnter: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const [version, setVersion] = useState(import.meta.env.VITE_APP_VERSION || '');

  useEffect(() => {
    import('@tauri-apps/api/app')
      .then(({ getVersion }) => getVersion())
      .then(v => {
        if (v) setVersion(v);
      })
      .catch(() => {});
  }, []);

  const handleEnter = () => {
    setLeaving(true);
    setTimeout(() => {
      markSplashSeen();
      onEnter();
    }, 500);
  };

  return (
    <div className={`splash-screen${leaving ? ' splash-leaving' : ''}`}>
      <div className="splash-bg-orb splash-bg-orb-1" />
      <div className="splash-bg-orb splash-bg-orb-2" />

      <div className="splash-content">
        <div className="splash-hero">
          <div className="splash-logo-wrap">
            <img src="/logo.svg" alt="轻舟考研台" className="splash-logo" />
          </div>
          <h1 className="splash-title">轻舟考研台</h1>
          <p className="splash-subtitle">你的考研备考助手</p>
          <p className="splash-tagline">考研计划 · 背单词 · 智能复盘</p>
        </div>

        <div className="splash-privacy-banner">
          <Sparkles size={28} className="splash-privacy-shield" />
          <div>
            <h2>从备考计划到每日复盘的一体化学习工作台</h2>
            <p>管理任务、规划考研、背单词与生成复盘，AI 全程辅助，数据始终留在本机</p>
          </div>
        </div>

        <div className="splash-privacy-grid">
          {FEATURE_POINTS.map((p, i) => (
            <div key={p.title} className="splash-privacy-card" style={{ animationDelay: `${0.2 + i * 0.08}s` }}>
              <div className="splash-privacy-card-icon">{p.icon}</div>
              <div>
                <h3>{p.title}</h3>
                <p>{p.desc}</p>
              </div>
            </div>
          ))}
        </div>

        <button className="splash-enter-btn" onClick={handleEnter}>
          开始使用
        </button>
        <p className="splash-version-badge">V{version || '0.0.0'}</p>
        <p className="splash-footer">无需注册 · 本地数据优先 · AI 配置由你掌控</p>
      </div>
    </div>
  );
}

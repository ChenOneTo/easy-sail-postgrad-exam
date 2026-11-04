/**
 * 打字背单词——统计面板。
 */
import { Activity, Clock, Flame, Target, Trophy } from 'lucide-react';
import type {
  TypingDailyPoint, TypingModeStat, TypingOverview, TypingSession, TypingUnitStat,
} from '../lib/typing-vocab-db';

interface Props {
  overview: TypingOverview | null;
  daily: TypingDailyPoint[];
  modeStats: TypingModeStat[];
  units: TypingUnitStat[];
  recentSessions: TypingSession[];
}

const MODE_LABEL: Record<string, string> = {
  follow: '跟打',
  dictation: '听写',
  selftest: '自测',
  recall: '默写',
};

function fmtDuration(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes} 分钟`;
  const h = Math.floor(minutes / 60);
  return `${h} 小时 ${minutes % 60} 分`;
}

function fmtShortTime(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function recentDays(count: number): string[] {
  const days: string[] = [];
  const now = new Date();
  for (let i = count - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    days.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
  }
  return days;
}

export function TypingVocabStatsPanel({ overview, daily, modeStats, units, recentSessions }: Props) {
  const days = recentDays(7).map((day) => {
    const hit = daily.find((d) => d.day === day);
    return {
      day,
      label: day.slice(5),
      words: hit?.words ?? 0,
      sessions: hit?.sessions ?? 0,
      accuracy: hit?.accuracy ?? 0,
      wpm: hit?.wpm ?? 0,
    };
  });
  const maxWords = Math.max(1, ...days.map((d) => d.words));
  const maxModeWords = Math.max(1, ...modeStats.map((m) => m.words));

  return (
    <section className="typing-stats-panel">
      <div className="typing-stat-grid">
        <StatCard icon={<Target size={14} />} label="累计练习" value={`${overview?.totalSessions ?? 0} 组`} />
        <StatCard icon={<Activity size={14} />} label="平均正确率" value={`${Math.round((overview?.avgAccuracy ?? 0) * 100)}%`} />
        <StatCard icon={<Trophy size={14} />} label="平均速度" value={`${(overview?.avgWpm ?? 0).toFixed(1)} WPM`} />
        <StatCard icon={<Clock size={14} />} label="累计时长" value={fmtDuration(overview?.totalDurationMs ?? 0)} />
      </div>

      <div className="typing-panel typing-today-panel">
        <h3><Flame size={15} /> 今日</h3>
        <div className="typing-today-grid">
          <div><b>{overview?.todayNew ?? 0}</b><span>新学单词</span></div>
          <div><b>{overview?.todayReviewed ?? 0}</b><span>复习单词</span></div>
          <div><b>{Math.round((overview?.todayAccuracy ?? 0) * 100)}%</b><span>今日正确率</span></div>
          <div><b>{fmtDuration(overview?.todayDurationMs ?? 0)}</b><span>今日时长</span></div>
        </div>
      </div>

      <div className="typing-panel">
        <h3>最近 7 天</h3>
        <div className="typing-chart">
          {days.map((d) => (
            <div className="typing-chart-col" key={d.day} title={`${d.words} 词 / ${d.sessions} 组`}>
              <span className="typing-chart-value">{d.words > 0 ? d.words : ''}</span>
              <div className="typing-chart-bar">
                <span style={{ height: `${Math.max(d.words > 0 ? 6 : 0, (d.words / maxWords) * 100)}%` }} />
              </div>
              <span className="typing-chart-label">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="typing-panel">
        <h3>模式分布</h3>
        {modeStats.length === 0 ? (
          <p className="placeholder-text">还没有练习记录</p>
        ) : (
          <ul className="typing-mode-stats">
            {modeStats.map((m) => (
              <li key={m.mode}>
                <span className="typing-mode-name">{MODE_LABEL[m.mode] ?? m.mode}</span>
                <div className="typing-mode-bar">
                  <span style={{ width: `${Math.max(3, (m.words / maxModeWords) * 100)}%` }} />
                </div>
                <span className="typing-mode-num">{m.words} 词 · {Math.round(m.accuracy * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="typing-panel">
        <h3>单元进度</h3>
        <div className="typing-unit-grid">
          {units.map((u) => (
            <div className="typing-unit-card" key={u.unit}>
              <div className="typing-unit-head">
                <b>{u.unit}</b>
                <span>{u.mastered}/{u.total}</span>
              </div>
              <div className="typing-unit-bar">
                <span style={{ width: `${u.total > 0 ? (u.mastered / u.total) * 100 : 0}%` }} />
              </div>
              {u.wrong > 0 && <span className="typing-unit-wrong">错词 {u.wrong}</span>}
            </div>
          ))}
        </div>
      </div>

      <div className="typing-panel">
        <h3>最近练习</h3>
        {recentSessions.length === 0 ? (
          <p className="placeholder-text">还没有练习记录</p>
        ) : (
          <ul className="typing-session-list">
            {recentSessions.map((s) => (
              <li key={s.id}>
                <span className="typing-session-mode">{MODE_LABEL[s.mode] ?? s.mode}</span>
                <span>{s.total} 词</span>
                <span>正确率 {Math.round(s.accuracy * 100)}%</span>
                <span>{s.wpm.toFixed(1)} WPM</span>
                <span className="typing-session-time">{fmtShortTime(s.startedAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatCard({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="typing-stat-card">
      <span className="typing-stat-label">{icon}{label}</span>
      <b>{value}</b>
    </div>
  );
}

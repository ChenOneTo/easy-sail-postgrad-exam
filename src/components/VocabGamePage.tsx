import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, BookOpen, CalendarDays, Check, ChevronRight, Clock, Lock,
  Map as MapIcon, RotateCw, Search, Settings2, Target, Volume2, X,
} from 'lucide-react';
import { useVocabGameStore, wordStatusOf } from '../stores/vocab-game-store';
import type { GameWord, WordStatus } from '../stores/vocab-game-store';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { useTaskStore } from '../stores/task-store';
import { getPhonetics } from '../lib/vocab-phonetics';
import { speak, speakAccent } from '../lib/vocab-tts';
import { localDateStr } from '../lib/utils';
import type { VocabHardWord } from '../lib/exam-vocab-db';
import type { DailyMinutes } from '../lib/vocab-game-db';
import { VocabGameSession } from './VocabGameSession';

type Tab = 'quest' | 'wordbook' | 'stats' | 'mistakes';
type WbFilter = 'all' | WordStatus;

const TABS: { id: Tab; label: string }[] = [
  { id: 'quest', label: '闯关' },
  { id: 'wordbook', label: '单词本' },
  { id: 'stats', label: '学习统计' },
  { id: 'mistakes', label: '错词复习' },
];

const STATUS_LABEL: Record<WordStatus, string> = {
  new: '新学',
  seen: '见过',
  familiar: '熟悉',
  mastered: '掌握',
};

/** 通关正确率选项，全部关卡统一生效 */
const PASS_OPTIONS = [0.6, 0.7, 0.8, 0.9] as const;

const FILTERS: { id: WbFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'mastered', label: '掌握' },
  { id: 'familiar', label: '熟悉' },
  { id: 'seen', label: '见过' },
  { id: 'new', label: '新学' },
];

/** SQLite 的 datetime('now') 是 UTC 空格格式，转成本地「M月D日」展示 */
function fmtRunDate(value: string): string {
  if (!value) return '';
  const iso = value.includes('T') ? value : `${value.replace(' ', 'T')}Z`;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return value.slice(5, 16);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 分钟数展示：整数不带小数点，小数最多两位 */
function formatMinutes(minutes: number): string {
  return String(Math.round(minutes * 100) / 100);
}

function daysUntil(dateStr: string, today: string): number {
  const a = new Date(`${dateStr}T00:00:00`);
  const b = new Date(`${today}T00:00:00`);
  return Math.round((a.getTime() - b.getTime()) / 86400000);
}

function StatusTag({ status }: { status: WordStatus }) {
  return <span className={`vg-status-tag ${status}`}>{STATUS_LABEL[status]}</span>;
}

/** 列表里的紧凑双音标文本 */
function fmtPhonetics(uk: string | null, us: string | null): string {
  const parts: string[] = [];
  if (uk) parts.push(`英${uk}`);
  if (us) parts.push(`美${us}`);
  return parts.length > 0 ? parts.join(' · ') : '—';
}

/** 词卡/详情里的双音标按钮，分别播放英音与美音 */
function PronChips({ word, uk, us }: { word: string; uk: string | null; us: string | null }) {
  if (!uk && !us) return <div className="vg-phonetic">—</div>;
  return (
    <div className="vg-pron-row">
      {uk && (
        <button className="vg-pron" type="button" aria-label="播放英式发音" onClick={() => speakAccent(word, 'uk')}>
          <span className="vg-pron-label">英</span>
          <span className="vg-pron-ipa">{uk}</span>
          <Volume2 size={13} />
        </button>
      )}
      {us && (
        <button className="vg-pron" type="button" aria-label="播放美式发音" onClick={() => speakAccent(word, 'us')}>
          <span className="vg-pron-label">美</span>
          <span className="vg-pron-ipa">{us}</span>
          <Volume2 size={13} />
        </button>
      )}
    </div>
  );
}

function WeeklyChart({ data, tall }: { data: DailyMinutes[]; tall?: boolean }) {
  const max = Math.max(1, ...data.map((d) => d.minutes));
  const today = localDateStr();
  const weekdays = ['日', '一', '二', '三', '四', '五', '六'];
  return (
    <div className={`vg-chart${tall ? ' tall' : ''}`}>
      {data.map((d) => {
        const date = new Date(`${d.date}T00:00:00`);
        const isToday = d.date === today;
        const height = d.minutes === 0 ? 2 : Math.max(8, Math.round((d.minutes / max) * 100));
        return (
          <div className="vg-bar-col" key={d.date}>
            <div className="vg-bar-track">
              <div
                className={`vg-bar${isToday ? ' today' : ''}`}
                style={{ height: `${height}%` }}
                title={`${d.date} · ${d.minutes} 分钟`}
              />
            </div>
            <span className="vg-bar-label">{isToday ? '今' : weekdays[date.getDay()]}</span>
          </div>
        );
      })}
    </div>
  );
}

/**
 * 单词闯关学习台。
 *
 * 关卡按词库顺序推进：通过关卡的词数累计 = 下一关在词库中的偏移，
 * 成绩写 exam_vocab_game_runs，测验评分走背单词的 FSRS，与既有模块共用一份词库。
 */
export function VocabGamePage() {
  const game = useVocabGameStore();
  const profile = useExamVocabStore((s) => s.profile);
  const wordCount = useExamVocabStore((s) => s.wordCount);
  const hardwords = useExamVocabStore((s) => s.hardwords);
  const addHardword = useExamVocabStore((s) => s.addHardword);
  const markHardwordGrasped = useExamVocabStore((s) => s.markHardwordGrasped);
  const setSection = useTaskStore((s) => s.setSection);

  const [tab, setTab] = useState<Tab>('quest');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [levelsOpen, setLevelsOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [detail, setDetail] = useState<GameWord | null>(null);
  const [detailNote, setDetailNote] = useState('');
  const [draft, setDraft] = useState(game.settings);
  const [starting, setStarting] = useState(false);
  const [banner, setBanner] = useState('');

  // —— 单词本 ——
  const [wbQuery, setWbQuery] = useState('');
  const [wbFilter, setWbFilter] = useState<WbFilter>('all');
  const [wbResults, setWbResults] = useState<GameWord[] | null>(null);

  // —— 错词复习 ——
  const [selectedMistakes, setSelectedMistakes] = useState<Set<number>>(new Set());
  const [reviewQueue, setReviewQueue] = useState<VocabHardWord[] | null>(null);
  const [reviewIndex, setReviewIndex] = useState(0);
  const [reviewRevealed, setReviewRevealed] = useState(false);
  const [reviewNote, setReviewNote] = useState('');

  // —— 全局搜索 ——
  const [globalQuery, setGlobalQuery] = useState('');
  const [globalResults, setGlobalResults] = useState<GameWord[]>([]);
  const levelMapRef = useRef<HTMLDivElement>(null);

  const load = game.load;
  const search = game.search;

  useEffect(() => { void load(); }, [load]);

  // 单词本搜索：输入停顿后再查，避免逐字打库；空查询直接展示当前关卡词，无需清空结果
  useEffect(() => {
    const q = wbQuery.trim();
    if (!q) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void search(q).then((rows) => { if (alive) setWbResults(rows); });
    }, 220);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [wbQuery, search]);

  useEffect(() => {
    if (!searchOpen) return;
    const q = globalQuery.trim();
    if (!q) return;
    let alive = true;
    const timer = window.setTimeout(() => {
      void search(q).then((rows) => { if (alive) setGlobalResults(rows); });
    }, 200);
    return () => { alive = false; window.clearTimeout(timer); };
  }, [globalQuery, searchOpen, search]);

  // 打开关卡地图时把当前关滚到可视区中部（列表较长，避免每次手动找）
  useEffect(() => {
    if (!levelsOpen) return;
    const raf = requestAnimationFrame(() => {
      const container = levelMapRef.current;
      const el = container?.querySelector<HTMLElement>('.vg-level-map-row.current');
      if (!container || !el) return;
      const c = container.getBoundingClientRect();
      const e = el.getBoundingClientRect();
      container.scrollTop += e.top - c.top - container.clientHeight / 2 + e.height / 2;
    });
    return () => cancelAnimationFrame(raf);
  }, [levelsOpen]);

  const todayStr = localDateStr();
  const size = game.settings.levelSize;
  const passedWords = game.progress?.passedWords ?? 0;
  const level = Math.floor(passedWords / size) + 1;
  /** 设置弹窗里的关卡号按草稿词数推算：改每关词数会重新切分关卡 */
  const draftLevel = Math.floor(passedWords / draft.levelSize) + 1;
  const sizeChanged = draft.levelSize !== size;
  const totalLevels = Math.max(1, Math.ceil(wordCount / size));
  const percent = wordCount > 0 ? Math.min(100, Math.round((passedWords / wordCount) * 100)) : 0;
  const todayPassed = game.progress?.todayPassed ?? 0;
  const todayMinutes = game.progress?.todayMinutes ?? 0;
  const avgAccuracy = Math.round((game.progress?.avgAccuracy ?? 0) * 100);
  const examDays = daysUntil(profile.phase3End, todayStr);
  const preview = game.previewWords;
  const rangeText = preview.length > 0
    ? `${preview[0].word} ~ ${preview[preview.length - 1].word}`
    : '全部单词已学完';
  const weekTotal = game.weekly.reduce((sum, d) => sum + d.minutes, 0);
  const ringLength = 2 * Math.PI * 52;
  const mistakes = hardwords.filter((h) => h.status === 'new');
  const wbSource = wbQuery.trim() ? (wbResults ?? []) : preview;
  const wbList = wbSource.filter((w) => wbFilter === 'all' || wordStatusOf(w) === wbFilter);
  const globalList = globalQuery.trim() ? globalResults : game.previewWords;
  const currentReviewWord = reviewQueue?.[reviewIndex];
  const dateLabel = new Date().toLocaleDateString('zh-CN', {
    month: 'long', day: 'numeric', weekday: 'long',
  });

  // 关卡地图展示全部关卡，已通过的都可重闯
  const levelRows = useMemo(
    () => Array.from({ length: totalLevels }, (_, i) => i + 1),
    [totalLevels]
  );

  const openSettings = () => {
    setDraft(game.settings);
    setSettingsOpen(true);
  };

  const startGame = async () => {
    if (starting) return;
    setStarting(true);
    game.saveSettings(draft);
    const ok = await game.startLevel();
    setStarting(false);
    if (ok) setSettingsOpen(false);
    else setBanner('关卡装载失败，请稍后再试。');
  };

  /** 重闯已通关卡：沿用当前设置，成绩记录为 replay，不推进进度 */
  const startReplay = async (target: number) => {
    setLevelsOpen(false);
    const ok = await game.startLevel(target);
    if (!ok) setBanner('关卡装载失败，请稍后再试。');
  };

  const addDetailToHardword = async () => {
    if (!detail) return;
    await addHardword(detail.wordId, 'manual');
    setDetailNote('已加入错词复习，可在「错词复习」标签查看。');
  };

  const startMistakeReview = (useAll: boolean) => {
    const queue = useAll ? mistakes : mistakes.filter((m) => selectedMistakes.has(m.wordId));
    if (queue.length === 0) { setReviewNote('请先选择需要复习的错词。'); return; }
    setReviewQueue(queue);
    setReviewIndex(0);
    setReviewRevealed(false);
    setReviewNote('');
  };

  const advanceReview = (grasped: boolean) => {
    if (!currentReviewWord) return;
    if (grasped) void markHardwordGrasped(currentReviewWord.wordId);
    const total = reviewQueue?.length ?? 0;
    if (reviewIndex + 1 >= total) {
      setReviewQueue(null);
      setSelectedMistakes(new Set());
      setReviewNote(grasped ? '复习完成，已掌握的单词移出错词。' : '复习完成，仍模糊的单词保留在错词本。');
    } else {
      setReviewIndex((i) => i + 1);
      setReviewRevealed(false);
    }
  };

  const toggleMistake = (wordId: number) => {
    setSelectedMistakes((prev) => {
      const next = new Set(prev);
      if (next.has(wordId)) next.delete(wordId); else next.add(wordId);
      return next;
    });
  };

  if (!game.loaded) {
    return <div className="vg-page"><p className="placeholder-text">加载中…</p></div>;
  }

  return (
    <div className="vg-page">
      <header className="vg-head">
        <div>
          <p className="vg-eyebrow">{dateLabel}</p>
          <h2>今天再拿下一关</h2>
          <p className="vg-sub">
            {wordCount} 词 · {totalLevels} 关 · 已通过 {game.progress?.passedLevels ?? 0} 关
          </p>
        </div>
        <div className="vg-head-ops">
          <span className="vg-chip"><Clock size={14} /> 今日已学习 {todayMinutes} 分钟</span>
          <button className="vg-icon-btn" title="搜索单词" aria-label="搜索单词" onClick={() => setSearchOpen(true)}>
            <Search size={17} />
          </button>
          <button className="vg-ghost-btn" onClick={() => setLevelsOpen(true)}>
            <MapIcon size={14} /> 关卡地图
          </button>
          <button className="vg-ghost-btn" onClick={openSettings}>
            <Settings2 size={14} /> 关卡设置
          </button>
        </div>
      </header>

      {(game.loadError || banner) && (
        <div className="vg-alert">
          <span>{game.loadError || banner}</span>
          <button
            type="button"
            aria-label="关闭提示"
            onClick={() => { setBanner(''); game.clearLoadError(); }}
          >×</button>
        </div>
      )}

      <div className="vg-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`vg-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'mistakes' && mistakes.length > 0 && <span className="vg-tab-badge">{mistakes.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'quest' && (
        <div className="vg-layout">
          <div className="vg-main">
            <section className="vg-summary" aria-label="今日学习概览">
              <div className="vg-summary-item">
                <div className="vg-summary-label">今日任务</div>
                <div className="vg-summary-value">
                  {todayPassed}<span className="vg-fraction"> / {game.settings.dailyGoal}</span><small>关</small>
                </div>
              </div>
              <div className="vg-summary-item">
                <div className="vg-summary-label">已掌握</div>
                <div className="vg-summary-value">{game.statusCounts.mastered}<small>词</small></div>
              </div>
              <div className="vg-summary-item">
                <div className="vg-summary-label">平均正确率</div>
                <div className="vg-summary-value">{avgAccuracy}<small>%</small></div>
              </div>
              <div className="vg-summary-item">
                <div className="vg-summary-label">连续打卡</div>
                <div className="vg-summary-value">{profile.streak}<small>天</small></div>
              </div>
            </section>

            <section className="vg-current">
              <div className="vg-current-copy">
                <div className="vg-kicker"><span className="vg-kicker-line" />当前关卡 · 待挑战</div>
                <h3>第 {level} 关</h3>
                <p className="vg-word-range">{rangeText}</p>
                <div className="vg-level-meta">
                  <div className="vg-meta-item">
                    <span className="vg-meta-icon"><BookOpen size={15} /></span>
                    <span>限时记忆<strong>{formatMinutes(game.settings.memoryMin)} 分钟</strong></span>
                  </div>
                  <div className="vg-meta-item">
                    <span className="vg-meta-icon"><Clock size={15} /></span>
                    <span>限时测验<strong>{formatMinutes(game.settings.quizMin)} 分钟</strong></span>
                  </div>
                </div>
                <div className="vg-pass-line">
                  <Target size={14} /> 正确率达到{' '}
                  <strong>{Math.round(game.settings.passAccuracy * 100)}%</strong> 即可通过并解锁下一关
                </div>
              </div>
              <div className="vg-level-action">
                <div className="vg-group-count">
                  <strong>{preview.length || size}</strong>
                  <span>组单词待挑战</span>
                </div>
                <button className="vg-continue" type="button" onClick={openSettings}>
                  继续第 {level} 关 <ArrowRight size={17} />
                </button>
              </div>
            </section>

            <div className="vg-lower">
              <section className="vg-panel">
                <div className="vg-panel-head">
                  <h4>最近关卡</h4>
                  <button className="vg-text-btn" type="button" onClick={() => setLevelsOpen(true)}>全部关卡</button>
                </div>
                {game.runs.length === 0 ? (
                  <p className="vg-empty">还没有闯关记录，从第 {level} 关开始吧。</p>
                ) : (
                  <div className="vg-level-list">
                    {game.runs.slice(0, 3).map((run) => (
                      <div className="vg-level-row" key={run.id}>
                        <span className={`vg-level-node ${run.passed ? 'done' : 'failed'}`}>
                          {run.passed ? <Check size={14} /> : '!'}
                        </span>
                        <div className="vg-level-row-copy">
                          <strong>第 {run.level} 关{run.replay ? ' · 复习' : ''}</strong>
                          <span>{run.wordsTotal} 词 · 用时 {Math.max(1, Math.round(run.durationMs / 60000))} 分钟</span>
                        </div>
                        <span className={`vg-level-state${run.passed ? '' : ' failed'}`}>
                          {run.passed ? `已通过 · ${Math.round(run.accuracy * 100)}%` : `未通过 · ${Math.round(run.accuracy * 100)}%`}
                        </span>
                        {run.passed && (
                          <button
                            className="vg-text-btn vg-level-replay"
                            type="button"
                            onClick={() => void startReplay(run.level)}
                          >
                            <RotateCw size={13} /> 重闯
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="vg-panel">
                <div className="vg-panel-head">
                  <h4>本周学习</h4>
                  <span className="vg-panel-total"><strong>{weekTotal}</strong> 分钟</span>
                </div>
                <WeeklyChart data={game.weekly} />
              </section>
            </div>
          </div>

          <aside className="vg-aside" aria-label="学习状态">
            <div className="vg-aside-head">
              <h3>学习状态</h3>
              <span className="vg-today-badge">今日</span>
            </div>

            <section className="vg-progress-block">
              <div className="vg-ring" aria-label={`词书进度 ${percent}%`}>
                <svg viewBox="0 0 120 120" aria-hidden="true">
                  <circle className="vg-ring-bg" cx="60" cy="60" r="52" />
                  <circle
                    className="vg-ring-value"
                    cx="60" cy="60" r="52"
                    strokeDasharray={ringLength}
                    strokeDashoffset={ringLength * (1 - percent / 100)}
                  />
                </svg>
                <div className="vg-ring-copy">
                  <strong>{percent}%</strong>
                  <span>词书进度</span>
                </div>
              </div>
              <h4>考研英语核心词汇</h4>
              <p>{wordCount} 词 · {totalLevels} 关</p>
            </section>

            <section className="vg-status-block">
              <h4 className="vg-section-label">单词掌握分布</h4>
              {(['new', 'seen', 'familiar', 'mastered'] as WordStatus[]).map((key) => (
                <div className="vg-status-row" key={key}>
                  <span className="vg-status-name">
                    <i className={`vg-dot ${key}`} />{STATUS_LABEL[key]}
                  </span>
                  <strong>{game.statusCounts[key]}<small>词</small></strong>
                </div>
              ))}
            </section>

            <section className="vg-review-block">
              <div className="vg-review-top">
                <div className="vg-review-label"><RotateCw size={15} /> 今日待复习</div>
                <div className="vg-review-count">{game.dueCount}<small>词</small></div>
              </div>
              <p>根据遗忘曲线生成，完成复习可巩固长期记忆。</p>
              <button className="vg-primary-btn" type="button" onClick={() => setSection('exam-vocab')}>
                去复习 <ArrowRight size={16} />
              </button>
            </section>

            <div className="vg-exam-card">
              <span className="vg-exam-icon"><CalendarDays size={19} /></span>
              <div>
                <span>距离考研</span>
                <strong>还有 <b>{examDays >= 0 ? examDays : 0}</b> 天，保持你的节奏</strong>
              </div>
            </div>
          </aside>
        </div>
      )}

      {tab === 'wordbook' && (
        <section className="vg-page-section">
          <div className="vg-page-heading">
            <div>
              <h3>单词本</h3>
              <p>
                {wbQuery.trim()
                  ? `搜索「${wbQuery.trim()}」，共 ${wbList.length} 条结果`
                  : `第 ${level} 关共 ${preview.length} 个核心词，随时回看掌握状态。`}
              </p>
            </div>
            {!wbQuery.trim() && (
              <button className="vg-primary-btn" type="button" onClick={openSettings}>学习本关单词</button>
            )}
          </div>

          <label className="vg-search">
            <Search size={16} />
            <input
              value={wbQuery}
              onChange={(e) => setWbQuery(e.target.value)}
              placeholder="搜索单词或中文释义"
              aria-label="搜索单词或中文释义"
            />
          </label>

          <div className="vg-filter-tabs" role="group" aria-label="按掌握状态筛选">
            {FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`vg-filter-tab${wbFilter === f.id ? ' active' : ''}`}
                aria-pressed={wbFilter === f.id}
                onClick={() => setWbFilter(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>

          <div className="vg-word-list">
            {wbList.length === 0 ? (
              <p className="vg-empty">没有符合当前条件的单词，请调整搜索或筛选。</p>
            ) : wbList.map((w) => (
              <button
                className="vg-word-row"
                key={w.wordId}
                type="button"
                onClick={() => { setDetail(w); setDetailNote(''); }}
              >
                <span className="vg-word-name">
                  <strong>{w.word}</strong>
                  <span>{fmtPhonetics(w.phoneticUk, w.phoneticUs)} · {w.unit}</span>
                </span>
                <span className="vg-word-def">{w.meaning}</span>
                <StatusTag status={wordStatusOf(w)} />
                <span className="vg-row-action"><ChevronRight size={16} /></span>
              </button>
            ))}
          </div>
        </section>
      )}

      {tab === 'stats' && (
        <section className="vg-page-section">
          <div className="vg-page-heading">
            <div>
              <h3>学习统计</h3>
              <p>用稳定的节奏积累，每一次测验都有记录。</p>
            </div>
            <span className="vg-chip">本周学习 {weekTotal} 分钟</span>
          </div>

          <div className="vg-stat-grid">
            <div className="vg-stat-card"><span>平均正确率</span><strong>{avgAccuracy}<small>%</small></strong></div>
            <div className="vg-stat-card"><span>累计通关</span><strong>{game.progress?.passedLevels ?? 0}<small>关</small></strong></div>
            <div className="vg-stat-card"><span>已掌握单词</span><strong>{game.statusCounts.mastered}<small>词</small></strong></div>
          </div>

          <div className="vg-stats-grid">
            <section className="vg-panel">
              <div className="vg-panel-head">
                <h4>本周学习时长</h4>
                <span className="vg-panel-total">单位：分钟</span>
              </div>
              <WeeklyChart data={game.weekly} tall />
            </section>

            <section className="vg-panel">
              <div className="vg-panel-head">
                <h4>最近成绩</h4>
                <span className="vg-panel-total">最近 {Math.min(5, game.runs.length)} 次</span>
              </div>
              {game.runs.length === 0 ? (
                <p className="vg-empty">还没有成绩记录。</p>
              ) : (
                <div className="vg-score-list">
                  {game.runs.slice(0, 5).map((run) => (
                    <div className="vg-score-row" key={run.id}>
                      <div>
                        <strong>第 {run.level} 关</strong>
                        <span>{fmtRunDate(run.finishedAt)} · {run.wordsTotal} 词{run.replay ? ' · 复习' : ''}</span>
                      </div>
                      <span className={run.passed ? 'vg-score-pass' : 'vg-score-fail'}>
                        {run.passed ? '通过' : '未通过'}
                      </span>
                      <em className="vg-score-value">{Math.round(run.accuracy * 100)}</em>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>
        </section>
      )}

      {tab === 'mistakes' && (
        <section className="vg-page-section">
          <div className="vg-page-heading">
            <div>
              <h3>错词复习</h3>
              <p>先回忆，再查看释义；标记「已掌握」后移出错词本。</p>
            </div>
            {!reviewQueue && (
              <button className="vg-secondary-btn" type="button" onClick={() => startMistakeReview(true)}>
                复习全部错词
              </button>
            )}
          </div>

          {!reviewQueue && (
            <>
              <div className="vg-mistake-toolbar">
                <label className="vg-check-label">
                  <input
                    type="checkbox"
                    checked={mistakes.length > 0 && selectedMistakes.size === mistakes.length}
                    onChange={() => {
                      setSelectedMistakes(
                        selectedMistakes.size === mistakes.length ? new Set() : new Set(mistakes.map((m) => m.wordId))
                      );
                    }}
                  />
                  选择当前全部错词
                </label>
                <button
                  className="vg-primary-btn"
                  type="button"
                  disabled={selectedMistakes.size === 0}
                  onClick={() => startMistakeReview(false)}
                >
                  复习所选 {selectedMistakes.size} 词
                </button>
              </div>

              <div className="vg-mistake-list">
                {mistakes.length === 0 ? (
                  <p className="vg-empty">当前没有错词。测验答错的单词会自动出现在这里。</p>
                ) : mistakes.map((m) => (
                  <div className="vg-mistake-row" key={m.wordId}>
                    <label className="vg-check-label">
                      <input
                        type="checkbox"
                        checked={selectedMistakes.has(m.wordId)}
                        onChange={() => toggleMistake(m.wordId)}
                      />
                      <span className="vg-sr-only">选择 {m.word}</span>
                    </label>
                    <div className="vg-mistake-word">
                      <strong>{m.word}</strong>
                      <span>
                        {fmtPhonetics(getPhonetics(m.word ?? '').uk, getPhonetics(m.word ?? '').us)}
                        {' · '}{m.unit ?? ''}
                      </span>
                    </div>
                    <span className="vg-mistake-meaning">{m.meaning}</span>
                    <button
                      className="vg-text-btn"
                      type="button"
                      onClick={() => speak(m.word ?? '')}
                    >
                      <Volume2 size={15} /> 发音
                    </button>
                  </div>
                ))}
              </div>
              <p className="vg-inline-status">{reviewNote}</p>
            </>
          )}

          {reviewQueue && currentReviewWord && (
            <div className="vg-review-session">
              <div className="vg-review-progress">复习进度 {reviewIndex + 1} / {reviewQueue.length}</div>
              <article className="vg-review-card">
                <PronChips
                  word={currentReviewWord.word ?? ''}
                  uk={getPhonetics(currentReviewWord.word ?? '').uk}
                  us={getPhonetics(currentReviewWord.word ?? '').us}
                />
                <h2>{currentReviewWord.word}</h2>
                {reviewRevealed ? (
                  <div className="vg-review-answer">
                    <p>{currentReviewWord.meaning}</p>
                    <span>{currentReviewWord.unit}</span>
                  </div>
                ) : (
                  <button className="vg-secondary-btn" type="button" onClick={() => setReviewRevealed(true)}>
                    查看释义
                  </button>
                )}
              </article>
              {reviewRevealed && (
                <div className="vg-review-controls">
                  <button className="vg-fuzzy-btn" type="button" onClick={() => advanceReview(false)}>仍模糊</button>
                  <button className="vg-known-btn" type="button" onClick={() => advanceReview(true)}>已掌握</button>
                </div>
              )}
              <button
                className="vg-text-btn vg-review-exit"
                type="button"
                onClick={() => { setReviewQueue(null); setReviewRevealed(false); }}
              >
                返回错词列表
              </button>
            </div>
          )}
        </section>
      )}

      {game.session && <VocabGameSession />}

      {/* 关卡设置 */}
      {settingsOpen && (
        <div className="vg-overlay" onClick={() => setSettingsOpen(false)}>
          <section className="vg-modal" role="dialog" aria-modal="true" aria-labelledby="vgSettingsTitle" onClick={(e) => e.stopPropagation()}>
            <div className="vg-modal-head">
              <div>
                <div className="vg-modal-kicker">第 {draftLevel} 关 · 关卡设置</div>
                <h2 id="vgSettingsTitle">准备开始第 {draftLevel} 关</h2>
              </div>
              <button className="vg-icon-btn" type="button" aria-label="关闭关卡设置" onClick={() => setSettingsOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <p className="vg-modal-range">
              {sizeChanged ? `按词库顺序继续，本关取 ${draft.levelSize} 个词` : rangeText}
              {' · '}正确率 {Math.round(draft.passAccuracy * 100)}% 通过
            </p>

            <div className="vg-setting-group">
              <div className="vg-setting-label">本关词数 <span>每组 1 个核心词</span></div>
              <div className="vg-segment" role="group" aria-label="选择本关词数">
                {([10, 15, 20] as const).map((n) => (
                  <button
                    key={n}
                    type="button"
                    className={draft.levelSize === n ? 'selected' : ''}
                    aria-pressed={draft.levelSize === n}
                    onClick={() => setDraft({ ...draft, levelSize: n })}
                  >
                    {n} 组
                  </button>
                ))}
              </div>
            </div>

            <div className="vg-setting-group">
              <div className="vg-setting-label">通过标准 <span>全部关卡统一生效</span></div>
              <div className="vg-segment four" role="group" aria-label="选择通关正确率">
                {PASS_OPTIONS.map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={draft.passAccuracy === p ? 'selected' : ''}
                    aria-pressed={draft.passAccuracy === p}
                    onClick={() => setDraft({ ...draft, passAccuracy: p })}
                  >
                    {Math.round(p * 100)}%
                  </button>
                ))}
              </div>
            </div>

            <div className="vg-setting-group">
              <div className="vg-setting-label">阶段时间 <span>可按专注节奏调整</span></div>
              <div className="vg-time-settings">
                <div className="vg-time-setting">
                  <div className="vg-time-label"><BookOpen size={15} /> 限时记忆</div>
                  <div className="vg-stepper">
                    <button
                      className="vg-step-btn"
                      type="button"
                      aria-label="减少记忆时间 5 分钟"
                      disabled={draft.memoryMin <= 5}
                      onClick={() => setDraft({ ...draft, memoryMin: Math.round((draft.memoryMin - 5) * 100) / 100 })}
                    >−</button>
                    <div className="vg-step-value">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={draft.memoryMin}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setDraft({ ...draft, memoryMin: Number(e.target.value) })}
                        onBlur={() => setDraft((d) => {
                          const n = Number(d.memoryMin);
                          return { ...d, memoryMin: n > 0 ? Math.round(n * 100) / 100 : 1 };
                        })}
                        aria-label="限时记忆分钟数"
                      />
                      <small>分钟</small>
                    </div>
                    <button
                      className="vg-step-btn"
                      type="button"
                      aria-label="增加记忆时间 5 分钟"
                      onClick={() => setDraft({ ...draft, memoryMin: Math.round(((draft.memoryMin || 0) + 5) * 100) / 100 })}
                    >+</button>
                  </div>
                </div>
                <div className="vg-time-setting">
                  <div className="vg-time-label"><Clock size={15} /> 限时测验</div>
                  <div className="vg-stepper">
                    <button
                      className="vg-step-btn"
                      type="button"
                      aria-label="减少测验时间 5 分钟"
                      disabled={draft.quizMin <= 5}
                      onClick={() => setDraft({ ...draft, quizMin: Math.round((draft.quizMin - 5) * 100) / 100 })}
                    >−</button>
                    <div className="vg-step-value">
                      <input
                        type="number"
                        step="any"
                        inputMode="decimal"
                        value={draft.quizMin}
                        onFocus={(e) => e.currentTarget.select()}
                        onChange={(e) => setDraft({ ...draft, quizMin: Number(e.target.value) })}
                        onBlur={() => setDraft((d) => {
                          const n = Number(d.quizMin);
                          return { ...d, quizMin: n > 0 ? Math.round(n * 100) / 100 : 1 };
                        })}
                        aria-label="限时测验分钟数"
                      />
                      <small>分钟</small>
                    </div>
                    <button
                      className="vg-step-btn"
                      type="button"
                      aria-label="增加测验时间 5 分钟"
                      onClick={() => setDraft({ ...draft, quizMin: Math.round(((draft.quizMin || 0) + 5) * 100) / 100 })}
                    >+</button>
                  </div>
                </div>
              </div>
            </div>

            <div className="vg-setting-summary">
              共 {draft.levelSize} 组，
              预计 {formatMinutes(draft.memoryMin + draft.quizMin)} 分钟完成
            </div>

            <button
              className="vg-primary-btn vg-modal-start"
              type="button"
              disabled={starting || draft.memoryMin <= 0 || draft.quizMin <= 0}
              onClick={() => void startGame()}
            >
              {starting ? '装载关卡…' : '开始学习'} <ArrowRight size={17} />
            </button>
            <p className="vg-keyboard-note">记忆阶段按 1/2 标记，测验阶段按 1-4 选择，Esc 退出</p>
          </section>
        </div>
      )}

      {/* 关卡地图 */}
      {levelsOpen && (
        <div className="vg-overlay" onClick={() => setLevelsOpen(false)}>
          <section className="vg-modal" role="dialog" aria-modal="true" aria-labelledby="vgLevelsTitle" onClick={(e) => e.stopPropagation()}>
            <div className="vg-modal-head">
              <div>
                <div className="vg-modal-kicker">共 {totalLevels} 关</div>
                <h2 id="vgLevelsTitle">关卡地图</h2>
              </div>
              <button className="vg-icon-btn" type="button" aria-label="关闭关卡地图" onClick={() => setLevelsOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <div className="vg-level-map" ref={levelMapRef}>
              {levelRows.map((l) => {
                const state = l === level ? 'current' : l < level ? 'done' : 'locked';
                // 已通过关卡只取「通过」的记录，避免最近一次复习失手把成绩显示成未通过
                const run = state === 'done'
                  ? game.runs.find((r) => r.level === l && r.passed)
                  : game.runs.find((r) => r.level === l);
                return (
                  <div className={`vg-level-map-row ${state}`} key={l}>
                    <strong>第 {l} 关</strong>
                    <span>
                      {state === 'current'
                        ? '当前关卡'
                        : state === 'done'
                          ? (run ? `已通过 · ${Math.round(run.accuracy * 100)}%` : '已通过')
                          : `通过第 ${l - 1} 关后解锁`}
                    </span>
                    {state === 'done' && (
                      <button
                        className="vg-text-btn vg-level-replay"
                        type="button"
                        onClick={() => void startReplay(l)}
                      >
                        <RotateCw size={13} /> 重闯
                      </button>
                    )}
                    {state === 'locked' && <Lock size={14} />}
                  </div>
                );
              })}
            </div>
            <p className="vg-keyboard-note">已通过的关卡可重闯，成绩计入复习记录但不改变关卡进度</p>
            <button className="vg-primary-btn vg-modal-start" type="button" onClick={() => { setLevelsOpen(false); openSettings(); }}>
              继续当前关卡 <ArrowRight size={17} />
            </button>
          </section>
        </div>
      )}

      {/* 全局搜索 */}
      {searchOpen && (
        <div className="vg-overlay" onClick={() => setSearchOpen(false)}>
          <section className="vg-modal" role="dialog" aria-modal="true" aria-labelledby="vgSearchTitle" onClick={(e) => e.stopPropagation()}>
            <div className="vg-modal-head">
              <div>
                <div className="vg-modal-kicker">考研英语核心词汇</div>
                <h2 id="vgSearchTitle">搜索单词</h2>
              </div>
              <button className="vg-icon-btn" type="button" aria-label="关闭搜索" onClick={() => setSearchOpen(false)}>
                <X size={17} />
              </button>
            </div>
            <label className="vg-search vg-search-modal">
              <Search size={16} />
              <input
                autoFocus
                value={globalQuery}
                onChange={(e) => setGlobalQuery(e.target.value)}
                placeholder="输入英文单词或中文释义"
                aria-label="输入英文单词或中文释义"
              />
            </label>
            <div className="vg-search-results">
              {globalList.length === 0 ? (
                <p className="vg-empty">未找到相关单词，请尝试其他关键词。</p>
              ) : globalList.map((w) => (
                <button
                  className="vg-search-result"
                  key={w.wordId}
                  type="button"
                  onClick={() => { setSearchOpen(false); setDetail(w); setDetailNote(''); }}
                >
                  <span>
                    <strong>{w.word}</strong>
                    <span>{fmtPhonetics(w.phoneticUk, w.phoneticUs)} · {w.unit}</span>
                  </span>
                  <span className="vg-result-meaning">{w.meaning}</span>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* 单词详情 */}
      {detail && (
        <div className="vg-overlay" onClick={() => setDetail(null)}>
          <section className="vg-modal" role="dialog" aria-modal="true" aria-labelledby="vgDetailTitle" onClick={(e) => e.stopPropagation()}>
            <div className="vg-modal-head">
              <div>
                <div className="vg-modal-kicker">单词详情</div>
                <h2 id="vgDetailTitle">词义与掌握状态</h2>
              </div>
              <button className="vg-icon-btn" type="button" aria-label="关闭单词详情" onClick={() => setDetail(null)}>
                <X size={17} />
              </button>
            </div>
            <div className="vg-detail-word">
              <h3>{detail.word}</h3>
              <PronChips word={detail.word} uk={detail.phoneticUk} us={detail.phoneticUs} />
              <div className="vg-word-pos">{detail.unit}{detail.coreZone ? ' · 核心词' : ''}</div>
              <p>{detail.meaning}</p>
              <StatusTag status={wordStatusOf(detail)} />
            </div>
            <div className="vg-detail-actions">
              <button className="vg-secondary-btn" type="button" onClick={() => speak(detail.word)}>
                <Volume2 size={16} /> 播放发音
              </button>
              <button className="vg-primary-btn" type="button" onClick={() => void addDetailToHardword()}>
                加入错词复习
              </button>
            </div>
            {detailNote && <p className="vg-inline-status">{detailNote}</p>}
          </section>
        </div>
      )}
    </div>
  );
}

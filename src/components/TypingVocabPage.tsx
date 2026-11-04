/**
 * 打字背单词——主页面（独立模块）。
 *
 * 与「背单词」模块完全独立：自己的词库、记忆曲线、生词本、统计与设置，
 * 数据表为 `typing_vocab_*`，不读写 `exam_vocab_*` 与任务数据。
 *
 * 六个标签：练习 / 生词本 / 收藏 / 已掌握 / 统计 / 设置。
 * 练习页内置四种模式（跟打、听写、自测、默写）与智能/自由两种出题方式。
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle, BookOpen, Check, ChevronRight, Eye, Keyboard, PenLine, Play,
  RefreshCw, Settings, Star, Target, Volume2,
} from 'lucide-react';
import { useTypingVocabStore } from '../stores/typing-vocab-store';
import type {
  TypingMode, TypingPlan, TypingProfile, TypingQueueItem, TypingWordSeed,
} from '../lib/typing-vocab-db';
import { speakTypingWord, warmupTypingSpeech } from '../lib/typing-vocab-speech';
import { TypingVocabSession, type TypingSessionResult } from './TypingVocabSession';
import { TypingVocabWordList } from './TypingVocabWordList';
import { TypingVocabStatsPanel } from './TypingVocabStatsPanel';
import { TypingVocabSettingsPanel } from './TypingVocabSettingsPanel';

type Tab = 'practice' | 'wrong' | 'favorite' | 'mastered' | 'stats' | 'settings';

const TABS: { id: Tab; label: string }[] = [
  { id: 'practice', label: '练习' },
  { id: 'wrong', label: '生词本' },
  { id: 'favorite', label: '收藏' },
  { id: 'mastered', label: '已掌握' },
  { id: 'stats', label: '统计' },
  { id: 'settings', label: '设置' },
];

const MODE_CARDS: { id: TypingMode; label: string; desc: string; icon: React.ReactNode }[] = [
  { id: 'follow', label: '跟打', desc: '看着单词逐字母输入，练键位与拼写', icon: <Keyboard size={18} /> },
  { id: 'dictation', label: '听写', desc: '听发音拼出单词，可重播三次', icon: <Volume2 size={18} /> },
  { id: 'selftest', label: '自测', desc: '看中文释义想英文，回车提交', icon: <Eye size={18} /> },
  { id: 'recall', label: '默写', desc: '只给释义与音标，盲写整词', icon: <PenLine size={18} /> },
];

interface ActiveSession {
  key: number;
  queue: TypingQueueItem[];
  mode: TypingMode;
  plan: TypingPlan;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

export function TypingVocabPage() {
  const loaded = useTypingVocabStore((s) => s.loaded);
  const loading = useTypingVocabStore((s) => s.loading);
  const lastError = useTypingVocabStore((s) => s.lastError);
  const clearError = useTypingVocabStore((s) => s.clearError);
  const books = useTypingVocabStore((s) => s.books);
  const profile = useTypingVocabStore((s) => s.profile);
  const overview = useTypingVocabStore((s) => s.overview);
  const dueCount = useTypingVocabStore((s) => s.dueCount);
  const units = useTypingVocabStore((s) => s.units);
  const wrongWords = useTypingVocabStore((s) => s.wrongWords);
  const favoriteWords = useTypingVocabStore((s) => s.favoriteWords);
  const masteredWords = useTypingVocabStore((s) => s.masteredWords);
  const daily = useTypingVocabStore((s) => s.daily);
  const modeStats = useTypingVocabStore((s) => s.modeStats);
  const recentSessions = useTypingVocabStore((s) => s.recentSessions);

  const loadFromDb = useTypingVocabStore((s) => s.loadFromDb);
  const saveProfile = useTypingVocabStore((s) => s.saveProfile);
  const buildSessionQueue = useTypingVocabStore((s) => s.buildSessionQueue);
  const rateWord = useTypingVocabStore((s) => s.rateWord);
  const toggleFavorite = useTypingVocabStore((s) => s.toggleFavorite);
  const setMastered = useTypingVocabStore((s) => s.setMastered);
  const resetWord = useTypingVocabStore((s) => s.resetWord);
  const saveSession = useTypingVocabStore((s) => s.saveSession);
  const importCustomBook = useTypingVocabStore((s) => s.importCustomBook);
  const removeBook = useTypingVocabStore((s) => s.removeBook);
  const exportBackup = useTypingVocabStore((s) => s.exportBackup);
  const restoreBackup = useTypingVocabStore((s) => s.restoreBackup);
  const refreshLists = useTypingVocabStore((s) => s.refreshLists);
  const refreshStats = useTypingVocabStore((s) => s.refreshStats);

  const [tab, setTab] = useState<Tab>('practice');
  const [session, setSession] = useState<ActiveSession | null>(null);
  const [result, setResult] = useState<TypingSessionResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  useEffect(() => {
    void loadFromDb();
    warmupTypingSpeech();
  }, [loadFromDb]);

  const activeBook = useMemo(
    () => books.find((b) => b.id === profile.activeBookId) ?? books[0],
    [books, profile.activeBookId],
  );

  const masteredPercent = overview && overview.totalWords > 0
    ? Math.round((overview.masteredWords / overview.totalWords) * 100)
    : 0;

  const startSession = useCallback(async (kind: 'today' | 'wrong' | 'favorite' | 'unit', unit?: string) => {
    setNotice('');
    setBusy(true);
    try {
      const queue = await buildSessionQueue(kind, unit);
      if (queue.length === 0) {
        setNotice(
          kind === 'today'
            ? '今天没有待练习的单词：智能模式下新词已学完且暂无到期复习，可切换「自由」模式继续，或在设置里调高每日新词上限。'
            : '这个列表里暂时没有可练习的单词。',
        );
        return;
      }
      setResult(null);
      setSession({ key: Date.now(), queue, mode: profile.mode, plan: profile.plan });
    } catch (err) {
      setNotice(`装载练习失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  }, [buildSessionQueue, profile.mode, profile.plan]);

  const handleFinished = useCallback(async (finished: TypingSessionResult) => {
    const active = session;
    setSession(null);
    setResult(finished);
    if (!active) return;
    try {
      await saveSession({
        mode: active.mode,
        plan: active.plan,
        total: finished.total,
        correct: finished.correct,
        wrong: finished.wrong,
        newCount: finished.newCount,
        reviewCount: finished.reviewCount,
        keystrokes: finished.keystrokes,
        correctKeystrokes: finished.correctKeystrokes,
        durationMs: finished.durationMs,
        wpm: finished.wpm,
        accuracy: finished.accuracy,
        startedAt: finished.startedAt,
      });
    } catch (err) {
      setNotice(`练习记录保存失败：${err instanceof Error ? err.message : String(err)}`);
    }
  }, [saveSession, session]);

  if (!loaded || loading) {
    return (
      <div className="typing-page">
        <p className="placeholder-text">加载中…</p>
      </div>
    );
  }

  // 会话进行中：整页只渲染练习区，避免误触其它标签
  if (session) {
    return (
      <div className="typing-page typing-page-session">
        <TypingVocabSession
          key={session.key}
          queue={session.queue}
          mode={session.mode}
          plan={session.plan}
          profile={profile}
          onRate={rateWord}
          onFinished={(r) => void handleFinished(r)}
          onExit={() => setSession(null)}
        />
      </div>
    );
  }

  return (
    <div className="typing-page">
      {lastError && (
        <div className="typing-error">
          <span>{lastError}</span>
          <button className="typing-error-close" onClick={clearError}>×</button>
        </div>
      )}
      {notice && (
        <div className="typing-notice">
          <span>{notice}</span>
          <button className="typing-error-close" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      <header className="typing-header">
        <div>
          <h2><Keyboard size={18} /> 打字背单词</h2>
          <p>
            {activeBook ? `${activeBook.name} · ${activeBook.wordCount} 词` : '尚未导入词库'}
            {overview && <> · 已掌握 {overview.masteredWords} 词（{masteredPercent}%）</>}
          </p>
        </div>
        <div className="typing-head-ops">
          {books.length > 0 && (
            <select
              className="typing-book-select"
              value={profile.activeBookId}
              onChange={(e) => void saveProfile({ activeBookId: Number(e.target.value) })}
              title="切换词库"
            >
              {books.map((book) => (
                <option key={book.id} value={book.id}>{book.name}</option>
              ))}
            </select>
          )}
          <button className="typing-ghost-btn" onClick={() => setTab('settings')}>
            <Settings size={14} /> 设置
          </button>
        </div>
      </header>

      <div className="typing-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={`typing-tab${tab === t.id ? ' active' : ''}`}
            onClick={() => {
              setTab(t.id);
              if (t.id === 'wrong' || t.id === 'favorite' || t.id === 'mastered') void refreshLists();
              if (t.id === 'stats') void refreshStats();
            }}
          >
            {t.label}
            {t.id === 'wrong' && wrongWords.length > 0 && <span className="typing-tab-badge">{wrongWords.length}</span>}
            {t.id === 'favorite' && favoriteWords.length > 0 && <span className="typing-tab-badge">{favoriteWords.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'practice' && (
        result ? (
          <ResultPanel
            result={result}
            onAgain={() => { setResult(null); void startSession('today'); }}
            onWrong={() => { setResult(null); setTab('wrong'); void refreshLists(); }}
            onBack={() => setResult(null)}
          />
        ) : (
          <PracticeReady
            overview={overview}
            dueCount={dueCount}
            profile={profile}
            units={units}
            wrongCount={wrongWords.length}
            favoriteCount={favoriteWords.length}
            busy={busy}
            onSaveProfile={saveProfile}
            onStart={(kind, unit) => void startSession(kind, unit)}
            onSpeak={() => speakTypingWord('example')}
          />
        )
      )}

      {tab === 'wrong' && (
        <TypingVocabWordList
          kind="wrong"
          title="生词本"
          subtitle="打错过的单词自动进入这里，答对后按记忆曲线安排复习"
          emptyText="还没有错词，去练一组吧"
          items={wrongWords}
          onDrill={() => void startSession('wrong')}
          onToggleFavorite={(item) => void toggleFavorite(item)}
          onSetMastered={(item, v) => void setMastered(item, v)}
          onReset={(item) => void resetWord(item)}
        />
      )}

      {tab === 'favorite' && (
        <TypingVocabWordList
          kind="favorite"
          title="收藏"
          subtitle="练习中收藏的重点词，可随时专项巩固"
          emptyText="还没有收藏单词，在列表或练习中点星标即可收藏"
          items={favoriteWords}
          onDrill={() => void startSession('favorite')}
          onToggleFavorite={(item) => void toggleFavorite(item)}
          onSetMastered={(item, v) => void setMastered(item, v)}
          onReset={(item) => void resetWord(item)}
        />
      )}

      {tab === 'mastered' && (
        <TypingVocabWordList
          kind="mastered"
          title="已掌握"
          subtitle="连续多次一次打对后自动标记，智能模式不再出题"
          emptyText="还没有已掌握的单词"
          items={masteredWords}
          onToggleFavorite={(item) => void toggleFavorite(item)}
          onSetMastered={(item, v) => void setMastered(item, v)}
          onReset={(item) => void resetWord(item)}
        />
      )}

      {tab === 'stats' && (
        <TypingVocabStatsPanel
          overview={overview}
          daily={daily}
          modeStats={modeStats}
          units={units}
          recentSessions={recentSessions}
        />
      )}

      {tab === 'settings' && (
        <TypingVocabSettingsPanel
          books={books}
          profile={profile}
          saveProfile={saveProfile}
          onImportBook={(name: string, seeds: TypingWordSeed[]) => importCustomBook(name, seeds)}
          onRemoveBook={removeBook}
          onExport={exportBackup}
          onRestore={restoreBackup}
        />
      )}
    </div>
  );
}

interface ReadyProps {
  overview: ReturnType<typeof useTypingVocabStore.getState>['overview'];
  dueCount: number;
  profile: ReturnType<typeof useTypingVocabStore.getState>['profile'];
  units: ReturnType<typeof useTypingVocabStore.getState>['units'];
  wrongCount: number;
  favoriteCount: number;
  busy: boolean;
  onSaveProfile: (updates: Partial<TypingProfile>) => Promise<void>;
  onStart: (kind: 'today' | 'wrong' | 'favorite' | 'unit', unit?: string) => void;
  onSpeak: () => void;
}

function PracticeReady({
  overview, dueCount, profile, units, wrongCount, favoriteCount, busy, onSaveProfile, onStart, onSpeak,
}: ReadyProps) {
  const total = overview?.totalWords ?? 0;
  const mastered = overview?.masteredWords ?? 0;
  const percent = total > 0 ? Math.round((mastered / total) * 100) : 0;

  return (
    <section className="typing-ready">
      <div className="typing-hero">
        <div className="typing-hero-main">
          <span className="typing-hero-kicker">词汇进度</span>
          <b>{mastered} <em>/ {total}</em></b>
          <div className="typing-hero-bar"><span style={{ width: `${percent}%` }} /></div>
          <p>今日新学 {overview?.todayNew ?? 0} 词 · 复习 {overview?.todayReviewed ?? 0} 词 · 错词 {wrongCount} 个</p>
        </div>
        <div className="typing-hero-stats">
          <div><b>{dueCount}</b><span>待复习</span></div>
          <div><b>{overview?.newWords ?? 0}</b><span>未学</span></div>
          <div><b>{Math.round((overview?.todayAccuracy ?? 0) * 100)}%</b><span>今日正确率</span></div>
          <div><b>{(overview?.todayWpm ?? 0).toFixed(1)}</b><span>今日 WPM</span></div>
        </div>
      </div>

      <div className="typing-mode-grid">
        {MODE_CARDS.map((card) => (
          <button
            key={card.id}
            className={`typing-mode-card${profile.mode === card.id ? ' active' : ''}`}
            onClick={() => void onSaveProfile({ mode: card.id })}
          >
            <span className="typing-mode-icon">{card.icon}</span>
            <b>{card.label}</b>
            <p>{card.desc}</p>
            {profile.mode === card.id && <span className="typing-mode-check"><Check size={12} /></span>}
          </button>
        ))}
      </div>

      <div className="typing-start-row">
        <div className="typing-plan-toggle">
          <button
            className={profile.plan === 'smart' ? 'active' : ''}
            onClick={() => void onSaveProfile({ plan: 'smart' })}
          >
            <Target size={14} /> 智能模式
          </button>
          <button
            className={profile.plan === 'free' ? 'active' : ''}
            onClick={() => void onSaveProfile({ plan: 'free' })}
          >
            <RefreshCw size={14} /> 自由模式
          </button>
        </div>
        <button className="typing-start-btn" onClick={() => onStart('today')} disabled={busy || total === 0}>
          <Play size={16} /> {busy ? '装载中…' : '开始练习'}
          <span>{profile.sessionSize} 词/组</span>
        </button>
        <button className="typing-ghost-btn typing-speak-btn" onClick={onSpeak} title="试听发音">
          <Volume2 size={14} />
        </button>
      </div>
      <p className="typing-hint">
        {profile.plan === 'smart'
          ? `智能模式：先复习 ${Math.min(dueCount, profile.dailyReview)} 个到期词，再学最多 ${Math.min(profile.dailyNew, profile.sessionSize)} 个新词。`
          : `自由模式：按单元顺序取 ${profile.sessionSize} 个未掌握的单词，不限复习时间。`}
      </p>

      <div className="typing-drill-row">
        <button className="typing-drill-card" onClick={() => onStart('wrong')} disabled={wrongCount === 0}>
          <span className="typing-drill-icon danger"><AlertTriangle size={16} /></span>
          <div><b>错词专项</b><p>{wrongCount} 个待攻克</p></div>
          <ChevronRight size={16} />
        </button>
        <button className="typing-drill-card" onClick={() => onStart('favorite')} disabled={favoriteCount === 0}>
          <span className="typing-drill-icon"><Star size={16} /></span>
          <div><b>收藏专项</b><p>{favoriteCount} 个重点词</p></div>
          <ChevronRight size={16} />
        </button>
        <button className="typing-drill-card" onClick={() => onStart('today')} disabled={total === 0}>
          <span className="typing-drill-icon"><BookOpen size={16} /></span>
          <div><b>今日任务</b><p>新词 {Math.min(profile.dailyNew, profile.sessionSize)} 个</p></div>
          <ChevronRight size={16} />
        </button>
      </div>

      {units.length > 0 && (
        <div className="typing-panel typing-unit-picker">
          <h3>按单元练习</h3>
          <div className="typing-unit-picker-grid">
            {units.map((u) => (
              <button key={u.unit} onClick={() => onStart('unit', u.unit)} disabled={u.total === 0}>
                <b>{u.unit}</b>
                <span>{u.mastered}/{u.total}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function ResultPanel({
  result, onAgain, onWrong, onBack,
}: {
  result: TypingSessionResult;
  onAgain: () => void;
  onWrong: () => void;
  onBack: () => void;
}) {
  return (
    <section className="typing-result-panel">
      <div className="typing-result-hero">
        <span className="typing-result-kicker">本组完成</span>
        <b>{Math.round(result.accuracy * 100)}%</b>
        <p>正确率</p>
      </div>
      <div className="typing-result-grid">
        <div><b>{result.total}</b><span>练习词数</span></div>
        <div><b>{result.newCount}</b><span>新学</span></div>
        <div><b>{result.reviewCount}</b><span>复习</span></div>
        <div><b>{result.wpm.toFixed(1)}</b><span>WPM</span></div>
        <div><b>{formatDuration(result.durationMs)}</b><span>用时</span></div>
        <div><b>{result.correct}/{result.total}</b><span>通过</span></div>
      </div>

      {result.wrongWords.length > 0 ? (
        <div className="typing-panel">
          <h3>本组错词</h3>
          <ul className="typing-result-wrong">
            {result.wrongWords.map((w) => (
              <li key={w.id}>
                <b>{w.word}</b>
                <span>{w.meaning}</span>
                <button className="typing-icon-btn" onClick={() => speakTypingWord(w.word)}>
                  <Volume2 size={14} />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="typing-all-clear"><Check size={16} /> 全部通过，继续保持</p>
      )}

      <div className="typing-result-actions">
        <button className="typing-start-btn" onClick={onAgain}><Play size={15} /> 再来一组</button>
        <button className="typing-ghost-btn" onClick={onWrong}>去生词本</button>
        <button className="typing-ghost-btn" onClick={onBack}>返回</button>
      </div>
    </section>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, ChevronLeft, ChevronRight, Loader2, Minus, Pencil, RotateCcw, Sparkles, Swords, Volume2, X,
} from 'lucide-react';
import {
  currentMonitor, getCurrentWindow, LogicalPosition, LogicalSize, primaryMonitor,
} from '@tauri-apps/api/window';
import { emit } from '@tauri-apps/api/event';
import { useVocabGameStore } from '../stores/vocab-game-store';
import type { GameMnemonic, GameWord, WordMark } from '../stores/vocab-game-store';
import { useExamVocabStore } from '../stores/exam-vocab-store';
import { useVocabPlayback, isSpeaking } from '../hooks/use-speak-playback';
import { speak, speakAccent } from '../lib/vocab-tts';
import { splitSyllables } from '../lib/word-syllables';
import { mnemonicRootsLabel } from '../lib/ai-json';
import {
  peekSessionForOrb, stashSessionForMain, takeSessionForOrb, VOCAB_ORB_RETURN_EVENT,
} from '../lib/vocab-orb-bridge';

/** 收起态窗口尺寸（与 Rust 侧 VOCAB_ORB_BALL_SIZE 保持一致） */
const BALL_SIZE = 88;
/** 展开态窗口尺寸：窄卡片，贴在屏幕左/顶部不挡内容 */
const CARD_WIDTH = 360;
const CARD_HEIGHT = 480;
/** 吸附后距离屏幕边缘的留白 */
const EDGE_GAP = 8;

type OrbMode = 'ball' | 'card';
type DockSide = 'left' | 'top';

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function fmtClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 桌面悬浮单词卡片（独立窗口，label = vocab-orb）。
 *
 * 收起时是一颗悬浮球，点击展开为本关的记忆卡；拖动后自动吸附到屏幕左侧或顶部。
 * 与主窗口共用同一份 SQLite 数据，会话通过 localStorage 交接（见 vocab-orb-bridge）。
 */
export function VocabOrbWindow() {
  const session = useVocabGameStore((s) => s.session);
  const gotoMemory = useVocabGameStore((s) => s.gotoMemory);
  const mark = useVocabGameStore((s) => s.mark);
  const retryMnemonic = useVocabGameStore((s) => s.retryMnemonic);
  const pickOption = useVocabGameStore((s) => s.pickOption);
  const nextQuestion = useVocabGameStore((s) => s.nextQuestion);
  const beginQuiz = useVocabGameStore((s) => s.beginQuiz);
  const expirePhase = useVocabGameStore((s) => s.expirePhase);
  const playback = useVocabPlayback();

  // 带有交接会话时直接以卡片形态出现，避免用户再从悬浮球点一次
  const [mode, setMode] = useState<OrbMode>(() => (peekSessionForOrb() ? 'card' : 'ball'));
  const [booting, setBooting] = useState(false);
  const [bootError, setBootError] = useState('');
  const [revealedWordId, setRevealedWordId] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());

  /** 程序化移动窗口的时间戳：过滤自己触发的 moved 事件，避免吸附死循环 */
  const programmaticRef = useRef(0);
  /** 悬浮球的「长按拖动 / 短按展开」判定 */
  const dragTimerRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  const startingRef = useRef(false);
  /** 会话交接只处理一次（StrictMode 下 effect 会重复执行） */
  const handoffRef = useRef(false);

  // —— 主题：与主窗口共用 localStorage 里的设置 ——
  useEffect(() => {
    document.body.classList.add('vg-orb-body');
    try {
      const raw = localStorage.getItem('easysail-exam-storage');
      if (raw) {
        const parsed = JSON.parse(raw) as { state?: { theme?: string; accentColor?: string } };
        const theme = parsed.state?.theme;
        const accent = parsed.state?.accentColor;
        if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
        if (accent) document.documentElement.setAttribute('data-accent', accent);
      }
    } catch {
      // 主题读取失败就用默认浅色
    }
    return () => document.body.classList.remove('vg-orb-body');
  }, []);

  // —— 只接管主窗口交接的会话：纯内存操作，窗口创建时绝不碰数据库 ——
  // 悬浮窗口与主窗口各有独立连接池，若创建即 load 词库/关卡，会和主窗口的
  // 「装载关卡」并发初始化同一个 SQLite 文件，表现为整个应用卡死。
  useEffect(() => {
    if (handoffRef.current) return;
    handoffRef.current = true;
    const incoming = takeSessionForOrb();
    if (incoming) useVocabGameStore.setState({ session: incoming });
  }, []);

  // —— 阶段计时 ——
  const phase = session?.phase;
  useEffect(() => {
    if (!phase || phase === 'result') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [phase]);

  useEffect(() => {
    if (!session || session.phase === 'result') return;
    if (now >= session.phaseEndsAt) expirePhase();
  }, [now, session, expirePhase]);

  const memoryWord = session?.phase === 'memory' ? session.words[session.memoryIndex] : null;
  const question = session?.phase === 'quiz' ? session.quiz[session.quizIndex] : null;
  const pickedId = question?.picked;

  // 测验：判分后短暂停留再自动下一题
  useEffect(() => {
    if (session?.phase !== 'quiz' || pickedId === null || pickedId === undefined) return;
    const timer = window.setTimeout(() => nextQuestion(), 800);
    return () => window.clearTimeout(timer);
  }, [session?.phase, pickedId, nextQuestion]);

  // —— 窗口尺寸与吸附 ——
  /** 按当前停靠边重新定位窗口；next 决定目标尺寸 */
  const applyLayout = useCallback(async (next: OrbMode) => {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    const width = next === 'ball' ? BALL_SIZE : CARD_WIDTH;
    const height = next === 'ball' ? BALL_SIZE : CARD_HEIGHT;

    if (!monitor) {
      await win.setSize(new LogicalSize(width, height));
      return;
    }

    const pos = await win.outerPosition();
    const monX = monitor.position.x / scale;
    const monY = monitor.position.y / scale;
    const monW = monitor.size.width / scale;
    const monH = monitor.size.height / scale;
    const curX = pos.x / scale;
    const curY = pos.y / scale;

    // 离哪条边更近就贴哪条边（首次出现在左侧中部 → 贴左）
    const dock: DockSide = curY - monY <= curX - monX ? 'top' : 'left';

    const x = dock === 'left'
      ? monX + EDGE_GAP
      : clamp(curX, monX + EDGE_GAP, monX + monW - width - EDGE_GAP);
    const y = dock === 'top'
      ? monY + EDGE_GAP
      : clamp(curY, monY + EDGE_GAP, monY + monH - height - EDGE_GAP);

    programmaticRef.current = Date.now();
    await win.setSize(new LogicalSize(width, height));
    await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  }, []);

  /** 拖动结束后吸附到最近的边（左 / 上） */
  const snapToEdge = useCallback(async () => {
    const win = getCurrentWindow();
    const scale = await win.scaleFactor();
    const monitor = (await currentMonitor()) ?? (await primaryMonitor());
    if (!monitor) return;

    const pos = await win.outerPosition();
    const size = await win.outerSize();
    const monX = monitor.position.x / scale;
    const monY = monitor.position.y / scale;
    const monW = monitor.size.width / scale;
    const monH = monitor.size.height / scale;
    const width = size.width / scale;
    const height = size.height / scale;
    const curX = pos.x / scale;
    const curY = pos.y / scale;

    const dock: DockSide = curY - monY <= curX - monX ? 'top' : 'left';

    const x = dock === 'left'
      ? monX + EDGE_GAP
      : clamp(curX, monX + EDGE_GAP, monX + monW - width - EDGE_GAP);
    const y = dock === 'top'
      ? monY + EDGE_GAP
      : clamp(curY, monY + EDGE_GAP, monY + monH - height - EDGE_GAP);

    programmaticRef.current = Date.now();
    await win.setPosition(new LogicalPosition(Math.round(x), Math.round(y)));
  }, []);

  // 拖动停止 320ms 后吸附；程序化定位触发的 moved 直接忽略
  useEffect(() => {
    const win = getCurrentWindow();
    let timer: number | null = null;
    let disposed = false;
    let unlisten: (() => void) | null = null;

    void win.onMoved(() => {
      if (Date.now() - programmaticRef.current < 800) return;
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => { void snapToEdge(); }, 320);
    }).then((fn) => {
      if (disposed) fn();
      else unlisten = fn;
    });

    return () => {
      disposed = true;
      if (timer !== null) window.clearTimeout(timer);
      unlisten?.();
    };
  }, [snapToEdge]);

  /** 展开时才按需加载词库并开一关（窗口创建阶段不触碰数据库） */
  const ensureLevel = useCallback(async () => {
    if (startingRef.current) return;
    startingRef.current = true;
    setBooting(true);
    setBootError('');
    try {
      const store = useVocabGameStore.getState();
      if (!store.loaded) await store.load();
      const latest = useVocabGameStore.getState();
      if (latest.session) return;
      const ok = await latest.startLevel();
      if (!ok) setBootError(useVocabGameStore.getState().loadError || '本关装载失败，请稍后重试。');
    } catch (err) {
      setBootError(err instanceof Error ? err.message : '本关装载失败，请稍后重试。');
    } finally {
      startingRef.current = false;
      setBooting(false);
    }
  }, []);

  const expand = useCallback(() => {
    setMode('card');
    // 有交接的会话就直接展示；没有才去读词库开新关
    if (!useVocabGameStore.getState().session) void ensureLevel();
  }, [ensureLevel]);

  const collapse = useCallback(() => setMode('ball'), []);

  /** 进入测验前加载词库参数：评分依赖 profile（FSRS 保留率等），不能停在默认值 */
  const handleBeginQuiz = useCallback(async () => {
    try {
      await useExamVocabStore.getState().loadFromDb();
    } catch {
      // 参数加载失败仍按默认 profile 评分，不阻塞测验
    }
    beginQuiz();
  }, [beginQuiz]);

  // 形态切换后调整窗口尺寸并保持贴边（不在这里 setState，避免 effect 触发级联渲染）
  useEffect(() => {
    void applyLayout(mode);
  }, [mode, applyLayout]);

  /** 关闭窗口：未完成的会话交还主窗口，避免标记白丢；主窗口据此刷新概览 */
  const closeWindow = useCallback(async () => {
    const current = useVocabGameStore.getState().session;
    if (current && current.phase !== 'result') stashSessionForMain(current);
    try {
      await emit(VOCAB_ORB_RETURN_EVENT);
    } catch {
      // 主窗口不可达时仅关闭，会话留在 localStorage 等待下次打开
    }
    try {
      await getCurrentWindow().close();
    } catch {
      // 窗口已销毁
    }
  }, []);

  /** 结果页「完成」：成绩已写库，清掉会话后关窗并让主窗口刷新概览 */
  const finish = useCallback(async () => {
    useVocabGameStore.getState().exit();
    await closeWindow();
  }, [closeWindow]);

  // —— 悬浮球：短按展开，按住 140ms 后交给系统拖动 ——
  const onBallPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    draggingRef.current = false;
    dragTimerRef.current = window.setTimeout(() => {
      dragTimerRef.current = null;
      draggingRef.current = true;
      void getCurrentWindow().startDragging().catch(() => {});
    }, 140);
  };

  const clearDragTimer = () => {
    if (dragTimerRef.current !== null) {
      window.clearTimeout(dragTimerRef.current);
      dragTimerRef.current = null;
    }
  };

  const onBallClick = () => {
    if (draggingRef.current) {
      draggingRef.current = false;
      return;
    }
    void expand();
  };

  // —— 卡片头部拖动 ——
  const onHeadPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button')) return;
    void getCurrentWindow().startDragging().catch(() => {});
  };

  // —— 键盘：与全屏闯关保持一致 ——
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        if (mode === 'card') void collapse();
        else void closeWindow();
        return;
      }
      if (mode !== 'card' || !session) return;

      if (session.phase === 'memory' && memoryWord) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); gotoMemory(session.memoryIndex - 1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); gotoMemory(session.memoryIndex + 1); return; }
        if (e.key === ' ') { e.preventDefault(); speak(memoryWord.word); return; }
        if (e.key === 'Enter') { e.preventDefault(); setRevealedWordId(memoryWord.wordId); return; }
        if (e.key === '1') { e.preventDefault(); mark(memoryWord.wordId, 'fuzzy'); return; }
        if (e.key === '2') { e.preventDefault(); mark(memoryWord.wordId, 'known'); return; }
        if (e.key === '3') { e.preventDefault(); mark(memoryWord.wordId, 'mastered'); return; }
      }

      if (session.phase === 'quiz' && question) {
        if (question.picked === null && /^[1-4]$/.test(e.key)) {
          const opt = question.options[Number(e.key) - 1];
          if (opt) { e.preventDefault(); pickOption(opt.id); }
          return;
        }
        if (e.key === 'Enter' && question.picked !== null) { e.preventDefault(); nextQuestion(); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, session, memoryWord, question, gotoMemory, mark, pickOption, nextQuestion, collapse, closeWindow]);

  // —— 渲染辅助 ——
  const totalSteps = session
    ? (session.phase === 'quiz' ? session.quiz.length : session.words.length)
    : 0;
  const step = session
    ? (session.phase === 'quiz' ? session.quizIndex + 1 : session.memoryIndex + 1)
    : 0;
  const remaining = session ? Math.max(0, Math.ceil((session.phaseEndsAt - now) / 1000)) : 0;
  const pct = totalSteps > 0 ? Math.min(100, Math.round((step / totalSteps) * 100)) : 0;
  const headSub = session
    ? session.phase === 'memory'
      ? `记忆 ${step}/${totalSteps}`
      : session.phase === 'quiz'
        ? `测验 ${step}/${totalSteps}`
        : '本关结束'
    : '准备中';

  if (mode === 'ball') {
    const ballLabel = session
      ? session.phase === 'quiz'
        ? `测 ${session.quizIndex + 1}/${session.quiz.length}`
        : `${Math.min(session.memoryIndex + 1, session.words.length)}/${session.words.length}`
      : '闯关';
    return (
      <div className="vg-orb-root">
        <div
          className="vg-orb-ball-hit"
          onPointerDown={onBallPointerDown}
          onPointerUp={clearDragTimer}
          onPointerCancel={clearDragTimer}
          onPointerLeave={clearDragTimer}
          onClick={onBallClick}
          role="button"
          tabIndex={0}
          aria-label="展开单词闯关悬浮卡片"
          onKeyDown={(e) => { if (e.key === 'Enter') void expand(); }}
        >
          <div className="vg-orb-ball">
            <Swords size={20} />
            <span className="vg-orb-ball-count">{ballLabel}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="vg-orb-root">
      <div className="vg-orb-card">
        <header className="vg-orb-head" onPointerDown={onHeadPointerDown}>
          <Swords size={13} />
          <span className="vg-orb-title">单词闯关</span>
          <span className="vg-orb-sub">{headSub}</span>
          <button className="vg-orb-icon-btn" type="button" onClick={() => void collapse()} title="收起为悬浮球">
            <Minus size={14} />
          </button>
          <button className="vg-orb-icon-btn danger" type="button" onClick={() => void closeWindow()} title="关闭悬浮卡片">
            <X size={14} />
          </button>
        </header>

        {session && session.phase !== 'result' && (
          <>
            <div className="vg-orb-progress">
              <span>{remaining > 0 ? `剩余 ${fmtClock(remaining)}` : '时间到'}</span>
              <span>{pct}%</span>
            </div>
            <div className="vg-orb-progress-track"><i style={{ width: `${pct}%` }} /></div>
          </>
        )}

        <div className="vg-orb-scroll">
          {!session && (
            <div className="vg-orb-empty">
              {bootError ? (
                <>
                  <p className="vg-orb-error">{bootError}</p>
                  <button className="vg-orb-primary" type="button" onClick={() => void ensureLevel()}>
                    重新装载
                  </button>
                </>
              ) : booting ? (
                <>
                  <Loader2 size={18} className="vg-orb-spin" />
                  <p>正在装载本关…</p>
                </>
              ) : (
                <>
                  <p>还没有正在进行的关卡。</p>
                  <button className="vg-orb-primary" type="button" onClick={() => void ensureLevel()}>
                    开始本关
                  </button>
                </>
              )}
            </div>
          )}

          {session?.phase === 'memory' && memoryWord && (
            <MemoryPane
              word={memoryWord}
              revealed={revealedWordId === memoryWord.wordId}
              onReveal={() => setRevealedWordId(memoryWord.wordId)}
              mnemonic={session.mnemonics[memoryWord.wordId]}
              custom={session.customs?.[memoryWord.wordId] ?? ''}
              onRetryMnemonic={() => void retryMnemonic(memoryWord.wordId)}
              marks={session.marks}
              index={session.memoryIndex}
              total={session.words.length}
              playback={playback}
              onPrev={() => gotoMemory(session.memoryIndex - 1)}
              onNext={() => gotoMemory(session.memoryIndex + 1)}
              onMark={(m) => mark(memoryWord.wordId, m)}
              onBeginQuiz={() => void handleBeginQuiz()}
            />
          )}

          {session?.phase === 'quiz' && question && (
            <div className="vg-orb-quiz">
              <p className="vg-orb-quiz-label">选择正确释义</p>
              <h3 className="vg-orb-quiz-word">{question.word}</h3>
              <div className="vg-orb-options">
                {question.options.map((opt, i) => {
                  const answered = question.picked !== null;
                  let cls = 'vg-orb-option';
                  if (answered && opt.correct) cls += ' correct';
                  else if (answered && opt.id === question.picked) cls += ' wrong';
                  return (
                    <button
                      key={opt.id}
                      className={cls}
                      type="button"
                      disabled={answered}
                      onClick={() => pickOption(opt.id)}
                    >
                      <span className="vg-orb-option-letter">{String.fromCharCode(65 + i)}</span>
                      <span>{opt.text}</span>
                    </button>
                  );
                })}
              </div>
              <button
                className="vg-orb-primary"
                type="button"
                disabled={question.picked === null}
                onClick={nextQuestion}
              >
                {session.quizIndex + 1 >= session.quiz.length ? '查看结果' : '下一题'}
                <ArrowRight size={14} />
              </button>
              <p className="vg-orb-hint">1-4 选择答案 · Enter 下一题</p>
            </div>
          )}

          {session?.phase === 'result' && session.result && (
            <div className="vg-orb-result">
              <strong className="vg-orb-score">{session.result.score}</strong>
              <p className="vg-orb-result-title">
                {session.result.passed ? '本关通过' : '还差一点'}
              </p>
              <p className="vg-orb-hint">
                正确率 {Math.round(session.result.accuracy * 100)}% · 答对 {session.result.correct}/{session.result.total}
              </p>
              <button
                className="vg-orb-primary"
                type="button"
                disabled={session.busy}
                onClick={() => void finish()}
              >
                {session.busy ? '记录中…' : '完成'}
              </button>
              {session.lastError && <p className="vg-orb-error">{session.lastError}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 记忆阶段的紧凑词卡：单词、音标、释义 / AI 助记、标记与切词 */
function MemoryPane({
  word, revealed, onReveal, mnemonic, custom, onRetryMnemonic, marks, index, total,
  playback, onPrev, onNext, onMark, onBeginQuiz,
}: {
  word: GameWord;
  revealed: boolean;
  onReveal: () => void;
  mnemonic: GameMnemonic | undefined;
  /** 用户自定义助记（口诀），悬浮窗内只读展示，录入在主窗口记忆卡上 */
  custom: string;
  onRetryMnemonic: () => void;
  marks: Record<number, WordMark>;
  index: number;
  total: number;
  playback: ReturnType<typeof useVocabPlayback>;
  onPrev: () => void;
  onNext: () => void;
  onMark: (mark: WordMark) => void;
  onBeginQuiz: () => void;
}) {
  const syllables = splitSyllables(word.word);
  const currentMark = marks[word.wordId];
  const mnemonicData = mnemonic?.status === 'ready' ? mnemonic.data : undefined;
  const homophone = mnemonicData?.variants.find((v) => v.method.includes('谐音'));
  const cipher = mnemonicData?.variants.find((v) => v.method.includes('密码'));

  return (
    <>
      <div className="vg-orb-word-row">
        <h3 className="vg-orb-word">{word.word}</h3>
        <button
          className={`vg-orb-icon-btn${isSpeaking(playback, word.word) ? ' is-speaking' : ''}`}
          type="button"
          title="播放发音（空格）"
          disabled={playback.playing}
          onClick={() => speak(word.word)}
        >
          <Volume2 size={15} />
        </button>
      </div>

      {syllables.length > 1 && <p className="vg-orb-syllables">{syllables.join(' · ')}</p>}

      <div className="vg-orb-pron-row">
        <button
          className={`vg-orb-pron${isSpeaking(playback, word.word, 'uk') ? ' is-speaking' : ''}`}
          type="button"
          disabled={playback.playing}
          onClick={() => speakAccent(word.word, 'uk')}
        >
          <span>英</span>{word.phoneticUk ?? '—'}
        </button>
        <button
          className={`vg-orb-pron${isSpeaking(playback, word.word, 'us') ? ' is-speaking' : ''}`}
          type="button"
          disabled={playback.playing}
          onClick={() => speakAccent(word.word, 'us')}
        >
          <span>美</span>{word.phoneticUs ?? '—'}
        </button>
      </div>

      {revealed ? (
        <>
          <p className="vg-orb-meaning">{word.meaning}</p>
          {mnemonic?.status === 'loading' && (
            <p className="vg-orb-hint"><Loader2 size={12} className="vg-orb-spin" /> AI 助记生成中…</p>
          )}
          {mnemonic?.status === 'error' && (
            <button
              className="vg-orb-retry"
              type="button"
              onClick={onRetryMnemonic}
              title={mnemonic.error ?? '点击重试'}
            >
              <RotateCcw size={12} /> AI 助记生成失败，点击重试
            </button>
          )}
          {mnemonicData && (
            <div className="vg-orb-mnemonic">
              <div className="vg-orb-mnemonic-title">
                <Sparkles size={12} /> AI 助记{mnemonicData.method ? ` · ${mnemonicData.method}` : ''}
              </div>
              {mnemonicData.examMeaning && (
                <p><b>常考</b>{mnemonicData.examMeaning}</p>
              )}
              {mnemonicData.roots && <p><b>{mnemonicRootsLabel(mnemonicData.method)}</b>{mnemonicData.roots}</p>}
              {mnemonicData.mnemonic && <p><b>口诀</b>{mnemonicData.mnemonic}</p>}
              {homophone && <p><b>谐音</b>{homophone.mnemonic}</p>}
              {cipher && (
                <p><b>密码</b>{cipher.roots ? `${cipher.roots}：` : ''}{cipher.mnemonic}</p>
              )}
            </div>
          )}
          {custom && (
            <div className="vg-orb-mnemonic">
              <div className="vg-orb-mnemonic-title"><Pencil size={12} /> 我的助记</div>
              <p>{custom}</p>
            </div>
          )}
        </>
      ) : (
        <button className="vg-orb-reveal" type="button" onClick={onReveal}>
          翻开查看释义与助记
          <span className="kbd">Enter</span>
        </button>
      )}

      <div className="vg-orb-marks">
        <button
          className={`vg-orb-mark fuzzy${currentMark === 'fuzzy' ? ' selected' : ''}`}
          type="button"
          onClick={() => onMark('fuzzy')}
        >
          有点模糊
        </button>
        <button
          className={`vg-orb-mark known${currentMark === 'known' ? ' selected' : ''}`}
          type="button"
          onClick={() => onMark('known')}
        >
          已经认识
        </button>
        <button
          className={`vg-orb-mark mastered${currentMark === 'mastered' ? ' selected' : ''}`}
          type="button"
          onClick={() => onMark('mastered')}
        >
          已掌握
        </button>
      </div>

      <div className="vg-orb-nav">
        <button className="vg-orb-nav-btn" type="button" disabled={index <= 0} onClick={onPrev} title="上一个（←）">
          <ChevronLeft size={16} />
        </button>
        <button
          className="vg-orb-nav-btn"
          type="button"
          disabled={index >= total - 1}
          onClick={onNext}
          title="下一个（→）"
        >
          <ChevronRight size={16} />
        </button>
        <button className="vg-orb-primary" type="button" onClick={onBeginQuiz}>
          开始测验 <ArrowRight size={14} />
        </button>
      </div>
      <p className="vg-orb-hint">← → 切词 · 1/2/3 标记 · 空格发音</p>
    </>
  );
}

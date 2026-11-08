import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Loader2, Pencil, RefreshCw, RotateCcw, Sparkles, Volume2,
} from 'lucide-react';
import { useVocabGameStore } from '../stores/vocab-game-store';
import type { GameMnemonic, GameWord } from '../stores/vocab-game-store';
import { mnemonicRootsLabel } from '../lib/ai-json';
import { getMnemonicMethodPrefs } from '../lib/vocab-mnemonic';
import { speak, speakAccent, stopSpeak } from '../lib/vocab-tts';
import { isSpeaking, useVocabPlayback } from '../hooks/use-speak-playback';
import { getExamExample } from '../lib/vocab-examples';
import { splitSyllables } from '../lib/word-syllables';

function fmtClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/**
 * 记忆卡上的 AI 助记块：加载中 / 失败重试 / 主助记 + 谐音口诀 + 密码口诀。
 *
 * 主助记（词根 + 口诀 + 画面）保持原样，新增的谐音、密码两条口诀并列展示，
 * 不做切换；旧缓存没有这两条时自然只显示主助记。
 */
function MnemonicBlock({ entry, onRetry }: { entry?: GameMnemonic; onRetry: () => void }) {
  const playback = useVocabPlayback();
  /** 谐音 / 密码两条附加口诀的开关（设置页可改，切词重挂载时重新读取） */
  const [methodPrefs] = useState(getMnemonicMethodPrefs);

  if (!entry) return null;
  if (entry.status === 'loading') {
    return (
      <div className="vg-mnemonic loading">
        <Loader2 size={13} className="spin" /> AI 正在生成助记…
      </div>
    );
  }
  if (entry.status === 'error' || !entry.data) {
    return (
      <div className="vg-mnemonic-error">
        <button
          className="vg-mnemonic-retry"
          type="button"
          onClick={onRetry}
          title={entry.error ?? '点击重试'}
        >
          <RotateCcw size={13} /> AI 助记生成失败，点击重试
        </button>
        {/* 直接显示原因（超时 / 限流 / 未配置），不用悬停猜 */}
        {entry.error && <p>{entry.error}</p>}
      </div>
    );
  }

  const { method, mnemonic, roots, scene, sentence, sentenceZh, examMeaning } = entry.data;
  // 设置里关掉的方法即使缓存里有也不展示
  const homophone = methodPrefs.homophone
    ? entry.data.variants.find((v) => v.method.includes('谐音'))
    : undefined;
  const cipher = methodPrefs.cipher
    ? entry.data.variants.find((v) => v.method.includes('密码'))
    : undefined;

  return (
    <div className="vg-mnemonic">
      <div className="vg-mnemonic-title">
        <Sparkles size={13} /> AI 助记
        {method && <span className="vg-mnemonic-method">{method}</span>}
        {/* 老记录可能只缓存了主助记，这里可让 AI 补生成谐音与密码 */}
        <button
          className="vg-mnemonic-refresh"
          type="button"
          title="重新生成助记（主助记 + 谐音 + 密码，消耗一次额度）"
          aria-label="重新生成助记"
          onClick={onRetry}
        >
          <RefreshCw size={12} />
        </button>
      </div>
      {examMeaning && (
        <p className="vg-mnemonic-exam"><span className="vg-mnemonic-tag">常考</span>{examMeaning}</p>
      )}
      {roots && <p><span className="vg-mnemonic-tag">{mnemonicRootsLabel(method)}</span>{roots}</p>}
      <p><span className="vg-mnemonic-tag">口诀</span>{mnemonic}</p>
      {scene && <p className="vg-mnemonic-scene"><span className="vg-mnemonic-tag">画面</span>{scene}</p>}
      {homophone && (
        <p><span className="vg-mnemonic-tag">谐音</span>{homophone.mnemonic}</p>
      )}
      {cipher && (
        <p className="vg-mnemonic-cipher">
          <span className="vg-mnemonic-tag">密码</span>
          {cipher.roots && <strong>{cipher.roots}：</strong>}
          {cipher.mnemonic}
        </p>
      )}
      {sentence && (
        <p className="vg-mnemonic-example">
          <span className="vg-mnemonic-tag">例句</span>{sentence}
          <button
            className={`vg-example-speak${isSpeaking(playback, sentence) ? ' is-speaking' : ''}`}
            type="button"
            aria-label="播放 AI 例句"
            aria-busy={isSpeaking(playback, sentence)}
            disabled={playback.playing}
            onClick={() => speak(sentence)}
          >
            <Volume2 size={13} />
          </button>
          {sentenceZh && <em>{sentenceZh}</em>}
        </p>
      )}
    </div>
  );
}

/**
 * 「我的助记」：用户自己录的口诀/联想，与 AI 助记并列展示、互不覆盖。
 *
 * 编辑框是卡片里唯一的文本输入，键盘事件在这里截断（stopPropagation），
 * 否则输入 1/2/3、空格、Enter 会触发卡片上的标记与切词快捷键。
 */
function CustomMnemonicBlock({ value, onSave }: {
  value: string;
  onSave: (text: string) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  /** 每次展开都以已保存内容开头，避免上次取消后的草稿残留 */
  const startEdit = () => {
    setText(value);
    setError('');
    setEditing(true);
    setSaving(false);
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    setError('');
    try {
      await onSave(text);
      setEditing(false);
    } catch {
      setError('保存失败，请检查后重试');
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <div className="vg-my-mnemonic">
        <div className="vg-my-mnemonic-head">
          <span className="vg-my-mnemonic-title"><Pencil size={12} /> 我的助记</span>
          <button className="vg-my-mnemonic-edit" type="button" onClick={startEdit}>
            {value ? '编辑' : '录入口诀'}
          </button>
        </div>
        {value
          ? <p className="vg-my-mnemonic-text">{value}</p>
          : <p className="vg-my-mnemonic-hint">用你自己的谐音、拆词或联想记一遍，比只读 AI 助记更牢。</p>}
      </div>
    );
  }

  return (
    <div className="vg-my-mnemonic editing">
      <div className="vg-my-mnemonic-head">
        <span className="vg-my-mnemonic-title"><Pencil size={12} /> 我的助记</span>
      </div>
      <textarea
        className="vg-my-mnemonic-input"
        value={text}
        autoFocus
        rows={2}
        maxLength={500}
        placeholder="例如：noun 音近「闹」——名词一出场，句子就热闹起来"
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); setEditing(false); return; }
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void save(); }
        }}
      />
      {error && <p className="vg-my-mnemonic-error">{error}</p>}
      <div className="vg-my-mnemonic-actions">
        <span className="vg-my-mnemonic-tip">Ctrl/⌘+Enter 保存 · Esc 取消</span>
        <button className="vg-mini-btn ghost" type="button" onClick={() => setEditing(false)}>取消</button>
        <button className="vg-mini-btn" type="button" disabled={saving} onClick={() => void save()}>
          {saving ? '保存中…' : '保存'}
        </button>
      </div>
    </div>
  );
}

/**
 * 记忆阶段的词卡
 *
 * 独立成组件并由父级用 key={word.wordId} 挂载：切词时组件重新挂载，
 * 发音等局部状态自然重置。「已翻开」由父级按 wordId 持有，
 * 以便键盘（Enter）与按钮共用同一份状态。
 */
function MemoryCard({ word, revealed, onReveal }: { word: GameWord; revealed: boolean; onReveal: () => void }) {
  const marks = useVocabGameStore((s) => s.session?.marks);
  const mnemonic = useVocabGameStore((s) => s.session?.mnemonics[word.wordId]);
  const retryMnemonic = useVocabGameStore((s) => s.retryMnemonic);
  const customMnemonic = useVocabGameStore((s) => s.session?.customs?.[word.wordId]);
  const saveCustomMnemonic = useVocabGameStore((s) => s.saveCustomMnemonic);
  const examExample = getExamExample(word.word);
  const playback = useVocabPlayback();

  // 切到新词时自动连续播放单词读音三遍，间隔 2 秒（不含例句读音）
  useEffect(() => {
    if (!word.word) return;
    const timers: number[] = [];
    for (let i = 0; i < 3; i++) {
      timers.push(window.setTimeout(() => speak(word.word), i * 2000));
    }
    return () => timers.forEach(t => window.clearTimeout(t));
  }, [word.word]);

  const mark = marks?.[word.wordId];
  /** 音节切分：一元一辅、从词尾往前切，点号连接，帮助分块记忆长单词 */
  const syllables = splitSyllables(word.word);

  return (
    <article className="vg-word-card">
      <h2 className="vg-memory-word">{word.word}</h2>
      {syllables.length > 1 && (
        <p className="vg-word-syllables" title="按「一元一辅」从词尾往前切分，点号分隔音节">
          {syllables.map((part, i) => (
            <span className="vg-syllable" key={`${part}-${i}`}>
              {part}
              {i < syllables.length - 1 && <i className="vg-syllable-dot" aria-hidden="true">·</i>}
            </span>
          ))}
        </p>
      )}
      <div className="vg-pron-row">
        <button
          className={`vg-pron${isSpeaking(playback, word.word, 'uk') ? ' is-speaking' : ''}`}
          type="button"
          onClick={() => speakAccent(word.word, 'uk')}
          aria-label="播放英式发音"
          aria-busy={isSpeaking(playback, word.word, 'uk')}
          disabled={playback.playing}
        >
          <span className="vg-pron-label">英</span>
          <span className="vg-pron-ipa">{word.phoneticUk ?? '—'}</span>
          <Volume2 size={13} />
        </button>
        <button
          className={`vg-pron${isSpeaking(playback, word.word, 'us') ? ' is-speaking' : ''}`}
          type="button"
          onClick={() => speakAccent(word.word, 'us')}
          aria-label="播放美式发音"
          aria-busy={isSpeaking(playback, word.word, 'us')}
          disabled={playback.playing}
        >
          <span className="vg-pron-label">美</span>
          <span className="vg-pron-ipa">{word.phoneticUs ?? '—'}</span>
          <Volume2 size={13} />
        </button>
      </div>
      <div className="vg-word-pos">
        {word.unit}{word.coreZone ? ' · 核心词' : ''}
      </div>
      <div className="vg-word-divider" />
      {revealed ? (
        <>
          <p className="vg-word-meaning">{word.meaning}</p>
          {examExample && (
            <div className="vg-example">
              <div className="vg-example-head">
                <span
                  className="vg-example-tag"
                  title="真题语境取自英语（二）历年试题原文；部分短语来自 exam-data/NETEMVocabulary（CC BY-NC-SA 4.0）"
                >真题语境</span>
                <span className="vg-example-source">
                  {examExample.source}{examExample.count >= 2 ? ` · 出现 ${examExample.count} 次` : ''}
                </span>
                <button
                  className={`vg-example-speak${isSpeaking(playback, examExample.en) ? ' is-speaking' : ''}`}
                  type="button"
                  aria-label="播放真题语境"
                  aria-busy={isSpeaking(playback, examExample.en)}
                  disabled={playback.playing}
                  onClick={() => speak(examExample.en)}
                >
                  <Volume2 size={13} />
                </button>
              </div>
              <p className="vg-example-en">{examExample.en}</p>
              {examExample.zh && <p className="vg-example-zh">{examExample.zh}</p>}
            </div>
          )}
          <MnemonicBlock
            entry={mnemonic}
            onRetry={() => void retryMnemonic(word.wordId)}
          />
          {/* 自定义助记不依赖 AI：没开 AI 也能录自己的口诀 */}
          <CustomMnemonicBlock
            value={customMnemonic ?? ''}
            onSave={(text) => saveCustomMnemonic(word.wordId, text)}
          />
        </>
      ) : (
        <button
          className="vg-primary-btn vg-reveal-btn"
          type="button"
          onClick={onReveal}
        >
          翻开查看释义与助记
          <span className="kbd">Enter</span>
        </button>
      )}
      <p className="vg-word-tip">
        {mark === 'mastered'
          ? '已标记为「已掌握」，本关测验会跳过该词，之后也不再进入复习。'
          : mark === 'known'
            ? '已标记为「认识」，测验时仍会正常出题。'
            : mark === 'fuzzy'
              ? '已标记为「有点模糊」，答错会自动进入难词本。'
              : '先试着回忆释义，再翻开核对。'}
      </p>
    </article>
  );
}

/**
 * 全屏闯关界面：记忆阶段（词卡浏览 + 模糊/认识标记）→ 随堂测验（英译中 4 选 1）
 * → 结果页。计时由 store 的 phaseEndsAt 驱动，本组件只负责渲染与键盘映射。
 */
export function VocabGameSession() {
  const session = useVocabGameStore((s) => s.session);
  const gotoMemory = useVocabGameStore((s) => s.gotoMemory);
  const mark = useVocabGameStore((s) => s.mark);
  const pickOption = useVocabGameStore((s) => s.pickOption);
  const nextQuestion = useVocabGameStore((s) => s.nextQuestion);
  const beginQuiz = useVocabGameStore((s) => s.beginQuiz);
  const expirePhase = useVocabGameStore((s) => s.expirePhase);
  const retryWrong = useVocabGameStore((s) => s.retryWrong);
  const exit = useVocabGameStore((s) => s.exit);
  /** 发音播放态：播放期间空格不再重复触发读音 */
  const playback = useVocabPlayback();
  const [now, setNow] = useState(() => Date.now());
  const [confirmExit, setConfirmExit] = useState(false);
  /** 已翻开释义的词：按 wordId 记录，切词后自动回到未翻开态 */
  const [revealedWordId, setRevealedWordId] = useState<number | null>(null);

  // 阶段计时：以截止时间戳为准，500ms 刷新显示，避免 setInterval 漂移累积
  useEffect(() => {
    if (!session || session.phase === 'result') return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [session]);

  useEffect(() => () => stopSpeak(), []);

  useEffect(() => {
    if (!session || session.phase === 'result') return;
    if (now >= session.phaseEndsAt) expirePhase();
  }, [now, session, expirePhase]);

  const memoryWord = session?.phase === 'memory' ? session.words[session.memoryIndex] : null;
  const question = session?.phase === 'quiz' ? session.quiz[session.quizIndex] : null;

  // 测验：选择后短暂展示判分，再自动跳到下一题
  const pickedId = question?.picked;
  useEffect(() => {
    if (session?.phase !== 'quiz' || pickedId === null || pickedId === undefined) return;
    const timer = window.setTimeout(() => nextQuestion(), 800);
    return () => window.clearTimeout(timer);
  }, [session?.phase, pickedId, nextQuestion]);

  // 键盘映射：记忆 Enter 翻开释义、1/2/3 标记、←/→ 切卡、空格发音；测验 1-4 选项、Enter 下一题
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!session) return;
      // 焦点在输入框里时不响应卡片快捷键：「我的助记」录入 1/2/3、空格、Enter 都是正常字符
      const target = e.target as HTMLElement | null;
      if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return;
      if (e.key === 'Escape') { e.preventDefault(); setConfirmExit(true); return; }
      if (session.phase === 'memory' && memoryWord) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); gotoMemory(session.memoryIndex - 1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); gotoMemory(session.memoryIndex + 1); return; }
        if (e.key === ' ') {
          e.preventDefault();
          if (!playback.playing) speak(memoryWord.word);
          return;
        }
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
  }, [session, memoryWord, question, playback.playing, gotoMemory, mark, pickOption, nextQuestion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!session) return null;

  const passPct = Math.round(session.passAccuracy * 100);
  const remaining = Math.max(0, Math.ceil((session.phaseEndsAt - now) / 1000));
  const levelLabel = session.isReview ? '今日复习关' : `第 ${session.level} 关`;
  const phaseTitle = session.phase === 'memory'
    ? `${levelLabel} · ${session.isReview ? '复习记忆' : session.isReplay ? '复习闯关' : '记忆阶段'}`
    : session.phase === 'quiz'
      ? `${levelLabel} · ${session.isReview || session.isReplay ? '复习测验' : '随堂测验'}`
      : `${levelLabel} · ${session.isReview || session.isReplay ? '复习结果' : '闯关结果'}`;
  const phaseSubtitle = session.phase === 'memory'
    ? session.isReview
      ? '全部到期单词已汇总成本关，完成测验并达到通过线才算复习完成'
      : session.isReplay
        ? '重闯已通过的关卡，标记与测验仍会更新单词复习计划'
        : '先建立第一印象，模糊的词会被重点复习'
    : session.phase === 'quiz'
      ? session.isReview
        ? `复习测验，正确率达到 ${passPct}% 才算完成本次复习`
        : session.isReplay
          ? `重闯不改变关卡进度，正确率达到 ${passPct}% 判定通过`
          : `选择正确释义，正确率达到 ${passPct}% 即通关`
      : session.isReview
        ? session.result?.passed
          ? '复习完成，单词已按遗忘曲线安排下一次复习'
          : '未达到通过线，到期单词会保留在待复习列表'
        : session.isRetry
          ? '错词重测不重复计入关卡进度'
          : session.isReplay
            ? '复习成绩已记录，关卡进度保持不变'
            : '本次成绩已同步到背单词复习计划';

  const totalSteps = session.phase === 'quiz' ? session.quiz.length : session.words.length;
  const step = session.phase === 'quiz' ? session.quizIndex + 1 : session.memoryIndex + 1;
  const percent = totalSteps > 0 ? Math.min(100, Math.round((step / totalSteps) * 100)) : 0;
  const knownCount = Object.values(session.marks).filter((m) => m === 'known').length;
  const fuzzyCount = Object.values(session.marks).filter((m) => m === 'fuzzy').length;
  const masteredCount = Object.values(session.marks).filter((m) => m === 'mastered').length;
  const mnemonicEntries = Object.values(session.mnemonics);
  const mnemonicReady = mnemonicEntries.filter((e) => e.status === 'ready').length;

  return (
    <div className="vg-screen" role="dialog" aria-modal="true" aria-label="单词闯关学习界面">
      <header className="vg-screen-top">
        <div className="vg-screen-brand">
          <span className="vg-brand-mark"><Check size={17} /></span>
          <span>单词闯关</span>
        </div>
        <div className="vg-screen-phase">
          <strong>{phaseTitle}</strong>
          <span>{phaseSubtitle}</span>
        </div>
        <div className="vg-screen-actions">
          {session.phase !== 'result' && (
            <div className={`vg-timer${remaining <= 30 ? ' urgent' : ''}`} aria-label="阶段剩余时间">
              <Clock size={16} />
              <span>{fmtClock(remaining)}</span>
            </div>
          )}
          <button className="vg-exit-btn" onClick={() => setConfirmExit(true)} type="button">退出学习</button>
        </div>
      </header>

      <div className="vg-screen-main">
        {session.phase !== 'result' && (
          <>
            <div className="vg-screen-progress-head">
              <strong>
                {session.phase === 'quiz' ? '测验进度' : '记忆进度'} {step} / {totalSteps}
              </strong>
              {session.phase === 'memory' && mnemonicEntries.length > 0 && (
                <span>AI 助记 {mnemonicReady} / {session.words.length}</span>
              )}
            </div>
            <div className="vg-screen-progress"><span style={{ width: `${percent}%` }} /></div>
          </>
        )}

        {session.phase === 'memory' && memoryWord && (
          <>
            <div className="vg-card-switch">
              <button
                className="vg-card-arrow"
                type="button"
                onClick={() => gotoMemory(session.memoryIndex - 1)}
                disabled={session.memoryIndex === 0}
                title="上一个"
                aria-label="上一个单词"
              >
                <ChevronLeft size={18} />
              </button>
              <MemoryCard
                key={memoryWord.wordId}
                word={memoryWord}
                revealed={revealedWordId === memoryWord.wordId}
                onReveal={() => setRevealedWordId(memoryWord.wordId)}
              />
              <button
                className="vg-card-arrow"
                type="button"
                onClick={() => gotoMemory(session.memoryIndex + 1)}
                disabled={session.memoryIndex >= session.words.length - 1}
                title="下一个"
                aria-label="下一个单词"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            <div className="vg-mark-row">
              <button
                className={`vg-fuzzy-btn${session.marks[memoryWord.wordId] === 'fuzzy' ? ' selected' : ''}`}
                type="button"
                onClick={() => mark(memoryWord.wordId, 'fuzzy')}
              >
                有点模糊
              </button>
              <button
                className={`vg-known-btn${session.marks[memoryWord.wordId] === 'known' ? ' selected' : ''}`}
                type="button"
                onClick={() => mark(memoryWord.wordId, 'known')}
              >
                已经认识
              </button>
              <button
                className={`vg-mastered-btn${session.marks[memoryWord.wordId] === 'mastered' ? ' selected' : ''}`}
                type="button"
                onClick={() => mark(memoryWord.wordId, 'mastered')}
              >
                已掌握
              </button>
            </div>

            <div className="vg-screen-foot">
              <span>已认识 {knownCount} · 有点模糊 {fuzzyCount} · 已掌握 {masteredCount}</span>
              <span className="vg-screen-shortcuts">← → 切换词卡 · Enter 翻开释义 · 1/2/3 标记 · 空格发音</span>
              <button className="vg-text-btn" type="button" onClick={beginQuiz}>
                提前测验 <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}

        {session.phase === 'quiz' && question && (
          <article className="vg-word-card vg-quiz-card">
            <div className="vg-quiz-label">{session.isReview ? '复习测验' : '随堂测验'} · 选择正确释义</div>
            <p className="vg-quiz-prompt">请选择该单词的中文释义</p>
            <h2 className="vg-quiz-word">{question.word}</h2>
            <div className="vg-quiz-options">
              {question.options.map((opt, i) => {
                const answered = question.picked !== null;
                let cls = 'vg-quiz-option';
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
                    <span className="vg-option-letter">{String.fromCharCode(65 + i)}</span>
                    <span>{opt.text}</span>
                  </button>
                );
              })}
            </div>
            <p className="vg-quiz-feedback">
              {question.picked === null
                ? '选择一个答案后立即判分'
                : question.options.find((o) => o.id === question.picked)?.correct
                  ? '回答正确，继续保持。'
                  : '答错了，这个单词会进入难词本。'}
            </p>
            <button
              className="vg-primary-btn vg-quiz-next"
              type="button"
              disabled={question.picked === null}
              onClick={nextQuestion}
            >
              {session.quizIndex + 1 >= session.quiz.length ? '查看结果' : '下一题'}
              <ArrowRight size={17} />
            </button>
            <p className="vg-screen-hint">1-4 选择答案 · Enter 下一题</p>
          </article>
        )}

        {session.phase === 'result' && session.result && (
          <article className="vg-word-card vg-result-card">
            <span className={`vg-result-badge${session.result.passed ? '' : ' fail'}`}>
              {session.result.passed ? <Check size={28} /> : <RotateCcw size={26} />}
            </span>
            <h2>
              {session.isReview
                ? (session.result.passed ? '复习完成' : '复习未通过')
                : session.isReplay
                  ? (session.result.passed ? '复习完成' : '复习结束')
                  : (session.result.passed ? '本关通过' : '还差一点')}
            </h2>
            <p className="vg-result-subtitle">
              {session.isReview
                ? session.result.passed
                  ? `正确率达到 ${passPct}%，今日到期单词已全部复习完成。`
                  : `正确率达到 ${passPct}% 才算复习完成，到期单词仍保留在待复习列表。`
                : session.isReplay
                  ? '本次为复习闯关，成绩已计入复习记录，不改变关卡进度。'
                  : session.result.passed
                    ? `正确率达到 ${passPct}%，下一关已解锁。`
                    : `正确率达到 ${passPct}% 即可通过，重测错词后再来一次。`}
            </p>
            <div className="vg-result-score">{session.result.score}<small> 分</small></div>
            <div className="vg-result-stats">
              <div>
                <strong>{session.result.total > 0 ? `${Math.round(session.result.accuracy * 100)}%` : '—'}</strong>
                <span>正确率</span>
              </div>
              <div><strong>{session.result.correct}</strong><span>答对</span></div>
              <div><strong>{session.result.wrongWordIds.length}</strong><span>错词</span></div>
              <div><strong>{session.result.skipped}</strong><span>已掌握跳过</span></div>
            </div>
            {session.result.skipped > 0 && (
              <p className="vg-result-hint">
                已掌握的 {session.result.skipped} 词不再进入测验与复习队列。
              </p>
            )}
            <div className="vg-result-actions">
              <button className="vg-secondary-btn" type="button" onClick={exit}>返回学习台</button>
              {session.isReview && !session.result.passed ? (
                <button
                  className="vg-primary-btn"
                  type="button"
                  disabled={session.busy}
                  onClick={retryWrong}
                >
                  {session.busy ? '记录中…' : `重新复习（${session.words.length}）`}
                </button>
              ) : (
                <button
                  className="vg-primary-btn"
                  type="button"
                  disabled={session.result.wrongWordIds.length === 0 || session.busy}
                  onClick={retryWrong}
                >
                  {session.busy ? '记录中…' : `重测错词（${session.result.wrongWordIds.length}）`}
                </button>
              )}
            </div>
            {session.lastError && <p className="vg-result-error">{session.lastError}</p>}
            <p className="vg-result-hint">按 Esc 退出学习</p>
          </article>
        )}
      </div>

      {confirmExit && (
        <div className="vg-confirm-overlay">
          <div className="vg-confirm" role="dialog" aria-modal="true" aria-label="退出学习确认">
            <h3>退出本次闯关？</h3>
            <p>未提交的成绩不会保存，本轮的记忆标记也不会记录。</p>
            <div className="vg-confirm-actions">
              <button className="vg-secondary-btn" type="button" onClick={() => setConfirmExit(false)}>继续学习</button>
              <button className="vg-danger-btn" type="button" onClick={exit}>退出</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

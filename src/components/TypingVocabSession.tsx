/**
 * 打字背单词——练习会话。
 *
 * 四种模式的差异集中在「给多少提示」与「如何判定」：
 * - follow      跟打：显示完整单词，逐字符校验，打错不前进；
 * - dictation   听写：只播发音 + 等长占位，逐字符校验；
 * - selftest    自测：只给中文释义，回车提交后对照；
 * - recall      默写：给中文释义与音标，回车提交后对照（无任何拼写提示）。
 *
 * 统计口径：keystrokes 记录所有有效字符输入，correctKeystrokes 只记打对的字符；
 * 实时模式逐键累加，提交模式在提交时按「相同前缀」估算。
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, Eye, LogOut, RotateCcw, Volume2, X,
} from 'lucide-react';
import type {
  TypingMode, TypingOutcome, TypingPlan, TypingProfile, TypingQueueItem,
} from '../lib/typing-vocab-db';
import { playTypingSound } from '../lib/typing-vocab-sound';
import { speakTypingWord, stopTypingSpeech } from '../lib/typing-vocab-speech';
import { isSpeaking, useTypingPlayback } from '../hooks/use-speak-playback';

export interface TypingSessionResult {
  total: number;
  correct: number;
  wrong: number;
  newCount: number;
  reviewCount: number;
  keystrokes: number;
  correctKeystrokes: number;
  durationMs: number;
  wpm: number;
  accuracy: number;
  startedAt: string;
  wrongWords: TypingQueueItem[];
}

interface Props {
  queue: TypingQueueItem[];
  mode: TypingMode;
  plan: TypingPlan;
  profile: TypingProfile;
  onRate: (wordId: number, outcome: TypingOutcome, mode: TypingMode) => Promise<void>;
  onFinished: (result: TypingSessionResult) => void;
  onExit: () => void;
}

interface WordRecord {
  item: TypingQueueItem;
  outcome: TypingOutcome;
}

const MODE_LABEL: Record<TypingMode, string> = {
  follow: '跟打',
  dictation: '听写',
  selftest: '自测',
  recall: '默写',
};

const MODE_HINT: Record<TypingMode, string> = {
  follow: '照着单词逐字母输入，打错不会前进',
  dictation: '听发音拼出单词，可重播 3 次',
  selftest: '看中文释义想出英文，回车提交',
  recall: '看释义与音标默写，回车提交',
};

const MAX_REPLAY = 3;

function normalize(text: string, ignoreCase: boolean): string {
  return ignoreCase ? text.trim().toLowerCase() : text.trim();
}

/** 逐字符比较不做 trim，否则空格字符会被吃掉 */
function normalizeChar(ch: string, ignoreCase: boolean): string {
  return ignoreCase ? ch.toLowerCase() : ch;
}

/** 相同前缀长度，用于提交模式的击键正确数估算 */
function commonPrefix(a: string, b: string): number {
  const n = Math.min(a.length, b.length);
  let i = 0;
  while (i < n && a[i] === b[i]) i += 1;
  return i;
}

function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const min = Math.floor(total / 60);
  const sec = total % 60;
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function TypingVocabSession({
  queue, mode, plan, profile, onRate, onFinished, onExit,
}: Props) {
  const [index, setIndex] = useState(0);
  const [input, setInput] = useState('');
  const [errorPositions, setErrorPositions] = useState<Set<number>>(() => new Set());
  const [phase, setPhase] = useState<'typing' | 'done'>('typing');
  const [lastOutcome, setLastOutcome] = useState<TypingOutcome | null>(null);
  const [replays, setReplays] = useState(0);
  const [confirmExit, setConfirmExit] = useState(false);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [wrongFlash, setWrongFlash] = useState(false);
  /** 发音播放态：播放期间朗读/重播按钮显示动效并禁用 */
  const playback = useTypingPlayback();
  /** 渲染用的已完成记录（ref 版本供事件回调同步读取，两者始终同步） */
  const [records, setRecords] = useState<WordRecord[]>([]);
  /** 渲染用的击键统计 */
  const [stat, setStat] = useState({ keystrokes: 0, correctKeystrokes: 0 });

  const inputRef = useRef<HTMLInputElement>(null);
  const startedAtRef = useRef(new Date());
  const recordsRef = useRef<WordRecord[]>([]);
  const statRef = useRef({ keystrokes: 0, correctKeystrokes: 0 });
  const finishedRef = useRef(false);
  /** 实时模式的输入串/错误位置：用 ref 同步，避免快速连打时闭包读到旧值 */
  const liveInputRef = useRef('');
  const errorRef = useRef<Set<number>>(new Set());

  const item = queue[Math.min(index, queue.length - 1)];
  const word = item?.word ?? '';
  const isLiveMode = mode === 'follow' || mode === 'dictation';
  const total = queue.length;
  const doneCount = records.length;
  const correctCount = records.filter((r) => r.outcome !== 'wrong').length;
  const accuracy = doneCount > 0 ? correctCount / doneCount : 1;
  const liveWpm = (() => {
    const minutes = Math.max(0, elapsedMs) / 60000;
    if (minutes <= 0) return 0;
    return Math.round((stat.correctKeystrokes / 5 / minutes) * 10) / 10;
  })();

  /** 累加击键统计：ref 保证事件回调里读到最新值，state 保证渲染更新 */
  const addStat = useCallback((keystrokes: number, correctKeystrokes: number) => {
    statRef.current = {
      keystrokes: statRef.current.keystrokes + keystrokes,
      correctKeystrokes: statRef.current.correctKeystrokes + correctKeystrokes,
    };
    setStat({ ...statRef.current });
  }, []);

  /** 结束：汇总本次记录（至少完成一个词才上报，避免空会话污染统计） */
  const finish = useCallback(() => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    stopTypingSpeech();
    const records = recordsRef.current;
    if (records.length === 0) {
      onExit();
      return;
    }
    const durationMs = Date.now() - startedAtRef.current.getTime();
    const correct = records.filter((r) => r.outcome !== 'wrong').length;
    const wrong = records.length - correct;
    const minutes = Math.max(durationMs, 1) / 60000;
    const wpm = Math.round((statRef.current.correctKeystrokes / 5 / minutes) * 10) / 10;
    onFinished({
      total: records.length,
      correct,
      wrong,
      newCount: records.filter((r) => r.item.isNew).length,
      reviewCount: records.filter((r) => !r.item.isNew).length,
      keystrokes: statRef.current.keystrokes,
      correctKeystrokes: statRef.current.correctKeystrokes,
      durationMs,
      wpm,
      accuracy: records.length > 0 ? correct / records.length : 0,
      startedAt: startedAtRef.current.toISOString(),
      wrongWords: records.filter((r) => r.outcome === 'wrong').map((r) => r.item),
    });
  }, [onExit, onFinished]);

  const resetWordState = useCallback(() => {
    liveInputRef.current = '';
    errorRef.current = new Set();
    setInput('');
    setErrorPositions(new Set());
    setPhase('typing');
    setLastOutcome(null);
    setReplays(0);
    setWrongFlash(false);
  }, []);

  const goNext = useCallback(() => {
    if (index + 1 >= queue.length) {
      finish();
      return;
    }
    setIndex(index + 1);
    resetWordState();
  }, [finish, index, queue.length, resetWordState]);

  const completeWord = useCallback((outcome: TypingOutcome) => {
    if (!item) return;
    recordsRef.current = [...recordsRef.current, { item, outcome }];
    setRecords(recordsRef.current);
    setPhase('done');
    setLastOutcome(outcome);
    playTypingSound(outcome === 'wrong' ? 'error' : 'success');
    void onRate(item.id, outcome, mode).catch((err) => {
      console.error('[TypingVocabSession] 写入记忆状态失败:', err);
    });
  }, [item, mode, onRate]);

  /** 实时模式：逐字符校验，错误不前进 */
  const typeChar = useCallback((raw: string) => {
    if (!item || phase !== 'typing' || !isLiveMode) return;
    const current = liveInputRef.current;
    const pos = current.length;
    if (pos >= word.length) return;
    const target = word[pos];
    const typed = normalizeChar(raw, profile.ignoreCase);
    const expected = normalizeChar(target, profile.ignoreCase);

    if (typed === expected) {
      addStat(1, 1);
      const nextInput = current + target;
      liveInputRef.current = nextInput;
      setInput(nextInput);
      playTypingSound(target === ' ' ? 'space' : 'key');
      if (nextInput.length >= word.length) {
        const outcome: TypingOutcome = errorRef.current.size > 0 ? 'correct' : 'perfect';
        // 等一帧让最后一个字符先渲染，再切到完成态
        window.setTimeout(() => completeWord(outcome), 90);
      }
    } else {
      addStat(1, 0);
      errorRef.current.add(pos);
      setErrorPositions(new Set(errorRef.current));
      setWrongFlash(true);
      window.setTimeout(() => setWrongFlash(false), 180);
      playTypingSound('error');
    }
  }, [addStat, completeWord, isLiveMode, item, phase, profile.ignoreCase, word]);

  const submitTyped = useCallback(() => {
    if (!item || phase !== 'typing') return;
    const typed = normalize(input, profile.ignoreCase);
    if (!typed) return;
    const expected = normalize(word, profile.ignoreCase);
    const samePrefix = commonPrefix(typed, expected);
    addStat(typed.length, typed === expected ? expected.length : samePrefix);
    completeWord(typed === expected ? 'perfect' : 'wrong');
  }, [addStat, completeWord, input, item, phase, profile.ignoreCase, word]);

  const revealAnswer = useCallback(() => {
    if (!item || phase !== 'typing') return;
    const typedLength = isLiveMode ? liveInputRef.current.length : input.length;
    addStat(Math.max(0, word.length - typedLength), 0);
    completeWord('wrong');
  }, [addStat, completeWord, input.length, isLiveMode, item, phase, word.length]);

  const replay = useCallback(() => {
    if (replays >= MAX_REPLAY || playback.playing) return;
    setReplays((n) => n + 1);
    speakTypingWord(word);
  }, [playback.playing, replays, word]);

  // 计时器：每 500ms 刷新一次已用时/实时 WPM
  useEffect(() => {
    const timer = window.setInterval(() => {
      setElapsedMs(Date.now() - startedAtRef.current.getTime());
    }, 500);
    return () => window.clearInterval(timer);
  }, []);

  // 换词：听写模式自动播放一次；提交模式自动聚焦输入框
  useEffect(() => {
    if (!item) return;
    if (mode === 'dictation') speakTypingWord(item.word);
    if (!isLiveMode) inputRef.current?.focus();
  }, [index, isLiveMode, item, mode]);

  // 卸载时停掉朗读
  useEffect(() => () => stopTypingSpeech(), []);

  // 键盘监听（实时模式）：用 ref 持有最新回调，避免逐字符重新绑定
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (confirmExit) {
        if (e.key === 'Escape') setConfirmExit(false);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setConfirmExit(true);
        return;
      }
      if (phase === 'done') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          goNext();
        }
        return;
      }
      if (!isLiveMode) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.isComposing) return;
      if (e.key === 'Backspace') {
        // 错误的字符不会进入输入，退格没有意义，直接拦住避免误删已打对的部分
        e.preventDefault();
        return;
      }
      if (e.key.length === 1) {
        e.preventDefault();
        typeChar(e.key);
      }
    };
  }, [confirmExit, goNext, isLiveMode, phase, typeChar]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 完成一个词后：开了「自动下一词」就短暂停留；答错的词停下来让用户看对照
  useEffect(() => {
    if (phase !== 'done' || !profile.autoNext || lastOutcome === 'wrong') return;
    const timer = window.setTimeout(() => {
      if (!finishedRef.current) goNext();
    }, 860);
    return () => window.clearTimeout(timer);
  }, [phase, goNext, lastOutcome, profile.autoNext, index]);

  if (!item) {
    return (
      <div className="typing-session typing-session-empty">
        <p className="placeholder-text">当前没有可练习的单词</p>
        <button className="typing-btn" onClick={onExit}>返回</button>
      </div>
    );
  }

  const showMeaning = profile.showMeaning;
  const showPhonetic = profile.showPhonetic && mode !== 'selftest';
  const phonetic = profile.accent === 'uk' ? item.phoneticUk : item.phoneticUs;
  const progressPercent = total > 0 ? ((index + (phase === 'done' ? 1 : 0)) / total) * 100 : 0;
  const revealed = phase === 'done';
  const speaking = isSpeaking(playback, word);

  return (
    <div className="typing-session">
      <header className="typing-session-head">
        <div className="typing-session-meta">
          <span className="typing-mode-tag">{MODE_LABEL[mode]}</span>
          <span className="typing-plan-tag">{plan === 'smart' ? '智能' : '自由'}</span>
          <span className="typing-session-count">{Math.min(index + 1, total)} / {total}</span>
        </div>
        <div className="typing-session-metrics">
          <span>正确率 <b>{Math.round(accuracy * 100)}%</b></span>
          <span>WPM <b>{liveWpm.toFixed(1)}</b></span>
          <span>用时 <b>{formatDuration(elapsedMs)}</b></span>
          <button className="typing-icon-btn" onClick={() => setConfirmExit(true)} title="结束练习">
            <LogOut size={16} />
          </button>
        </div>
        <div className="typing-progress">
          <span style={{ width: `${Math.min(100, progressPercent)}%` }} />
        </div>
      </header>

      <main className={`typing-stage${wrongFlash ? ' shake' : ''}`}>
        <div className="typing-stage-top">
          <span className="typing-stage-hint">{MODE_HINT[mode]}</span>
          <button
            className={`typing-icon-btn${speaking ? ' is-speaking' : ''}`}
            onClick={() => speakTypingWord(item.word)}
            title={playback.playing ? '正在播放…' : '朗读单词'}
            aria-busy={speaking}
            disabled={playback.playing}
          >
            <Volume2 size={16} />
          </button>
        </div>

        {mode === 'dictation' && phase === 'typing' && (
          <button
            className={`typing-replay${speaking ? ' is-speaking' : ''}`}
            onClick={replay}
            disabled={replays >= MAX_REPLAY || playback.playing}
            aria-busy={speaking}
          >
            <RotateCcw size={14} /> 重播发音（{MAX_REPLAY - replays}）
          </button>
        )}

        {showPhonetic && phonetic && (
          <p className="typing-phonetic">{phonetic}</p>
        )}

        {/* 提示区：跟打显示全词；听写只显示输入进度；自测/默写显示释义 */}
        {mode === 'follow' && !revealed && (
          <div className="typing-word" aria-label={`目标单词 ${word}`}>
            {Array.from(word).map((ch, i) => {
              const typed = i < input.length;
              const current = i === input.length && !revealed;
              const bad = errorPositions.has(i);
              return (
                <span
                  key={`${ch}-${i}`}
                  className={`typing-char${typed ? ' typed' : ''}${current ? ' current' : ''}${bad ? ' bad' : ''}`}
                >
                  {ch}
                </span>
              );
            })}
          </div>
        )}

        {mode === 'dictation' && !revealed && (
          <div className="typing-word typing-word-masked">
            {Array.from(word).map((ch, i) => {
              const typed = i < input.length;
              const current = i === input.length && !revealed;
              const bad = errorPositions.has(i);
              return (
                <span
                  key={`${ch}-${i}`}
                  className={`typing-char${typed ? ' typed' : ' slot'}${current ? ' current' : ''}${bad ? ' bad' : ''}`}
                >
                  {typed ? ch : '_'}
                </span>
              );
            })}
          </div>
        )}

        {(mode === 'selftest' || mode === 'recall') && (
          <div className="typing-prompt">
            <p className="typing-meaning">{showMeaning ? item.meaning : '（释义已隐藏）'}</p>
            {mode === 'recall' && !revealed && (
              <p className="typing-prompt-tip">根据释义与音标默写单词，回车提交</p>
            )}
            <input
              ref={inputRef}
              className={`typing-answer-input${lastOutcome === 'wrong' ? ' wrong' : ''}`}
              value={input}
              onChange={(e) => {
                setInput(e.target.value);
                if (lastOutcome === 'wrong') setLastOutcome(null);
              }}
              onKeyDown={(e) => {
                if (e.key !== 'Enter') return;
                e.preventDefault();
                if (phase === 'done') goNext();
                else submitTyped();
              }}
              placeholder="输入英文单词…"
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="none"
              spellCheck={false}
              disabled={phase === 'done'}
            />
          </div>
        )}

        {/* 完成态：显示完整单词与释义；提交模式额外显示逐字对照 */}
        {revealed && (
          <div className={`typing-result ${lastOutcome === 'wrong' ? 'wrong' : 'ok'}`}>
            <div className="typing-result-title">
              {lastOutcome === 'wrong' ? <X size={16} /> : <Check size={16} />}
              {lastOutcome === 'wrong' ? '本次未通过' : lastOutcome === 'perfect' ? '一次全对' : '已通过（有错键）'}
            </div>
            <div className="typing-result-word">
              {mode === 'selftest' || mode === 'recall'
                ? Array.from(word).map((ch, i) => {
                  const typed = input[i] ?? '';
                  const ok = typed.toLowerCase() === ch.toLowerCase();
                  const touched = i < input.length;
                  return (
                    <span key={`${ch}-${i}`} className={`typing-char${touched ? (ok ? ' typed' : ' bad') : ' missed'}`}>
                      {ch}
                    </span>
                  );
                })
                : word}
            </div>
            {showMeaning && <p className="typing-result-meaning">{item.meaning}</p>}
            {item.exampleEn && (
              <p className="typing-result-example">
                {item.exampleEn}
                {item.exampleZh && <em> {item.exampleZh}</em>}
              </p>
            )}
            <button className="typing-next-btn" onClick={goNext}>
              下一个 <ArrowRight size={14} />
            </button>
          </div>
        )}

        {phase === 'typing' && (
          <div className="typing-actions">
            {isLiveMode ? (
              <span className="typing-kbd-tip">直接敲键盘输入 · Esc 结束</span>
            ) : (
              <>
                <button className="typing-btn" onClick={submitTyped} disabled={!input.trim()}>
                  <Check size={14} /> 提交（Enter）
                </button>
                <button className="typing-ghost-btn" onClick={revealAnswer}>
                  <Eye size={14} /> 不会，看答案
                </button>
              </>
            )}
          </div>
        )}
      </main>

      {confirmExit && (
        <div className="typing-confirm-mask" onClick={() => setConfirmExit(false)}>
          <div className="typing-confirm" onClick={(e) => e.stopPropagation()}>
            <h3>结束本次练习？</h3>
            <p>已完成的 {doneCount} 个单词会保留记忆进度。</p>
            <div className="typing-confirm-actions">
              <button className="typing-ghost-btn" onClick={() => setConfirmExit(false)}>继续练习</button>
              <button className="typing-btn" onClick={finish}>结束并结算</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

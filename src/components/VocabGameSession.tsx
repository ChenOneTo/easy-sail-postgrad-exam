import { useEffect, useRef, useState } from 'react';
import {
  ArrowRight, Check, ChevronLeft, ChevronRight, Clock, Loader2, RotateCcw, Sparkles, Volume2,
} from 'lucide-react';
import { useVocabGameStore } from '../stores/vocab-game-store';
import type { GameMnemonic } from '../stores/vocab-game-store';
import { speak, speakAccent, stopSpeak } from '../lib/vocab-tts';
import { getExamExample } from '../lib/vocab-examples';

function fmtClock(seconds: number): string {
  const s = Math.max(0, seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** 记忆卡上的 AI 助记块：加载中 / 失败重试 / 词根 + 口诀 + 例句 */
function MnemonicBlock({ entry, onRetry }: { entry?: GameMnemonic; onRetry: () => void }) {
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
      <button className="vg-mnemonic-retry" type="button" onClick={onRetry}>
        <RotateCcw size={13} /> AI 助记生成失败，点击重试
      </button>
    );
  }
  const { roots, mnemonic, method, scene, sentence, sentenceZh } = entry.data;
  return (
    <div className="vg-mnemonic">
      <div className="vg-mnemonic-title">
        <Sparkles size={13} /> AI 助记
        {method && <span className="vg-mnemonic-method">{method}</span>}
      </div>
      {roots && <p><span className="vg-mnemonic-tag">词根</span>{roots}</p>}
      <p><span className="vg-mnemonic-tag">口诀</span>{mnemonic}</p>
      {scene && <p className="vg-mnemonic-scene"><span className="vg-mnemonic-tag">画面</span>{scene}</p>}
      {sentence && (
        <p className="vg-mnemonic-example">
          <span className="vg-mnemonic-tag">例句</span>{sentence}
          {sentenceZh && <em>{sentenceZh}</em>}
        </p>
      )}
    </div>
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
  const retryMnemonic = useVocabGameStore((s) => s.retryMnemonic);
  const exit = useVocabGameStore((s) => s.exit);
  const [now, setNow] = useState(() => Date.now());
  const [confirmExit, setConfirmExit] = useState(false);

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
  const examExample = memoryWord ? getExamExample(memoryWord.word) : null;
  const question = session?.phase === 'quiz' ? session.quiz[session.quizIndex] : null;

  // 键盘映射：记忆 1/2 标记、←/→ 切卡、空格发音；测验 1-4 选项、Enter 下一题
  const keyRef = useRef<(e: KeyboardEvent) => void>(() => {});
  useEffect(() => {
    keyRef.current = (e: KeyboardEvent) => {
      if (!session) return;
      if (e.key === 'Escape') { e.preventDefault(); setConfirmExit(true); return; }
      if (session.phase === 'memory' && memoryWord) {
        if (e.key === 'ArrowLeft') { e.preventDefault(); gotoMemory(session.memoryIndex - 1); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); gotoMemory(session.memoryIndex + 1); return; }
        if (e.key === ' ') { e.preventDefault(); speak(memoryWord.word); return; }
        if (e.key === '1') { e.preventDefault(); mark(memoryWord.wordId, 'fuzzy'); return; }
        if (e.key === '2') { e.preventDefault(); mark(memoryWord.wordId, 'known'); return; }
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
  }, [session, memoryWord, question, gotoMemory, mark, pickOption, nextQuestion]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => keyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  if (!session) return null;

  const passPct = Math.round(session.passAccuracy * 100);
  const remaining = Math.max(0, Math.ceil((session.phaseEndsAt - now) / 1000));
  const phaseTitle = session.phase === 'memory'
    ? `第 ${session.level} 关 · ${session.isReplay ? '复习闯关' : '记忆阶段'}`
    : session.phase === 'quiz'
      ? `第 ${session.level} 关 · ${session.isReplay ? '复习测验' : '随堂测验'}`
      : `第 ${session.level} 关 · ${session.isReplay ? '复习结果' : '闯关结果'}`;
  const phaseSubtitle = session.phase === 'memory'
    ? session.isReplay
      ? '重闯已通过的关卡，标记与测验仍会更新单词复习计划'
      : '先建立第一印象，模糊的词会被重点复习'
    : session.phase === 'quiz'
      ? session.isReplay
        ? `重闯不改变关卡进度，正确率达到 ${passPct}% 判定通过`
        : `选择正确释义，正确率达到 ${passPct}% 即通关`
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
            <article className="vg-word-card" key={memoryWord.wordId}>
              <h2 className="vg-memory-word">{memoryWord.word}</h2>
              <div className="vg-pron-row">
                <button
                  className="vg-pron"
                  type="button"
                  onClick={() => speakAccent(memoryWord.word, 'uk')}
                  aria-label="播放英式发音"
                >
                  <span className="vg-pron-label">英</span>
                  <span className="vg-pron-ipa">{memoryWord.phoneticUk ?? '—'}</span>
                  <Volume2 size={13} />
                </button>
                <button
                  className="vg-pron"
                  type="button"
                  onClick={() => speakAccent(memoryWord.word, 'us')}
                  aria-label="播放美式发音"
                >
                  <span className="vg-pron-label">美</span>
                  <span className="vg-pron-ipa">{memoryWord.phoneticUs ?? '—'}</span>
                  <Volume2 size={13} />
                </button>
              </div>
              <div className="vg-word-pos">
                {memoryWord.unit}{memoryWord.coreZone ? ' · 核心词' : ''}
              </div>
              <div className="vg-word-divider" />
              <p className="vg-word-meaning">{memoryWord.meaning}</p>
              {examExample && (
                <div className="vg-example">
                  <div className="vg-example-head">
                    <span
                      className="vg-example-tag"
                      title="真题语境来自 exam-data/NETEMVocabulary（CC BY-NC-SA 4.0）"
                    >真题语境</span>
                    <span className="vg-example-source">
                      {examExample.source}{examExample.count >= 2 ? ` · 出现 ${examExample.count} 次` : ''}
                    </span>
                    <button
                      className="vg-example-speak"
                      type="button"
                      aria-label="播放真题语境"
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
                entry={session.mnemonics[memoryWord.wordId]}
                onRetry={() => void retryMnemonic(memoryWord.wordId)}
              />
              <p className="vg-word-tip">
                {session.marks[memoryWord.wordId] === 'known'
                  ? '已标记为「认识」，测验时仍会正常出题。'
                  : session.marks[memoryWord.wordId] === 'fuzzy'
                    ? '已标记为「有点模糊」，答错会自动进入难词本。'
                    : '先看一遍释义，再判断自己是否认识。'}
              </p>
            </article>

            <div className="vg-nav-row">
              <button
                className="vg-secondary-btn"
                type="button"
                onClick={() => gotoMemory(session.memoryIndex - 1)}
                disabled={session.memoryIndex === 0}
              >
                <ChevronLeft size={16} /> 上一个
              </button>
              <button
                className="vg-secondary-btn"
                type="button"
                onClick={() => gotoMemory(session.memoryIndex + 1)}
                disabled={session.memoryIndex >= session.words.length - 1}
              >
                下一个 <ChevronRight size={16} />
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
            </div>

            <div className="vg-screen-foot">
              <span>已认识 {knownCount} · 有点模糊 {fuzzyCount}</span>
              <span className="vg-screen-shortcuts">← → 切换词卡 · 1/2 标记 · 空格发音</span>
              <button className="vg-text-btn" type="button" onClick={beginQuiz}>
                提前测验 <ArrowRight size={15} />
              </button>
            </div>
          </>
        )}

        {session.phase === 'quiz' && question && (
          <article className="vg-word-card vg-quiz-card">
            <div className="vg-quiz-label">随堂测验 · 选择正确释义</div>
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
              {session.isReplay
                ? (session.result.passed ? '复习完成' : '复习结束')
                : (session.result.passed ? '本关通过' : '还差一点')}
            </h2>
            <p className="vg-result-subtitle">
              {session.isReplay
                ? '本次为复习闯关，成绩已计入复习记录，不改变关卡进度。'
                : session.result.passed
                  ? `正确率达到 ${passPct}%，下一关已解锁。`
                  : `正确率达到 ${passPct}% 即可通过，重测错词后再来一次。`}
            </p>
            <div className="vg-result-score">{session.result.score}<small> 分</small></div>
            <div className="vg-result-stats">
              <div><strong>{Math.round(session.result.accuracy * 100)}%</strong><span>正确率</span></div>
              <div><strong>{session.result.correct}</strong><span>答对</span></div>
              <div><strong>{session.result.wrongWordIds.length}</strong><span>错词</span></div>
            </div>
            <div className="vg-result-actions">
              <button className="vg-secondary-btn" type="button" onClick={exit}>返回学习台</button>
              <button
                className="vg-primary-btn"
                type="button"
                disabled={session.result.wrongWordIds.length === 0 || session.busy}
                onClick={retryWrong}
              >
                {session.busy ? '记录中…' : `重测错词（${session.result.wrongWordIds.length}）`}
              </button>
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

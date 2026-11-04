/**
 * 朗读播放态（纯状态，不含任何 TTS 实现）。
 *
 * 背单词与打字背单词各自持有一个实例：播放开始 / 结束时通知订阅者，
 * 供按钮渲染播放动效、并在播放期间禁止重复点击。
 *
 * 每次 begin 都推进代次（seq）：异步回调（音频 ended、语音合成 onend）
 * 只有代次仍是最新时才允许收尾，避免慢请求晚到把正在播放的按钮提前复位；
 * 同时带兜底超时，任何异常都不会让按钮永久停在「播放中」。
 */

export interface SpeechPlayback {
  playing: boolean;
  /** 正在朗读的文本；空闲时为空串 */
  text: string;
  /** 正在朗读的口音（取值由调用方约定）；整句或未指定时为 null */
  accent: string | null;
}

export interface SpeechPlaybackTracker {
  get(): SpeechPlayback;
  subscribe(listener: (state: SpeechPlayback) => void): () => void;
  /** 开始一次播放并返回代次；超过 maxMs 仍未收尾则强制复位 */
  begin(text: string, accent: string | null, maxMs?: number): number;
  /** 结束指定代次的播放；代次已过期（已被新的播放取代）时忽略 */
  finish(seq: number): void;
  /** 立即收尾并作废当前代次（停止发音、切卡时用） */
  reset(): void;
  /** 当前代次：用于判断异步回调是否已过期 */
  seq(): number;
}

const IDLE: SpeechPlayback = { playing: false, text: '', accent: null };

/** 兜底上限：正常读音都在几十秒内结束，超过视为异常 */
const DEFAULT_MAX_MS = 60000;

export function createSpeechPlayback(): SpeechPlaybackTracker {
  let state: SpeechPlayback = IDLE;
  let seq = 0;
  let timer = 0;

  const listeners = new Set<(state: SpeechPlayback) => void>();

  const stopTimer = (): void => {
    if (!timer) return;
    window.clearTimeout(timer);
    timer = 0;
  };

  const emit = (next: SpeechPlayback): void => {
    if (next.playing === state.playing && next.text === state.text && next.accent === state.accent) return;
    state = next;
    listeners.forEach((fn) => {
      try {
        fn(state);
      } catch {
        /* 单个订阅者异常不影响播放 */
      }
    });
  };

  function finish(id: number): void {
    if (id !== seq) return;
    stopTimer();
    emit(IDLE);
  }

  return {
    get: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    begin(text, accent, maxMs = DEFAULT_MAX_MS) {
      seq += 1;
      const id = seq;
      stopTimer();
      timer = window.setTimeout(() => {
        timer = 0;
        finish(id);
      }, maxMs);
      emit({ playing: true, text, accent });
      return id;
    },
    finish,
    reset() {
      seq += 1;
      stopTimer();
      emit(IDLE);
    },
    seq: () => seq,
  };
}

/**
 * 系统语音合成（speechSynthesis）的收尾兜底。
 *
 * 部分 WebView 不派发 utterance 的 onend / onerror，只靠事件会让「播放中」
 * 永久卡住。这里轮询合成器状态，确认已经不在说话就收尾。
 * 返回清理函数，调用方在停止播放时执行。
 */
export function watchSpeechSynthesisEnd(
  tracker: SpeechPlaybackTracker,
  seq: number,
  hasStarted: () => boolean,
): () => void {
  const startedAt = Date.now();
  let idle = 0;
  const timer = window.setInterval(() => {
    if (seq !== tracker.seq()) {
      window.clearInterval(timer);
      return;
    }
    let speaking = false;
    try {
      speaking = speechSynthesis.speaking || speechSynthesis.pending;
    } catch {
      /* ignore */
    }
    if (speaking) {
      idle = 0;
      return;
    }
    // 语音还在加载时 speaking 同样是 false，给足启动时间再判断
    if (!hasStarted() && Date.now() - startedAt < 3000) return;
    idle += 1;
    if (idle < 2) return;
    window.clearInterval(timer);
    tracker.finish(seq);
  }, 200);
  return () => window.clearInterval(timer);
}

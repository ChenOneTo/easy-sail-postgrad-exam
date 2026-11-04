/**
 * 「打字背单词」发音（系统 TTS）。
 *
 * 刻意不复用背单词模块的在线 TTS：本模块只需要单词朗读，系统
 * speechSynthesis 离线可用、无网络失败面，也不会与背单词的发音设置互相影响。
 *
 * 播放态（getTypingPlayback / subscribeTypingPlayback）同样独立于背单词模块：
 * 按钮据此显示播放动效，播放期间禁止重复点击。
 */
import type { TypingAccent } from './typing-vocab-db';
import { createSpeechPlayback, watchSpeechSynthesisEnd } from './speech-playback';
import type { SpeechPlayback } from './speech-playback';

interface SpeechConfig {
  enabled: boolean;
  accent: TypingAccent;
  rate: number;
}

const ACCENT_LANG: Record<TypingAccent, string> = { us: 'en-US', uk: 'en-GB' };

let _config: SpeechConfig = { enabled: true, accent: 'us', rate: 0.9 };

/** 播放态：按钮据此显示播放动效，播放期间禁止重复点击 */
const _playback = createSpeechPlayback();
/** 系统 TTS 收尾兜底的清理函数 */
let _sysWatch: (() => void) | null = null;

export function getTypingPlayback(): SpeechPlayback {
  return _playback.get();
}

export function subscribeTypingPlayback(listener: (state: SpeechPlayback) => void): () => void {
  return _playback.subscribe(listener);
}

/** 结束一次播放：代次已过期（有更新的播放）时什么都不做 */
function finish(seq: number): void {
  if (seq !== _playback.seq()) return;
  if (_sysWatch) {
    _sysWatch();
    _sysWatch = null;
  }
  _playback.finish(seq);
}

export function configureTypingSpeech(next: Partial<SpeechConfig>): void {
  _config = { ..._config, ...next };
  if (!_config.enabled) stopTypingSpeech();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined') return undefined;
  const voices = speechSynthesis.getVoices();
  const exact = lang.toLowerCase();
  return voices.find((v) => v.lang.replace('_', '-').toLowerCase() === exact)
    ?? voices.find((v) => v.lang.replace('_', '-').toLowerCase().startsWith(exact.slice(0, 2)))
    ?? voices.find((v) => /^en/i.test(v.lang));
}

/** 朗读一个单词；accent 可覆盖设置（音标旁的英/美按钮） */
export function speakTypingWord(word: string, accent?: TypingAccent): void {
  if (!_config.enabled) return;
  const text = word.trim();
  if (!text) return;
  if (typeof speechSynthesis === 'undefined') return;
  const target = accent ?? _config.accent;
  const seq = _playback.begin(text, target);
  let started = false;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = ACCENT_LANG[target];
    utterance.rate = Math.min(1.2, Math.max(0.6, _config.rate));
    const voice = pickVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    utterance.onstart = () => { started = true; };
    utterance.onend = () => finish(seq);
    utterance.onerror = () => finish(seq);
    speechSynthesis.speak(utterance);
    // onend 不派发的 WebView 由轮询兜底收尾
    if (_sysWatch) _sysWatch();
    _sysWatch = watchSpeechSynthesisEnd(_playback, seq, () => started);
  } catch {
    /* 合成不可用时静默放弃 */
    finish(seq);
  }
}

export function stopTypingSpeech(): void {
  if (_sysWatch) {
    _sysWatch();
    _sysWatch = null;
  }
  _playback.reset();
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch {
    /* ignore */
  }
}

/** 预热语音列表（部分 WebView 需触发一次 getVoices） */
export function warmupTypingSpeech(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') void speechSynthesis.getVoices();
  } catch {
    /* ignore */
  }
}

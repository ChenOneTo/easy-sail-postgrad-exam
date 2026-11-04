/**
 * 「打字背单词」发音（系统 TTS）。
 *
 * 刻意不复用背单词模块的在线 TTS：本模块只需要单词朗读，系统
 * speechSynthesis 离线可用、无网络失败面，也不会与背单词的发音设置互相影响。
 */
import type { TypingAccent } from './typing-vocab-db';

interface SpeechConfig {
  enabled: boolean;
  accent: TypingAccent;
  rate: number;
}

const ACCENT_LANG: Record<TypingAccent, string> = { us: 'en-US', uk: 'en-GB' };

let _config: SpeechConfig = { enabled: true, accent: 'us', rate: 0.9 };

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
  if (!_config.enabled || !word.trim()) return;
  if (typeof speechSynthesis === 'undefined') return;
  const target = accent ?? _config.accent;
  try {
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(word.trim());
    utterance.lang = ACCENT_LANG[target];
    utterance.rate = Math.min(1.2, Math.max(0.6, _config.rate));
    const voice = pickVoice(utterance.lang);
    if (voice) utterance.voice = voice;
    speechSynthesis.speak(utterance);
  } catch {
    /* 合成不可用时静默放弃 */
  }
}

export function stopTypingSpeech(): void {
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

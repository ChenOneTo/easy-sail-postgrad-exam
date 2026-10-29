/**
 * 背单词发音封装（零新增依赖、零 Rust 改动）。
 *
 * - 系统 TTS：WebView2（Edge Chromium）原生支持 window.speechSynthesis，离线可用。
 * - 在线真人：有道词典 dictvoice 接口（type=2 美音 / type=1 英音），联网可用。
 * - 在线播放失败（限流/断网/超时）自动回退系统 TTS，不抛错。
 *
 * 发音运行时合成，不落库；设置项按设备存于 localStorage（发音源/语速/翻面自动播）。
 */

export type TtsSource = 'system' | 'online' | 'off';

export interface VocabTtsConfig {
  source: TtsSource;
  rate: number;            // 0.7–1.2
  autoPlayOnFlip: boolean;
  accent: 1 | 2;           // 在线接口 type：1=英音 2=美音
}

const STORAGE_KEY = 'easysail-exam-vocab-tts';
const DEFAULT_CONFIG: VocabTtsConfig = {
  source: 'system',
  rate: 0.9,
  autoPlayOnFlip: true,
  accent: 2,
};

let _config: VocabTtsConfig | null = null;

function readConfig(): VocabTtsConfig {
  if (_config) return _config;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<VocabTtsConfig>;
      _config = { ...DEFAULT_CONFIG, ...parsed };
    } else {
      _config = { ...DEFAULT_CONFIG };
    }
  } catch {
    _config = { ...DEFAULT_CONFIG };
  }
  return _config;
}

export function getTtsConfig(): VocabTtsConfig {
  return { ...readConfig() };
}

export function saveTtsConfig(updates: Partial<VocabTtsConfig>): VocabTtsConfig {
  const next = { ...readConfig(), ...updates };
  _config = next;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch { /* 忽略隐私模式写入失败 */ }
  return { ...next };
}

// —— 系统 TTS ——

export type SpeakAccent = 'uk' | 'us';

const ACCENT_LANG: Record<SpeakAccent, string> = { uk: 'en-GB', us: 'en-US' };

/** 挑一个指定口音的英文语音；没有精确匹配时退回任意英文语音 */
function pickEnglishVoice(lang: string): SpeechSynthesisVoice | undefined {
  if (typeof speechSynthesis === 'undefined') return undefined;
  const voices = speechSynthesis.getVoices();
  const prefix = lang.slice(0, 2);
  return voices.find(v => v.lang.replace('_', '-').toLowerCase().startsWith(lang.toLowerCase()))
    ?? voices.find(v => v.lang.toLowerCase().startsWith(prefix))
    ?? voices.find(v => /^en/i.test(v.lang));
}

function speakSystem(word: string, rate: number, lang = 'en-US'): void {
  if (typeof speechSynthesis === 'undefined') return;
  try {
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(word);
    u.lang = lang;
    u.rate = Math.min(1.2, Math.max(0.7, rate));
    const v = pickEnglishVoice(lang);
    if (v) u.voice = v;
    speechSynthesis.speak(u);
  } catch { /* 静默：合成不可用时直接放弃 */ }
}

// —— 在线真人 ——

let _audio: HTMLAudioElement | null = null;

function speakOnline(word: string, accent: 1 | 2, fallbackRate: number): void {
  const fallbackLang = accent === 1 ? ACCENT_LANG.uk : ACCENT_LANG.us;
  try {
    if (_audio) { _audio.pause(); _audio = null; }
    const audio = new Audio(`https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(word)}&type=${accent}`);
    _audio = audio;
    // 8s 超时或加载/播放失败 → 回退系统 TTS（保持同一口音）
    const timer = setTimeout(() => {
      if (!_audio) return;
      _audio = null;
      audio.pause();
      speakSystem(word, fallbackRate, fallbackLang);
    }, 8000);
    audio.addEventListener('error', () => {
      clearTimeout(timer);
      if (_audio === audio) _audio = null;
      speakSystem(word, fallbackRate, fallbackLang);
    }, { once: true });
    audio.addEventListener('ended', () => {
      clearTimeout(timer);
      if (_audio === audio) _audio = null;
    }, { once: true });
    void audio.play().catch(() => {
      clearTimeout(timer);
      if (_audio === audio) _audio = null;
      speakSystem(word, fallbackRate, fallbackLang);
    });
  } catch {
    speakSystem(word, fallbackRate, fallbackLang);
  }
}

// —— 对外入口 ——

/** 播放单词发音（按设置选源，在线失败回退系统，关闭源则静默） */
export function speak(word: string): void {
  const cfg = readConfig();
  if (cfg.source === 'off' || !word) return;
  if (cfg.source === 'online') {
    speakOnline(word, cfg.accent, cfg.rate);
  } else {
    speakSystem(word, cfg.rate, cfg.accent === 1 ? ACCENT_LANG.uk : ACCENT_LANG.us);
  }
}

/** 指定口音播放（音标旁的「英 / 美」按钮），不受设置里的默认口音影响 */
export function speakAccent(word: string, accent: SpeakAccent): void {
  const cfg = readConfig();
  if (cfg.source === 'off' || !word) return;
  if (cfg.source === 'online') {
    speakOnline(word, accent === 'uk' ? 1 : 2, cfg.rate);
  } else {
    speakSystem(word, cfg.rate, ACCENT_LANG[accent]);
  }
}

/** 停止当前发音（切卡/卸载时调用） */
export function stopSpeak(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') speechSynthesis.cancel();
  } catch { /* ignore */ }
  if (_audio) { try { _audio.pause(); } catch { /* ignore */ } _audio = null; }
}

/** 预热：部分浏览器需触发一次 getVoices 才会异步加载语音列表 */
export function warmupTts(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') void speechSynthesis.getVoices();
  } catch { /* ignore */ }
}

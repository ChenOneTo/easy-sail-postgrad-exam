/**
 * 背单词发音封装（零新增依赖、零 Rust 改动）。
 *
 * - 系统 TTS：WebView2（Edge Chromium）原生支持 window.speechSynthesis，离线可用。
 * - 在线单词：有道词典 dictvoice（type=2 美音 / type=1 英音）；但它只对词库词条有音频，
 *   整句一律回 500，因此例句改走百度翻译 TTS（gettts），同样无需密钥。
 * - 在线播放失败（限流/断网/超时）按音源顺序换源，全部失败再回退系统 TTS，不抛错。
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

// —— 在线发音 ——

let _audio: HTMLAudioElement | null = null;
let _audioTimer = 0;

/** 停掉当前在线音频与超时计时器 */
function clearAudio(): void {
  if (_audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
  if (_audio) {
    try { _audio.pause(); } catch { /* ignore */ }
    _audio = null;
  }
}

/** 含空白即按整句处理；单词 / 连字符词走词典音源 */
function isSentence(text: string): boolean {
  return /\s/.test(text.trim());
}

/** 单词真人发音（有道词典，type 1=英音 2=美音，可区分英/美） */
function wordAudioUrl(text: string, accent: 1 | 2): string {
  return `https://dict.youdao.com/dictvoice?audio=${encodeURIComponent(text)}&type=${accent}`;
}

/**
 * 整句朗读（百度翻译 TTS）。
 *
 * 有道 dictvoice 只对其词库里的词条返回音频，任意整句都回 500
 * `returned null audio`，所以例句以前必然回退系统 TTS——表现为「例句读音
 * 不跟随联网读音设置」。百度 gettts 支持任意整句，同样无需密钥。
 * spd 取值 1–5（3≈常速），按设置的语速折算；该音源不区分英/美口音。
 */
function sentenceAudioUrl(text: string, rate: number): string {
  const spd = Math.min(5, Math.max(1, Math.round(rate * 3)));
  return `https://fanyi.baidu.com/gettts?lan=en&text=${encodeURIComponent(text)}&spd=${spd}&source=web`;
}

/**
 * 依次尝试多个在线音源：某个源加载失败 / 播放被拒 / 8s 内没出声就换下一个，
 * 全部失败才回退系统 TTS。已开始播放的音频不会被后面的源打断。
 */
function playAudioChain(urls: string[], onAllFailed: () => void): void {
  const [url, ...rest] = urls;
  if (!url) { onAllFailed(); return; }
  clearAudio();

  let audio: HTMLAudioElement;
  try {
    audio = new Audio(url);
  } catch {
    playAudioChain(rest, onAllFailed);
    return;
  }
  _audio = audio;

  let settled = false;
  const next = () => {
    if (settled) return;
    settled = true;
    clearAudio();
    playAudioChain(rest, onAllFailed);
  };
  _audioTimer = window.setTimeout(next, 8000);
  // 一旦开始出声就撤掉超时，避免长句播到一半被下一个源打断
  audio.addEventListener('playing', () => {
    if (_audio === audio && _audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
  }, { once: true });
  audio.addEventListener('error', next, { once: true });
  audio.addEventListener('ended', () => {
    if (_audioTimer) { window.clearTimeout(_audioTimer); _audioTimer = 0; }
    if (_audio === audio) _audio = null;
  }, { once: true });
  void audio.play().catch(next);
}

function speakOnline(text: string, accent: 1 | 2, rate: number): void {
  const fallbackLang = accent === 1 ? ACCENT_LANG.uk : ACCENT_LANG.us;
  // 整句只走百度（有道对整句必失败，多试一次只会拖慢回退）；单词优先有道
  const urls = isSentence(text)
    ? [sentenceAudioUrl(text, rate)]
    : [wordAudioUrl(text, accent), sentenceAudioUrl(text, rate)];
  playAudioChain(urls, () => speakSystem(text, rate, fallbackLang));
}

// —— 对外入口 ——

/** 播放发音（单词与整句通用：单词走词典音源、整句走百度 TTS；在线失败回退系统，关闭源则静默） */
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
  clearAudio();
}

/** 预热：部分浏览器需触发一次 getVoices 才会异步加载语音列表 */
export function warmupTts(): void {
  try {
    if (typeof speechSynthesis !== 'undefined') void speechSynthesis.getVoices();
  } catch { /* ignore */ }
}

/**
 * 发音播放态的 React 绑定。
 *
 * 两套发音体系（背单词 / 打字背单词）各自维护播放态，这里按体系暴露订阅 hook，
 * 供发音按钮渲染播放动效、并在播放期间禁用点击。
 */
import { useSyncExternalStore } from 'react';
import type { SpeechPlayback } from '../lib/speech-playback';
import { getSpeakPlayback, subscribeSpeakPlayback } from '../lib/vocab-tts';
import { getTypingPlayback, subscribeTypingPlayback } from '../lib/typing-vocab-speech';

function usePlayback(
  read: () => SpeechPlayback,
  subscribe: (listener: (state: SpeechPlayback) => void) => () => void,
): SpeechPlayback {
  return useSyncExternalStore(subscribe, read);
}

/** 背单词 / 单词闯关的播放态 */
export function useVocabPlayback(): SpeechPlayback {
  return usePlayback(getSpeakPlayback, subscribeSpeakPlayback);
}

/** 打字背单词的播放态 */
export function useTypingPlayback(): SpeechPlayback {
  return usePlayback(getTypingPlayback, subscribeTypingPlayback);
}

/** 该文本（可限定口音）是否正在朗读 */
export function isSpeaking(state: SpeechPlayback, text: string, accent?: 'uk' | 'us'): boolean {
  if (!state.playing) return false;
  if (state.text.trim() !== text.trim()) return false;
  return accent ? state.accent === accent : true;
}

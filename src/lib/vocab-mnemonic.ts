/**
 * 单词 AI 助记生成（非 Hook 版）。
 *
 * 与 VocabMnemonicSheet 复用同一套提示词/校验，但可在 store 的后台预生成里直接调用。
 * 已生成的助记由调用方写入 exam_vocab_mnemonics，后续按 word_id 直接读库。
 */
import { canUseAi, chatCompletion } from './ai';
import { buildVocabMnemonicPrompt } from './prompts';
import { normalizeMnemonicDraft, parseAiJson, type AiMnemonicDraft } from './ai-json';

/** 当前环境是否允许调用 AI（开关 + 模型配置） */
export function canGenerateMnemonic(): boolean {
  return canUseAi();
}

/**
 * 生成一条 AI 助记；未开启 AI 时返回 null。
 * 网络/解析失败会抛出，由调用方决定降级为「重试」按钮。
 */
export async function generateVocabMnemonic(
  word: string,
  meaning: string,
  signal?: AbortSignal,
): Promise<AiMnemonicDraft | null> {
  if (!canUseAi()) return null;
  const content = await chatCompletion([
    { role: 'system', content: '你只输出可解析 JSON。' },
    { role: 'user', content: buildVocabMnemonicPrompt(word, meaning) },
  ], { signal, temperature: 0.6 });
  return normalizeMnemonicDraft(parseAiJson(content));
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { canUseAi, chatCompletion } from '../lib/ai';
import {
  buildBreakdownPrompt,
  buildCompleteNotesPrompt,
  buildAiChatPrompt,
  buildClassifyTasksPrompt,
  buildExamPlanPrompt,
  buildPolishNotesPrompt,
  buildQuickAddPrompt,
  buildVocabMnemonicPrompt,
} from '../lib/prompts';
import {
  normalizeAiBreakdownDraft,
  normalizeAiChatDraft,
  normalizeAiClassifyDraft,
  normalizeAiTaskDraft,
  normalizeExamPlanDraft,
  normalizeMnemonicDraft,
  parseAiJson,
  type AiBreakdownDraft,
  type AiChatDraft,
  type AiClassifyDraft,
  type AiExamPlanDraft,
  type AiMnemonicDraft,
  type AiTaskDraft,
} from '../lib/ai-json';
import type { Task } from '../lib/types';

type AiStatus = 'idle' | 'loading' | 'error';

export function useAiTask() {
  const [status, setStatus] = useState<AiStatus>('idle');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const abort = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => abort, [abort]);

  const run = useCallback(async <T,>(work: (signal: AbortSignal) => Promise<T>): Promise<T | null> => {
    if (!canUseAi()) {
      setError('AI 未开启或未配置');
      setStatus('error');
      return null;
    }

    abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = requestRef.current + 1;
    requestRef.current = requestId;
    setStatus('loading');
    setError('');

    try {
      const result = await work(controller.signal);
      if (requestRef.current !== requestId) return null;
      setStatus('idle');
      return result;
    } catch (err) {
      if (controller.signal.aborted) return null;
      const message = err instanceof Error ? err.message : 'AI 调用失败';
      if (requestRef.current === requestId) {
        setError(message);
        setStatus('error');
      }
      return null;
    }
  }, [abort]);

  const parseQuickAdd = useCallback((input: string, currentProjectId: string): Promise<AiTaskDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildQuickAddPrompt(input, currentProjectId) },
      ], { signal, temperature: 0.2 });
      return normalizeAiTaskDraft(parseAiJson(content));
    });
  }, [run]);

  const polishNotes = useCallback((task: Task): Promise<string | null> => {
    return run(async signal => chatCompletion([
      { role: 'system', content: '你只输出用户可直接使用的 Markdown 正文。' },
      { role: 'user', content: buildPolishNotesPrompt(task) },
    ], { signal, temperature: 0.4 }));
  }, [run]);

  const completeNotes = useCallback((task: Task): Promise<string | null> => {
    return run(async signal => chatCompletion([
      { role: 'system', content: '你只输出用户可直接使用的 Markdown 正文。' },
      { role: 'user', content: buildCompleteNotesPrompt(task) },
    ], { signal, temperature: 0.5 }));
  }, [run]);

  const breakdownTask = useCallback((task: Task): Promise<AiBreakdownDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildBreakdownPrompt(task) },
      ], { signal, temperature: 0.3 });
      return normalizeAiBreakdownDraft(parseAiJson(content), task.projectId);
    });
  }, [run]);

  const chatWithTasks = useCallback((
    message: string,
    tasks: Task[],
    currentProjectId: string,
    currentTask?: Task | null
  ): Promise<AiChatDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildAiChatPrompt(message, tasks, currentProjectId, currentTask) },
      ], { signal, temperature: 0.4 });
      return normalizeAiChatDraft(parseAiJson(content));
    });
  }, [run]);

  const classifyTasks = useCallback((tasks: Task[]): Promise<AiClassifyDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildClassifyTasksPrompt(tasks) },
      ], { signal, temperature: 0.2 });
      return normalizeAiClassifyDraft(parseAiJson(content), tasks.map(task => task.id));
    });
  }, [run]);

  /** 考研周计划生成：需求 → 未来 7 天任务草稿列表 */
  const generateExamPlan = useCallback((subjectName: string, requirement: string, examDate: string | null): Promise<AiExamPlanDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildExamPlanPrompt(subjectName, requirement, examDate) },
      ], { signal, temperature: 0.5 });
      return normalizeExamPlanDraft(parseAiJson(content));
    });
  }, [run]);

  /** 考研单词 AI 助记：词根拆解 + 联想口诀 + 例句 */
  const generateMnemonic = useCallback((word: string, meaning: string): Promise<AiMnemonicDraft | null> => {
    return run(async signal => {
      const content = await chatCompletion([
        { role: 'system', content: '你只输出可解析 JSON。' },
        { role: 'user', content: buildVocabMnemonicPrompt(word, meaning) },
      ], { signal, temperature: 0.6 });
      return normalizeMnemonicDraft(parseAiJson(content));
    });
  }, [run]);

  return {
    status,
    loading: status === 'loading',
    error,
    abort,
    parseQuickAdd,
    polishNotes,
    completeNotes,
    breakdownTask,
    chatWithTasks,
    classifyTasks,
    generateExamPlan,
    generateMnemonic,
  };
}

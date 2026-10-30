import type { Task } from './types';
import { localDateStr } from './utils';

export const PROJECT_IDS = ['project-work', 'project-study', 'project-life'] as const;
export const TAG_IDS = ['tag-urgent', 'tag-important'] as const;
export const KANBAN_IDS = ['todo', 'doing', 'done'] as const;

export type ProjectId = typeof PROJECT_IDS[number];
export type TagId = typeof TAG_IDS[number];
export type KanbanId = typeof KANBAN_IDS[number];

const TIME_KEYWORDS = [
  '今天', '明天', '后天', '大后天', '本周', '下周', '下个月',
  '周一', '周二', '周三', '周四', '周五', '周六', '周日',
  '上午', '下午', '晚上', '中午', '今晚', '明早',
];

const PRIORITY_KEYWORDS = ['紧急', '重要', '尽快', '马上', 'ASAP', 'asap'];

const ACTION_KEYWORDS = [
  '开会', '会议', '汇报', '报告', '文档', '邮件', '代码', '审查',
  '学习', '阅读', '练习', '课程', '作业', '预约', '取快递',
];

export function shouldTriggerAiParse(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 6) return false;
  return [...TIME_KEYWORDS, ...PRIORITY_KEYWORDS, ...ACTION_KEYWORDS]
    .some(keyword => normalized.includes(keyword));
}

function todayStr(): string {
  return localDateStr();
}

export function buildQuickAddPrompt(input: string, currentProjectId: string): string {
  return [
    '你是一个任务解析器。请把用户输入解析成一个 JSON 对象，不要输出 Markdown，不要解释。',
    `当前日期：${todayStr()}`,
    `当前默认任务类型：${currentProjectId}`,
    '只能返回这些字段：title, dueDate, dueTimeText, reminderAt, recurrence, projectId, tags, notes。',
    'dueDate 只能是 YYYY-MM-DD 或 null。',
    '如果用户提到具体时间（如”下午3点”、”15:30”），请计算并设置 reminderAt 为 ISO 日期时间格式（YYYY-MM-DDTHH:mm:ss）。',
    '如果用户提到重复（如”每天”、”每周一”、”每月”），请设置 recurrence 为 {“type”:”daily”} 或 {“type”:”weekly”} 或 {“type”:”monthly”} 或 {“type”:”yearly”}。',
    'projectId 只能是 project-work、project-study、project-life 或 null。',
    'tags 只能包含 tag-urgent、tag-important。不要返回”会议”等系统不认识的标签。',
    'title 必须简洁，去掉时间和紧急程度等修饰后仍表达任务动作。',
    `用户输入：${input}`,
  ].join('\n');
}

export function buildPolishNotesPrompt(task: Task): string {
  return [
    '你是任务备注编辑助手。请润色下面的备注，优化排版、语法和措辞，不要改变事实。',
    '只输出润色后的 Markdown 文本，不要解释。',
    `任务标题：${task.title}`,
    `备注：\n${task.notes}`,
  ].join('\n');
}

export function buildCompleteNotesPrompt(task: Task): string {
  return [
    '你是任务备注助手。请根据任务信息生成简洁、可执行的 Markdown 备注。',
    '只输出备注正文，不要解释。',
    `任务标题：${task.title}`,
    `任务类型：${task.projectId}`,
    `截止日期：${task.dueDate ?? '未设置'}`,
    `标签：${task.tags.join(', ') || '无'}`,
  ].join('\n');
}

export function buildBreakdownPrompt(task: Task): string {
  return [
    '你是任务拆解助手。请把当前任务拆解为最多 8 个可执行子任务。',
    '只返回 JSON，不要输出 Markdown，不要解释。',
    'JSON schema: {"subtasks":[{"title":"string","notes":"string","dueDate":"YYYY-MM-DD|null","projectId":"project-work|project-study|project-life","tags":["tag-urgent"|"tag-important"]}]}',
    `当前日期：${todayStr()}`,
    `父任务标题：${task.title}`,
    `父任务备注：${task.notes || '无'}`,
    `父任务类型：${task.projectId}`,
    `父任务截止日期：${task.dueDate ?? '未设置'}`,
  ].join('\n');
}

function compactTask(task: Task): string {
  return [
    `id:${task.id}`,
    `title:${task.title}`,
    `project:${task.projectId}`,
    `due:${task.dueDate ?? '无'}`,
    `completed:${task.completed ? '是' : '否'}`,
    `completedAt:${task.completedAt ?? '无'}`,
    `tags:${task.tags.join(',') || '无'}`,
    `notes:${task.notes ? task.notes.slice(0, 120) : '无'}`,
  ].join(' | ');
}

export function buildAiChatPrompt(
  message: string,
  tasks: Task[],
  currentProjectId: string,
  currentTask?: Task | null
): string {
  const visibleTasks = tasks
    .filter(task => !task.completed)
    .sort((a, b) => (a.dueDate ?? '9999-99-99').localeCompare(b.dueDate ?? '9999-99-99'))
    .slice(0, 40);

  return [
    '你是「轻舟考研台」的任务助手。你可以回答用户关于任务的问题、自动判断用户是否在记录一条任务，也可以为已有任务生成修改建议。',
    '只返回 JSON，不要输出 Markdown code block，不要解释 JSON 之外的内容。',
    'JSON schema: {“reply”:”string”,”taskDraft”:null|{“title”:”string”,”dueDate”:”YYYY-MM-DD|null”,”dueTimeText”:”string|null”,”reminderAt”:”YYYY-MM-DDTHH:mm:ss|null”,”recurrence”:null|{“type”:”daily|weekly|monthly|yearly”,”interval”:1,”endDate”:”YYYY-MM-DD|null”},”projectId”:”project-work|project-study|project-life|null”,”tags”:[“tag-urgent”|”tag-important”],”notes”:”string”},”taskPatch”:null|{“taskId”:123,”title”:”string”,”notes”:”string”,”dueDate”:”YYYY-MM-DD|null”,”projectId”:”project-work|project-study|project-life”,”tags”:[“tag-urgent”|”tag-important”],”starred”:true,”completed”:true,”kanban”:”todo|doing|done”,”reason”:”string”}}',
    '如果用户提到具体时间（如”下午3点”、”明天9点”），请在 taskDraft 中设置 reminderAt 为 ISO 日期时间。',
    '如果用户提到重复（如”每天”、”每周”、”每月”），请设置 recurrence。',
    '如果用户的语义是在记录、安排、提醒、待办、计划或委托一件事情，即使没有说”创建任务”，也应返回 taskDraft。',
    '如果用户明确要求修改已有任务，返回 taskPatch，taskDraft 必须是 null。',
    'taskPatch.taskId 必须来自输入任务数据；只能包含用户要求修改的字段，不要顺手改无关字段。',
    '如果存在“当前任务上下文”，且用户说“这个任务”“它”“当前任务”，默认指向该任务。',
    '如果用户是在询问、闲聊、总结、排序或解释，taskDraft 和 taskPatch 都必须是 null。',
    '当返回 taskDraft 时，reply 要简短说明将记录该任务；不要声称已经完成创建，应用会自动创建。',
    '当返回 taskPatch 时，reply 要简短说明修改建议；不要声称已经修改，应用会要求用户确认。',
    '回答任务情况时只能基于输入任务数据，不要编造。',
    `当前日期：${todayStr()}`,
    `当前默认任务类型：${currentProjectId}`,
    `当前任务上下文：${currentTask ? compactTask(currentTask) : '无'}`,
    '任务数据：',
    ...visibleTasks.map(compactTask),
    `用户消息：${message}`,
  ].join('\n');
}

export function buildClassifyTasksPrompt(tasks: Task[]): string {
  return [
    '你是任务归类助手。请根据任务标题、备注、截止日期，为任务建议类型和标签。',
    '只返回 JSON，不要输出 Markdown，不要解释。',
    'JSON schema: {"suggestions":[{"taskId":123,"projectId":"project-work|project-study|project-life|null","tags":["tag-urgent"|"tag-important"],"reason":"string"}]}',
    'projectId 只能是 project-work、project-study、project-life 或 null。',
    'tags 只能包含 tag-urgent、tag-important。不要输出其他标签。',
    '没有把握时 projectId 返回 null，tags 返回空数组。',
    '只返回确实有价值的建议，不要为了填满而输出。',
    `当前日期：${todayStr()}`,
    '任务数据：',
    ...tasks.slice(0, 30).map(compactTask),
  ].join('\n');
}

/** 考研周计划生成（独立于主对话 schema） */
export function buildExamPlanPrompt(subjectName: string, requirement: string, examDate: string | null): string {
  return [
    '你是在职考研学习规划助手。请根据用户需求，为该科目生成未来一周的学习任务清单。',
    '只返回 JSON，不要输出 Markdown code block，不要解释 JSON 之外的内容。',
    'JSON schema: {"plans":[{"title":"string(40字以内,具体可执行)","notes":"string(安排细节/资料/验收标准)","planDate":"YYYY-MM-DD|null"}]}',
    `科目：${subjectName}`,
    examDate ? `考试日期：${examDate}，请结合剩余时间安排节奏。` : '',
    `今天日期：${todayStr()}；planDate 只能取今天起未来 7 天内的日期。`,
    '生成 3~10 个任务：标题包含数量或时长（如"背单词 List1-2（100个）"）；大任务拆到天；每天重复类内容（如背单词）按天各建一条。',
    `用户需求：${requirement.trim().slice(0, 300)}`,
  ].filter(Boolean).join('\n');
}

/** 考研单词 AI 助记：词根/谐音拆解 + 生动画面 + 例句 */
export function buildVocabMnemonicPrompt(word: string, meaning: string): string {
  return [
    '你是考研英语助记专家，擅长把单词变成夸张、具体、有画面的联想，让考生过目不忘。',
    '只返回 JSON，不要输出 Markdown code block，不要解释 JSON 之外的内容。',
    'JSON schema: {"method":"string(记忆法类型:谐音/词根/拆分/画面/故事,10字内)","mnemonic":"string(词根拆解或谐音口诀,80字内)","scene":"string(一个生动、夸张、具体的画面或小故事,必须出现该单词或其读音,120字内)","roots":"string(核心词根/词缀及其含义,40字内)","sentence":"string(一句考研语境例句,含该词,120字内)","sentenceZh":"string(sentence的中文翻译,60字内)"}',
    `单词：${word}`,
    `释义：${meaning.trim().slice(0, 120)}`,
    '要求：',
    '1. method 选最贴合这个词的一种记忆法；',
    '2. mnemonic 给词根拆解、构词法或谐音口诀，要短、可复述；',
    '3. scene 是关键：写成一个有动作、有场景、有情绪甚至荒诞感的脑内小剧场，像一幅能记住的漫画，不要写成抽象解释；',
    '4. scene 必须出现该单词或其读音/拼写片段，帮助音形义绑定；',
    '5. roots 列出可复用的词根词缀；sentence 用考研阅读常见语境造一句自然例句；sentenceZh 是准确中文翻译；',
    '6. 内容积极健康，不要低俗、暴力、歧视或政治敏感内容。',
  ].join('\n');
}


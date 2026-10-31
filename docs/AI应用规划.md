# 轻舟AI考研 大模型应用规划

> 版本：v1.2
> 更新日期：2026-06-18
> 状态：已收敛为可实施规格，优先交付阶段一 MVP

---

## 一、项目背景

轻舟AI考研是一个基于 **Tauri + React + TypeScript** 的桌面任务管理应用，目前已具备任务管理（任务/项目/看板/标签/星标/截止日期/排序）等基础能力，并已集成 AI 配置系统（`src/lib/ai.ts`），支持 OpenAI 兼容协议的多模型接入（DeepSeek / 智谱 / 通义等），但尚未接入业务场景。

本规划旨在将大模型能力融入轻舟AI考研的日常使用流程，提升用户在"建任务、理任务、做任务、复盘任务"四个环节的效率。当前版本先以阶段一 MVP 为开发基线，阶段二、三保留方向但不一次性纳入首轮交付。

## 二、当前实现约束

AI 业务功能必须先对齐现有数据模型，避免规划字段与代码字段不一致导致实现返工。

### 现有 `Task` 数据结构

当前任务类型定义位于 `src/lib/types.ts`：

```typescript
export interface Task {
  id: number;
  title: string;
  notes: string;
  projectId: string;
  kanban: 'todo' | 'doing' | 'done';
  starred: boolean;
  completed: boolean;
  completedAt: string | null;
  dueDate: string | null;
  tags: string[];
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}
```

### 需要特别处理的差异

| 规划能力 | 当前约束 | v1.2 处理方式 |
|------|------|------|
| 具体时间，如"明天下午 3 点" | `dueDate` 目前只保存 `YYYY-MM-DD` | MVP 只保存日期；时间可进入 `notes`，后续如需准确提醒再新增 `dueTime` |
| `priority` 字段 | 当前 `Task` 无该字段 | 不新增字段；"紧急/重要"映射到现有标签 |
| 任意自然语言标签，如"会议" | 当前标签体系只有 `tag-urgent`、`tag-important` | MVP 只输出白名单标签；"会议"等暂不写入 `tags` |
| `type` 字段 | 当前无 `type` 字段 | 不返回 `type`；任务类型使用现有 `projectId` |
| `projectId` 值域 | 仅支持 `project-work`、`project-study`、`project-life` | AI 只能在这三个值中选择，无法判断时使用当前 QuickAdd 选中类型 |
| 创建完整任务 | `addTask(title, projectId?, dueDate?)` 不能写入 notes/tags | 阶段一需要新增 `createTask(input)` 或扩展 store API |

## 三、设计原则

| 原则 | 说明 |
|------|------|
| 优雅降级 | AI 未配置、被关闭、调用失败或返回异常时，所有原有功能正常可用 |
| 用户确认 | QuickAdd、拆解、排序、备注等结构化变更必须先展示预览；AI 对话助手按用户最新决策可自动记录新任务 |
| 成本可控 | 自动触发必须有 debounce、最小输入长度、关键词预判和请求取消 |
| Prompt 集中管理 | 所有 System Prompt 统一在 `src/lib/prompts.ts` 维护 |
| 结构化输出 | AI 返回 JSON，前端按 schema 解析、清洗、白名单过滤后渲染预览 |
| 不打扰原则 | AI 结果异步展示，不抢焦点，不阻塞输入，不覆盖用户后续输入 |
| 最小权限数据 | 只发送完成当前任务所需的字段，不发送无关历史数据 |

## 四、阶段一 MVP 范围

阶段一先交付三个能力：

| 场景 | 名称 | 触发方式 | 首轮是否交付 |
|------|------|------|----------|
| ① | 自然语言快速建任务 | 自动判断触发 | 是 |
| ② | 任务智能拆解 | 手动按钮 | 是 |
| ③ | 备注 AI 润色/补全 | 手动按钮 | 是 |

阶段二、三暂作为后续版本：

| 场景 | 名称 | 原因 |
|------|------|------|
| ④ 每日任务总结复盘 | 需要更完整的上下文摘要与展示面板 |
| ⑤ 智能优先级建议 | 涉及排序写入与用户确认流程，放在基础能力稳定后 |
| ⑥ AI 对话助手 | 需要上下文注入、会话状态和工具式动作设计 |
| ⑦ 智能标签/类型自动归类 | 当前标签体系过窄，建议先扩展标签模型后再做 |

## 五、架构分层

```text
组件层 (QuickAdd / DetailPanel / AiButton)
   ↓ 调用
AI Hooks 层 (useAiTask)
   ↓ 组装业务输入、管理 loading/error/abort
Prompt 模板层 (prompts.ts)
   ↓ 生成 System Prompt + User Prompt
结构化解析层 (ai-json.ts)
   ↓ parse / validate / normalize
核心层 (ai.ts → chatCompletion)
   ↓ HTTP
OpenAI 兼容 API
```

### 新增文件清单

| 文件 | 职责 |
|------|------|
| `src/lib/prompts.ts` | 管理 prompt、关键词预判、字段白名单说明 |
| `src/lib/ai-json.ts` | 从模型文本中提取 JSON、校验 schema、清洗非法字段 |
| `src/hooks/useAiTask.ts` | 封装业务级 AI 调用，管理 loading/error/abort/requestId |
| `src/components/AiButton.tsx` | 可复用 AI 触发按钮，支持 loading、disabled、tooltip |

### 修改文件清单

| 文件 | 改造内容 |
|------|----------|
| `src/lib/ai.ts` | 可选增加 `temperature`、`signal`、超时控制；保留现有多模型配置 |
| `src/stores/task-store.ts` | 新增 `createTask(input)` 或扩展任务创建能力 |
| `src/components/SettingsModal.tsx` | 提前增加全局 AI 开关；未开启时所有 AI 入口置灰 |
| `src/components/QuickAdd.tsx` | 接入 AI 解析预览条 |
| `src/components/DetailPanel.tsx` | 增加 AI 拆解、备注润色、备注补全 |

## 六、基础设施规格

### 1. 全局 AI 开关

除现有模型配置外，需要新增应用级开关：

```typescript
const AI_ENABLED_KEY = 'easysail-exam-enabled';
```

规则：

- 默认关闭或默认沿用现有配置状态，需在 Settings 中明确展示。
- `isAiConfigured()` 只表示模型可用，不等于用户允许业务功能调用 AI。
- 业务入口需要同时满足 `isAiEnabled()` 和 `isAiConfigured()`。
- 未启用时入口置灰并提示"在设置中开启 AI 功能"。

### 2. 完整任务创建 API

阶段一需要新增或扩展任务创建方法，避免 AI 结果只能写入 title/project/dueDate。

建议新增：

```typescript
export interface CreateTaskInput {
  title: string;
  notes?: string;
  projectId?: 'project-work' | 'project-study' | 'project-life';
  dueDate?: string | null;
  tags?: string[];
  starred?: boolean;
}
```

写入规则：

- `title` 为空时禁止创建。
- `projectId` 非白名单时使用当前选中的任务类型。
- `dueDate` 只接受 `YYYY-MM-DD` 或 `null`。
- `tags` 只接受 `tag-urgent`、`tag-important`。
- `notes` 默认为空字符串。

### 3. 结构化 JSON 解析

新增 `parseAiJson<T>()`，职责包括：

- 支持模型返回纯 JSON 或 Markdown code block。
- 解析失败时返回明确错误，不写入数据。
- 对字段做白名单过滤，丢弃未知字段。
- 对日期、项目、标签做 normalize。
- 解析结果只进入预览，不直接调用 store 写入。

### 4. 请求取消与过期结果丢弃

所有自动触发请求必须满足：

- 新输入产生时取消上一请求。
- 每次请求记录 `requestId`。
- 只有最后一次请求可以更新预览状态。
- 组件卸载时 abort 正在进行的请求。
- AI 请求失败不清空用户输入，不弹阻塞式错误。

## 七、场景①：自然语言快速建任务

### 目标

用户在 `QuickAdd` 输入自然语言后，系统判断是否值得调用 AI。若命中触发条件，则在输入框下方展示一个可确认的结构化预览。用户确认后，任务才写入 store。

### 触发条件

同时满足以下条件才调用 AI：

1. AI 功能已开启且模型已配置。
2. 输入文本 trim 后长度不少于 6 个字符。
3. 输入停止 800ms 后仍未变化。
4. 命中至少一个高置信关键词组。
5. 当前输入文本与最近一次成功解析文本不同。

### 关键词预判

避免使用过于宽泛的单字词，如"日""分""洗"。建议按关键词组打分：

```typescript
const TIME_KEYWORDS = [
  '今天', '明天', '后天', '大后天', '本周', '下周', '下个月',
  '周一', '周二', '周三', '周四', '周五', '周六', '周日',
  '上午', '下午', '晚上', '中午', '今晚', '明早'
];

const PRIORITY_KEYWORDS = ['紧急', '重要', '尽快', '马上', 'ASAP', 'asap'];

const ACTION_KEYWORDS = [
  '开会', '会议', '汇报', '报告', '文档', '邮件', '代码', '审查',
  '学习', '阅读', '练习', '课程', '作业', '预约', '取快递'
];

export function shouldTriggerAiParse(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 6) return false;
  return [...TIME_KEYWORDS, ...PRIORITY_KEYWORDS, ...ACTION_KEYWORDS]
    .some(keyword => normalized.includes(keyword));
}
```

### AI 返回 schema

阶段一只允许返回现有模型可承接的字段：

```json
{
  "title": "和产品开会讨论 v2 需求",
  "dueDate": "2026-06-19",
  "dueTimeText": "15:00",
  "projectId": "project-work",
  "tags": ["tag-important"],
  "notes": "原始时间：明天下午 3 点"
}
```

字段规则：

| 字段 | 类型 | 规则 |
|------|------|------|
| `title` | string | 必填，去掉时间、优先级等修饰词后仍需表达任务动作 |
| `dueDate` | string/null | 只能是 `YYYY-MM-DD`；无法判断则为 `null` |
| `dueTimeText` | string/null | 仅用于预览和 notes，不写入 `Task.dueDate` |
| `projectId` | string/null | 只能是 `project-work`、`project-study`、`project-life`、`null` |
| `tags` | string[] | 只能包含 `tag-urgent`、`tag-important` |
| `notes` | string | 可选；用于保留时间、上下文或模型解释，不要过长 |

### 交互流程

1. 用户在 `QuickAdd` 输入"明天下午 3 点和产品开会讨论 v2 需求"。
2. 800ms 无输入后，前端执行关键词预判。
3. 命中后调用 AI，并传入当前日期、当前选中的任务类型和允许字段说明。
4. AI 返回 JSON 后，前端解析并清洗字段。
5. 输入框下方展示预览：
   - 标题：和产品开会讨论 v2 需求
   - 日期：2026-06-19
   - 时间：15:00（将写入备注）
   - 类型：工作
   - 标签：重要
6. 用户可以确认、取消或继续编辑。
7. 用户确认后调用 `createTask()` 写入。

### 验收标准

- 未开启或未配置 AI 时，原有 Enter 添加任务逻辑完全不变。
- 输入变化时旧请求会被取消或忽略，不展示过期预览。
- AI 返回非法 JSON 时，不影响输入，不创建任务。
- 预览确认前不会写入 store。
- `dueDate` 写入值必须是 `YYYY-MM-DD` 或 `null`。
- `tags` 不会出现当前系统不认识的标签。

## 八、场景②：任务智能拆解

### 目标

在 `DetailPanel` 中提供"AI 拆解"按钮，将当前任务拆分为多个可执行任务。首轮不新增真实父子任务模型，拆出的任务作为普通任务创建，并在备注中保留来源说明。

### AI 返回 schema

```json
{
  "subtasks": [
    {
      "title": "梳理 v2 需求清单",
      "notes": "来源任务：和产品开会讨论 v2 需求",
      "dueDate": null,
      "projectId": "project-work",
      "tags": []
    }
  ]
}
```

字段规则：

- `subtasks` 最多 8 条。
- 每条 `title` 必填，长度建议 4-60 字。
- `projectId` 非法时继承父任务。
- `dueDate` 非法时置为 `null`。
- `tags` 只接受白名单标签。

### 交互流程

1. 用户打开任务详情。
2. 点击"AI 拆解"。
3. 系统传入当前任务标题、备注、项目、截止日期。
4. AI 返回子任务列表。
5. 弹出或内嵌展示可编辑预览列表。
6. 用户确认后批量调用 `createTask()`。

### 验收标准

- 按钮只在 AI 开启且已配置时可用。
- AI 失败不会修改原任务。
- 用户确认前不会创建任何子任务。
- 创建出的子任务继承父任务项目，除非 AI 明确返回合法项目。
- 不把技术性父任务 id 强塞进用户备注；只保留可读来源说明。

## 九、场景③：备注 AI 润色/补全

### 目标

在 `DetailPanel` 备注区提供两个手动 AI 操作：

- 润色：优化已有备注的语法、排版、措辞，不改变事实。
- 补全：根据任务标题、项目、标签、截止日期生成建议性备注。

### 返回格式

此场景返回纯 Markdown 文本，不走 JSON。前端仍需做长度限制和用户确认。

### 交互规则

- "润色"仅在 notes 非空时可用。
- "补全"可在 notes 为空时使用。
- AI 返回后先展示预览，用户选择"替换备注"或"追加到备注"。
- 最大输入上下文限制在当前任务字段，不发送全部任务列表。

### 验收标准

- AI 结果不会自动覆盖备注。
- 用户正在编辑备注时，AI 返回结果不会抢占光标或直接写入。
- 失败时保留原备注内容。
- 返回文本过长时截断或提示用户确认。

## 十、阶段二后续方向

### 场景④：每日任务总结复盘

后续在 `Sidebar` 或 `TopBar` 增加"今日总结"入口，汇总今日完成、今日到期未完成、明日建议优先项。

实施前需要补充：

- 今日的定义是否使用本地时区。
- completedAt 与 dueDate 的统计口径。
- 总结结果展示为弹窗、侧栏还是临时面板。
- 是否允许复制 Markdown 总结。

### 场景⑤：智能优先级建议

后续在 `ListView` 提供"AI 排序建议"。AI 只输出建议顺序和理由，用户确认后再更新 `sortOrder`。

实施前需要补充：

- 当前列表过滤条件如何传给 AI。
- 已完成任务是否参与排序。
- 应用排序是否只影响当前视图内任务。
- 排序失败或取消时如何恢复。

## 十一、阶段三后续方向

### 场景⑥：AI 对话助手

在 `App.tsx` 右下角挂载 `AiChat`。该能力不应只是聊天窗口，需要明确可执行动作边界：

- 查询任务：只读当前任务摘要。
- 创建任务：由 AI 根据语义判断是否为任务记录意图；判断为任务时自动调用 `createTask()`，不再要求用户二次确认。
- 修改任务：仍必须走预览确认。
- 自由对话：不写入任何数据。

自动记录任务的约束：

- AI 只能创建新任务，不能修改或删除已有任务。
- 自动创建仅使用白名单字段：`title`、`dueDate`、`projectId`、`tags`、`notes`。
- 无法判断为任务记录意图时，`taskDraft` 必须为 `null`。
- 创建完成后必须在对话中明确告知用户已记录的任务标题。
- 若当前打开了任务详情，AI 对话中的"这个任务/当前任务"默认指向该任务，供修改建议优先使用。

### 场景⑦：智能标签/类型自动归类

当前标签体系较窄，不建议立即做历史任务批量打标。更合理的前置工作是先决定是否支持自定义标签。

后续可选方案：

- 维持固定标签：AI 只能返回 `tag-urgent`、`tag-important`。
- 扩展自定义标签：新增标签表、标签颜色、标签管理 UI，再允许 AI 推荐新标签。

## 十二、实施计划

| 步骤 | 内容 | 涉及文件 | 阶段 |
|------|------|----------|------|
| Step 1 | AI 开关、结构化解析、prompt 基础设施 | `ai.ts` / `prompts.ts` / `ai-json.ts` / `SettingsModal.tsx` | 一 |
| Step 2 | 扩展任务创建 API | `task-store.ts` / `db.ts`（如需） | 一 |
| Step 3 | QuickAdd AI 解析预览 | `QuickAdd.tsx` | 一 |
| Step 4 | 通用 AI 按钮与状态 | `AiButton.tsx` / 样式文件 | 一 |
| Step 5 | DetailPanel 备注润色/补全 | `DetailPanel.tsx` / `useAiTask.ts` | 一 |
| Step 6 | DetailPanel 任务拆解 | `DetailPanel.tsx` / `task-store.ts` | 一 |
| Step 7 | 每日总结 | `Sidebar.tsx` 或 `TopBar.tsx` | 二 |
| Step 8 | 智能排序建议 | `ListView.tsx` | 二 |
| Step 9 | AI 对话助手 | `AiChat.tsx` / `App.tsx` | 三 |
| Step 10 | 标签体系扩展与智能归类 | `types.ts` / store / Settings | 三 |

## 十三、决策记录

| 日期 | 决策项 | 选择 | 说明 |
|------|--------|------|------|
| 2026-06-17 | 实施范围 | 原计划覆盖 7 个场景 | 作为完整愿景保留 |
| 2026-06-17 | 自然语言建任务交互方式 | 自动判断触发 | 使用关键词预判 + debounce + 配置检测 |
| 2026-06-18 | 首轮交付范围 | 阶段一 MVP | 先完成建任务、拆任务、备注处理 |
| 2026-06-18 | 时间字段处理 | MVP 只写日期 | 现有 `Task.dueDate` 不支持具体时间 |
| 2026-06-18 | 标签处理 | 只写现有白名单标签 | 避免 AI 生成系统不认识的标签 |
| 2026-06-18 | AI 开关位置 | 提前到基础设施 | 所有业务入口统一依赖开关状态 |
| 2026-06-18 | AI 对话助手建任务 | 自动创建 | 根据用户要求，对话助手自行判断任务记录意图并自动写入新任务 |
| 2026-06-18 | AI 对话助手修改任务上下文 | 优先使用当前详情任务 | 打开详情面板时，对话中的"这个任务"默认锚定当前任务 |

## 十四、风险与对策

| 风险 | 对策 |
|------|------|
| AI 接口延迟影响输入体验 | debounce、AbortController、过期结果丢弃、异步预览 |
| 模型返回非 JSON | `parseAiJson()`、schema 校验、失败降级、不写入数据 |
| 用户未配置或未开启 AI | 入口置灰并引导设置，普通任务流程不受影响 |
| Token 成本不可控 | 自动场景只传当前输入；批量场景必须手动触发 |
| 隐私风险 | 仅发送当前操作所需字段，不发送完整任务库 |
| 数据模型不匹配 | AI 输出字段严格白名单，无法承接的能力进入后续数据迁移 |
| 自动触发误判频繁 | 最小长度、高置信关键词、缓存同文本结果、可关闭 AI 自动解析 |
| 用户误接受错误结果 | 所有结构化变更必须先预览、可编辑、可取消 |

---

> 本文档为 AI 功能开发基线。实施过程中如遇数据模型、交互或范围调整，需要更新版本号，并在"决策记录"中补充原因与影响。

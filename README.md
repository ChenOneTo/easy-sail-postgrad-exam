# Easy Sail Exam - 轻舟考研台

一款基于 **Tauri + React + TypeScript** 构建的桌面效率应用。以任务管理为核心，
集成灵感记录、AI 助手、考研计划与背单词等模块。

> 面向 AI 编码助手的项目约定与已知陷阱见 **[AGENTS.md](./AGENTS.md)**。

---

## 功能特性

- **任务管理** — 创建/编辑/删除/完成，支持截止日期、开始日期、备注、标签
- **双视图** — 日历视图与看板视图，看板支持 `@dnd-kit` 拖拽排序
- **提醒通知** — 单次与重复提醒、稍后提醒，系统通知 + 通知中心历史
- **灵感记录** — 一句话速记，AI 提炼标题、润色扩写、生成标签
- **AI 助手** — 对话式助手，可结合任务数据生成计划
- **复盘** — 完成情况回顾统计
- **考研计划** — 倒计时、科目与阶段管理、周任务规划
- **背单词** — 内置 5054 词词表，基于 ts-fsrs 间隔重复，含音标、助记、难词本
- **云盘备份** — 各模块数据可备份/恢复
- **主题切换** — 浅色/深色 + 6 种强调色
- **自动更新** — 内置更新器，启动时检查新版本

---

## 技术栈

| 类别 | 技术 | 版本 |
|------|------|------|
| 前端框架 | React | ^19.2.6 |
| 类型系统 | TypeScript | ~6.0.2 |
| 构建工具 | Vite | ^8.0.12 |
| CSS 框架 | Tailwind CSS | ^4.3.0 |
| 状态管理 | Zustand | ^5.0.14 |
| 图标库 | Lucide React | ^1.17.0 |
| 拖拽库 | @dnd-kit | core ^6.3.1 / sortable ^10.0.0 |
| 间隔重复 | ts-fsrs | ^5.4.2 |
| 桌面端框架 | Tauri | 2.x (Rust) |
| 数据库 | SQLite（tauri-plugin-sql） | — |
| 包管理器 | npm | — |

---

## 项目结构

```
easy-sail-postgrad-exam/
├── scripts/build-phonetics.mjs   # 由 CMU 词典生成音标数据
├── src/
│   ├── assets/exam-vocab/        # 词表与音标（文件名需为 ASCII）
│   ├── components/               # 页面与 UI 组件
│   ├── hooks/                    # 自定义 Hook
│   ├── lib/                      # 数据访问与工具
│   │   ├── db.ts                 # 任务表读写
│   │   ├── *-db.ts               # 其余模块各自的数据访问层
│   │   ├── cloud.ts              # 云盘备份/恢复
│   │   ├── tauri.ts              # Tauri 运行环境检测
│   │   └── types.ts              # 全局类型定义
│   ├── stores/                   # Zustand store（每模块一个）
│   ├── App.tsx
│   └── index.css                 # 全局样式 + CSS 变量
├── src-tauri/
│   ├── capabilities/default.json # Tauri 权限声明（作用域为窗口 main）
│   ├── src/lib.rs                # 窗口 / 托盘 / 数据库迁移
│   ├── Cargo.toml
│   └── tauri.conf.json           # 应用配置（版本号以这里为准）
├── .github/workflows/build.yml   # 打包并发布到 GitHub Release
└── AGENTS.md                     # AI 编码助手上下文
```

---

## 快速开始

### 环境要求

- **Node.js** >= 20.19.0（仓库在 Node 24 上开发）
- **Rust**（参考 [Tauri 安装指南](https://tauri.app/start/prerequisites/)）
- **npm**

### 安装与启动

```bash
npm install
npm run dev          # 纯 Web 模式，访问 http://localhost:1420
npm run tauri dev    # 桌面模式，带原生窗口与 SQLite
```

> 纯 Web 模式下数据仅存内存，不持久化。
>
> 修改 Rust 代码或 `src-tauri/capabilities/*.json` 后必须重启 `tauri dev`
> ——这两者编译期生效，前端热更新不会应用。

### 构建与检查

```bash
npm run build            # tsc -b + Vite 构建
npm run tauri build      # 打包安装包
npm run lint             # ESLint
```

无测试套件，回归保障依靠 `npm run build` 与 `npm run lint`。

---

## 核心模块说明

### 状态管理

Zustand，每个业务模块一个 store：

| Store | 职责 |
|-------|------|
| `task-store` | 任务、视图模式、当前区域、详情面板、主题 |
| `inspiration-store` | 灵感记录 |
| `exam-store` | 考研计划（科目、阶段、任务） |
| `exam-vocab-store` | 背单词（卡片调度、单元进度、难词本） |
| `reminder-history-store` | 通知历史 |

### 数据持久化

- **Tauri 环境**：本地 SQLite，文件 `sqlite:easy-sail-postgrad-exam.db`，经
  `@tauri-apps/plugin-sql` 访问。各模块表独立，以前缀区分
  （`tasks`、`inspirations`、`exam_*`、`exam_vocab_*`）。
  建表与变更由 `src-tauri/src/lib.rs` 中的迁移定义。
- **浏览器开发模式**：跳过数据库，仅内存。
- `task-store` 通过 `zustand/persist` 将 `theme`、`accentColor`、
  `tasks`、`viewOrder` 写入 localStorage（key 为 `easysail-exam-storage`）。
- 云盘备份由 `src/lib/cloud.ts` 协调，各 store 注册快照函数后参与自动同步。

### 数据模型

```typescript
interface Task {
  id: number;
  title: string;
  notes: string;
  projectId: string;            // 'project-work' | 'project-study' | 'project-life'
  kanban: 'todo' | 'doing' | 'done';
  starred: boolean;
  completed: boolean;
  completedAt: string | null;
  dueDate: string | null;
  startDate: string | null;     // 进入「进行中」的日期
  tags: string[];               // 'tag-urgent' | 'tag-important'
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  // —— 提醒 ——
  reminderAt: string | null;    // ISO 时间，null = 无提醒
  reminderEnabled: boolean;
  reminderText: string | null;
  recurrence: RecurrenceRule | null;
  snoozedUntil: string | null;
  lastNotifiedAt: string | null;
}
```

---

## 视图与导航

### 视图模式

| 视图 | 组件 | 说明 |
|------|------|------|
| 日历 | `CalendarView` | 月历视图，按日期展示任务 |
| 看板 | `KanbanBoard` | 三列（待办 / 进行中 / 已完成），支持拖拽 |

### 侧边栏导航

| 分组 | SectionId | 名称 |
|------|-----------|------|
| — | `inbox` | 首页 |
| — | `inspiration` | 灵感 |
| — | `ai` | AI 助手 |
| — | `review` | 复盘 |
| 学习计划 | `exam` | 考研计划 |
| 学习计划 | `exam-vocab` | 背单词 |

---

## 键盘快捷键

| 快捷键 | 功能 |
|--------|------|
| `Ctrl/Cmd + K` | 聚焦搜索框 |
| `Ctrl/Cmd + N` | 聚焦快速添加输入框 |
| `Enter` / `Ctrl/Cmd + Enter` | 快速添加：直接添加 / 添加后打开详情 |
| `Esc` | 关闭详情面板 / 设置弹窗 |
| `空格`、`1`~`4` | 背单词：翻卡 / 评分 |

---

## 主题系统

通过 CSS 变量实现，变量定义在 `src/index.css`：

- 主题经 `documentElement` 上的 `data-theme`（`light` / `dark`）切换
- 强调色经 `data-accent` 切换，提供绿 / 蓝 / 紫 / 橙 / 粉 / 红 六种
- 主题与强调色偏好持久化在 localStorage

---

## 桌面端配置

| 配置项 | 值 |
|--------|-----|
| 应用名称（productName） | Easy Sail Exam（安装后显示为「轻舟考研台」） |
| 应用标识 | `com.easysail.postgradexam` |
| 窗口尺寸 | 1200 x 800（最小 900 x 600） |
| 开发地址 | `http://localhost:1420` |
| 前端产物 | `../dist` |

主要 Tauri 插件：`sql`、`fs`、`http`、`dialog`、`notification`、`shell`、
`process`、`updater`、`autostart`、`single-instance`。

权限声明集中在 `src-tauri/capabilities/default.json`。注意
`sql:default` **不含** `execute` 权限，写操作需显式声明 `sql:allow-execute`。

Release 构建启用 LTO、`codegen-units=1`、`opt-level=s` 等优化。

---

## 开发脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动 Vite 开发服务器 |
| `npm run build` | TypeScript 编译 + Vite 构建 |
| `npm run preview` | 预览构建产物 |
| `npm run lint` | ESLint 检查 |
| `npm run tauri dev` | 桌面端开发模式 |
| `npm run tauri build` | 构建桌面安装包 |
| `npm run build:phonetics` | 重新生成音标数据（词表变化时） |

---

## 发布

版本号需同时更新 `src-tauri/tauri.conf.json` 与 `package.json`，然后打 `v*`
标签并推送，由 `.github/workflows/build.yml` 构建安装包并连同 `latest.json`
一起发布到 GitHub Release。完整流程见 [AGENTS.md](./AGENTS.md) 的「发布流程」。

---

## 许可证

本项目仅供学习和参考使用。

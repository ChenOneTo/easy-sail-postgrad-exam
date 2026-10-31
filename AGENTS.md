# AGENTS.md

给 AI 编码助手的项目上下文。补充 `README.md`（面向人）之外的构建步骤、架构约定与已知陷阱。

修改代码前请先读本文件，尤其是「数据库迁移」和「Tauri 权限」两节。

## 项目概览

「轻舟AI考研」— 基于 **Tauri v2 + React 19 + TypeScript** 的跨平台桌面应用。

- 前端：Vite 8 + Tailwind CSS v4 + Zustand 5
- 后端：Rust，位于 `src-tauri/`
- 存储：本地 SQLite，通过 `tauri-plugin-sql` 访问
- 英文名 / 产物名（productName）`Easy Sail Exam`，中文名 `轻舟AI考研`，
  包名 `easy-sail-postgrad-exam`，标识符 `com.easysail.postgradexam`
- 产物名保持 ASCII；安装后的快捷方式与「程序和功能」显示名由
  `src-tauri/windows/hooks.nsh` 改写为中文。注意该钩子里重复写了一份
  `APP_NAME_EN`，改 `productName` 时需同步。

## 常用命令

| 命令 | 用途 |
|------|------|
| `npm run dev` | 仅前端，浏览器访问 http://localhost:1420 |
| `npm run tauri dev` | 桌面端开发模式 |
| `npm run build` | `tsc -b` + Vite 构建 |
| `npm run lint` | ESLint 检查 |
| `npm run build:phonetics` | 重新生成英美双音标 `phonetics.json`（仅词表变化时；构建期下载 ipa-dict / Britfone） |
| `npm run build:examples` | 重新生成考研真题语境 `exam-examples.json`（数据源 CC BY-NC-SA 4.0） |

无测试套件。提交前必须跑通 `npm run build` 与 `npm run lint`。

改动 Rust 代码或 `capabilities/*.json` 后必须重启 `npm run tauri dev`——
这两者是编译期生效的，前端热更新不会应用。

## 架构约定

- **状态**：每个业务模块一个 Zustand store，位于 `src/stores/`
  （task / inspiration / exam / exam-vocab / vocab-game / reminder-history）。
- **数据访问**：每个模块一个 `src/lib/*-db.ts`，**共用**同一个 SQLite 文件
  `sqlite:easy-sail-postgrad-exam.db`，各模块表以前缀区分
  （`tasks`、`inspirations`、`exam_*`、`exam_vocab_*`）。
- **云同步**：`src/lib/cloud.ts`。各 store 通过 `registerXxxGetter()` 注册快照函数
  后才参与自动备份。
- **原生逻辑**：窗口、托盘、数据库迁移集中在 `src-tauri/src/lib.rs`。
- **样式**：Tailwind v4 + `src/index.css` 中的 CSS 变量。主题与强调色通过
  `documentElement` 上的 `data-theme` / `data-accent` 属性切换。

新增业务模块请沿用现有分层：`xxx-db.ts` → `xxx-store.ts` → `XxxPage.tsx`。

### 新增页面必须同步的 4 处（易漏）

新增独立页面（非任务视图）除数据层/store/页面外，还必须登记到以下位置，漏一处
会出现「通用 UI 串页」：

1. `src/lib/types.ts` 的 `SectionId` 联合类型
2. `src/components/Sidebar.tsx` 的导航项
3. `src/App.tsx` 的 `isSpecialSection` 与页面渲染分支
4. `src/components/TopBar.tsx` 的 `TITLES` **和 `hideChrome`**

`hideChrome` 控制是否渲染日历/看板/AI 视图切换器与任务搜索框。专用工作台
（背单词、单词闯关、考研计划等）必须加入该条件，否则顶部会混入与
页面无关的「日历 / 看板」切换，界面上看像是布局错乱。
**只加 `TITLES` 不加 `hideChrome` 就会复现此问题。**

## 数据库迁移（高危区）

迁移定义在 `src-tauri/src/lib.rs` 的 `add_migrations("sqlite:easy-sail-postgrad-exam.db", ...)`。

- 本项目为全新项目，**只有 1 条初始迁移**（`version: 1, "create initial schema"`），
  已包含全部表结构与种子数据；新增迁移从 **2** 开始。
- **禁止修改或删除任何已发布的迁移版本号及其 SQL。** 迁移由 sqlx 执行，
  它会校验「已应用过的版本是否存在于当前迁移集合」，回退版本号会抛
  `VersionMissing` 错误，导致 `Database.load()` 失败、整个数据层不可用，
  且该库文件无法自行恢复。
- 不保留任何历史版本兼容代码：旧库（`deskdo.db`）、旧 localStorage 键、
  旧云盘文件名一律不做迁移。改数据文件名或键名等同视为不兼容变更。
- 迁移 SQL 一律用 `CREATE TABLE IF NOT EXISTS` / `INSERT OR IGNORE` 保证可重入。
- 单例配置表使用 `id INTEGER PRIMARY KEY CHECK (id = 1)`，
  并配 `INSERT OR IGNORE INTO <表> (id) VALUES (1)` 初始化。

## Tauri 权限

权限声明在 `src-tauri/capabilities/default.json`，作用域为窗口 `main`。

**`sql:default` 只包含 `allow-load` / `allow-select` / `allow-close`，不含 `allow-execute`。**
任何写操作（INSERT / UPDATE / DELETE / BEGIN / COMMIT）都需要显式声明
`sql:allow-execute`，否则运行时报：

```
Command plugin:sql|execute not allowed by ACL
```

读操作不受影响，因此这类问题只在写入时才暴露，容易漏测。

## 发布流程

版本号必须**同时**改动两处，否则更新器行为异常：

1. `src-tauri/tauri.conf.json` 的 `version` —— **CI 以此为准**，决定 tag 与安装包文件名
2. `package.json` 的 `version`

`latest.json` 不再由人工维护：CI 构建时由 tauri-action 生成并上传到 GitHub Release，
客户端从 `releases/latest/download/latest.json` 读取。

确认远端没有同名 tag（`git ls-remote --tags origin`），然后：

```bash
git add -A
git commit -F <消息文件>          # 见下方「提交信息」
git tag -a v1.0.x -m "轻舟AI考研 v1.0.x"
git push origin main && git push origin v1.0.x
```

推送 tag 触发 `.github/workflows/build.yml`：Windows(nsis+msi)、macOS(dmg)、
Linux(deb+appimage) 三平台并行构建，安装包与 `latest.json` 直接发布到 GitHub Release。
**任一平台失败则该 Release 不完整**，已安装客户端可能收到缺平台的更新清单，
需修复后删除远端 tag 重新推送。

## 环境注意事项（Windows）

- **中文经命令行参数传递会被 GBK 编码破坏**：`git commit -m "中文"` 提交后是乱码。
  提交信息请先写入 UTF-8 文件（用编辑器写入，不要从终端重定向），再用
  `git commit -F <文件>` 提交。
- **资源文件名保持纯 ASCII**。Vite 会把非 ASCII 资源名百分号编码输出，
  Tauri 的 asset 协议解码可能失败导致资源取不到。
  词表文件已因此从 `主词表.tsv` 改名为 `main-wordlist.tsv`。

## 代码风格

- TypeScript strict，避免 `any`（用 `unknown` 加类型收窄）。
- 2 空格缩进，语句末尾不加分号，字符串用单引号。
- 函数组件 + Hooks，不写 class 组件。
- 组件命名 PascalCase，其余 camelCase。
- 注释与 UI 文案使用中文。

## 查看账户剩余构建时间直达地址
- https://github.com/settings/billing

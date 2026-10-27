# AGENTS.md — 交接约定与导航

> 本文件写给在本仓库工作的 AI 助手与开发者。**开工前先读本文件**，再按末尾「文档索引」按需深入。
>
> 对应数据版本：`2026.10.27-限时活动更新` ｜ 事实核对日期：2026-10-27 ｜ 详细文档见 `docs/`

## 这个项目是什么

囤囤鼠（阴阳师任务清单）：**纯手动勾选**的自查工具，不登录、不读取游戏账号或游戏内数据、不模拟点击。
技术栈：React 18 · TypeScript（严格模式）· Vite 8 · Tailwind CSS 3 · Zustand 5 · Vitest 5；无 UI 框架依赖。

保存与数据都在当前浏览器的 `localStorage`（按账号分片），默认走本地 Mock API，不需要后端。

**术语约定（2026-09-23）**：界面与文档统一称「**账号**」，对应代码层的 `Profile` / `profileId` 与持久化键 `yys:profiles`。
改名只发生在文案层 —— **代码标识符与持久化键不动**（键名是已发布的数据契约，改了既有数据读不出来）。

**样式约定（2026-09-24）**：控件（按钮 / 输入框 / chip / 标签 / 选项行 / 浮层 / 卡片 / 徽章）的类串**只有一条出口** ——
`src/components/common/controls.ts`。需要新形态先在它里面加一档，不要在组件里另写一套；
参考稿换代两次踩过的坑（同一颗主按钮散在 40 个文件里、改参考稿必漏）就是这条约定的由来。

**文字档约定（2026-09-28）**：设置页（含全部折叠分区）的**字号 / 字重 / 字距 / 行高**同样只有一条出口 ——
同一个文件的 `tx`（`cardTitle` / `settingTitle` / `label` / `rowName` / `note` / `mono` / `message`；
前两个是"折叠卡标题衬线"与"设置行标题正体"，**故意不同档**，别顺手统一）。
分区组件里不要再写 `text-sm` / `text-lg` / `text-xs`：这一页的文字是逐轮手写攒起来的，
"说明"曾同时存在 10px / 11px / 12px 三种写法。**颜色不烧进 `tx`**，由调用点补
（同属性类名相撞时按 Tailwind 生成顺序决胜，不由书写顺序定 —— 见该常量的注释）。
**例外只有一处**：Tailwind 类串表达不了的控件（径向渐变 / `inset` 内圈 / `::after` 外环 / 百分比图标等，
任意值写法按纪律禁用）改由 `src/styles/theme.css` 的 `.genso-*` 类承担 —— 仍然是"只有一处定义"。
现在只剩一例：`.genso-rt`（回到顶部朱印按钮）—— `.genso-daruma`（达摩点睛）已于 2026-09-28 随该功能整体删除，别照旧文档复活。

---

## 一、红线（改动前必须理解，违反即视为实现错误）

### 1. 分层铁律

```text
页面只管排列 → store 管状态 → domain 管纯函数规则 → api 契约管数据访问
```

- 页面（`src/pages/`）不直连种子文件、不写业务规则。
- 合并、重置、排序、统计等规则只写在 `src/domain/`，必须是可单测的纯函数。
- Mock 适配器（`src/api/mock/`）只做 IO 与合并调用，**不含合并规则本身**。
- 数据访问只有一条出口：`import { api } from '@/api'`。

### 2. 种子 JSON 只能被一个文件 import

`src/db/*.db.json` **只允许** `src/api/mock/db.ts` 引用。
`eslint.config.js` 里 `no-restricted-imports`（`JSON_BAN`，error 级）拦截 `**/db/*.db.json`、`**/db/*.json`、`@/db/*`，唯一豁免 `src/api/mock/db.ts`。
需要新数据 → 在 `db.ts` 加载 → 经 `domain/merge` 合并 → 经契约暴露。

### 3. localStorage 只有一个出口

全应用读写 `localStorage` 的地方只有 `src/services/localStore.ts`（`read` / `write` / `remove` / `DEVICE_KEY` / `NS`）。
Mock 的分片键由 `src/api/mock/persist.ts` 封装（`KEY` / `removeProfileShards`），它再导出 `localStore` 的方法，业务代码不得自己调 `window.localStorage`。

### 4. 口径纪律（动统计 / 勾选 / 显示逻辑前必读）

| 纪律 | 含义 | 落点 |
| --- | --- | --- |
| 只统计固定数值 | 浮动收益（只有类型没有数值）不进分子分母 | `domain/stats.ts` `summarizeRangeGain`（周期进度口径 `summarizeGain` 已于 2026-09-29 删除） |
| 覆盖 / 隐藏只影响渲染 | 绝不影响统计口径 | `domain/stats.ts`、`hooks/useChecklist.ts` |
| 统计不受列表筛选影响 | 统计直接吃原始勾选状态，不经过 `isVisible` | `pages/StatsPage.tsx` |
| 时间只提示不限制勾选 | 到期条目在**数据层**过滤，不在渲染层判 | `domain/reset.ts` `activeItems`、`domain/countdown.ts` |
| 单一数据出口 | 页面不直连种子，一律 store → api 契约 | `src/api/index.ts` / `src/api/contract.ts` |

### 5. 枚举双轨，改一侧必须同步另一侧

`src/domain/enums.ts` 的字面量联合类型（`CYCLE` / `GAIN_KIND` / `SORT_BY` / `DICT_TYPE` …）与 `src/db/meta.db.json` 的 `dicts` 是同一事实的两份编码，由 `npm run db:check`（`tools/build.js` 的 `PAIRS` 双向校验）强制对齐。
**改任一侧都要同步另一侧并跑 `npm run db:check`**。

### 6. 不要「复活」已移除的东西

- 已删除的条目字段：`value`（主观档）、`time2`、`source`、`reward`、`entry`、`action`。奖励文本字段是整体移除的，不要因为「看起来方便」而加回来。
- 浏览器提醒能力曾于 2026-09-11 整体下线；2026-10-27 只恢复**结界卡收/续点到点通知**，
  使用新键 `yys:nurture-notice`。`yys:notify` / `yys:reminded` 仍属已删除旧键，
  其他提醒能力不要借机恢复。

### 7. 不要用正则从奖励文本反推奖励类型

历史反面教材：曾用正则把「免费黑蛋礼包」标成黑碎 + 黑蛋 + 达摩 + 碎片，把「地域鬼王 皮肤券」拆成皮肤 + 券（子串重叠误判）。
奖励类型一律**逐条人工核定**，数据录入遵守 `tools/templates/version-intake.md`。

### 8. 每次改动都要留下变更记录

任何改动完成后，先在根目录 `CHANGELOG.md` 的 `[Unreleased]` 区追加条目：按「新增 / 修改 / 修复 / 移除 / 数据」选分组，写清**改了什么**（每条一行，不写动机、不复制 `docs/` 正文）。
数据类改动（条目库、枚举、数据版本号）必须同时登记到「数据」分组。
发版时才把 `[Unreleased]` 整段归入新的版本小节并补日期；版本号以 `package.json` 的 `version` 与 `src/db/meta.db.json` 的 `meta.version` 为准，本记录只引用不发明。
未修复的问题与待办写在 `docs/04-handover-guide.md` 的路线图一节，**不要**写进 `CHANGELOG.md` 的修复分组。

### 9. 开发阶段不做历史数据兼容（2026-09-14 起）

项目尚未正式发布给真实用户，**所有改动只需保证「全新初始状态」正确**：

- 不必为旧版本 `localStorage` 分片或旧备份文本写迁移 / 降级逻辑；
- 不必为「某个 id 曾经合法、现在不再合法」设计兼容路径；
- 数据模型可以随时改字段、删字段，不用考虑线上已有数据。

**唯一例外（仍要保留的廉价防御）**：过滤「当前运行期就可能出现」的非法输入 —— 例如某账号的配置里引用了已被删除 / 已下线的条目 id。这类过滤只有一两行，去掉换来的却是运行期异常，不值得省。

### 10. 提交身份要显式指定（本机未配置 git user）

本机**没有**配置 `user.name` / `user.email`，git 会按系统账户推断出 `Luo <ykluok@isoftstone.com>`，与仓库历史（`Jachin-Luo <Jachin-Luo@users.noreply.github.com>`）不一致。

**不要修改 git 配置**（`git config user.*`），提交时显式指定即可 —— `--author` 只管 author，committer 要靠环境变量：

```powershell
$env:GIT_AUTHOR_NAME = "Jachin-Luo"; $env:GIT_AUTHOR_EMAIL = "Jachin-Luo@users.noreply.github.com"
$env:GIT_COMMITTER_NAME = "Jachin-Luo"; $env:GIT_COMMITTER_EMAIL = "Jachin-Luo@users.noreply.github.com"
git commit --message="..."
```

提交后用 `git log -1 --format='A:%an <%ae> | C:%cn <%ce>'` 复核一眼。

---

## 二、常用命令

```bash
npm ci                    # 按 lockfile 安装（Node 18+，实测 Node 24）
npm run dev               # 开发服务，默认 http://localhost:5173/
npm test                  # vitest run，单元测试（27 文件 / 412 用例）
npm run lint              # eslint
npm run build             # tsc -b && vite build → dist/（**随发布入库**，产物要一并提交）
npm run db:check          # 数据校验 + 枚举双轨对齐，产物 reports/data-check.md
npm run db:calibrate      # 数据核对报告，产物 reports/pending-review.*、reports/calibration.md
npm run icons             # 生成 PWA 四张 PNG 图标（改 favicon.svg 后重跑）
npm run android:sync      # 构建 Web 产物并同步到 Capacitor Android 工程
npm run android:open      # 用 Android Studio 打开原生工程
node tools/verify.js      # 一键验收：tsc + eslint + vitest + build + db:check，产物 reports/verify-<date>.md
```

`reports/` 已被 `.gitignore` 忽略，可随时重跑生成。

Android APK 走 **GitHub Actions**：`.github/workflows/android-apk.yml` 支持分支构建与
`v*` tag 发布，正式 APK 使用 GitHub Secrets 中的稳定 release keystore 签名。原生壳使用 Capacitor 8；结界卡通知经
`@capacitor/local-notifications` 交给 Android 系统调度，不是常驻后台进程。

---

## 三、改动后的自检

| 改了什么 | 至少跑什么 |
| --- | --- |
| 任何改动 | 在 `CHANGELOG.md` 的 `[Unreleased]` 区追加一条（选分组、写清改了什么） |
| `src/db/*.db.json`、`src/domain/enums.ts` | `npm run db:check` |
| `src/domain/**`、`src/stores/**`、`src/api/**` | `npm test`（必要时补测试） |
| 页面 / 组件 | `npm run lint` + `npm run build` |
| 视觉 / 布局改动 | 见下表后的「AI 助手注意」—— **不要靠开浏览器截图** |
| 任何会进产物的改动（源码 / 数据 / 样式） | 提交前跑 `npm run build` 并把 **`dist/` 一起提交**（它随发布入库，漏了就是"线上 index.html 指向不存在的文件"） |
| 准备提交前 | `node tools/verify.js` |

> **AI 助手注意（2026-09-29）**：视觉 / 布局改动的自检**不要开浏览器截图** —— 本机
> `agent-browser` / Chromium 冷启动会卡住（用户要等着），而且截图**并不是当前会话模型能真正
> 解析的输入**，"我截图看过了"不构成证据。请改用可复算的手段：
> ① **类串静态核对** —— 例如"第一排是否共用同一个 `h-5` / `leading-5` 基准""手调 `mt` 是否已清零"；
> ② **按令牌与配方数值算** —— 对比度用色值算（如 `--c-jade` 的 5.66:1）、尺寸用间距阶算，不靠目测；
> ③ 观感类问题（间距舒不舒服、层级清不清楚）**直接说"需要你看一眼"**，不要用截图冒充验证。

---

## 四、文档索引

| 文档 | 内容 |
| --- | --- |
| `docs/README.md` | 文档总索引、按角色的推荐阅读路径、文档时效与更新约定 |
| `docs/01-architecture.md` | 目录逐层职责、启动到首屏的渲染链路、导航机制、11 个 store 的职责与依赖方向、双布局差异 |
| `docs/02-data-and-domain.md` | 数据契约、Mock 适配器与分片持久化、8 个 db.json 结构与规模、21 个 domain 模块导出表、特殊机制（一键日常 / 卡片显示 / 寮时间 / 备份 / 寄养 / 账号同步 / 御魂 / 悬赏） |
| `docs/03-conventions-and-tests.md` | 分层约束的强制手段、口径纪律逐条落点、测试体系与写法、数据录入流程、工具脚本、常见坑 |
| `docs/04-handover-guide.md` | 环境准备、6 类改动任务手册、未完成项与路线图、问题排查、「不要这样做」清单 |
| `docs/05-icon-inventory.md` | 图标槽位清单（重设计底稿）：改版前 36 枚符号的语义与分组（**现用图标以 `sprite.tsx` 的 45 枚为准**）、名不副实的三处系统性诊断、重设计分组与两种改动口径 |
| `docs/06-limited-intake.md` | **限时条目录入规范**：一条数据怎么进 `limited.db.json`（字段表、收益口径、子步骤、时间三兄弟与归档）、录入七步、强制校验 vs 约定的速查、踩过的坑 |

面向玩家的功能说明、FAQ、数据说明与免责在根目录 `README.md`；本文件与 `docs/` 只讲开发所需的事实，不重复玩家向内容。

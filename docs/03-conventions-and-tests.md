# 03 · 约定、测试与工具链

> 对应数据版本：`2026.10.27-限时活动更新` ｜ 事实核对日期：2026-10-27
> 本文回答：**哪些约束是被工具强制的、口径纪律落在哪个函数、怎么跑测试、数据怎么录入**。

## 1. 分层铁律与强制手段

```text
页面只管排列 → store 管状态 → domain 管纯函数规则 → api 契约管数据访问
```

这条铁律不是口号，有三处硬性强制：

| 约束 | 强制位置 | 违反后果 |
| --- | --- | --- |
| 种子 JSON 只能被 `src/api/mock/db.ts` import | `eslint.config.js` 的 `no-restricted-imports`（`JSON_BAN`，**error** 级），拦截 `**/db/*.db.json`、`**/db/*.json`、`@/db/*` | `npm run lint` 失败 |
| localStorage 只能经 `src/services/localStore.ts` | 约定 + 代码审查（Mock 的分片键封装在 `src/api/mock/persist.ts`） | 分片写入被破坏，`api/mock/contract.test.ts` 会失败 |
| 合并规则只在 domain | `domain/merge.ts` 是唯一实现；`api/mock/adapter.ts` 与 `api/mock/userStore.ts` 头部注释明确「不写合并规则」 | 规则分叉，备份 / 统计口径不一致 |

`eslint.config.js` 其他要点（供排查 lint 报错时参考）：

- `ignores`：`dist`、`node_modules`、`data`、`prototype`、`src/db`、`reports`、`*.config.js`。
- 作用范围 `**/*.{ts,tsx}`；`extends`：`js.configs.recommended` + `tseslint.configs.recommended`。
- `plugins`：`react-hooks`、`react-refresh`；`globals`：`globals.browser`；`ecmaVersion: 2022`。
- 规则：`reactHooks.configs.recommended`、`react-refresh/only-export-components`（warn，`allowConstantExport: true`）、`@typescript-eslint/no-explicit-any`（warn）、`no-restricted-imports`（error）。

TypeScript 为严格模式（`tsconfig.app.json`），`npm run build` 会先跑 `tsc -b`，类型错误直接中断构建。

### 1.1 类串只有一个出口：控件配方与文字阶梯

`src/components/common/controls.ts` 是全站**样式类串的唯一来源**，两支各管一段：

| 出口 | 管什么 | 档位 |
| --- | --- | --- |
| `btn` / `field` / `input` / `chip` / `tag` / `option` / `popover` / `cardBox` / `badge` | **控件**：按钮 / 输入框 / 标签 / 选项行 / 浮层 / 卡片 / 徽章 | 对参考稿 `uiRef/囤囤鼠大作战_控件样式示例.html`，见该文件头部的对应表 |
| `tx` | **设置页（含全部折叠分区）的文字**：字号 / 字重 / 字距 / 行高 | `cardTitle` 折叠卡标题 13px 衬线 · `settingTitle` 设置行标题 13px 半粗正体 · `label` 12px 中粗 · `rowName` 13px · `note` 11px · `mono` 11px 等宽 · `message` 12px |

> 两个"标题"档**故意不同字族**（折叠卡衬线 / 设置行正体）—— 用户 2026-09-28 定的，别顺手统一。

两条纪律：

1. 组件里**不再拼**控件的圆角 / 高度 / 字号，分区组件里**不再写** `text-sm` / `text-lg` / `text-xs`。
   需要新形态先在这两支里加一档 —— 参考稿换代两次踩过的坑（同一颗主按钮散在 40 个文件、改参考稿必漏）就是这条的由来。
2. `tx` **只给字形、不给颜色**：同属性类名相撞时按 Tailwind 的生成顺序决胜，不由 className 的书写顺序定
   —— 本仓库已栽过两次（`w-full` 对 `w-28`、`focus:border-danger` 对 `focus:border-gold-line`），
   配方里带一个颜色、调用点再补一个想覆盖它，就是一个"看着写对了、其实没生效"的静默失效。

另有一条下限：**11px 是中文的地板**，说明类文字不许用 `text-2xs`（10px）——
`uiRef/囤囤鼠大作战_UI审查意见.md` 记过「CJK 在 10px 下笔画会糊」，项目此前已把字号整档上抬过一次。

## 2. 口径纪律的代码落点

改动统计 / 勾选 / 显示相关代码前，先确认没有破坏以下五条：

| # | 纪律 | 落点 |
| --- | --- | --- |
| 1 | 只统计固定数值（浮动收益不进分子分母） | `domain/stats.ts` `summarizeRangeGain`（按 `gain` 过滤；`PERIOD_META` 与周期口径 `summarizeGain` 已分别于 2026-09-28 / 09-29 删除，纪律不变） |
| 2 | 覆盖 / 隐藏只影响渲染，绝不影响统计 | `domain/stats.ts`（不读 `coverMode`）、`hooks/useChecklist.ts`（`hiddenByCover` 只作用于列表）、`domain/autoDaily.ts` |
| 3 | 统计不受列表筛选影响 | `pages/StatsPage.tsx` 直接吃原始 `checked`，不经过 `domain/sort.isVisible`（该函数按勾选状态过滤的口子与 `keepDone` 已于 2026-09-24 删除） |
| 4 | 时间字段只提示，不限制勾选 | `domain/countdown.ts`；到期条目在数据层被 `domain/reset.activeItems` 过滤，不在渲染层判 |
| 5 | 单一数据出口（页面不直连种子） | `src/api/index.ts` 唯一入口；`src/api/contract.ts` 唯一定义 |

> 2026-09-15 删去原第 3 条「漏失明细只列事实，不折算不估算」—— `missGroups` 已随
> 「痛感只用于默认排序」一并删除（统计页自 2026-09-14 起也不再展示漏失明细）。**2026-09-30 起连"默认排序"也不再由痛感决定**（改按条目库顺序），本表已无痛感相关行。

## 3. 周期与重置口径

| 周期 | 重置口径 | 锚点值位置 |
| --- | --- | --- |
| 每日 | 0 点刷新 | `meta.resetHour` = 0 |
| 每周 | 周一 0 点刷新 | 同上 |
| 每月 | 自然月（1 日 0 点起算） | 同上 |
| 限时 | **不自动重置**（`periodStartOf` 恒 0）：条目靠 `until` 到期归档下线 | —— |

- 重置**靠时间戳比对**（`domain/reset.periodStartOf` + `mergeChecked`），不靠定时器清数据。
- 页面顶部的自然日期（`domain/dateLabel.ts`）纯展示，与勾选重置口径无关 —— 这是刻意分离的，别去「修」它。
- 前台刷新：`hooks/usePeriodRefresh.ts` 在分钟边界 / 聚焦 / 可见性变化时重估，只改内存不写盘。

## 4. 测试体系

### 4.1 配置与约定

| 项 | 值 |
| --- | --- |
| 运行器 | Vitest 5，`environment: 'node'`，`include: ['src/**/*.test.ts']` |
| 位置约定 | **测试与被测代码同目录**（无独立 `tests/` 目录） |
| localStorage 垫片 | `src/test/memoryStorage.ts`（`MemoryStorage` 记录每次 `setItem`；`installMemoryStorage()` 注入 `window.localStorage`） |
| 总量 | **27 个测试文件 / 412 个用例**（2026-10-27 按 `npm test` 实测重算） |

### 4.2 分布

| 测试文件 | 用例数 |
| --- | --- |
| `api/mock/contract.test.ts` | 32（含 2026-09-28 新增的 `updateItem` 三条：改写自建 / 改写预设并清除改写 / 未知 id 报错） |
| `api/mock/persistence.test.ts` | 7 |
| `domain/autoDaily.test.ts` | 22 |
| `domain/backup.test.ts` | 30 |
| `domain/bounty.test.ts` | 21 |
| `domain/calendar.test.ts` | 7 |
| `domain/cardDisplay.test.ts` | 16 |
| `domain/checkLog.test.ts` | 17 |
| `domain/dateLabel.test.ts` | 10 |
| `domain/domain.test.ts` | 32（reset / sort / merge / countdown 跨天跨周跨月边界 + 限时永不自动重置 + 预设改写合并） |
| `domain/itemPatch.test.ts` | 12（稀疏覆盖：键不存在 / `null` / 有值三态；对着种子求差；外部脏值净化） |
| `domain/steps.test.ts` | 13（子步骤派生：单条与多次的步数 / 完成判定 / 当前步 / 缺省继承父） |
| `domain/guildTime.test.ts` | 10 |
| `domain/itemDraft.test.ts` | 4（草稿 → 条目的字段映射与归一：空白串、空 `gainKind`、整体覆盖、收益清洗） |
| `domain/nurture.test.ts` | 44 |
| `domain/sort.test.ts` | 18 |
| `domain/stats.test.ts` | 6 |
| `domain/sync.test.ts` | 12 |
| `domain/yuhun.test.ts` | 15 |
| `hooks/usePeriodRefresh.test.ts` | 8 |
| `services/localStore.test.ts` | 6 |
| `stores/check.test.ts` | 28 |
| `stores/device.test.ts` | 6 |
| `stores/guildTime.test.ts` | 7 |
| `stores/items.test.ts` | 7 |
| `stores/nurture.test.ts` | 11 |
| `stores/session.test.ts` | 11 |

### 4.3 各层怎么写测试

| 层 | 写法 | 参考文件 |
| --- | --- | --- |
| domain | 纯函数，直接给定输入断言输出；时间相关用传入 `now` 参数固定时刻，**不要 mock 系统时间** | `domain/domain.test.ts` |
| stores | 先 `installMemoryStorage()`，再按需 `reset*Memory()` 清内存态，直接调 action 断言 state | `stores/check.test.ts` |
| api（mock） | 走真实适配器 + 内存 localStorage，断言契约行为与**分片写入**（勾一条只写对应分片）与越权报错 | `api/mock/contract.test.ts` |
| hooks | 需要 React 渲染环境时慎用（`environment: 'node'`），优先测其纯逻辑部分 | `hooks/usePeriodRefresh.test.ts` |

**新增 domain 模块必须带单测**；新增 store action 建议补测。`domain/` 下没有**独立**测试文件的模块只有 `enums.ts`（纯类型）、`ids.ts`、`merge.ts`、`countdown.ts` —— 后三者由消费方（`domain/domain.test.ts` 等）连带覆盖。

## 5. 工具脚本

| 脚本 | 命令 | 做什么 | 产物 |
| --- | --- | --- | --- |
| `tools/build.js` | `npm run db:check` | 校验 `src/db/*.db.json`：枚举双轨对齐、字段白名单、id 唯一、`isAutoHub` 唯一、锚点必填、引用完整性、`dataVersion` 覆盖 | `reports/data-check.md`；有 error → 退出码 1 |
| `tools/calibrate-report.js` | `npm run db:calibrate` | 汇总待人工核对项（收益 / 截止日 / 时间窗），并生成录入模板 | `reports/pending-review.md`、`reports/pending-review.json`、`reports/calibration.md`，并覆盖 `tools/templates/version-intake.md` 与 `tools/templates/new-items.draft.json` |
| `tools/verify.js` | `node tools/verify.js [--quiet] [--output=路径]` | 一键验收，依次跑 `tsc -b` → `eslint .` → `vitest run` → `build` → `db:check`，记录当次真实输出 | `reports/verify-YYYY-MM-DD.md`；任一步失败 → 退出码 1 |

`reports/` 已被 `.gitignore` 忽略（可随时重跑生成），不要把它提交进仓库。

> 提示：`tools/verify.js` 内部注释里的用例数（历史值）可能滞后于真实值，**以 `npm test` 输出为准**（当前 27 文件 / 412 用例）。

## 6. 数据录入流程

见 `docs/02-data-and-domain.md` 第 8 节（完整七步）。速查版：

```text
读 tools/templates/version-intake.md
→ 草稿写 tools/templates/new-items.draft.json
→ npm run db:check
→ 落 src/db/
→ 同步 meta.db.json 的 dataVersion 与 dataVersion.db.json 版本行
→ npm run db:calibrate 人工复核
→ npm test && node tools/verify.js
```

## 7. 常见坑与反面案例

| 坑 | 说明 | 正确做法 |
| --- | --- | --- |
| 用正则从奖励文本反推奖励类型 | 子串重叠会误判：「免费黑蛋礼包」→ 黑碎 + 黑蛋 + 达摩 + 碎片；「地域鬼王 皮肤券」→ 皮肤 + 券 | 逐条人工核定；奖励文本字段已整体删除，不要复活 |
| 只改 `enums.ts` 或只改 `dicts` | `db:check` 会因双向对齐失败而报错 | 两侧同步改，再跑 `npm run db:check` |
| 在页面里判「今天是否新周期」 | 会让口径分裂成两份 | 周期判定只在 `domain/reset.ts`，前台刷新只走 `usePeriodRefresh` |
| 让「一键日常隐藏」参与统计 | 会造成「隐藏 = 少算收益」 | 统计只吃原始 `checked`（`pages/StatsPage.tsx`） |
| 删掉 Mock 的延迟或 AbortSignal 处理 | 会写出没有 loading / 竞态的 UI，接后端时集中爆雷 | 保留 `api/mock/latency.ts` 的延迟语义 |
| 直接 `window.localStorage.setItem` | 破坏「唯一出口」，且绕过分片键封装 | 走 `services/localStore.ts` 或 `api/mock/persist.ts` 的 `KEY` |
| 把寮时间写进种子数据 | 各寮时间不同，写死即错 | 用户配置走 `stores/guildTime`（**账号级**，2026-09-16 由设备级升格），展示层叠加 |
| 在业务代码 import `@/db/items.db.json` | ESLint error 级拦截 | 新数据在 `api/mock/db.ts` 加载并经契约暴露 |
| 把 `reports/` 提交入库 | 该目录是工具产物 | 已在 `.gitignore` 中忽略，保持忽略 |
| 给条目增加新字段但不更新白名单 | `db:check` 会报未知字段 | 同步更新 `tools/build.js` 的字段白名单与 `schema/item.schema.json` |

## 8. 开发阶段的数据兼容边界（2026-09-14 起）

项目**尚未正式发布给真实用户**，因此：

| 不需要做 | 说明 |
| --- | --- |
| 旧 `localStorage` 分片的迁移 | 分片键或字段结构可以直接改，不写升级逻辑 |
| 旧备份文本的降级 | `domain/backup` 的 `schemaVersion` 差异提示是给**未来**用户的，开发期不必为它加分支 |
| 「id 曾经合法、现在不再合法」的兼容 | 例如一键日常覆盖集合里可能残留已不在候选内的 id —— 无需为这类历史数据设计路径 |

**仍要保留的廉价防御**（成本一两行，收益是避免运行期异常）：

- `domain/autoDaily.effectiveAutoSet` / `cascadeTargets` 过滤「当前不存在或已下线」的 id —— 它同时处理**运行期**就会出现的情况（条目被删、活动条目下线），不只是历史数据；
- `domain/reset.mergeChecked` 清理已下线条目的键（防状态对象无限膨胀）；
- `api/mock/userStore.assertScope` 的越权校验。

结论：**新逻辑不必背兼容包袱；已有的廉价防御不要为了"精简"而删掉。**

下一篇：`docs/04-handover-guide.md`（上手步骤与改动任务手册）。

# 04 · 接手上手与改动任务手册

> 对应数据版本：`2026.10.27-限时活动更新` ｜ 事实核对日期：2026-10-27
> 本文回答：**第一次跑起来要做什么、常见改动怎么改、坏了怎么查**。
> 每步都给出「触点文件 / 需要同步改的位置 / 必须跑的命令 / 怎么验证」。

## 1. 环境准备与启动

| 项 | 说明 |
| --- | --- |
| 依赖 | Node 20+（Vite 8 与 `workbox-build` 均要求 Node ≥ 20；仓库未声明 `engines`，实测在 Node 24 下跑通）。若 `node -v` 提示找不到命令，先安装 Node（官方安装包或 nvm-windows / fnm 等版本管理器） |
| 包管理 | npm（仓库有 `package-lock.json`，用 `npm ci` 保证与锁文件一致） |
| 后端 | **不需要**。默认 `VITE_API_MODE` 未设置 → 走本地 Mock，数据在浏览器 `localStorage` |
| 端口 | `npm run dev` 默认 `5173` |

```bash
npm ci
npm run db:check     # 先确认种子数据自洽（不依赖 node_modules 之外的东西）
npm test             # 基线：27 文件 / 412 用例应全绿
npm run dev          # http://localhost:5173/
```

可选环境变量（`src/api/index.ts` 是唯一读取处）：

| 变量 | 作用 | 默认 |
| --- | --- | --- |
| `VITE_API_MODE` | `mock` 或 `http` | `mock` |
| `VITE_API_BASE_URL` | Http 适配器的 baseURL | `/api` |
| `VITE_API_FAIL` | 让 Mock 注入一次失败，用于验证错误态 | 未设置 |

## 2. 第一次接手建议做的事

1. 通读 `AGENTS.md`（红线与导航）→ `docs/01` → `docs/02` → `docs/03` → 本文；顺手看一眼根目录 `CHANGELOG.md`，了解最近改了什么（每次改动都登记在那里）。
2. `node tools/verify.js` 跑一次完整验收，把 `reports/verify-<date>.md` 当作**基线快照**留档。
3. `npm run dev` 手动点一遍七个页面（今日 / 本周 / 本月 / 限时 / 统计 / 工具 / 设置），并：
   - 勾一条看勾选是否落盘（刷新页面仍在）、统计页区间收益是否变化；
   - 在「设置 · 数据备份」导出一次，确认文本能出现；
   - 切到手机宽度（< 768px）确认切到底部 Tab 布局。
4. 需要理解数据时，直接打开 `src/db/items.db.json` —— **清单的默认顺序就是它里面的书写顺序**（2026-09-30 起），挑一条对着字段表读即可。

## 3. 改动任务手册

### 任务 1 · 修改或新增条目 / 升级数据版本

| 项 | 内容 |
| --- | --- |
| 触点文件 | `src/db/items.db.json`（真正的常驻：每日 / 每周 / 每月）、`src/db/limited.db.json`（非常驻：活动期每日 / 限时活动，含版本活动）、`src/db/dataVersion.db.json`（版本行）、`src/db/meta.db.json`（`meta.dataVersion`） |
| 需要同步 | 若新增字段 → `tools/build.js` 的字段白名单 + `schema/item.schema.json`；若引入新枚举 code → `src/domain/enums.ts` 与 `meta.db.json` 的 `dicts` 两侧同步；若带固定收益 → 填 `gain` 的 `jade` / `blackFrag` / `blueTicket` 数值（`gainKind` 是奖励类型枚举，与 `GAIN_KIND` 对齐；不写 `gain` 即视为浮动、不进统计） |
| 必须跑 | `npm run db:check` → `npm test` → `node tools/verify.js` |
| 验证 | 开发服务里能在对应页面看到条目；**清单里的先后与数据文件里的书写顺序一致**（默认排序，2026-09-30 起）；带 `gain` 的条目会让统计页对应币种的区间收益变化 |

硬性约束（`tools/build.js` 会拦）：

- id 全局唯一且格式合规；
- 全库**恰有 1 条** `isAutoHub`（一键日常入口）；
- 带 `until` 的条目到期后在数据层被 `activeItems` 过滤，不要写「渲染层判断」；
- 不要写 `reward` / `entry` / `action` 字段（已从白名单移除）。

> 用户自建条目走 UI（设置 · 条目管理），落 `ItemOverrides`，**不进种子数据**。

### 任务 2 · 新增一个一级页面并接入导航

| 项 | 内容 |
| --- | --- |
| 触点文件 | 新建 `src/pages/XxxPage.tsx` |
| 需要同步（4 处，缺一即编译报错或 UI 不对） | ① `src/stores/ui.ts` 的 `NavKey` 加 key；② 同文件 `NAV_ITEMS` 加 `{ key, label }`；③ `src/components/common/NavContent.tsx` 的 `switch (nav)` 加 `case`；④ `src/components/icons/navIcons.ts` 的 `NAV_ICON: Record<NavKey, IconName>` 补图标（两端壳层共用这一份） |
| 容易漏的第 5 处 | `src/components/mobile/MobileShell.tsx` 底部 Tab 的 `grid-cols-<页数>`（当前 7 页 = `grid-cols-7`）要同步改成对应列数，否则 Tab 换行错位 |
| 骨架屏例外 | `NavContent` 里 `loading && nav !== 'me' && nav !== 'tools'` 决定是否显示骨架 —— 新页面若不需要首屏骨架，把 key 加入这个例外 |
| 必须跑 | `npm run lint` → `npm run build`（`tsc -b` 会因 `ICONS` 缺项直接失败） |
| 验证 | 桌面侧栏与手机底部 Tab 都能进入该页面；两端布局都正常 |

页面写法遵循分层铁律：只做排列与组合，数据从 store 取、规则从 `domain` 取。

### 任务 3 · 新增一个 store

| 项 | 内容 |
| --- | --- |
| 触点文件 | 新建 `src/stores/xxx.ts`（`create<T>()`，与现有 store 同构） |
| 若需首屏数据 | ① `src/api/types.ts` 加类型；② `src/api/contract.ts` 加方法；③ `src/api/mock/adapter.ts` 实现（读路径组装进 `getBootstrap`，写路径用 `store.enqueue` 串行化）；④ `src/api/http/adapter.ts` 加同名方法（先 `fail()` 占位）；⑤ `src/hooks/useBootstrap.ts` 里按序清空内存态并写回新 store |
| 若需持久化 | 账号级 → `src/api/mock/persist.ts` 加 `KEY` 分片 + `src/api/mock/userStore.ts` 加读写函数（注意 `assertScope` 越权校验）；设备级 → `src/services/localStore.ts` 的 `DEVICE_KEY` |
| 必须跑 | `npm test`（建议同时在 `src/stores/xxx.test.ts` 补测，用 `installMemoryStorage()` + 模块级 `reset*Memory()`） |
| 验证 | 切账号后数据不串；刷新页面数据仍在；`npm run lint` 通过 |

约束：store 只存状态与调用契约，**不写业务规则**；规则放 `domain`。

### 任务 4 · 新增一个 domain 模块与单测

| 项 | 内容 |
| --- | --- |
| 触点文件 | 新建 `src/domain/xxx.ts`（纯函数）+ 同目录 `xxx.test.ts` |
| 硬约束 | 不 import `api` / `stores` / `services` / `localStorage`；时间相关函数把「当前时间」作为参数传入（便于测试，不 mock 系统时钟） |
| 若涉及枚举 | `src/domain/enums.ts` 与 `src/db/meta.db.json` 的 `dicts` 双向同步 |
| 必须跑 | `npm test`（新增模块必须有测试）→ `npm run db:check`（若动枚举） |
| 验证 | 单测覆盖跨天 / 跨周 / 跨月边界与"限时永不自动重置"（参考 `src/domain/domain.test.ts`） |

### 任务 5 · 接入真实后端（替换 HttpApi 空壳）

| 项 | 内容 |
| --- | --- |
| 触点文件 | `src/api/http/adapter.ts`（当前所有方法 `this.fail()` 抛 `NOT_IMPLEMENTED`，文件头有端点映射参考与 `TODO(S2 之后 / M2)`） |
| 需要保持 | ① 契约形状不变（`ApiClient` 37 个方法）；② `DataScope` 显式传 `userId` + `profileId`，服务端据此校验越权；③ 错误统一用 `ApiError`（带 `code`）；④ `listProfiles` 返回**含归档的全部账号**，归档过滤留在 UI |
| 不改的地方 | 页面、store、domain、hooks 一律不动 —— 契约是唯一边界，切换靠 `VITE_API_MODE=http` + `VITE_API_BASE_URL` |
| 必须跑 | `npm test`（`api/mock/contract.test.ts` 是 Mock 的行为基准，可对照着验证 Http 实现语义一致）；`npm run build` |
| 验证 | 关掉 Mock（设 `VITE_API_MODE=http`）后七个页面功能等价；离线 / 报错时 `SaveErrorNotice` 与 `ErrorScreen` 有正确表现 |

注意：Mock 的注入延迟与 AbortSignal 语义是**前端 UI 的既成前提**（loading 态、竞态守卫都已按异步写），接后端时不需要在 http 层「补偿」，但也不要因此把前端的 loading/竞态处理删掉。

### 任务 6 · 调整布局或断点

| 项 | 内容 |
| --- | --- |
| 触点文件 | `src/styles/layout.ts`（共享容器类，如 `CHECKLIST_GRID`）、`tailwind.config.ts` / `src/styles/theme.css`（令牌）、`src/styles/base.css` / `index.css`、`src/components/mobile/MobileShell.tsx`、`src/components/desktop/DesktopShell.tsx` |
| 断点 | 只有 `src/hooks/useBreakpoint.ts`（`matchMedia('(min-width: 768px)')`）读窗口宽度 —— **不要新增第二个读屏宽的地方**，页面内部也不要自己判断 |
| 必须跑 | `npm run lint` → `npm run build` |
| 验证 | 1280 / 768 / 390 三种宽度下无横向滚动；手机端刘海区与底部 Tab 不被遮挡（`safe-*` 类 + `dvh`） |

## 4. 未完成项与路线图

| 项 | 现状 | 位置 |
| --- | --- | --- |
| Http Adapter | 空壳，全部方法抛 `NOT_IMPLEMENTED`，端点映射已写在注释里 | `src/api/http/adapter.ts` |
| PWA / 离线 | **已接入**（2026-09-29，不再是待办）：`vite-plugin-pwa`（`generateSW`）产出 `sw.js` + `manifest.webmanifest`、19 条 precache；图标由 `npm run icons` 从 `favicon.svg` 生成；更新时机交给用户（`registerType: 'prompt'` + 设置页「应用更新」），**不静默刷新** | `vite.config.ts`、`src/services/pwa.ts`、`src/stores/pwa.ts`、`tools/make-icons.mjs`、`index.html` |
| 数据快照热更新 | 不做：条目库随包发布 | `src/components/settings/DataVersionSection.tsx` |
| 通知能力 | 2026-10-27 仅恢复**结界卡收/续点通知**：网页版在应用存活时轮询并弹普通浏览器通知；Android APK 通过 Capacitor Local Notifications 预交给系统，应用关闭后仍可触发。其他提醒仍不恢复 | `hooks/useNurtureNotifications.ts`、`services/notifications.ts`、`stores/device.ts`、`components/settings/NurtureNotificationSection.tsx`、`android/` |
| Android APK | GitHub Actions 手动运行 `Android APK` workflow，构建 debug APK 并上传 artifact；本地需要 JDK 21 + Android SDK 36 + Gradle wrapper | `.github/workflows/android-apk.yml`、`capacitor.config.ts`、`android/` |
| 排序控件 | 按产品决策取消：排序由「**默认按条目库顺序** + 置顶 + 自定义顺序」决定（2026-09-30 起默认不再是痛感分）；`ViewPrefs.sortBy` 字段保留在数据层 | `src/domain/sort.ts`（原控件 `ViewBar` 已于 2026-09-28 删除） |
| 痛感的其他出口 | 2026-09-15 收敛为「只作默认排序键」：`minWeight` 门槛（筛选项 + `isVisible` 判断）、今日页高痛感警示条（原 `SHOW_WEEKLY_ALERT`）、`missGroups` 漏失分级、`WEIGHT_LEGEND` 图例 **全部删除**（不是隐藏）。**2026-09-30 连痛感分本体也退场**：默认排序改按条目库顺序，`domain/weight.ts` 整个文件删除 | `pages/TodayPage.tsx`、`components/common/OnboardingDialog.tsx`、原 `domain/weight.ts`（已删）、`domain/sort.ts`（`cycleRank` 迁入） |
| 读取游戏数据 | **长期不做**，属于产品定位而非待办 | `README.md` |

### 已登记但暂不修复的技术债（2026-09-14 评估）

结论：以下问题**都不影响当前功能**，作为技术债搁置。修复时请先更新本节状态，并在 `CHANGELOG.md` 追加一条记录。

| # | 问题 | 影响面 | 何时才会真的咬人 |
| --- | --- | --- | --- |
| 1 | UI 层零测试（`src/**/*.test.tsx` 为 0，27 个测试文件全在 domain / stores / hooks / services / api） | 组件与双布局无回归网 | 改组件或布局后只能手点验证，问题到线上才暴露 |
| 2 | localStorage 分片无版本号与迁移机制（备份 bundle 有 `schemaVersion`，`yys:state\|view\|ovr\|checklog:{profileId}` 没有） | 老用户的本地数据 | 改数据结构并升级版本时，旧分片会被静默读入、不报警 |
| 3 | `hooks/useBootstrap` 的「按序清空 items → check → view 再写回」是手工维护的隐式契约 | 切号正确性 | 新增 store 时漏改，出现「切号残留上一账号数据」 |
| 4 | 保留但不可达的字段未在代码内标注：`ViewPrefs.sortBy` / `minWeight`（UI 不再写入） | 可读性 | 后来者误以为它在生效，或误删相关逻辑。**`hideDone` 已按此原则于 2026-09-24 整体删除** —— 它没有 UI 却仍在 `domain/sort.isVisible` 里生效，比"保留但不可达"更糟；`SHOW_WEEKLY_ALERT`（今日页警示条）亦已于 2026-09-15 随痛感收敛删除 |
| 5 | `schema/item.schema.json` 与 `tools/build.js` 双轨校验 | 数据录入体验 | 两处规则漂移时，编辑器提示与运行时校验不一致 |
| 6 | 三个「版本号」并存：`meta.version`（同时是备份 `schemaVersion`）、`meta.dataVersion`、`dataVersion.db.json` 的行版本 | 认知成本 | 写迁移或备份逻辑时用错号 |
| 7 | 统计只覆盖 22 条带固定收益的条目（按子步骤算"叶子"，父条目不进统计） | 期望管理 | 不属缺陷，是「只统计固定数值」的既定口径 |

附带记录：仓库内曾发现三处过时注释 —— `tools/verify.js` 的「215 测试通过」、`src/domain/reset.ts` 的「当前 89 条」、`src/domain/yuhun.ts` 的「10 副本」。按 2026-09-30 实测，对应真值分别是 **407 用例 / 91 条 / 11 个副本**；三处注释已于同日的文档一致性核查中一并改正。

## 5. 问题排查

| 现象 | 先看哪里 | 常见原因 |
| --- | --- | --- |
| 首屏一直骨架屏 / 停在 ErrorScreen | `hooks/useBootstrap.ts`、`stores/ui.ts` 的 `bootstrapLoading` / `bootstrapError` | Mock 失败注入（`?__fail=1`、`VITE_API_FAIL`）；契约方法抛错 |
| 页面顶部出现「保存失败」提示 | `components/common/SaveErrorNotice.tsx`（聚合 5 处 `error`） | `localStorage` 配额 / 权限问题（`services/localStore.ts` 已转成可读文案）；写队列中的契约错误 |
| 勾选了但统计页不变 | `domain/stats.ts` `summarizeRangeGain` | 该条目没有固定数值 `gain` —— 这是口径，不是 bug（周期进度口径已于 2026-09-29 删除，统计页只走区间收益） |
| 勾选后条目仍在列表里 | （设计如此，非故障） | 「已完成」的表达是**沉下去但仍在**（`card-done` + 划朱线），另有独立「已完成」分区；不复存在"勾了就消失"的开关（`hideDone` 已于 2026-09-24 删除） |
| 到了新的一天 / 新的一周，勾选没归零 | `hooks/usePeriodRefresh.ts`、`domain/reset.ts` | 前台未触发刷新（切到后台再回来会重估）；或条目自带 `until` 被 `activeItems` 过滤下线 |
| 报 `E_FORBIDDEN` / 越权 | `api/mock/userStore.ts` `assertScope` | `DataScope` 传了空 `userId` / `profileId`，或账号未加载完成就发起写操作 |
| 单测里 `localStorage is not defined` | `src/test/memoryStorage.ts` | 测试开头需要 `installMemoryStorage()` |
| `npm run db:check` 失败 | `reports/data-check.md` | 枚举双轨不一致、字段不在白名单、id 重复、`isAutoHub` 数量不为 1、锚点缺失、引用不到 |
| lint 报「禁止 import 数据库 JSON」 | `eslint.config.js` 的 `JSON_BAN` | 业务代码引了 `@/db/*` —— 改走 `api/mock/db.ts` + 契约 |
| 手机端底部 Tab 被顶出屏幕 | `src/styles/base.css`（`dvh`）、`MobileShell` 的 `safe-bottom` | 用了 `vh` 而非 `dvh`；或丢失 `safe-*` 类 |

## 6. 「不要这样做」清单

1. 不要在页面或组件里 `import` `src/db/*.db.json`（ESLint error）。
2. 不要绕开 `services/localStore.ts` 直接写 `window.localStorage`。
3. 不要把业务规则写进页面、store 或 Mock 适配器（规则只在 `domain/`）。
4. 不要给「隐藏 / 覆盖」赋予统计含义（会让统计口径与事实分叉）。
5. 不要在渲染层判断条目是否到期（到期在数据层 `activeItems` 过滤）。
6. 不要用正则从奖励文本反推奖励类型（历史误判案例见 `docs/03` 第 7 节）。
7. 不要复活已删除字段（`value` / `time2` / `source` / `reward` / `entry` / `action`）与旧提醒键 / 其他提醒能力；结界卡通知是 2026-10-27 唯一经确认恢复的通知。
8. 不要把寮活动时间写进种子数据（各寮不同，展示层叠加才是对的）。
9. 不要为了「更快」删掉 Mock 的延迟与 AbortSignal 处理（会让 UI 失去 loading / 竞态处理能力）。
10. 不要在组件里读窗口宽度或写 `outline-none`（破坏断点唯一来源与焦点环）。
11. 不要把 `reports/` 提交进仓库（已被 `.gitignore` 忽略，属可重跑产物）。

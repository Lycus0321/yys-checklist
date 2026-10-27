# 01 · 架构总览

> 对应数据版本：`2026.10.27-限时活动更新` ｜ 事实核对日期：2026-10-27
> 本文回答：**代码放在哪、谁调用谁、一次点击之后发生了什么**。符号名与路径均可在代码中直接跳转核对。

## 1. 技术栈与工程配置

| 项 | 值 | 位置 |
| --- | --- | --- |
| 运行时 | Node 18+（实测 Node 24） | `package.json` |
| 框架 | React 18 + ReactDOM 18 | `package.json` dependencies |
| 语言 | TypeScript 严格模式 | `tsconfig.app.json` |
| 构建 | Vite 8 | `vite.config.ts` |
| 样式 | Tailwind CSS 3（+ `tailwindcss-animate`）；颜色槽写成 `rgb(var(--c-x) / <alpha-value>)`，取值随主题变 | `tailwind.config.ts`、`postcss.config.js`、`src/styles/theme.css` |
| 主题 | 明暗双主题（设备级键 `yys:theme`；初始值优先本机存档、其次跟随 `prefers-color-scheme`、默认明版） | `src/stores/theme.ts`、`src/styles/theme.css` |
| 状态 | Zustand 5 | `src/stores/` |
| 测试 | Vitest 5，`environment: 'node'`，`include: ['src/**/*.test.ts']` | `vite.config.ts` |
| 图标 | 自建和风图标库（`<symbol>` sprite，无第三方图标依赖） | `src/components/icons/` |
| PWA / 离线 | `vite-plugin-pwa`（`generateSW`；`registerType: 'prompt'` —— 更新由用户在设置页触发，**不静默刷新**） | `vite.config.ts`、`src/services/pwa.ts`、`src/stores/pwa.ts`、`tools/make-icons.mjs` |
| Android 原生壳 | Capacitor 8 + `@capacitor/local-notifications`；GitHub Actions 构建 debug APK，原生本地通知可脱离页面进程 | `capacitor.config.ts`、`android/`、`.github/workflows/android-apk.yml` |
| 路径别名 | `@` → `./src` | `vite.config.ts`、`tsconfig.app.json` |
| 其他运行时依赖 | `nanoid`（id 生成）、`tailwind-merge`（类名合并） | `package.json` |

脚本（逐字，来自 `package.json`）：

```bash
npm run dev          # vite
npm run build        # tsc -b && vite build
npm run preview      # vite preview
npm run lint         # eslint .
npm test             # vitest run
npm run test:watch   # vitest
npm run db:check     # node tools/build.js
npm run db:calibrate # node tools/calibrate-report.js
npm run icons        # node tools/make-icons.mjs 生成 PWA 图标（改 favicon.svg 后重跑）
```

构建产物在 `dist/`（**随发布入库**，2026-09-29 起不再被 `.gitignore` 忽略：服务器上有本机部署脚本直接取这份产物、不在服务器上二次构建，因此每次 `npm run build` 后都要把 `dist/` 一并提交，包括换了名字的 `assets/index-<hash>.js` / `.css`）；`reports/` 是工具脚本产物目录，已被 `.gitignore` 忽略。

## 2. 目录地图

### 2.1 顶层

```text
yys-checklist/
├── index.html            # 单页挂载点 #root；挂 SVG favicon + iOS 专属 meta（manifest 由构建注入）
├── src/
├── public/               # 站点图标 favicon.svg + 四张 PWA 图标（PNG，由 `npm run icons` 从它生成）
├── android/              # Capacitor Android 工程（原生本地通知、APK 构建）
├── schema/item.schema.json   # 条目 JSON Schema，仅供编辑器提示；运行时校验以 tools/build.js + domain/enums.ts 为准
├── tools/                # 数据校验、核对报告、一键验收、录入模板
├── docs/                 # 本套交接文档
├── AGENTS.md             # AI / 协作方开工前必读的约定
└── README.md             # 玩家向说明（玩法、口径理由、FAQ）
```

### 2.2 `src/` 逐层职责与文件清单

| 层 | 职责 | 文件 |
| --- | --- | --- |
| `src/` | 入口与根组件 | `main.tsx`、`App.tsx`、`vite-env.d.ts` |
| `src/api/` | 唯一的对外数据边界：契约 + 适配器 + DTO | `contract.ts`、`index.ts`、`types.ts`、`http/adapter.ts`、`mock/adapter.ts`、`mock/db.ts`、`mock/userStore.ts`、`mock/persist.ts`、`mock/latency.ts`、`mock/contract.test.ts`、`mock/persistence.test.ts` |
| `src/db/` | 种子主数据，只允许被 `api/mock/db.ts` import | `items.db.json`、`limited.db.json`、`yuhun.db.json`、`souls.db.json`、`bounty.db.json`、`meta.db.json`、`users.db.json`、`dataVersion.db.json` |
| `src/domain/` | 纯函数业务规则（无 IO，全部可单测） | 21 个模块：`enums.ts`、`reset.ts`、`merge.ts`、`sort.ts`、`countdown.ts`、`stats.ts`、`autoDaily.ts`、`backup.ts`、`cardDisplay.ts`、`guildTime.ts`、`checkLog.ts`、`calendar.ts`、`ids.ts`、`itemDraft.ts`、`itemPatch.ts`、`steps.ts`、`sync.ts`、`nurture.ts`、`yuhun.ts`、`bounty.ts`、`dateLabel.ts` + 17 个 `*.test.ts`（`weight.ts` 已于 2026-09-30 随痛感分退场删除） |
| `src/stores/` | Zustand 状态容器（按领域分片） | 11 个：`session.ts`、`items.ts`、`check.ts`、`view.ts`、`theme.ts`、`device.ts`、`guildTime.ts`、`ui.ts`、`tools.ts`、`nurture.ts`、`pwa.ts` + 6 个 `*.test.ts` |
| `src/hooks/` | 编排与副作用封装（竞态、首屏、断点、焦点、周期刷新、长按、通知、卡片配置出口） | 11 个：`useBootstrap.ts`、`useBreakpoint.ts`、`useCardDisplay.ts`、`useChecklist.ts`、`useAutoDaily.ts`、`useDevicePrefs.ts`、`useLongPress.ts`、`useModalFocus.ts`、`useNurtureNotifications.ts`、`usePeriodCountdown.ts`、`usePeriodRefresh.ts` + `usePeriodRefresh.test.ts`（`useApi.ts` / `useScope.ts` 已随 2026-09-28 的死符号清理删除） |
| `src/pages/` | 页面容器（只管排列） | `TodayPage.tsx`、`WeekPage.tsx`、`MonthPage.tsx`、`LimitedPage.tsx`、`StatsPage.tsx`、`ToolsPage.tsx`、`MePage.tsx`；`pages/settings/`（7）：`ProfileSection.tsx`、`ProfileSyncSection.tsx`、`AutoDailySection.tsx`、`ItemManagerSection.tsx`、`CardDisplaySection.tsx`、`GuildTimeSection.tsx`、`ClearDataSection.tsx`；`pages/tools/`：`YuhunSection.tsx`、`BountySection.tsx`、`NurtureSection.tsx` |
| `src/components/` | 展示原子件与布局骨架 | `common/`（27）：`Alert.tsx`、`BackToTop.tsx`、`CheckBox.tsx`、`ChecklistEntry.tsx`、`ChecklistGroupCard.tsx`、`ChecklistItem.tsx`、`CollapsibleSection.tsx`、`ConfirmDialog.tsx`、`controls.ts`、`EmptyState.tsx`、`HubCard.tsx`、`ItemField.tsx`、**`Modal.tsx`**（2026-09-28 抽出的弹层外壳）、`NavContent.tsx`、`NurtureBadge.tsx`、`OnboardingDialog.tsx`、`PageHead.tsx`、`ProfilePickDialog.tsx`、`ProfileSwitcher.tsx`、`RewardBadges.tsx`（2026-09-29 由 `GainBadges` + `KindBadges` 合并）、`SaveErrorNotice.tsx`、`sectionNo.ts`、`Segmented.tsx`、`SettingRow.tsx`、`SummaryBar.tsx`、`Tags.tsx`、`ThemeToggle.tsx`；`desktop/DesktopShell.tsx`；`mobile/MobileShell.tsx`；`settings/`（6）：`AboutSection.tsx`、`BackupSection.tsx`、`DataVersionSection.tsx`、**`ItemForm.tsx`**（条目新建 / 编辑表单，弹层形态）、`NurtureNotificationSection.tsx`（结界卡通知开关）、`UpdateSection.tsx`（PWA 更新检查） |
| `src/services/` | 跨域用例编排与基础设施 | `localStore.ts`、`backupService.ts`、`clipboard.ts`、`notifications.ts`（通知权限 / 发送）、`pwa.ts`（SW 注册 / 检查更新）+ `localStore.test.ts` |
| `src/styles/` | 设计令牌与共享容器类 | `index.css`、`base.css`、`layout.ts`（`tokens.ts` 这个 JS 侧令牌镜像已于 2026-09-29 随唯一消费方 `ProgressBar` 删除） |
| `src/test/` | 单测垫片 | `memoryStorage.ts` |

> 注意一处**目录归属不对称**（历史遗留，非 bug）：`BackupSection` 与 `DataVersionSection` 在 `src/components/settings/`，其余四个设置分区在 `src/pages/settings/`。新增设置分区时**跟随 `pages/settings/`**，不要扩大不对称。

## 3. 分层职责

```mermaid
graph TD
    P["pages/ 页面<br/>只做排列与组合"] --> H["hooks/ 编排<br/>竞态、首屏、断点"]
    H --> S["stores/ 状态<br/>Zustand 分片"]
    S --> D["domain/ 纯函数规则<br/>合并·重置·排序·统计·备份"]
    S --> A["api/ 契约<br/>ApiClient + DataScope"]
    A --> M["api/mock/ 适配器<br/>种子 + localStorage 分片 + 延迟"]
    M --> D
    M --> DB["db/ 种子 JSON<br/>仅 db.ts 可 import"]
```

铁律：**页面不直连种子文件；Mock 只做 IO、不含合并规则。**

## 4. 启动到首屏的调用链

```mermaid
sequenceDiagram
    participant HTML as index.html
    participant Main as src/main.tsx
    participant App as src/App.tsx
    participant Boot as hooks/useBootstrap
    participant API as api (MockApi)
    participant Shell as DesktopShell / MobileShell
    participant Nav as common/NavContent

    HTML->>Main: #root + module script
    Main->>App: createRoot().render(<App/>)（StrictMode，不注册 SW）
    App->>Boot: useBootstrap()
    Boot->>API: getSession() → listProfiles() + getBootstrap()
    API-->>Boot: session + profiles + bootstrap 载荷
    Boot->>Boot: 清空 items→check→view→guildTime→nurture 内存态后按序写回六个 store
    App->>App: usePeriodRefresh() 周期重估；useNurtureNotifications() 检查到点；hydrate() 读设备级偏好
    App->>Shell: breakpoint === 'mobile' ? MobileShell : DesktopShell
    Shell->>Nav: <NavContent variant="desktop|mobile">
    Nav->>Nav: switch(nav) 分派 7 个一级页面
```

关键文件与位置：

| 环节 | 位置 | 说明 |
| --- | --- | --- |
| HTML 挂载点 | `index.html` | `#root` + `<script type="module" src="/src/main.tsx">`；另有 favicon SVG 与 iOS 专属 meta（`apple-mobile-web-app-*` / `apple-touch-icon`），manifest 由 PWA 插件在构建期注入 |
| 根渲染 | `src/main.tsx` | `React.StrictMode`；Service Worker 的注册在 `src/App.tsx` 挂载时调 `services/pwa.initPwa()`（2026-09-29 接入 PWA，开发态是空实现、不注册） |
| 首屏聚合 | `src/App.tsx` → `hooks/useBootstrap.ts` | 首屏唯一入口；切号 / `bootstrapTick` 变化时全量重载 |
| 周期刷新 | `hooks/usePeriodRefresh.ts` | 每分钟边界 + 窗口聚焦 + 可见性变化时重估周期状态，**不写盘** |
| 设备级状态 | `src/App.tsx` 挂载时 `hydrate()` → `stores/device.ts` | 引导标记、主题偏好与**结界卡通知开关 / 去重键**；寮时间与寄养记录仍是账号级并随 `getBootstrap` 下发 |
| 首屏错误 | `App.tsx` | 渲染 `ErrorScreen` |
| 顶层提示 | `App.tsx` | `SaveErrorNotice`（聚合六处 `error`）、`OnboardingDialog`、`ConfirmDialog`、`ProfilePickDialog`（长按跨账号勾选的选择器，与确认框同一位置）。后三者共用 `Modal` 外壳；条目新建 / 编辑的弹层长在设置页里，经 `createPortal` 挂到 `body`（设置页的滚动容器会裁 `fixed` 遮罩） |

## 5. 导航与页面分派

**没有 react-router**。导航是自研的 view store：

- `src/stores/ui.ts`：`NavKey`（type）、`NAV_ITEMS`（导航项数组）、`setNav`、state 字段 `nav` / `bootstrapLoading` / `bootstrapError` / `confirmState` / `bootstrapTick`。
- `src/components/common/NavContent.tsx`：`switch (nav)` 分派 7 个一级页面；首屏 `bootstrapLoading` 时渲染 `Skeleton`。
- 两套骨架各自渲染导航：`DesktopShell.tsx`（左侧固定 `w-56` 侧栏 + 底部 `ProfileSwitcher`）、`MobileShell.tsx`（顶部应用栏 + 底部固定 Tab，带 `safe-area` 与 `dvh` 处理）。两端页头是同一套品牌锁定（标题「囤囤鼠」/ 副标题「阴阳师任务清单」）；**进度不进顶栏**（2026-09-23 起）—— 每个页面各自展示自己的进度，顶栏只放身份与时间信息。两端内容区共用**回顶按钮**（`common/BackToTop.tsx`：滚动量 > 4px 浮出、回到顶部即隐藏，锚在内容区右下 —— 移动端离底栏 8px、PC 28px）；它挂在**壳层**而不是各页面里，所以七个页面自动都有。挂载时内容区各包一层 `relative`，`main` 仍是唯一滚动容器。
- 断点判据唯一来源：`src/hooks/useBreakpoint.ts`，`matchMedia('(min-width: 768px)')`；模块级首帧缓存避免闪烁。

> 页面内部不应自行读屏宽 —— 全项目只有 `useBreakpoint` 读窗口宽度。新增布局差异请走 `components/mobile` / `components/desktop` 与 `styles/layout.ts`。

## 6. 状态层：十一个 store

| store | 导出符号 | state | action |
| --- | --- | --- | --- |
| `stores/session.ts` | `useSessionStore`、`aliveProfiles` | `session`、`profiles`、`error`、`saving` | `applySession`、`loadProfiles`、`switchProfile`、`createProfile`、`updateProfile`、`archiveProfile`、`restoreProfile`、`deleteProfile`、`setError` |
| `stores/items.ts` | `useItemStore`、`resetItemsMemory`、`dictIndexOf` | `meta`、`items`、`presetItems`、`overrides`、`error` | `applyBootstrap`、`reloadItems`、`loadPreset`、`addItem`、`updateItem`、`hideItem`、`restoreItem`、`removeItem`、`saveOrder`、`resetLibrary` |
| `stores/check.ts` | `useCheckStore`、`resetCheckMemory` | `checked`、`log`、`loading`、`error` | `applyChecked`、`toggle`、`setMany`、`toggleWithCascade`、`toggleInProfiles`（长按跨账号）、`clearAll` |
| `stores/view.ts` | `useViewStore`、`resetViewMemory`、`CoverMode` | `view`、`defaults`、`error` | `applyView`、`setSortBy`、`setMinWeight`、`togglePin`、`setPinned`、`setCoverMode`、`setCardDisplay`（带 `scope`，只写一页）、`setAutoSet`、`resetAutoSet` |
| `stores/theme.ts` | `useThemeStore`、`Theme` | `theme` | `setTheme` |
| `stores/device.ts` | `useDeviceStore` | `onboarded`、`notifyNurture`、`lastNurtureNoticeKey`、`notificationPermission`、`hydrated`、`error` | `hydrate`、`markOnboarded`、`resetOnboarding`、`refreshNotificationPermission`、`enableNurtureNotice`、`disableNurtureNotice`、`markNurtureNoticeShown` |
| `stores/guildTime.ts` | `useGuildTimeStore`、`resetGuildTimeMemory` | `guildTime`、`error` | `applyGuildTime`、`setGuildTime`、`clearGuildTime` |
| `stores/ui.ts` | `useUiStore`、`NAV_ITEMS`、`NavKey`、`ConfirmOptions`、`PickOptions` | `nav`、`navRequest`、`bootstrapLoading`、`bootstrapError`、`confirmState`、`bootstrapTick` | `setNav`、`requestNav`、`clearNavRequest`、`setBootstrapLoading`、`setBootstrapError`、`refreshBootstrap`、`askConfirm`、`answerConfirm`、`askPick`、`answerPick` |
| `stores/tools.ts` | `useToolsStore`、`ToolTab` | `yuhun`、`souls`、`bounty`、`loading`、`error` | `ensure`（模块级 `inflight` 去重） |
| `stores/nurture.ts` | `useNurtureStore`、`resetNurtureMemory` | `records`、`error` | `applyPlans`、`add`、`promote`、`markPoint`、`clearPoint`、`remove`、`clearAll` |
| `stores/pwa.ts` | `usePwaStore` | `supported`、`registered`、`needRefresh`、`offlineReady` | `setSupported`、`setRegistered`、`setNeedRefresh`、`setOfflineReady`（**刻意不持久化** —— SW 活在浏览器层，刷新就要重新握手） |

依赖方向（谁调用谁）：

```text
hooks/useBootstrap ──> api.getSession / listProfiles / getBootstrap ──> 六个 store（items → check → view → session → guildTime → nurture）
stores/session ──> stores/ui        （切号时点亮骨架 loading）
stores/items ──> stores/session     （取 DataScope）
stores/check ──> stores/session, stores/items（currentPeriod 依赖 meta + items）
stores/view  ──> stores/session
components/common/SaveErrorNotice ──> 聚合 session / items / check / view / device 五处 error
```

`useBootstrap` 的顺序很关键：**先按序清空 items → check → view 的内存态，再写回新数据**，避免切号瞬间旧账号的勾选残留。

## 7. 数据流：一次勾选发生了什么

```text
用户点击 ChecklistItem
  → hooks/useChecklist 提供的回调（或 useAutoDaily 的级联）
  → stores/check.toggle / setMany / toggleWithCascade（乐观更新内存）
  → api.setChecked / clearAllChecked（契约）
  → api/mock/adapter 写路径经 userStore.enqueue 串行化
  → api/mock/persist.KEY.state(profileId) 只重写当前账号的勾选分片
  → services/localStore.write 落 localStorage
```

读路径（首屏）：

```text
api.getBootstrap
  → mock/db.ts 取种子（items + limited 合并为 seedItems）
  → userStore.ensureStore() 把种子与 localStorage 覆盖层组装
  → domain/merge.mergeItems / effectiveView / buildMeta + domain/reset.mergeChecked
  → 返回 BootstrapPayload → stores/items.applyBootstrap / check.applyChecked / view.applyView / session.applySession
```

要点：

- 写操作**串行化**（`userStore.enqueue`），避免竞态覆盖。
- **分片存储**：勾一条只重写 `yys:state:{profileId}`，不触碰其他账号分片（`api/mock/persist.ts` 的 `KEY`，由 `api/mock/contract.test.ts` 单测守护）。
- 失败提示：写失败会写入对应 store 的 `error`，由 `components/common/SaveErrorNotice.tsx` 统一呈现。

## 8. 页面对应的编排 hook

| 页面 | 主要依赖 |
| --- | --- |
| `TodayPage.tsx` | `useChecklist`（`useAutoDaily` 提供一键日常卡片与级联） |
| `WeekPage.tsx` | `useChecklist('week')`（周常；月常已于 2026-09-15 拆到 `MonthPage`） |
| `MonthPage.tsx` | `useChecklist('month')`（月常；每月 1 日 0 点刷新，页面顶部标本月区间） |
| `LimitedPage.tsx` | `useChecklist`（限时分区，固定按剩余天数升序，无排序控件） |
| `StatsPage.tsx` | `domain/calendar.buildMonthGrid`（月历）+ `stores/check` 的 `log` + `domain/stats.summarizeRangeGain`（区间收益）—— **不经过 `useChecklist`**，因此不受「覆盖隐藏 / 奖励类型筛选」影响 |
| `ToolsPage.tsx` | `stores/tools.ensure`（御魂 / 悬赏 / 寄养三段懒加载） |
| `MePage.tsx` | 设置页：**5 组**（观感 / 委托 / 账号 / 数据 / 关于）。来源是 `pages/settings/*` 七个（游戏账号 / 同步到其他账号 / 一键日常 / 条目管理 / 卡片显示字段 / 寮时间 / 清空记录）+ `components/settings/*` 四个（数据版本 / 数据备份 / 应用更新 / 联系方式），另有一个平铺行（界面主题） |

> **设置页的两级结构与形态口径**（2026-09-23 重构）：组名走清单页同一套分组头 `SectionTitle`
> （传 `flush` —— 页面容器已自带 `px-3.5`，不传会缩两次）。组内按「**能一行说完的平铺、
> 需要展开看的收起**」分：平铺用 `components/common/SettingRow`（与任务卡同一套材质
> `surface` + `shadow-card` + `rounded-md`），收起用 `CollapsibleSection`；两者间距由组容器的
> `space-y-1.5` 统一给（`CollapsibleSection` 因此不再自带 `mt-4`）。5 个长列表
> （覆盖清单 / 条目库 / 账号列表 / 寮时间 / 备份）默认收起，靠 `summary` 在收起状态下
> 也给出关键结论（"已覆盖 12 项" / "存活 2 个" / "快照更新于 9/9"）。分段选择类控件统一用
> `components/common/Segmented`（`value` 传 `null` 表示"不属于任何一档"，此时三档都不高亮）。

`hooks/useChecklist.ts` 是清单类页面的公共编排：过滤（`domain/sort.isVisible`）+ 排序（`domain/sort.buildComparator`）+ 按卡切分（`domain/steps.isCardDone`），导出 `Checklist`、`ChecklistTarget`（`HIGH_WEIGHT` 已随痛感分于 2026-09-30 删除）。

## 9. 两套布局的共享与差异

- **共享**：数据层、状态层、领域逻辑、原子件（`ChecklistItem`、`HubCard` 等两端同款）。
- **差异**：只有排列方式。栅格在 `src/styles/layout.ts`（`CHECKLIST_GRID` 等容器类），令牌在 `tailwind.config.ts` 与 `src/styles/theme.css`，全局基样式在 `src/styles/base.css` / `index.css`。
- 移动端为单列 + 底部固定 Tab；桌面端为左侧固定导航 + 多列栅格。
- 可访问性约定：全局 `:focus-visible` 焦点环（组件内不写 `outline-none`）、模态焦点管理（`hooks/useModalFocus.ts`）、勾选卡整行命中、图标按钮带 `aria-label`。

## 10. 已知的「看起来奇怪但有意为之」的点

| 现象 | 原因与位置 |
| --- | --- |
| 一键日常入口永远排第 0 位 | `domain/sort.ts` 的前置特判，不参与任何比较（`weightOf` 已随 `domain/weight.ts` 于 2026-09-30 删除） |
| 日期显示与勾选重置口径不一致 | 顶部日期纯展示（`domain/dateLabel.ts`），重置按周期口径（`domain/reset.ts`） |
| `ViewPrefs.sortBy` / `minWeight` 有字段但 UI 不写 | 排序已由「**默认按条目库顺序** + 置顶 + 自定义顺序」决定（2026-09-30 起默认不再是痛感分；痛感自 2026-09-15 起只作排序键，如今连排序键也不是 —— `domain/weight.ts` 已随本次改动删除）。两个字段保留在数据层（不动契约形状），**勿据此新增控件** |
| 界面里找不到任何「痛感」字样 | 2026-09-15 收敛：今日页「本周高痛感还剩 N 项」警示条已删除，`minWeight` 门槛与 `WEIGHT_LEGEND` 图例一并移除 —— 当时痛感只剩「默认排序」一个出口；**2026-09-30 连那个出口也没了**（默认排序改按条目库顺序），`domain/weight.ts` 随之删除 |
| `api/http/adapter.ts` 全是「未实现」 | 本期只留类型占位，接后端时替换，见 `docs/04-handover-guide.md` |
| `stores/*` 里的 `CheckState` / `ItemState` 等接口没有导出 | 属内部实现细节，新增对外符号请显式 export |

下一篇：`docs/02-data-and-domain.md`（数据契约、种子结构与领域规则）。

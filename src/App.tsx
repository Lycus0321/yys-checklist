import { useEffect } from 'react';
import ConfirmDialog from './components/common/ConfirmDialog';
import OnboardingDialog from './components/common/OnboardingDialog';
import ProfilePickDialog from './components/common/ProfilePickDialog';
import SaveErrorNotice from './components/common/SaveErrorNotice';
import DesktopShell from './components/desktop/DesktopShell';
import IconSprite from './components/icons/sprite';
import MobileShell from './components/mobile/MobileShell';
import { useBootstrap } from './hooks/useBootstrap';
import { useBreakpoint } from './hooks/useBreakpoint';
import { useNurtureNotifications } from './hooks/useNurtureNotifications';
import { usePeriodRefresh } from './hooks/usePeriodRefresh';
import { initPwa } from './services/pwa';
import { useDeviceStore } from './stores/device';
import { useThemeStore } from './stores/theme';
import { useUiStore } from './stores/ui';

/** 首屏错误边界：把契约层抛出的错误显式呈现，而不是白屏 */
function ErrorScreen({ message }: { message: string }) {
  return (
    <div className="flex h-full items-center justify-center bg-surface-2 px-6">
      <div className="max-w-md rounded-lg border border-crimson-soft bg-surface px-5 py-4 shadow-panel">
        <h1 className="font-serif text-xl tracking-card text-crimson">数据加载失败</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{message}</p>
        <p className="mt-2 text-sm text-ink-3">
          若地址带 <code className="rounded-sm bg-surface-3 px-1">?__fail=1</code> 即 mock 错误注入，去掉即可。
        </p>
      </div>
    </div>
  );
}

/**
 * 双套结构（设计文档 §8.3）：`useBreakpoint` 是唯一分流判据，
 * 只切渲染树，不重置数据（数据在 store 中，天然保留）。
 *
 * 设备级偏好（明暗主题 / 引导标记）在挂载时从本机读一次；冷启动引导在
 * 「数据就绪 + 标记缺失」时才出现（`OnboardingDialog` 内部判定）。
 * 二次确认弹窗挂在顶层，调用方只需 `await askConfirm(...)`。
 *
 * 2026-09-11：原先这里挂了 `useReminderEngine()`，随 S7 提醒能力一并移除。
 * 2026-10-27：只恢复结界卡到点通知（`useNurtureNotifications`），其余提醒不复活。
 *
 * 2026-09-23 换肤：
 *   - 挂 `IconSprite` —— 和风图标库是全站唯一的一份 `<symbol>` 定义（零 DOM 成本）；
 *   - 订阅系统明暗变化：**用户没显式选过主题时**跟随系统，选过就不再打扰。
 */
export default function App() {
  useBootstrap();
  usePeriodRefresh();
  useNurtureNotifications();
  const hydrate = useDeviceStore((s) => s.hydrate);
  const breakpoint = useBreakpoint();
  const error = useUiStore((s) => s.bootstrapError);
  const followSystem = useThemeStore((s) => s.followSystem);

  useEffect(() => {
    hydrate();
  }, [hydrate]);

  /* 离线能力：注册 Service Worker（更新时机交给用户，见 `services/pwa`）。
     这里只负责"握手"，发现新版由设置页的「应用更新」行提示、由用户点重启。
     开发态拿到的是插件给的空实现、不会注册，故不必按环境分叉。 */
  useEffect(() => {
    initPwa();
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => followSystem();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [followSystem]);

  if (error) return <ErrorScreen message={error.message} />;

  return (
    <>
      <IconSprite />
      {breakpoint === 'mobile' ? <MobileShell /> : <DesktopShell />}
      <SaveErrorNotice />
      <OnboardingDialog />
      <ConfirmDialog />
      {/* 跨账号勾选的选择器（清单长按触发）：与确认框同一位置，
          调用点只 `await pick({...})`，不必各自维护弹层状态 */}
      <ProfilePickDialog />
    </>
  );
}

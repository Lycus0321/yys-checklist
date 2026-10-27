import { useDeviceStore } from '../stores/device';

/**
 * 设备级状态的统一入口（2026-09-16 起只剩引导标记）。
 *
 * 「设备级」的含义：**不随账号走、不上后端**。
 *
 * 寮时间已从这里移出（迁到 `stores/guildTime` 的账号级 store）—— 它不再满足上面两条：
 * 不同号可能在**不同的寮**，且用户要求所有配置项都能被备份带走。这个 hook 的名字
 * 之所以不改，是因为"设备级"这个分层本身仍然存在，只是成员只剩引导标记一个。
 */
export function useDevicePrefs() {
  const onboarded = useDeviceStore((s) => s.onboarded);
  const hydrated = useDeviceStore((s) => s.hydrated);
  const hydrate = useDeviceStore((s) => s.hydrate);
  const markOnboarded = useDeviceStore((s) => s.markOnboarded);
  const resetOnboarding = useDeviceStore((s) => s.resetOnboarding);
  const notifyNurture = useDeviceStore((s) => s.notifyNurture);
  const notificationPermission = useDeviceStore((s) => s.notificationPermission);
  const enableNurtureNotice = useDeviceStore((s) => s.enableNurtureNotice);
  const disableNurtureNotice = useDeviceStore((s) => s.disableNurtureNotice);
  const refreshNotificationPermission = useDeviceStore((s) => s.refreshNotificationPermission);

  return {
    onboarded,
    hydrated,
    hydrate,
    markOnboarded,
    resetOnboarding,
    notifyNurture,
    notificationPermission,
    enableNurtureNotice,
    disableNurtureNotice,
    refreshNotificationPermission,
  };
}

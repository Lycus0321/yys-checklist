import { create } from 'zustand';
import {
  DEFAULT_NURTURE_NOTICE_PREFS,
  sanitizeNurtureNoticePrefs,
  type NurtureNoticePrefs,
} from '../domain/nurture';
import {
  getDeviceNotificationPermission,
  getInitialNotificationPermission,
  requestDeviceNotificationPermission,
  type NotificationPermissionState,
} from '../services/notifications';
import { DEVICE_KEY, read, write } from '../services/localStore';

/**
 * 设备级状态（**不属于用户数据模型**：不随账号走、不上后端、mock 与 http 行为一致）。
 *
 * ## 2026-09-16 瘦身：只剩引导标记
 *
 * 寮时间与结界寄养任务**升为账号级**（见 `api/mock/persist.ts` 的分片表与
 * `UserDataBundle`）—— 它们都不是"这台手机的属性"，且用户要求"所有配置项均可备份"。
 * 相应入口迁到 `stores/guildTime`（新）与 `stores/nurture`（改为走契约）。
 *
 * 留下 `onboarded` 的理由：它**不是用户的配置项**，而是"这台设备看过引导没有"的状态。
 * 换设备后重看一次引导是正确的（引导里本来就有"配置寮时间"这一步），
 * 把它塞进备份反而会让新设备首次使用少了那一步。
 *
 * 保留 store（而不是组件内 `useState`）的理由没变：
 * 设置页点「重看引导」后要让引导层立即出现，而不是依赖页面重新挂载。
 *
 * 2026-10-27：只重新加入结界卡通知的设备级开关与去重键。通知权限本身由浏览器持有，
 * `yys:nurture-notice` 只记录用户意愿和最近提醒点，不进入账号数据或备份。
 */
interface DeviceState {
  /** 冷启动引导是否已完成（设备级一次性标记） */
  onboarded: boolean;
  /** 结界卡到点通知开关（设备级） */
  notifyNurture: boolean;
  /** 最近一次已经提醒过的结界卡点，用于避免每分钟重复弹窗 */
  lastNurtureNoticeKey: string | null;
  /** 当前浏览器通知权限；不持久化，浏览器才是权限真值 */
  notificationPermission: NotificationPermissionState;
  hydrated: boolean;
  error: Error | null;
  /** 启动时从本机读一次 */
  hydrate: () => void;
  markOnboarded: () => void;
  /** 设置页「重看引导」用 */
  resetOnboarding: () => void;
  /** 重新读取浏览器权限（权限可能在站点设置里被外部改动） */
  refreshNotificationPermission: () => Promise<void>;
  /** 请求权限并开启；必须直接由用户点击触发 */
  enableNurtureNotice: () => Promise<NotificationPermissionState | 'error'>;
  disableNurtureNotice: () => void;
  /** 通知成功显示后记录去重键 */
  markNurtureNoticeShown: (key: string) => void;
}

export const useDeviceStore = create<DeviceState>((set, get) => {
  const persist = (key: string, value: unknown, patch: Partial<DeviceState>) => {
    try {
      write(key, value);
      set({ ...patch, error: null });
    } catch (e) {
      set({ error: e as Error });
    }
  };

  const readNurtureNotice = (): NurtureNoticePrefs => {
    const stored = read<NurtureNoticePrefs>(DEVICE_KEY.nurtureNotice);
    return stored ? sanitizeNurtureNoticePrefs(stored) : { ...DEFAULT_NURTURE_NOTICE_PREFS };
  };

  const persistNurtureNotice = (prefs: NurtureNoticePrefs): boolean => {
    try {
      write(DEVICE_KEY.nurtureNotice, prefs);
      set({
        notifyNurture: prefs.enabled,
        lastNurtureNoticeKey: prefs.lastKey ?? null,
        error: null,
      });
      return true;
    } catch (e) {
      set({ error: e as Error });
      return false;
    }
  };

  return {
    onboarded: false,
    notifyNurture: false,
    lastNurtureNoticeKey: null,
    notificationPermission: getInitialNotificationPermission(),
    hydrated: false,
    error: null,

    hydrate: () => {
      if (get().hydrated) return;
      const notice = readNurtureNotice();
      set({
        onboarded: read<boolean>(DEVICE_KEY.onboarded) === true,
        notifyNurture: notice.enabled,
        lastNurtureNoticeKey: notice.lastKey ?? null,
        notificationPermission: getInitialNotificationPermission(),
        hydrated: true,
      });
    },

    markOnboarded: () => {
      persist(DEVICE_KEY.onboarded, true, { onboarded: true });
      // Dismiss onboarding even when storage is unavailable; the unsaved notice remains visible.
      set({ onboarded: true });
    },

    resetOnboarding: () => {
      persist(DEVICE_KEY.onboarded, false, { onboarded: false });
      set({ onboarded: false });
    },

    refreshNotificationPermission: async () => {
      set({ notificationPermission: await getDeviceNotificationPermission() });
    },

    enableNurtureNotice: async () => {
      const permission = await requestDeviceNotificationPermission();
      set({ notificationPermission: permission, error: null });
      if (permission !== 'granted') return permission;
      const current = readNurtureNotice();
      return persistNurtureNotice({ ...current, enabled: true }) ? 'granted' : 'error';
    },

    disableNurtureNotice: () => {
      const current = readNurtureNotice();
      persistNurtureNotice({ ...current, enabled: false });
    },

    markNurtureNoticeShown: (key) => {
      const state = get();
      persistNurtureNotice({
        enabled: state.notifyNurture,
        lastKey: key,
      });
    },
  };
});

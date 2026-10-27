import { Capacitor } from '@capacitor/core';
import {
  LocalNotifications,
  type LocalNotificationSchema,
  type PermissionStatus,
} from '@capacitor/local-notifications';
import {
  isRunning,
  recordPoints,
  type NurtureDue,
  type NurtureRecord,
} from '../domain/nurture';

export type NotificationPermissionState =
  | NotificationPermission
  | 'unsupported';

export const isNativeApp = (): boolean => Capacitor.isNativePlatform();

function mapNativePermission(status: PermissionStatus): NotificationPermissionState {
  if (status.display === 'granted') return 'granted';
  if (status.display === 'denied') return 'denied';
  return 'default';
}

/** 同步值只用于首帧：原生权限需要异步查询，稍后由 refresh 方法校正 */
export function getInitialNotificationPermission(): NotificationPermissionState {
  if (isNativeApp()) return 'default';
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return window.Notification.permission;
}

export function getWebNotificationPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    return 'unsupported';
  }
  return window.Notification.permission;
}

export async function getDeviceNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNativeApp()) return getWebNotificationPermission();
  try {
    return mapNativePermission(await LocalNotifications.checkPermissions());
  } catch {
    return 'unsupported';
  }
}

/** 必须由用户手势直接调用；浏览器 / Android 系统负责弹权限框 */
export async function requestDeviceNotificationPermission(): Promise<NotificationPermissionState> {
  if (!isNativeApp()) {
    if (getWebNotificationPermission() === 'unsupported') return 'unsupported';
    if (window.Notification.permission !== 'default') {
      return window.Notification.permission;
    }
    return window.Notification.requestPermission();
  }

  try {
    const current = await LocalNotifications.checkPermissions();
    if (current.display === 'granted') return 'granted';
    return mapNativePermission(await LocalNotifications.requestPermissions());
  } catch {
    return 'unsupported';
  }
}

const NURTURE_URL = '/?nurture=1';
const NATIVE_CHANNEL = 'nurture';

/**
 * Web 通知：页面存活时到点发送。移动浏览器通常不允许页面直接 `new Notification()`，
 * 所以优先使用已注册的 Service Worker。
 */
export async function showNurtureDueNotice(due: NurtureDue): Promise<void> {
  if (getWebNotificationPermission() !== 'granted') {
    throw new Error('通知权限未授予');
  }

  const when = due.point.dayLabel === '今天'
    ? due.point.hm
    : `${due.point.dayLabel} ${due.point.hm}`;
  const options: NotificationOptions = {
    body: `${due.record.base} 上卡 · ${when} 该收/续了`,
    tag: `nurture-${due.record.id}-${due.point.index}-${due.point.ts}`,
    icon: '/pwa-192.png',
    data: { nurture: true, url: NURTURE_URL },
  };

  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
    const registration = await navigator.serviceWorker.getRegistration();
    if (registration) {
      await registration.showNotification('结界卡该收了', options);
      return;
    }
  }

  const notification = new window.Notification('结界卡该收了', options);
  notification.onclick = () => {
    window.focus();
    window.location.assign(NURTURE_URL);
    notification.close();
  };
}

/** 32 位正整数 ID：同一条记录的同一个点稳定映射，取消/重建不会撞号 */
function nativeNotificationId(key: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash & 0x7fffffff;
}

async function cancelNativeNurtureNotifications(): Promise<void> {
  const pending = await LocalNotifications.getPending();
  const ours = pending.notifications
    .filter((notification) => notification.extra?.source === 'nurture')
    .map((notification) => ({ id: notification.id }));
  if (ours.length) await LocalNotifications.cancel({ notifications: ours });
}

/**
 * 原生调度：把当前账号所有未完成收/续点交给 Android 系统。
 * 每次记录变化先取消旧的本应用提醒，再按新时间重建，避免修改时间后留下幽灵闹钟。
 */
export async function syncNativeNurtureNotifications(
  records: NurtureRecord[],
  enabled: boolean,
): Promise<void> {
  if (!isNativeApp()) return;

  await LocalNotifications.createChannel({
    id: NATIVE_CHANNEL,
    name: '结界卡提醒',
    description: '结界卡收/续点到点提醒',
    importance: 4,
    visibility: 1,
    vibration: true,
  });

  await cancelNativeNurtureNotifications();
  if (!enabled) return;
  if ((await getDeviceNotificationPermission()) !== 'granted') return;

  const now = new Date();
  const notifications: LocalNotificationSchema[] = [];
  for (const record of records.filter((item) => isRunning(item, now))) {
    for (const point of recordPoints(record, now)) {
      if (point.index <= 0 || point.doneAt !== undefined) continue;
      const key = `${record.id}:${point.index}:${point.ts}`;
      notifications.push({
        id: nativeNotificationId(key),
        title: '结界卡该收了',
        body: `${record.base} 上卡 · ${point.dayLabel} ${point.hm} 该收/续了`,
        channelId: NATIVE_CHANNEL,
        schedule: {
          at: new Date(Math.max(point.ts, Date.now() + 1000)),
          allowWhileIdle: true,
        },
        extra: {
          source: 'nurture',
          recordId: record.id,
          pointIndex: point.index,
          ts: point.ts,
        },
        isExactNotification: true,
        isExactMandatory: false,
      });
    }
  }
  if (!notifications.length) return;

  const result = await LocalNotifications.schedule({ notifications });
  if (result.warning) {
    console.warn('[nurture-notice] 精确闹钟未授权，已回退系统调度', result.warning);
  }
}

/** 原生通知点击：应用被杀后由插件在启动时派发 */
export async function listenNativeNurtureClick(handler: () => void): Promise<() => void> {
  if (!isNativeApp()) return () => undefined;
  const listener = await LocalNotifications.addListener(
    'localNotificationActionPerformed',
    (event) => {
      if (event.notification.extra?.source === 'nurture') handler();
    },
  );
  return () => {
    void listener.remove();
  };
}

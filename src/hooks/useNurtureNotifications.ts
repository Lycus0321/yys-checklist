import { useEffect, useRef } from 'react';
import {
  nextDue,
  nurtureNoticeKey,
  shouldNotifyNurture,
} from '../domain/nurture';
import {
  getWebNotificationPermission,
  isNativeApp,
  listenNativeNurtureClick,
  showNurtureDueNotice,
  syncNativeNurtureNotifications,
} from '../services/notifications';
import { useDeviceStore } from '../stores/device';
import { useNurtureStore } from '../stores/nurture';
import { useUiStore } from '../stores/ui';

/**
 * 结界卡到点通知（2026-10-27）。
 *
 * 纯 PWA 没有系统闹钟权限：页面存活时每分钟检查一次 `nextDue`，到点后发一条
 * 普通浏览器通知。应用被系统完全关闭后不会继续计时，这是能力边界，不假装成后台闹钟。
 *
 * 去重键落在设备级存储里：同一条记录的同一个收/续点只提醒一次；若前一点被改时间，
 * 新排期会生成新键并重新提醒。
 */
export function useNurtureNotifications(): void {
  const records = useNurtureStore((s) => s.records);
  const hydrate = useDeviceStore((s) => s.hydrate);
  const notifyNurture = useDeviceStore((s) => s.notifyNurture);
  const notificationPermission = useDeviceStore((s) => s.notificationPermission);
  const hydrated = useDeviceStore((s) => s.hydrated);
  const refreshPermission = useDeviceStore((s) => s.refreshNotificationPermission);
  const markShown = useDeviceStore((s) => s.markNurtureNoticeShown);
  const requestNav = useUiStore((s) => s.requestNav);
  const sending = useRef(false);

  useEffect(() => {
    hydrate();
    void refreshPermission();
  }, [hydrate, refreshPermission]);

  /* 通知点击：已有窗口走 Service Worker postMessage；冷启动走 `?nurture=1`。 */
  useEffect(() => {
    const openNurture = () => requestNav({ nav: 'tools', section: 'nurture' });

    const url = new URL(window.location.href);
    if (url.searchParams.get('nurture') === '1') {
      openNurture();
      url.searchParams.delete('nurture');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }

    let active = true;
    let removeNative: () => void = () => undefined;
    void listenNativeNurtureClick(openNurture).then((remove) => {
      if (active) removeNative = remove;
      else remove();
    });

    if (!('serviceWorker' in navigator)) {
      return () => {
        active = false;
        removeNative();
      };
    }
    const onMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'yys:nurture') openNurture();
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => {
      active = false;
      removeNative();
      navigator.serviceWorker.removeEventListener('message', onMessage);
    };
  }, [requestNav]);

  useEffect(() => {
    if (!hydrated) return;

    if (isNativeApp()) {
      void syncNativeNurtureNotifications(records, notifyNurture).catch((error) => {
        console.error('[nurture-notice] 原生通知调度失败', error);
      });
      return;
    }

    if (!notifyNurture) return;

    let disposed = false;
    const check = () => {
      void (async () => {
        if (disposed || sending.current) return;

        const permission = getWebNotificationPermission();
        if (permission !== useDeviceStore.getState().notificationPermission) {
          void refreshPermission();
        }
        if (permission !== 'granted') return;

        const now = new Date();
        const due = nextDue(useNurtureStore.getState().records, now);
        if (!due) return;

        const state = useDeviceStore.getState();
        if (
          !shouldNotifyNurture(due, now, {
            enabled: state.notifyNurture,
            lastKey: state.lastNurtureNoticeKey ?? undefined,
          })
        ) {
          return;
        }

        sending.current = true;
        try {
          await showNurtureDueNotice(due);
          markShown(nurtureNoticeKey(due));
        } catch (error) {
          /* 通知失败不打断应用；下一分钟仍会重试，直到成功或权限被撤下。 */
          console.error('[nurture-notice] 通知发送失败', error);
        } finally {
          sending.current = false;
        }
      })();
    };

    check();
    const timer = window.setInterval(check, 60000);
    const onVisible = () => {
      if (!document.hidden) check();
    };
    window.addEventListener('focus', check);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', check);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [
    hydrated,
    markShown,
    notificationPermission,
    notifyNurture,
    records,
    refreshPermission,
  ]);
}

import { useEffect, useState } from 'react';
import Icon from '../icons/Icon';
import SettingRow from '../common/SettingRow';
import { btn, tx } from '../common/controls';
import { useDevicePrefs } from '../../hooks/useDevicePrefs';
import {
  isNativeApp,
  showNativeTestNotification,
} from '../../services/notifications';

/**
 * 结界卡到点通知。设备级开关与浏览器权限分开存储：
 * 开关决定“用户想不想收”，Notification.permission 决定“浏览器让不让发”。
 */
export default function NurtureNotificationSection() {
  const {
    hydrated,
    hydrate,
    notifyNurture,
    notificationPermission,
    enableNurtureNotice,
    disableNurtureNotice,
    refreshNotificationPermission,
  } = useDevicePrefs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [feedback, setFeedback] = useState('');
  const native = isNativeApp();

  useEffect(() => {
    hydrate();
    void refreshNotificationPermission();
  }, [hydrate, refreshNotificationPermission]);

  const granted = notificationPermission === 'granted';
  const active = notifyNurture && granted;
  const blocked = notificationPermission === 'denied';
  const unsupported = notificationPermission === 'unsupported';

  const desc = unsupported
    ? '当前浏览器不支持通知'
    : blocked
      ? '通知权限已被浏览器阻止，请在站点设置中恢复'
      : active
        ? native
          ? '下一个收/续点由 Android 系统提醒；应用关闭后仍可触发'
          : '应用运行时，结界卡到收/续点提醒一次；关闭应用后不保证触发'
        : native
          ? '开启后，系统会在结界卡收/续点提醒；需通知权限'
          : '开启后，应用运行时到点提醒；需浏览器通知权限';

  const onToggle = async () => {
    setError('');
    setFeedback('');
    setBusy(true);
    try {
      if (active) {
        disableNurtureNotice();
        return;
      }
      const result = await enableNurtureNotice();
      if (result === 'denied') setError('通知权限被拒绝；可在浏览器站点设置中重新允许');
      else if (result === 'default') setError('尚未授予通知权限');
      else if (result === 'unsupported') setError('当前浏览器不支持通知');
      else if (result === 'error') setError('通知设置保存失败，请检查浏览器存储权限');
    } catch {
      setError('通知权限请求失败，请稍后重试');
    } finally {
      setBusy(false);
    }
  };

  const onTest = async () => {
    setError('');
    setFeedback('');
    setBusy(true);
    try {
      await showNativeTestNotification();
      setFeedback('测试通知已发送，约 1 秒后显示');
    } catch {
      setError('测试通知发送失败，请检查通知权限');
    } finally {
      setBusy(false);
    }
  };

  const label = unsupported
    ? '不支持'
    : blocked
      ? '权限已阻止'
      : busy
        ? '处理中…'
        : active
          ? '关闭通知'
          : '开启通知';

  return (
    <SettingRow
      title="结界卡通知"
      desc={desc}
      control={
        <>
          {native && active ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => void onTest()}
              className={`${btn.base} ${btn.sm} ${btn.out}`}
            >
              测试通知
            </button>
          ) : null}
          <button
            type="button"
            disabled={!hydrated || busy || unsupported || blocked}
            onClick={() => void onToggle()}
            className={`${btn.base} ${btn.sm} ${active ? btn.out : btn.sec}`}
          >
            <Icon name="tokei" size={12} />
            {label}
          </button>
        </>
      }
    >
      {feedback ? (
        <p className={`${tx.note} text-gold-hi`} role="status">
          {feedback}
        </p>
      ) : null}
      {error ? (
        <p className={`${tx.message} text-danger`} role="alert">
          {error}
        </p>
      ) : null}
    </SettingRow>
  );
}

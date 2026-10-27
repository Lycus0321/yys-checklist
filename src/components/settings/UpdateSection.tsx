import { useState } from 'react';
import Icon from '../icons/Icon';
import SettingRow from '../common/SettingRow';
import { btn, tx } from '../common/controls';
import { applyUpdate, checkForUpdate } from '../../services/pwa';
import { isNativeApp } from '../../services/notifications';
import { usePwaStore } from '../../stores/pwa';

/** 「检查更新」的一次性反馈；`preparing` 是"新版正在下载"的中间态 */
type CheckState = 'idle' | 'checking' | 'preparing' | 'latest' | 'error';

/**
 * 「设置 · 关于」下的「应用更新」行（2026-09-29 随离线能力接入）。
 *
 * ## 更新时机为什么由用户点
 *
 * 用户拍板："离线可用，更新时机交给用户"。装到主屏后，除取新版本外不再联网
 * （本应用运行时零网络请求，数据全在 localStorage）。静默 `autoUpdate` 虽省事，
 * 却可能在用户正勾选时把页面换掉 —— 这里改成：**发现新版只提示，重启由用户点**。
 *
 * ## 三个状态各有各的话
 *
 *   - 平时：说明"能离线用、只有更新才联网"（新用户最需要知道这一句）；
 *   - `needRefresh`：按钮换成「重启更新」—— 本页唯一需要用户"做个决定"的状态；
 *   - 点过检查后：`preparing`（下载中）/ `latest`（已是最新）/ `error`（多半是离线），
 *     后两者是一次性反馈，2.6 秒后自己退场，不占常驻位置。
 *
 * ## 为什么不用主按钮配方（`btn.pri`）
 *
 * `btn.pri` 是"朱红实心、同一屏最多一颗"的行动按钮，留给清单页的主行动。
 * 设置页整页都是管理操作，这里用次级（`btn.sec`）——「重启更新」要显眼，
 * 但不必在全页静默的调性里砸一颗红按钮。
 *
 * **不显示版本号**：应用版本就在紧邻的「数据版本」行里（`DataVersionSection`），
 * 同一页说两遍是这一页最容易犯的重复。
 */
export default function UpdateSection() {
  const supported = usePwaStore((s) => s.supported);
  const needRefresh = usePwaStore((s) => s.needRefresh);
  const offlineReady = usePwaStore((s) => s.offlineReady);
  const native = isNativeApp();
  const [state, setState] = useState<CheckState>('idle');

  const onCheck = async () => {
    setState('checking');
    const result = await checkForUpdate();
    if (result === 'update') {
      /* 新版正在下载：停在 preparing，等 `needRefresh` 置位后由下面的渲染接管 */
      setState('preparing');
      return;
    }
    setState(result === 'latest' ? 'latest' : 'error');
    window.setTimeout(() => setState('idle'), 2600);
  };

  const feedback =
    state === 'preparing'
      ? '发现新版本，正在下载…'
      : state === 'latest'
        ? '已是最新版本'
        : state === 'error'
          ? '检查失败 —— 多半是当前没联网，等联网后再试'
          : '';

  const desc = native
    ? 'Android 版通过安装新 APK 更新'
    : needRefresh
    ? '新版本已经下载好了，重启后生效'
    : supported
      ? `装到主屏后可离线使用，只有取新版本时才需要联网${
          offlineReady ? '（本机副本已缓存完成）' : ''
        }`
      : '当前浏览器不支持离线安装，联网打开照常使用';

  return (
    <SettingRow
      title="应用更新"
      desc={desc}
      control={
        native ? (
          <span className={`${tx.note} text-ink-3`}>APK</span>
        ) : needRefresh ? (
          <button
            type="button"
            onClick={applyUpdate}
            className={`${btn.base} ${btn.sm} ${btn.sec}`}
          >
            <Icon name="restore" size={12} />
            重启更新
          </button>
        ) : (
          <button
            type="button"
            disabled={!supported || state === 'checking'}
            onClick={() => void onCheck()}
            className={`${btn.base} ${btn.sm} ${btn.out}`}
          >
            {state === 'checking' ? '检查中…' : '检查更新'}
          </button>
        )
      }
    >
      {feedback ? (
        <p className={`${tx.note} ${state === 'error' ? 'text-crimson' : 'text-ink-3'}`}>
          {feedback}
        </p>
      ) : null}
    </SettingRow>
  );
}

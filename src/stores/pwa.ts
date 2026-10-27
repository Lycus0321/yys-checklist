import { Capacitor } from '@capacitor/core';
import { create } from 'zustand';

/**
 * PWA / Service Worker 状态（2026-09-29 接入离线能力时新建）。
 *
 * 为什么单独一个 store，而不是塞进 `stores/ui`：它描述的是**浏览器与 SW 的握手状态**
 * （能否安装、有没有新版待应用），与页面导航、弹层这类界面状态没有交集。
 * 而它天然是"两个位置用同一份状态"——注册发生在应用启动时（`App.tsx`），
 * 按钮却在设置页里。
 *
 * ⚠️ **不可持久化**：SW 活在浏览器层，刷新页面就要重新握手，存下来只会读到假状态。
 */
interface PwaState {
  /** 浏览器是否支持 Service Worker（老浏览器 / 非安全上下文为 false） */
  supported: boolean;
  /** 注册成功 —— 只表示"握手完成"，不代表离线已就绪 */
  registered: boolean;
  /** 新版已下载、等用户重启才生效（`registerType: 'prompt'` 的唯一信号） */
  needRefresh: boolean;
  /** 首次缓存已写完：此后断网也能打开 */
  offlineReady: boolean;
  setRegistered: (v: boolean) => void;
  setNeedRefresh: (v: boolean) => void;
  setOfflineReady: (v: boolean) => void;
}

const detectSupport = () =>
  !Capacitor.isNativePlatform()
  && typeof navigator !== 'undefined'
  && 'serviceWorker' in navigator;

export const usePwaStore = create<PwaState>()((set) => ({
  supported: detectSupport(),
  registered: false,
  needRefresh: false,
  offlineReady: false,
  setRegistered: (registered) => set({ registered }),
  setNeedRefresh: (needRefresh) => set({ needRefresh }),
  setOfflineReady: (offlineReady) => set({ offlineReady }),
}));

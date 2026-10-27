/**
 * 本机 localStorage 字节层 —— **全应用唯一读写 localStorage 的地方**（设计文档 §2 铁律）。
 * Mock Adapter 的用户数据分片、以及设备级状态，都只经由这里落盘。
 *
 * 两类键必须分开理解：
 *   - **用户数据分片**（`yys:state|view|ovr|checklog|guild|plans:{profileId}`）：属于用户数据模型，
 *     经 `ApiClient` 契约读写，后期接后端要上传（见 `api/mock/persist.ts`）；
 *   - **设备级键**（本文件 `DEVICE_KEY`）：**不属于用户数据模型** —— 不随账号走、不上后端、
 *     在 mock 与 http 两种模式下行为完全一致。
 *
 * ## 设备级键的收敛（2026-09-16，用户决策）
 *
 * 原来这里有三个键：寮时间、引导标记、寄养计划。**寮时间与寄养计划已升为账号级分片** ——
 * 它们都不是"这台手机的属性"：寮时间取决于所在寮（可能是代管的号、或两个号在两个寮），
 * 寄养节奏取决于具体号的结界卡；而且只有这样，它们才能被备份带走
 * （用户要求"所有配置项均可备份"）。现在只剩 `onboarded`。
 *
 * 历史键（**按用户决策不做迁移，直接作废**）：`yys:guildTime` / `yys:plans` 在新版本中
 * 不再有任何读取点，旧值残留在本机无害；用户需要在新版里重新配置一次，或用设置页的
 * 「同步到其他账号」批量铺开。另有更早的 `yys:notify` / `yys:reminded`
 * 随 `S7 提醒能力` 下线删除；2026-10-27 重新接入的通知只使用新的
 * `yys:nurture-notice`，上述两个旧键仍不得复活。
 */

export const NS = 'yys';

/** 设备级键：本机状态，不参与契约、不随账号、不上传 */
export const DEVICE_KEY = {
  /** 冷启动引导完成标记（一次性）—— 不是"配置"，是"这台设备看过没有" */
  onboarded: `${NS}:onboarded`,
  /**
   * 明暗主题（2026-09-23 新增）。
   * 归为设备级而非账号级：明暗是屏幕与环境的属性，不是"玩哪个号"的属性。
   * 没存过时跟随系统 `prefers-color-scheme`，系统也读不到才落回明版（见 `stores/theme`）。
   */
  theme: `${NS}:theme`,
  /**
   * 结界卡到点通知（2026-10-27）。设备级而非账号级：
   * 浏览器通知权限属于当前设备 / 站点；`lastKey` 也只用于当前设备的去重。
   */
  nurtureNotice: `${NS}:nurture-notice`,
} as const;

function storage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch (e) {
    console.error('[localStore] localStorage 不可用（隐私模式？）', e);
    return null;
  }
}

export function read<T>(key: string): T | null {
  const ls = storage();
  if (!ls) return null;
  try {
    const raw = ls.getItem(key);
    return raw === null ? null : (JSON.parse(raw) as T);
  } catch (e) {
    console.error(`[localStore] 读取失败，按缺失处理：${key}`, e);
    return null;
  }
}

export function write<T>(key: string, value: T): void {
  const ls = storage();
  if (!ls) throw new Error('浏览器本地存储不可用，请检查存储权限后重试。');
  try {
    ls.setItem(key, JSON.stringify(value));
  } catch (e) {
    console.error(`[localStore] 写入失败：${key}`, e);
    const full = e instanceof Error
      && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED');
    throw new Error(full
      ? '本地存储空间不足，请释放空间后重试。'
      : '无法写入本地存储，请检查浏览器存储权限后重试。');
  }
}

export function remove(key: string): void {
  const ls = storage();
  if (!ls) throw new Error('浏览器本地存储不可用，请检查存储权限后重试。');
  try {
    ls.removeItem(key);
  } catch (e) {
    console.error(`[localStore] 删除失败：${key}`, e);
    throw new Error('无法更新本地存储，请检查浏览器存储权限后重试。');
  }
}

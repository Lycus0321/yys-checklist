import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEVICE_KEY } from '../services/localStore';
import { installMemoryStorage } from '../test/memoryStorage';
import { useDeviceStore } from './device';

const storage = installMemoryStorage();

beforeEach(() => {
  storage.clear();
  storage.written.length = 0;
  useDeviceStore.setState({
    onboarded: false,
    notifyNurture: false,
    lastNurtureNoticeKey: null,
    notificationPermission: 'unsupported',
    hydrated: false,
    error: null,
  });
});

afterEach(() => vi.restoreAllMocks());

/**
 * 设备级状态。
 *
 * 2026-09-16：寮时间与结界寄养计划升为**账号级**（见 `stores/guildTime` /
 * `stores/nurture` 各自的测试），本文件只剩引导标记 —— 它的"设备级"身份没变，
 * 因为它不是配置，而是"这台设备看过引导没有"。
 */
describe('设备级状态', () => {
  it('hydrate 从本机读引导标记，且幂等（已 hydrated 不再读）', () => {
    storage.setItem(DEVICE_KEY.onboarded, JSON.stringify(true));

    useDeviceStore.getState().hydrate();
    expect(useDeviceStore.getState().hydrated).toBe(true);
    expect(useDeviceStore.getState().onboarded).toBe(true);

    /* 内存态被人为改掉后再 hydrate：不该再读本机（幂等） */
    useDeviceStore.setState({ onboarded: false });
    useDeviceStore.getState().hydrate();
    expect(useDeviceStore.getState().onboarded).toBe(false);
  });

  it('本机无数据时给出安全默认值', () => {
    useDeviceStore.getState().hydrate();
    expect(useDeviceStore.getState().onboarded).toBe(false);
  });

  it('markOnboarded / resetOnboarding 落盘到设备级键', () => {
    useDeviceStore.getState().markOnboarded();
    expect(useDeviceStore.getState().onboarded).toBe(true);
    expect(storage.written).toContain(DEVICE_KEY.onboarded);

    useDeviceStore.getState().resetOnboarding();
    expect(useDeviceStore.getState().onboarded).toBe(false);
    expect(storage.written).toContain(DEVICE_KEY.onboarded);
  });

  it('写入失败时置 error，但内存态仍然生效（不挡住用户继续用）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(storage, 'setItem').mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });

    useDeviceStore.getState().markOnboarded();
    expect(useDeviceStore.getState().error).toBeTruthy();
    /* markOnboarded 里刻意在 persist 之后又 set 了一次：存储不可用时引导仍要能关掉，
       否则用户会被一个永远关不掉的弹层挡在外面 */
    expect(useDeviceStore.getState().onboarded).toBe(true);
  });

  it('通知偏好与去重键从设备级键恢复', () => {
    storage.setItem(
      DEVICE_KEY.nurtureNotice,
      JSON.stringify({ enabled: true, lastKey: 'nr_1:1:123' }),
    );

    useDeviceStore.getState().hydrate();
    expect(useDeviceStore.getState().notifyNurture).toBe(true);
    expect(useDeviceStore.getState().lastNurtureNoticeKey).toBe('nr_1:1:123');
  });

  it('关闭通知时保留去重键，避免重新开启后同一收/续点重复提醒', () => {
    useDeviceStore.setState({ notifyNurture: true });
    useDeviceStore.getState().markNurtureNoticeShown('nr_1:1:123');

    useDeviceStore.getState().disableNurtureNotice();
    const saved = JSON.parse(storage.getItem(DEVICE_KEY.nurtureNotice) ?? '{}');
    expect(saved).toEqual({ enabled: false, lastKey: 'nr_1:1:123' });
    expect(useDeviceStore.getState().notifyNurture).toBe(false);
  });
});

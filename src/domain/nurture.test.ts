/**
 * 结界寄养时间测试。全部用**固定 now**，不依赖真实时间 —— 否则测试会在特定时刻随机失败。
 */
import { describe, expect, it } from 'vitest';
import {
  baseTsOf,
  clearPointDone,
  dueText,
  endLabelOf,
  endRecord,
  endTsOf,
  hmToDate,
  isRunning,
  makeNurture,
  markPointDone,
  MAX_NURTURE_DELAY,
  MAX_NURTURE_HOURS,
  MAX_NURTURE_N,
  nextDue,
  nextPendingPoint,
  normalizeHM,
  nurtureNoticeKey,
  nurturePoints,
  pointCountOf,
  pointStats,
  recordPoints,
  sanitizePlans,
  sanitizeNurtureNoticePrefs,
  shouldNotifyNurture,
  sortNurture,
  type NurtureRecord,
} from './nurture';

/** 2026-09-10（周四）14:00 */
const NOW = new Date(2026, 8, 10, 14, 0, 0);
/** 今天的某个时刻（时间戳） */
const at = (h: number, m = 0): number => new Date(2026, 8, 10, h, m).getTime();

describe('normalizeHM', () => {
  it('补零并校验范围', () => {
    expect(normalizeHM('9:05')).toBe('09:05');
    expect(normalizeHM('21:05')).toBe('21:05');
    expect(normalizeHM(' 23:59 ')).toBe('23:59');
  });

  it('非法输入返回 null（00:60 / 24:00 / 不补零的分钟 / 乱填）', () => {
    for (const bad of ['', 'abc', '24:00', '12:60', '9:5', '12-30']) expect(normalizeHM(bad)).toBeNull();
  });

  it('hmToDate：`HH:mm` → 今天的该时刻；非法 → null（实际完成时间输入用）', () => {
    expect(hmToDate('8:05', NOW)?.getTime()).toBe(at(8, 5));
    expect(hmToDate('乱填', NOW)).toBeNull();
  });
});

describe('nurturePoints：每 6h 推点（不含上卡点）', () => {
  it('从上卡时刻起推 n 个点，**不含上卡那一刻自身**', () => {
    const pts = nurturePoints('10:00', 4, NOW);
    expect(pts.map((p) => p.hm)).toEqual(['16:00', '22:00', '04:00', '10:00']);
    expect(pts.map((p) => p.index)).toEqual([1, 2, 3, 4]);
  });

  it('跨天自动标 明天 / 后天', () => {
    expect(nurturePoints('10:00', 4, NOW).map((p) => p.dayLabel)).toEqual(['今天', '今天', '明天', '明天']);
    /* 18:00 上卡推到第 5 点正好跨到后天 */
    expect(nurturePoints('18:00', MAX_NURTURE_N, NOW).map((p) => p.dayLabel)).toEqual([
      '明天',
      '明天',
      '明天',
      '明天',
      '后天',
    ]);
  });

  it('已过 / 未到按 now 判定；**同刻算未到**（那一点正是现在要做的事）', () => {
    const pts = nurturePoints('10:00', 4, NOW);
    expect(pts.map((p) => p.past)).toEqual([false, false, false, false]);

    const early = nurturePoints('02:00', 3, NOW);
    expect(early.map((p) => p.hm)).toEqual(['08:00', '14:00', '20:00']);
    expect(early.map((p) => p.past)).toEqual([true, false, false]);
  });

  it('非法上卡时间回落到"现在"，不抛错', () => {
    const pts = nurturePoints('乱填', 2, NOW);
    /* 14:00 → 20:00 / 次日 02:00 */
    expect(pts.map((p) => p.hm)).toEqual(['20:00', '02:00']);
  });

  it('n=0 返回空数组（不生成上卡时刻）', () => {
    expect(nurturePoints('10:00', 0, NOW)).toEqual([]);
  });
});

describe('recordPoints：上卡点 + 逐点递推（2026-09-15 重构）', () => {
  it('点列表以上卡点（index 0）打头，且它天然是已完成', () => {
    const r = makeNurture('08:00', 18, true, NOW);
    const pts = recordPoints(r, NOW);
    expect(pts.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    expect(pts.map((p) => p.hm)).toEqual(['08:00', '14:00', '20:00', '02:00']);
    expect(pts[0].doneAt).toBe(at(8));
    expect(pts[1].doneAt).toBeUndefined();
  });

  it('给某个点记完成 → 该点显示实际时刻，之后的点顺延，之前的原样不动', () => {
    const r = makeNurture('08:00', 18, true, NOW);
    /* 14:00 那个点实际 14:05 才收 */
    const done = markPointDone(r, 1, new Date(2026, 8, 10, 14, 5));
    const pts = recordPoints(done, NOW);

    /* 点 1 自己显示 14:05（实际），不再是 14:00（预计）—— 2026-09-20 修复 */
    expect(pts.map((p) => p.hm)).toEqual(['08:00', '14:05', '20:05', '02:05']);
    expect(pts[1].doneAt).toBe(new Date(2026, 8, 10, 14, 5).getTime());
    expect(pts[0].doneAt).toBe(at(8)); // 上卡点不受影响
    expect(pts[2].doneAt).toBeUndefined();
  });

  it('已完成的点：`hm` 取实际、`ts` 仍是预计（两套时刻各司其职）', () => {
    const r = makeNurture('08:00', 12, true, NOW);
    const pts = recordPoints(markPointDone(r, 1, new Date(2026, 8, 10, 14, 5)), NOW);
    expect(pts[1].hm).toBe('14:05');
    /* `ts` 不受影响 —— 递推基准与 nextDue 排队都按预计值 */
    expect(pts[1].ts).toBe(at(14));
    expect(pts[2].hm).toBe('20:05');
  });

  it('连续两个点各按自己的实际时间 → 后一个基于前一个的实际时间递推', () => {
    let r = makeNurture('08:00', 18, true, NOW);
    r = markPointDone(r, 1, new Date(2026, 8, 10, 14, 5));
    r = markPointDone(r, 2, new Date(2026, 8, 10, 20, 12));
    expect(recordPoints(r, NOW).map((p) => p.hm)).toEqual(['08:00', '14:05', '20:12', '02:12']);
  });

  it('取消某点的完成 → 该点与后续一起回到"按预计时间推"', () => {
    const r = makeNurture('08:00', 18, true, NOW);
    const done = markPointDone(r, 1, new Date(2026, 8, 10, 14, 5));
    expect(recordPoints(done, NOW).map((p) => p.hm)).toEqual(['08:00', '14:05', '20:05', '02:05']);
    expect(recordPoints(clearPointDone(done, 1), NOW).map((p) => p.hm)).toEqual([
      '08:00',
      '14:00',
      '20:00',
      '02:00',
    ]);
  });

  it('上卡点不接受改写（index 0 由 base 决定）', () => {
    const r = makeNurture('08:00', 12, true, NOW);
    expect(markPointDone(r, 0, new Date(2026, 8, 10, 9, 30))).toEqual(r);
  });
});

describe('pointCountOf / endTsOf / endLabelOf：由持续时间派生（2026-09-20）', () => {
  it('点数 = 持续时间 / 6 向下取整（用户给的例子：22h → 3 次）', () => {
    expect(pointCountOf(22)).toBe(3);
    expect(pointCountOf(24)).toBe(4);
    expect(pointCountOf(18)).toBe(3);
    expect(pointCountOf(23)).toBe(3);
    /* 不足一个间隔：卡还没到第一个续点就到期 */
    expect(pointCountOf(5)).toBe(0);
    expect(pointCountOf(0)).toBe(0);
  });

  it('点数受上限夹紧', () => {
    expect(pointCountOf(MAX_NURTURE_HOURS)).toBe(MAX_NURTURE_N);
    expect(pointCountOf(999)).toBe(MAX_NURTURE_N);
  });

  it('结束时刻 = 上卡 + 持续时间（不是"最后一个点 + 6h"）', () => {
    /* 08:00 上卡、22h 的卡：最后一点在 02:00（+18h），但卡要到 06:00 才结束 */
    expect(endTsOf({ base: '08:00', hours: 22 }, NOW)).toBe(new Date(2026, 8, 11, 6, 0).getTime());
    expect(endLabelOf({ base: '08:00', hours: 22 }, NOW)).toBe('明天 06:00');
  });

  it('记录的点数与结束时间一致：22h 排出 3 个点、都落在结束之前', () => {
    const r = makeNurture('08:00', 22, true, NOW);
    const pts = recordPoints(r, NOW);
    expect(pts.map((p) => p.index)).toEqual([0, 1, 2, 3]);
    const end = endTsOf(r, NOW);
    for (const p of pts) expect(p.ts).toBeLessThan(end);
  });

  it('`delay` 按分钟累积：6:00 上卡、延迟 5 → 12:05 → 18:10', () => {
    const r = makeNurture('06:00', 22, true, NOW, 5);
    expect(recordPoints(r, NOW).map((p) => p.hm)).toEqual(['06:00', '12:05', '18:10', '00:15']);
  });

  it('延迟会挤掉点数：24h 的卡配 5 分钟延迟只剩 3 个点', () => {
    /* 第 4 点会落在 24h20min，已超出卡的寿命 —— 这正是"算次数时要带上延迟" */
    expect(pointCountOf(24, 0)).toBe(4);
    expect(pointCountOf(24, 5)).toBe(3);
    expect(pointCountOf(22, 5)).toBe(3);
    /* 延迟大到一定程度，一个续点都排不出来 */
    expect(pointCountOf(6, 60)).toBe(0);
  });

  it('延迟不影响结束时间：结束仍由持续时间决定', () => {
    const r = makeNurture('06:00', 22, true, NOW, 5);
    expect(endTsOf(r, NOW)).toBe(new Date(2026, 8, 11, 4, 0).getTime());
  });

  it('延迟夹到 [0, MAX_NURTURE_DELAY]；负数与非数按 0', () => {
    expect(makeNurture('06:00', 12, true, NOW, -5).delay).toBe(0);
    expect(makeNurture('06:00', 12, true, NOW, 999).delay).toBe(MAX_NURTURE_DELAY);
    expect(makeNurture('06:00', 12, true, NOW).delay).toBe(0);
  });
});

describe('pointStats / nextPendingPoint', () => {
  it('统计已完成与待收（上卡点算已完成）', () => {
    const r = makeNurture('08:00', 18, true, NOW);
    expect(pointStats(recordPoints(r, NOW))).toEqual({ done: 1, pending: 3 });
    expect(pointStats(recordPoints(markPointDone(r, 1, new Date(2026, 8, 10, 14, 5)), NOW))).toEqual({
      done: 2,
      pending: 2,
    });
  });

  it('nextPendingPoint 取第一个未完成的收/续点（已过时间也算待办，不会跳过）', () => {
    const r = makeNurture('06:00', 18, true, NOW); // 12:00 / 18:00 / 00:00，其中 12:00 已过
    expect(nextPendingPoint(r, NOW)?.hm).toBe('12:00');

    const done = markPointDone(r, 1, new Date(2026, 8, 10, 12, 10));
    expect(nextPendingPoint(done, NOW)?.hm).toBe('18:10');
  });

  it('全部完成 → nextPendingPoint 为 null', () => {
    let r = makeNurture('08:00', 12, true, NOW);
    r = markPointDone(r, 1, new Date(2026, 8, 10, 14, 5));
    r = markPointDone(r, 2, new Date(2026, 8, 10, 20, 10));
    expect(nextPendingPoint(r, NOW)).toBeNull();
  });
});

describe('baseTsOf', () => {
  it('base 按今天解释；非法 base 回落到现在', () => {
    expect(baseTsOf({ base: '10:00' }, NOW)).toBe(at(10));
    expect(baseTsOf({ base: '乱填' }, NOW)).toBe(at(14));
  });
});

describe('nextDue / dueText：跨任务取最紧要的待办点（壳层徽章用）', () => {
  it('只算任务，取时间最早的那个未完成点（计划不参与）', () => {
    const early = makeNurture('08:00', 18, true, NOW); // 14:00 / 20:00 / 02:00
    const late = makeNurture('12:00', 18, true, NOW); // 18:00 / 00:00 / 06:00
    const plan = makeNurture('06:00', 18, false, NOW);

    const due = nextDue([late, plan, early], NOW);
    expect(due?.record.id).toBe(early.id);
    expect(due?.point.hm).toBe('14:00');
  });

  it('任务全部完成、或只有计划 → null', () => {
    let r = makeNurture('08:00', 6, true, NOW);
    r = markPointDone(r, 1, new Date(2026, 8, 10, 14, 5));
    expect(nextDue([r], NOW)).toBeNull();
    expect(nextDue([makeNurture('08:00', 18, false, NOW)], NOW)).toBeNull();
  });

  it('dueText：分 / 时:分 / 整点 / 到点即提醒', () => {
    const base = NOW.getTime();
    expect(dueText(base + 45 * 60000, NOW)).toBe('45 分');
    expect(dueText(base + (2 * 60 + 15) * 60000, NOW)).toBe('2h15m');
    expect(dueText(base + 120 * 60000, NOW)).toBe('2h');
    expect(dueText(base, NOW)).toBe('该收卡了');
    expect(dueText(base - 1000, NOW)).toBe('该收卡了');
  });
});

describe('结界卡通知：到点判定与去重', () => {
  const prefs = { enabled: true };
  const record = makeNurture('08:00', 18, true, NOW); // 14:00 / 20:00 / 02:00

  it('未到点不提醒，到点且未提醒过才提醒', () => {
    const due = nextDue([record], NOW)!;
    expect(shouldNotifyNurture(due, new Date(2026, 8, 10, 13, 59), prefs)).toBe(false);
    expect(shouldNotifyNurture(due, NOW, prefs)).toBe(true);
    expect(shouldNotifyNurture(due, NOW, { enabled: false })).toBe(false);
  });

  it('同一个点提醒后去重；点被重新排期则生成新键', () => {
    const due = nextDue([record], NOW)!;
    const sent = { enabled: true, lastKey: nurtureNoticeKey(due) };
    expect(shouldNotifyNurture(due, NOW, sent)).toBe(false);
    expect(nurtureNoticeKey({ ...due, point: { ...due.point, ts: due.point.ts + 60000 } }))
      .not.toBe(sent.lastKey);
  });

  it('净化通知偏好：坏值回落关闭，合法去重键保留', () => {
    expect(sanitizeNurtureNoticePrefs(null)).toEqual({ enabled: false });
    expect(sanitizeNurtureNoticePrefs({ enabled: 'yes', lastKey: 42 })).toEqual({ enabled: false });
    expect(sanitizeNurtureNoticePrefs({ enabled: true, lastKey: 'nr_1:1:123' }))
      .toEqual({ enabled: true, lastKey: 'nr_1:1:123' });
  });
});

describe('makeNurture / sortNurture', () => {
  it('归一化 base、夹紧持续时间、id 唯一', () => {
    const a = makeNurture('9:05', 99, true, NOW);
    const b = makeNurture('9:05', -3, false, NOW);
    expect(a.base).toBe('09:05');
    expect(a.hours).toBe(MAX_NURTURE_HOURS);
    expect(b.hours).toBe(1);
    expect(a.id).not.toBe(b.id);
  });

  it('非法 base 回落到当前时刻', () => {
    expect(makeNurture('乱填', 24, true, NOW).base).toBe('14:00');
  });

  it('新记录没有完成记录；dones 只在记完成时出现', () => {
    const r = makeNurture('10:00', 24, true, NOW);
    expect(r.dones).toBeUndefined();
    expect(markPointDone(r, 1, NOW).dones).toEqual({ 1: NOW.getTime() });
  });

  it('任务在前、计划在后，各自按创建时间倒序', () => {
    const recs = [
      makeNurture('10:00', 24, false, new Date(2026, 8, 10, 10, 0)),
      makeNurture('11:00', 24, true, new Date(2026, 8, 10, 11, 0)),
      makeNurture('12:00', 24, true, new Date(2026, 8, 10, 12, 0)),
    ];
    const sorted = sortNurture(recs);
    expect(sorted.map((r) => r.base)).toEqual(['12:00', '11:00', '10:00']);
    expect(sorted.map((r) => r.started)).toEqual([true, true, false]);
  });
});

/* ─────────────── 上卡日期锚定 + 「同时只记一条进行中」（2026-09-28） ─────────────── */

describe('上卡日期：任务记下 `baseDate`，点不再漂到今天', () => {
  it('任务是唯一带日期的形态；计划不带（它本就按"今晚"解释）', () => {
    expect(makeNurture('21:00', 24, true, NOW).baseDate).toBe('2026-09-10');
    expect(makeNurture('21:00', 24, false, NOW).baseDate).toBeUndefined();
  });

  it('`baseTsOf` 按 `baseDate` 锚定，而不是每次都算今天', () => {
    expect(baseTsOf({ base: '21:00', baseDate: '2026-09-08' }, NOW)).toBe(
      new Date(2026, 8, 8, 21, 0).getTime(),
    );
    /* 无 `baseDate` 的计划仍按今天 —— 保留「预先登记今晚上卡」的用法 */
    expect(baseTsOf({ base: '21:00' }, NOW)).toBe(at(21));
  });

  it('老记录（任务、无 `baseDate`）回落 `createdAt` 那一天 —— 这就是"几天后还在进行中"的正解', () => {
    const legacy = {
      id: 'x',
      base: '21:00',
      hours: 24,
      delay: 0,
      started: true,
      createdAt: new Date(2026, 8, 8, 21, 0).getTime(),
    };
    expect(baseTsOf(legacy, NOW)).toBe(new Date(2026, 8, 8, 21, 0).getTime());
  });

  it('过去的日子标「昨天 / M/D」，不再一律写成"今天"', () => {
    /* 9/9 10:00 上卡、6h 卡 → 上卡点与唯一一个收点都落在昨天 */
    const r = { ...makeNurture('10:00', 6, true, NOW), baseDate: '2026-09-09' };
    expect(recordPoints(r, NOW).map((p) => p.dayLabel)).toEqual(['昨天', '昨天']);
    /* 更早的日子没有"前天"这种说法，写日期 */
    const older = { ...r, baseDate: '2026-09-07' };
    expect(recordPoints(older, NOW)[0].dayLabel).toBe('9/7');
  });
});

describe('isRunning / nextDue：到期与被结束都不算进行中', () => {
  it('进行中 = 任务 且 未结束 且 卡未到期', () => {
    const running = { ...makeNurture('10:00', 24, true, NOW), baseDate: '2026-09-10' };
    expect(isRunning(running, NOW)).toBe(true);
    /* 三天前的 24h 卡：早到期 */
    expect(isRunning({ ...running, baseDate: '2026-09-07' }, NOW)).toBe(false);
    expect(isRunning({ ...running, endedAt: NOW.getTime() }, NOW)).toBe(false);
    expect(isRunning({ ...running, started: false }, NOW)).toBe(false);
  });

  it('endRecord 只给"任务且未结束"盖时间戳（计划 / 已结束的不动）', () => {
    const task = makeNurture('10:00', 24, true, NOW);
    const plan = makeNurture('10:00', 24, false, NOW);
    expect(endRecord(plan, NOW).endedAt).toBeUndefined();
    const once = endRecord(task, NOW);
    expect(once.endedAt).toBe(NOW.getTime());
    expect(endRecord(once, new Date(2026, 8, 11)).endedAt).toBe(NOW.getTime());
  });

  it('几天前的旧任务不再占着徽章', () => {
    const stale: NurtureRecord = {
      ...makeNurture('10:00', 24, true, NOW),
      baseDate: '2026-09-05',
    };
    expect(nextDue([stale], NOW)).toBeNull();
  });
});

describe('sanitizePlans：新增的两个可选字段', () => {
  it('`baseDate` 合法才留、`endedAt` 只认有限数；缺失照旧可用（不丢整条）', () => {
    const rows = sanitizePlans([
      { id: 'a', base: '10:00', hours: 24, started: true, createdAt: 1, baseDate: '2026-09-08', endedAt: 123 },
      { id: 'b', base: '10:00', hours: 24, started: true, createdAt: 1, baseDate: '乱填', endedAt: 'x' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0].baseDate).toBe('2026-09-08');
    expect(rows[0].endedAt).toBe(123);
    expect(rows[1].baseDate).toBeUndefined();
    expect(rows[1].endedAt).toBeUndefined();
  });
});

/**
 * 结界寄养时间派生（S6）—— 纯函数，无 IO。
 *
 * 规则（原型 v6 定稿，需求侧已确认）：**每次 6 小时**，记下「上卡时间」后，
 * 自动排出往后每 6h 的收/续点（跨天标 明天/后天/日期）。
 *
 * 两个状态刻意分开：
 *   - **任务**（`started: true`）：逐点记录完成情况
 *   - **计划**（`started: false`）：纯查看，不背状态；决定开刷时点「开始」转正
 * 这个区分是有意义的 —— 用户常常只是"打算这个点寄"，并不想一存就被判成未到。
 *
 * ## 点模型（2026-09-15 重构）
 *
 * 点列表 = `[上卡点(index 0), 收/续点 1..n]`，**上卡点也作为一个点**展示
 * （它是任务的起点，之前只存在 `base` 里、列表上看不到）。
 *
 * 递推规则：第 k 点的预计时刻 = 前一个点的「实际完成时间（没有就用它的预计时刻）」+ 6h。
 * 于是给某个点记完成，只把它**之后**的点往后挪，之前的点原样不动 ——
 * 早先那版「记一次完成就把整条任务重新推一遍」会让用户觉得任务被初始化了（2026-09-15 用户反馈）。
 */
import { dayKey, dayKeyOf, keyToTs } from './checkLog';

/** 寄养间隔（小时）。写成常量而不是散落的 6 —— 官方若调整，只改这一处 */
export const NURTURE_HOURS = 6;
/** 收/续点数上限（5 个 ≈ 30h，够覆盖一张 6 星卡） */
export const MAX_NURTURE_N = 5;
/** 结界卡持续时间上限（小时）—— 与点数上限一致，避免"排得出点、但记不下"的不一致 */
export const MAX_NURTURE_HOURS = MAX_NURTURE_N * NURTURE_HOURS;
/**
 * 每次收/续的延迟上限（分钟，2026-09-20 新增）。
 * 实测里"总是晚几分钟"很常见，但超过一小时就该去改上卡时间而不是记延迟了 ——
 * 而且延迟越大、挤掉的点数越多，给个上限免得填出 0 个点的记录。
 */
export const MAX_NURTURE_DELAY = 60;

export interface NurtureRecord {
  id: string;
  /** 上卡时间 `HH:mm` */
  base: string;
  /**
   * 上卡**日期**（`YYYY-MM-DD`，2026-09-28 新增）。
   *
   * 为什么必须记：`base` 只有 `HH:mm`，而 `baseTsOf` 原先一律把它解释成**今天** ——
   * 几天前上的卡每次渲染都重新锚定到今天，点永远落在未来，于是任务"永远进行中"
   * （用户反馈："明明已经到了几天后了，任务还在进行中"）。记下日期后，点、结束时刻、
   * 徽章才落在真实的那一天上。
   *
   * 计划（`started: false`）**不带**它 —— 计划本就是"打算今晚寄"，按今天解释才对
   * （预先登记今晚 18:00 上卡是合法用法）。
   */
  baseDate?: string;
  /**
   * 任务结束时刻（2026-09-28 新增）—— 同一时刻**只允许一个进行中的任务**：
   * 新任务开始时（`add(started)` / `promote`）自动给此前还在进行中的那条盖上它，
   * 那条转入「已结束」（记录与点列表都留着，只是不再提醒、不再算进行中）。
   *
   * 卡**自然到期**（`now >= 上卡 + 持续`）不写入这个字段，由 `isRunning` 派生 ——
   * 到期是时间推移的必然结果，不需要（也不该有）任何定时任务去改数据。
   */
  endedAt?: number;
  /**
   * 结界卡的**持续时间**（小时，1 – `MAX_NURTURE_HOURS`）。
   *
   * 2026-09-20 起改由它推算点数（用户要求：不让用户直接选次数，而是填卡能持续多久）。
   * 点数**不落盘**，由 `pointCountOf(hours)` 派生 —— 存两个字段迟早会漂移
   * （改了时长忘了改次数，界面上就会出现"说 3 个点、显示 5 个"）。
   *
   * 它也不能用 `点数 × 6` 反推：最后一个收/续点之后卡还会继续生效一段时间
   * （22h 的卡，最后一点在 18h，结束在 22h），结束时刻必须由它本身决定。
   */
  hours: number;
  /**
   * 每次收/续的**延迟**（分钟，0 – `MAX_NURTURE_DELAY`），2026-09-20 新增。
   *
   * 递推因此变成：第 k 点 = 上卡 + `k × (6h + delay)`。
   * 延迟**逐点累积**（6:00 上卡、延迟 5 → 12:05 → 18:10），所以算「能排几个点」时
   * 必须把它算进去：22h 的卡配 5 分钟延迟仍是 3 点，但 24h 的卡就只有 3 点而非 4 点
   * —— 第 4 点会落在 24h20min，已经超出卡的寿命。见 `pointCountOf`。
   */
  delay: number;
  /** true = 任务（记状态） / false = 计划（纯查看） */
  started: boolean;
  createdAt: number;
  /**
   * 逐点完成记录：点序号（1..`pointCountOf(hours)`，**不含上卡点**）→ 实际完成时间戳。
   * 缺席表示该点还没收/续。上卡点天然视为已完成（它的完成时刻就是 `base` 那一刻）。
   */
  dones?: Record<number, number>;
}

/** 延迟夹到 `[0, MAX_NURTURE_DELAY]`；非有限数当 0 */
const clampDelay = (min: number): number =>
  Number.isFinite(min) ? Math.min(Math.max(Math.round(min), 0), MAX_NURTURE_DELAY) : 0;

/** 相邻两点的间隔（毫秒）= 6h + 延迟。递推只经这里，别处不要再写 `6 * 3600000` */
export const nurtureStepMs = (delay: number): number =>
  NURTURE_HOURS * 3600000 + clampDelay(delay) * 60000;

/**
 * 持续时间 → 收/续点数：**向下取整**。
 *
 * 第 k 点落在 `k × (6h + delay)`，所以点数 = `floor(总分钟 / (360 + delay))`。
 * 延迟逐点累积，于是它会把点数往下压 —— 这正是"算次数时要带上延迟"的地方：
 *   22h + 5 分 → `floor(1320 / 365)` = 3 个点
 *   24h + 5 分 → `floor(1440 / 365)` = 3 个点（不加延迟会是 4 个）
 *
 * 不足一个间隔返回 0 —— 卡还没到第一个续点就到期了。
 */
export function pointCountOf(hours: number, delay = 0): number {
  const stepMin = NURTURE_HOURS * 60 + clampDelay(delay);
  return Math.min(Math.max(0, Math.floor((hours * 60) / stepMin)), MAX_NURTURE_N);
}

export interface NurturePoint {
  /** 0 = 上卡点；1..n = 收/续点。UI 用它定位"给哪个点记完成" */
  index: number;
  /**
   * **预计**时刻（点 0 = 上卡时刻；点 k = 前一点的完成/预计 + 6h）。
   * 递推与 `nextDue` 用它；展示用 `hm` —— 两者的差别见 `recordPoints`。
   */
  ts: number;
  /** 展示用的 `HH:mm`：**已完成 = 实际完成时间**，未完成 = 预计时间 */
  hm: string;
  /** 今天 / 明天 / 后天 / `M/D`（跟随 `hm` 所依据的那个时刻） */
  dayLabel: string;
  past: boolean;
  /** 实际完成时刻：点 0 = `ts`（上卡即完成）；其余取 `dones[index]`；没完成则 undefined */
  doneAt?: number;
}

const pad2 = (n: number): string => (n < 10 ? `0${n}` : `${n}`);

/** `HH:mm` 合法性（允许 `9:00` 这种不补零写法） */
export const isHM = (v: string): boolean => /^([01]?\d|2[0-3]):([0-5]\d)$/.test(v.trim());

/** 归一成 `HH:mm`；非法返回 null（调用方负责回落到"现在"） */
export function normalizeHM(v: string): string | null {
  const t = v.trim();
  if (!isHM(t)) return null;
  const [h, m] = t.split(':');
  return `${pad2(Number(h))}:${m}`;
}

export const nowHM = (now: Date = new Date()): string =>
  `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;

/** `HH:mm` → **今天的**该时刻；非法输入返回 null（用于「实际完成时间」输入：记的都是已发生的事） */
export function hmToDate(v: string, now: Date): Date | null {
  const norm = normalizeHM(v);
  if (!norm) return null;
  const [h, m] = norm.split(':').map(Number);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0);
}

/**
 * 「上卡锚点」—— 推点只需要这几个字段。
 * `baseDate` / `started` / `createdAt` 都是可选的：调用方可能只给 `{ base }`
 * （表单预览、`endLabelOf` 的草稿），此时按"今天"解释。
 */
export type NurtureAnchor = Pick<NurtureRecord, 'base'> &
  Partial<Pick<NurtureRecord, 'baseDate' | 'started' | 'createdAt'>>;

/**
 * 上卡时刻（绝对时间戳）。锚定日期按三级回落：
 *
 *   1. **`baseDate`**（本轮新增，任务在上卡那一刻记下）；
 *   2. 老记录（本轮之前创建的任务）**回落到 `createdAt` 那一天** —— 不回落的话，
 *      那些"几天前就上卡"的任务会继续漂到今天（就是用户反馈的那个 bug）；
 *   3. 其余（计划、无 `createdAt` 的记录）仍按**今天** —— 保留「预先登记今晚 18:00 上卡」
 *      这种用法，也是 `base` 只有 `HH:mm` 时的原语义。
 *
 * 不做"昨天"推断：`base` 是用户手填的时刻，只有 `baseDate` 才能说明它在哪一天。
 */
export function baseTsOf(record: NurtureAnchor, now: Date): number {
  const norm = normalizeHM(record.base) ?? nowHM(now);
  const [h, m] = norm.split(':').map(Number);
  const key = record.baseDate ?? (record.started && record.createdAt ? dayKeyOf(record.createdAt) : null);
  const dayTs = key ? keyToTs(key) : null;
  const day = dayTs !== null ? new Date(dayTs) : new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, m, 0, 0).getTime();
}

/** 卡到期时刻 = 上卡 + 持续时间。**只读**：由 `base`（含锚定日期）与 `hours` 决定，不接受单独改写 */
export const endTsOf = (record: NurtureAnchor & Pick<NurtureRecord, 'hours'>, now: Date): number =>
  baseTsOf(record, now) + record.hours * 3600000;

/**
 * 是否「进行中」= 任务 且 未被显式结束 且 **卡还没到期**（2026-09-28 新增）。
 *
 * 三个消费点：列表分组（进行中 / 已结束）、壳层徽章（`nextDue`）、
 * 以及"同时只允许一个进行中任务"的判定（新任务开始时据此决定给谁盖 `endedAt`）。
 *
 * 到期是**派生**的，不写入 —— 见 `NurtureRecord.endedAt` 的说明。
 */
export function isRunning(record: NurtureRecord, now: Date): boolean {
  if (!record.started) return false;
  if (record.endedAt !== undefined) return false;
  return now.getTime() < endTsOf(record, now);
}

/** 结束一条任务（盖 `endedAt`）。计划没有"进行中"可言，原样返回；已结束的不重复盖 */
export const endRecord = (record: NurtureRecord, at: Date): NurtureRecord =>
  record.started && record.endedAt === undefined ? { ...record, endedAt: at.getTime() } : record;

/** 点的展示字段（不含完成状态，由调用方补 `doneAt`） */
function shapePoint(ts: number, index: number, now: Date): NurturePoint {
  const t = new Date(ts);
  const day0 = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const dayStart = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime();
  const gap = Math.round((dayStart - day0) / 86400000);
  return {
    index,
    ts,
    hm: `${pad2(t.getHours())}:${pad2(t.getMinutes())}`,
    /* ⚠️ 过去的日子**不能也算"今天"**（2026-09-28 修）：点一旦按真实 `baseDate` 锚定，
       昨天/几天前的记录每个点都会走到这里 —— 若仍按 `gap <= 0` 归"今天"，一条旧任务
       会显示成一排「今天 10:00 / 今天 16:00…」，看不出是哪天的事（正是那个 bug 的表象）。
       现在：昨天 / 今天 / 明天 / 后天 / `M/D`，与点 chip、结束标签共用这一处口径 */
    dayLabel:
      gap === 0
        ? '今天'
        : gap === -1
          ? '昨天'
          : gap === 1
            ? '明天'
            : gap === 2
              ? '后天'
              : `${t.getMonth() + 1}/${t.getDate()}`,
    past: ts < now.getTime(),
  };
}

/**
 * 从基准时刻按固定 6h 推 `n` 个点（**不含上卡点自身**，点序号从 1 开始）。
 * 用于表单预览（"首点几点"）与纯时间计算；带完成状态的完整列表见 `recordPoints`。
 */
export function nurturePointsFrom(baseTs: number, n: number, now: Date, delay = 0): NurturePoint[] {
  const out: NurturePoint[] = [];
  const step = nurtureStepMs(delay);
  for (let i = 1; i <= n; i++) out.push(shapePoint(baseTs + i * step, i, now));
  return out;
}

/** 按 `HH:mm` 基准推点（等价于用今天的该时刻作基准） */
export const nurturePoints = (base: string, n: number, now: Date, delay = 0): NurturePoint[] =>
  nurturePointsFrom(baseTsOf({ base }, now), n, now, delay);

/**
 * 一条记录的**完整点列表** `[上卡点, ...收/续点]`：展示、徽章与 `nextDue` 都走这里。
 *
 * 递推：第 k 点的预计时刻 = 前一点的「实际完成时间 ?? 预计时刻」+ 6h。
 * 所以某个点记了完成之后，只有它**自己与它之后**的点会挪动。
 *
 * ## 展示时刻 = `doneAt ?? ts`（2026-09-20 修复）
 *
 * 先前一律用 `ts`（预计）展示，于是用户把"14:00 收"改成"14:05 收"之后：
 * 那个点**自己仍写着 14:00**，只有它之后的点挪到了 20:05 —— 看起来像改动没生效
 * （用户反馈："修改的当前时间不会变，只有后续的时间会变"）。
 * 现在已完成的点显示实际完成时刻，与"记了完成"这个动作在视觉上闭环。
 *
 * `ts` 仍保留为预计值：递推的基准是 `doneAt ?? ts`，`nextDue` / `dueText` 也按预计排队，
 * 两套时刻各司其职，不要互相取代。
 */
export function recordPoints(record: NurtureRecord, now: Date): NurturePoint[] {
  const dones = record.dones ?? {};
  const start = baseTsOf(record, now);
  /* 上卡点：自己操作的那一刻，天然视为已完成 */
  const out: NurturePoint[] = [{ ...shapePoint(start, 0, now), doneAt: start }];

  let prev = start;
  /* 点数从 `hours` / `delay` 派生，不读落盘字段 —— 见 `NurtureRecord.hours` 的说明 */
  for (let k = 1; k <= pointCountOf(record.hours, record.delay); k++) {
    const ts = prev + nurtureStepMs(record.delay);
    const doneAt = dones[k];
    /* 用 `doneAt ?? ts` 定位展示时刻（`hm` / `dayLabel` / `past` 都跟着它），
       再把 `ts` 覆盖回**预计值** —— 否则上面那三个字段会把预计值顶掉，递推口径就乱了 */
    out.push({ ...shapePoint(doneAt ?? ts, k, now), ts, doneAt });
    prev = doneAt ?? ts;
  }
  return out;
}

/** 记某个点完成（纯函数）。点 0（上卡）不接受改写 —— 它由 `base` 决定 */
export const markPointDone = (record: NurtureRecord, index: number, at: Date): NurtureRecord =>
  index <= 0 ? record : { ...record, dones: { ...(record.dones ?? {}), [index]: at.getTime() } };

/** 取消某个点的完成记录（点错了 / 想重新记时间） */
export function clearPointDone(record: NurtureRecord, index: number): NurtureRecord {
  const dones = { ...(record.dones ?? {}) };
  delete dones[index];
  return { ...record, dones };
}

/** 该记录的下一个待办点 = 第一个**未完成的收/续点**（不管它是否已过时间）；全部完成 → null */
export const nextPendingPoint = (record: NurtureRecord, now: Date): NurturePoint | null =>
  recordPoints(record, now).find((p) => p.index > 0 && p.doneAt === undefined) ?? null;

/** 完成 / 待收 计数（列表头部一句话总结用；上卡点算已完成） */
export function pointStats(points: NurturePoint[]): { done: number; pending: number } {
  const done = points.filter((p) => p.doneAt !== undefined).length;
  return { done, pending: points.length - done };
}

/** 逐点完成记录：键必须是不小于 1 的整数（0 是上卡点，天然已完成、不接受单独记录） */
function sanitizeDones(value: unknown): Record<number, number> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const out: Record<number, number> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 1) continue;
    if (typeof val !== 'number' || !Number.isFinite(val)) continue;
    out[index] = val;
  }
  return Object.keys(out).length ? out : undefined;
}

/**
 * 寄养记录净化（2026-09-16）：逐条校验必需字段，畸形记录**直接丢弃**。
 *
 * 为什么必须有：这些数据来自 localStorage 分片与用户导入的备份 —— 两者都是**外部数据**，
 * 可能来自旧版本、被手工改过、或干脆选错了文件。一条 `base` 不是合法 `HH:mm` 的记录
 * 会让 `recordPoints` 的递推算出 `NaN`，界面上表现为"时间显示成 NaN:NaN"且所有点全乱。
 * 宁可少几条也不能放进去。
 *
 * 为什么放在 domain 而不是 Mock：它是**数据规则**，Mock 只做 IO（分层铁律）。
 * `domain/backup`（导入校验）与 `api/mock/userStore`（分片读取）都调它 ——
 * 同一个入口，两处不会漂移。
 */
export function sanitizePlans(value: unknown): NurtureRecord[] {
  if (!Array.isArray(value)) return [];
  const out: NurtureRecord[] = [];
  for (const raw of value) {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) continue;
    const row = raw as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : '';
    const base = typeof row.base === 'string' ? row.base.trim() : '';
    if (!id || !isHM(base)) continue;
    /* `hours` 越界或非数则丢弃整条：它是派生点数的依据，给个荒唐值会让结束时间与点列表都没意义 */
    if (typeof row.hours !== 'number' || !Number.isFinite(row.hours)) continue;
    const hours = Math.round(row.hours);
    if (hours < 1 || hours > MAX_NURTURE_HOURS) continue;
    /* `delay` 缺失按 0 处理（不用丢整条：它是可选细节，0 就是"每次都准时"，
       与旧记录、与用户没填的默认情形都一致）；给了值但离谱则夹紧 */
    const delay = typeof row.delay === 'number' && Number.isFinite(row.delay)
      ? clampDelay(row.delay)
      : 0;
    /* 起始日期 / 结束时刻（2026-09-28）都是**可选**字段：格式不对一律当没记，
       不丢整条 —— 缺 `baseDate` 有明确语义（回落 `createdAt` / 今天，见 `baseTsOf`），
       为它丢掉一条寄养记录太重。`endedAt` 只认有限数（非数当"未结束"，不会误判成已结束）。 */
    const rawDate = typeof row.baseDate === 'string' ? row.baseDate.trim() : '';
    const baseDate = /^\d{4}-\d{2}-\d{2}$/.test(rawDate) ? rawDate : undefined;
    const endedAt =
      typeof row.endedAt === 'number' && Number.isFinite(row.endedAt) ? row.endedAt : undefined;
    const dones = sanitizeDones(row.dones);
    out.push({
      id,
      base,
      ...(baseDate ? { baseDate } : {}),
      hours,
      delay,
      started: row.started === true,
      createdAt: typeof row.createdAt === 'number' && Number.isFinite(row.createdAt) ? row.createdAt : 0,
      ...(endedAt !== undefined ? { endedAt } : {}),
      ...(dones ? { dones } : {}),
    });
  }
  return out;
}

export interface NurtureDue {
  record: NurtureRecord;
  point: NurturePoint;
}

/** 设备级通知偏好：只记录是否开启，以及最近一次已提醒的点（用于跨刷新去重） */
export interface NurtureNoticePrefs {
  enabled: boolean;
  lastKey?: string;
}

export const DEFAULT_NURTURE_NOTICE_PREFS: Readonly<NurtureNoticePrefs> = {
  enabled: false,
};

/** 外部存储是外部输入：坏值一律回落为关闭，不因此让通知设置页崩掉 */
export function sanitizeNurtureNoticePrefs(value: unknown): NurtureNoticePrefs {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ...DEFAULT_NURTURE_NOTICE_PREFS };
  }
  const row = value as Record<string, unknown>;
  const lastKey = typeof row.lastKey === 'string' && row.lastKey ? row.lastKey : undefined;
  return {
    enabled: row.enabled === true,
    ...(lastKey ? { lastKey } : {}),
  };
}

/** 一次“到点”的唯一键：同一记录同一个点被重新排期后，会得到新的时间戳并再次提醒 */
export const nurtureNoticeKey = (due: NurtureDue): string =>
  `${due.record.id}:${due.point.index}:${due.point.ts}`;

/**
 * 最紧要的一个待办点（供壳层的实时徽章用）：
 * 「进行中的结界卡任务」= `started` 且**还有未完成的点**；计划不背状态、不参与。
 * 多个任务取时间最早的那个。返回 null 表示当前无事可等。
 */
export function nextDue(records: NurtureRecord[], now: Date): NurtureDue | null {
  let best: NurtureDue | null = null;
  for (const record of records) {
    /* 只认**进行中**（含"卡已到期"与"已被新任务结束"两种终结态都被排除在这之外）——
        见 `isRunning`。2026-09-28 前这里只判 `started`，于是几天前的旧任务会一直占着徽章 */
    if (!isRunning(record, now)) continue;
    const point = nextPendingPoint(record, now);
    if (!point) continue;
    if (!best || point.ts < best.point.ts) best = { record, point };
  }
  return best;
}

/** 只提醒“已经到点”且尚未提醒过的下一个收/续点；未来点由调用方轮询等待 */
export function shouldNotifyNurture(
  due: NurtureDue,
  now: Date,
  prefs: NurtureNoticePrefs,
): boolean {
  return (
    prefs.enabled &&
    due.point.ts <= now.getTime() &&
    prefs.lastKey !== nurtureNoticeKey(due)
  );
}

/** 距某个收/续点还有多久的可读文案（徽章用，窄容器所以写紧凑：`2h15m` / `45 分` / `该收卡了`） */
export function dueText(ts: number, now: Date): string {
  const ms = ts - now.getTime();
  if (ms <= 0) return '该收卡了';
  const min = Math.floor(ms / 60000);
  if (min < 60) return `${min} 分`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h${pad2(m)}m` : `${h}h`;
}

/* id 生成：时间戳 + 自增序号。放在领域层是为了让 store 不必自己拼 id，
   同时保证同一毫秒内连加两条也不会撞 id。 */
let seq = 0;
export const nurtureId = (now: Date): string => `nr_${now.getTime().toString(36)}_${(seq++).toString(36)}`;

/** 持续时间夹到 `[1, MAX_NURTURE_HOURS]`；非有限数回落到 1（宁可记一条短的，也不要 NaN） */
const clampHours = (h: number): number =>
  Number.isFinite(h) ? Math.min(Math.max(Math.round(h), 1), MAX_NURTURE_HOURS) : 1;

/**
 * 建一条寄养记录（`hours` = 结界卡持续时间）。
 * 注意**不接收点数** —— 点数由 `pointCountOf(hours, delay)` 派生，用户填的是
 * 「卡能撑多久」与「每次大概晚几分钟」。
 *
 * `delay` 放在末位并默认 0：它本来就是可选的（0 = 每次都准时），且 TS 要求可选参数
 * 必须排在必填参数之后。调用点因此不必为一个"大多数记录都用不上"的字段改写。
 */
export function makeNurture(
  base: string,
  hours: number,
  started: boolean,
  now: Date,
  delay = 0,
): NurtureRecord {
  return {
    id: nurtureId(now),
    base: normalizeHM(base) ?? nowHM(now),
    /* 上卡日期只给任务记：计划是"打算今晚寄"，不该被钉在某一天（见 `baseDate` 的说明） */
    ...(started ? { baseDate: dayKey(now) } : {}),
    hours: clampHours(hours),
    delay: clampDelay(delay),
    started,
    createdAt: now.getTime(),
  };
}

/**
 * 卡到期时刻的展示点（`index = -1`，只读）—— 供时间线把「结束」也画成一个 chip。
 *
 * 复用 `shapePoint` 而不是自己拼日期：同一行里的收/续点都走它，
 * 另写一套格式化迟早会在"明天 / 后天 / 9/21"的切换边界上与它们不一致。
 * `index = -1` 是个不占号段的哨兵值（收/续点从 1 开始，上卡点是 0），
 * 因此它天然不会被 `active.index` 选中、也不会被当成可点 chip。
 */
export const endPointOf = (
  record: NurtureAnchor & Pick<NurtureRecord, 'hours'>,
  now: Date,
): NurturePoint => shapePoint(endTsOf(record, now), -1, now);

/** 卡到期时刻的可读文案（`明天 12:00` / `9/21 12:00`）—— 与点 chip 共用同一套日标签口径 */
export function endLabelOf(record: NurtureAnchor & Pick<NurtureRecord, 'hours'>, now: Date): string {
  const p = endPointOf(record, now);
  return `${p.dayLabel} ${p.hm}`;
}

/** 任务在前、计划在后；各自按创建时间倒序（最近加的排最上） */
export const sortNurture = (records: NurtureRecord[]): NurtureRecord[] =>
  [...records].sort((a, b) => {
    if (a.started !== b.started) return a.started ? -1 : 1;
    return b.createdAt - a.createdAt;
  });

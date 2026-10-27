#!/usr/bin/env node
/**
 * S1.5 数据校准（设计文档 §9 S1.5）
 *
 * ① 人工待核清单：把「数据存疑 / 待校准」的条目集中成一份**可导出**清单（md + json，不落字段）
 * ② 数据核对报告：由 tools/build.js 产出 reports/data-check.md（本脚本附带汇总）
 * ⑤ 新版本录入门架：生成「新版本条目录入」模板（tools/templates/），配合 npm run db:check 校验
 *
 * 用法：npm run db:calibrate   （等价 node tools/calibrate-report.js）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const readJson = (p) => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));
const writeFile = (p, text) => {
  const abs = path.join(ROOT, p);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, text, 'utf8');
};

const metaDb = readJson('src/db/meta.db.json');
const { items } = readJson('src/db/items.db.json');
const { versions } = readJson('src/db/dataVersion.db.json');

/* ---------- 分类汇总待核项 ---------- */
const groups = {
  gain: [],      // 收益数值待核
  deadline: [],  // 截止日 / 下线日待核
  timeWindow: [],// 时间窗待核（来源 NGA，未全面核对）
};

for (const it of items) {
  const blank = `${it.note || ''}${it.gainNote || ''}`;
  if (it.gain && /待校准|待核/.test(it.gainNote || '')) {
    groups.gain.push({ id: it.id, name: it.name, detail: it.gainNote || '', value: it.gain });
  }
  if (it.cycle === 'limited' && (!it.deadline || !it.until)) {
    groups.deadline.push({
      id: it.id,
      name: it.name,
      detail: it.deadline ? '有 deadline 但无 until（无法判断何时归档）' : '缺 deadline / until',
      note: it.note || '',
    });
  }
  if (it.time && (/待核|NGA/.test(blank) || it.isGuildTime)) {
    groups.timeWindow.push({
      id: it.id, name: it.name, window: it.time + (it.timeEnd ? `–${it.timeEnd}` : ''), detail: it.timeNote || '',
    });
  }
}

const total = Object.values(groups).reduce((s, g) => s + g.length, 0);

/* ---------- ① 可导出待核清单 ---------- */
const md = [
  '# 人工待核清单（S1.5 ①）',
  '',
  `> 生成命令：\`npm run db:calibrate\` · 数据版本 ${metaDb.meta.dataVersion} · 更新日 ${metaDb.meta.updated}`,
  '> 口径：清单只列事实、不落字段（K5 已删除 `source`）。核对完直接改 `src/db/items.db.json`，再跑 `npm run db:check`。',
  '',
  `共 **${total}** 项待核。`,
  '',
  '## 一、收益数值待核',
  '',
  groups.gain.length
    ? groups.gain.map((g) => `- [ ] \`${g.id}\` ${g.name} —— ${g.detail}｜当前值 ${JSON.stringify(g.value)}`).join('\n')
    : '_无_',
  '',
  '## 二、截止日 / 下线日待核',
  '',
  groups.deadline.length
    ? groups.deadline.map((g) => `- [ ] \`${g.id}\` ${g.name} —— ${g.detail}\n      > ${g.note}`).join('\n')
    : '_无_',
  '',
  '## 三、时间窗待核（来源 NGA 整理 + 官方公告）',
  '',
  groups.timeWindow.length
    ? groups.timeWindow.map((g) => `- [ ] \`${g.id}\` ${g.name} —— ${g.window}｜${g.detail}`).join('\n')
    : '_无_',
  '',
  '---',
  '',
  '### 核对流程',
  '',
  '1. 逐项查证（优先官方公告 / 游戏内截图，AI 水文站不采信）；',
  '2. 改 `src/db/items.db.json`（条目）或 `src/db/limited.db.json`（限时 / 版本活动条目）；',
  '3. `npm run db:check` 必须 0 错误；',
  '4. 本清单对应项勾选后，重跑本脚本确认已移出。',
  '',
].join('\n');
writeFile('reports/pending-review.md', md);
writeFile('reports/pending-review.json', `${JSON.stringify({
  generatedFrom: { dataVersion: metaDb.meta.dataVersion, updated: metaDb.meta.updated },
  total,
  groups,
}, null, 2)}\n`);

/* ---------- ② 核对报告汇总（明细由 build.js 生成） ---------- */
const checkMd = fs.existsSync(path.join(ROOT, 'reports/data-check.md'))
  ? fs.readFileSync(path.join(ROOT, 'reports/data-check.md'), 'utf8')
  : '（尚未生成，请先跑 npm run db:check）';
writeFile('reports/calibration.md', [
  '# S1.5 数据校准报告',
  '',
  '## 汇总',
  '',
  '| 类别 | 待核数 |',
  '|---|---|',
  `| 收益数值 | ${groups.gain.length} |`,
  `| 截止日 / 下线日 | ${groups.deadline.length} |`,
  `| 时间窗 | ${groups.timeWindow.length} |`,
  `| **合计** | **${total}** |`,
  '',
  '## 数据核对报告（tools/build.js 产出）',
  '',
  checkMd,
  '',
].join('\n'));

/* ---------- ⑤ 新版本录入门架 ---------- */
/* 2026-09-29 修：这份模板曾是 `cycle: 'version'` + `id: version_xxx_yyy`（版本周期还在时写的），
   周期合并后照抄会得到一个非法/无家可归的条目；`gain: { jade: 0 }` 与 `time: '00:00'` /
   `timeEnd: '00:00'` 也都会被 `db:check` 直接判错（gain 三项全 0；timeEnd 不晚于 time）。
   现值是"复制即可通过校验"的形状，逐项含义见 `docs/06-limited-intake.md`。 */
const templateItem = {
  id: 'ltd_xxx_yyy',
  name: '（新条目名，2–24 字）',
  cycle: 'limited',
  path: '（入口路径，≤40 字）',
  gainKind: ['jade', 'blueTicket'],
  gainNote: '（口径说明，≤40 字；浮动收益写「不计入固定收益」）',
  condition: '（触发条件，可选）',
  time: '20:00',
  timeEnd: '21:00',
  start: '2026-09-09',
  deadline: '2026-10-06 23:59',
  until: '2026-10-07',
  note: '（提醒备注，≤60 字；只写玩家可见的事实）',
  origin: 'preset',
};
writeFile('tools/templates/version-intake.md', [
  '# 新版本条目录入门架（K6 / S1.5 ⑤）',
  '',
  '版本更新时按此流程录入，**目标是「宁可少而准，不要多而错」**。',
  '',
  '> 完整规范（字段逐个说明、收益口径、子步骤写法、踩过的坑）见 `docs/06-limited-intake.md`。',
  '',
  '## 0. 前置',
  '',
  '1. 更新 `src/db/limited.db.json` 里当期版本的条目（2026-09-28 起版本活动与限时活动同属 `limited`，没有单独的版本周期）；',
  '2. 活动结束的条目填 `until`（到期自动归档下线）—— 合并后**不再有"随版本锚点自动翻篇"**这回事，翻篇只能靠 `until`。',
  '',
  '> 旧的 `meta.periods` 锚点机制已随周期合并整体删除，别再去找它。',
  '',
  '## 1. 录入清单',
  '',
  '| 步骤 | 动作 | 校验点 |',
  '|---|---|---|',
  '| ① 归档 | 上一版本条目：确认 `until` 已过，或补上 `until` | `npm run db:check` 无「应归档」提示 |',
  '| ② 新增 | 复制下方模板到 `src/db/limited.db.json` 的 `items` 数组（版本活动条目属 `limited`） | `id` 唯一、`^[a-z0-9_]+$` |',
  '| ③ 枚举 | `cycle` / `gainKind` 只能取 `src/domain/enums.ts` 中的值 | 双轨校验通过 |',
  '| ④ 时间 | 活动类填 `start` + `deadline`（+`until`）；日常类填 `time` + `timeEnd` | `deadline ≥ start`、`timeEnd > time` |',
  '| ⑤ 收益 | 只填**保底固定值**；浮动的只标 `gainKind` 不填 `gain` | `gain` 与 `gainKind` 对应关系校验 |',
  '| ⑥ 校验 | `npm run db:check` | **0 错误** |',
  '| ⑦ 校准 | `npm run db:calibrate` 导出待核清单 | 新增的存疑项已登记 |',
  '',
  '## 2. 条目模板',
  '',
  '```jsonc',
  JSON.stringify(templateItem, null, 2),
  '```',
  '',
  '## 3. 字段红线',
  '',
  '- `value`（S/A/B/C）/ `time2` / `source` **已删除**，不得再录入；',
  '- 一天两次的条目**必须拆成两条**（如 `xxx_am` / `xxx_pm`），两条 `gain` 之和须等于原条目总量；',
  '- `gainKind` **必须逐条人工指定**，禁止用正则从任何文本字段推断（Q14 纪律；`reward` 字段已于 2026-09-11 删除）；',
  '- `until` ≠ `deadline`：前者是「从清单下线」，后者是「活动截止仍要提示」；',
  '- `note` / `condition` **只写玩家可见的事实**，不写维护口径（步数怎么算出来的、改在哪个界面、依据哪篇攻略、这条什么时候由谁删）。用户会在清单卡片上逐字读到它们；「子步骤 = 剩余可做次数（自 9/28 起 3 次，可在「条目管理」里改）」这类话 2026-09-29 已从 `limited.db.json` 清理，录入时别再写回来。',
  '',
].join('\n'));
writeFile('tools/templates/new-items.draft.json', `${JSON.stringify({
  _comment: '新版本条目草稿：填好后把 items 合并进 src/db/items.db.json，再跑 npm run db:check',
  items: [templateItem],
}, null, 2)}\n`);

/* ---------- 输出 ---------- */
console.log(`S1.5 数据校准完成：待核 ${total} 项`);
/* 2026-09-29 修：这里原有一处 `groups.anchor.length`（"周期锚点"）—— 锚点机制
   2026-09-28 删除时只清了 `groups` 的定义与报告小节，漏了这句汇总，脚本一跑就
   `TypeError: Cannot read properties of undefined`（写在模板与报告之后，所以文件都生成了、
   命令却以失败退出）。同批删掉的还有本行的第 4 段计数。 */
console.log(`  收益数值 ${groups.gain.length} · 截止日 ${groups.deadline.length} · 时间窗 ${groups.timeWindow.length}`);
console.log('  已生成 reports/pending-review.md（可导出清单）');
console.log('  已生成 reports/pending-review.json');
console.log('  已生成 reports/calibration.md（汇总 + data-check）');
console.log('  已生成 tools/templates/version-intake.md（新版本录入门架）');
console.log('  已生成 tools/templates/new-items.draft.json');
console.log(`  数据版本库登记 ${versions.length} 个库`);

/**
 * 一键验收：tsc / eslint / vitest / build / 数据校验，产出一份可复现的验收记录。
 *
 * 为什么要脚本化：验收结论（"0 错误 412 测试通过"）一旦只存在于聊天记录里，
 * 换 agent 或换设备后就无法复核。跑 `node tools/verify.js` 会把**当次真实输出**写进
 * `reports/verify-YYYY-MM-DD.md`，报告可随归档一起留存。
 *
 * 用法：node tools/verify.js [--quiet] [--output=reports/verify-custom.md]
 * 退出码：任一步失败即 1（可直接接进 CI）。
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const quiet = process.argv.includes('--quiet');
const outputPath = process.argv.find((arg) => arg.startsWith('--output='))?.slice('--output='.length);

/** 每步：命令 + 从输出里挑出的摘要行（挑不到就首行，便于报告一眼可读） */
const STEPS = [
  {
    name: 'tsc -b（TypeScript 严格模式）',
    cmd: 'npx tsc -b',
    pick: [/error TS\d+/],
    emptyText: '无输出（通过）',
  },
  {
    name: 'eslint .',
    cmd: 'npx eslint .',
    pick: [/error|warning/],
    emptyText: '无输出（通过）',
  },
  {
    name: 'vitest run（单测）',
    cmd: 'npx vitest run --reporter=default',
    pick: [/Test Files/, /Tests\s/, /FAIL/],
  },
  {
    name: 'npm run build（生产构建）',
    cmd: 'npm run build',
    pick: [/built in/, /dist\//, /error/],
  },
  {
    name: 'node tools/build.js（数据校验）',
    cmd: 'node tools/build.js',
    pick: [/校验/],
  },
];

/** spawn 的输出里带有 ANSI 色码，报告里不需要 */
const stripAnsi = (s) => s.replace(/\u001b\[[0-9;]*m/g, '');

function run(step) {
  const started = Date.now();
  try {
    const out = stripAnsi(
      execSync(step.cmd, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], shell: true }),
    );
    return { ok: true, out, ms: Date.now() - started };
  } catch (e) {
    const err = e;
    const out = stripAnsi(`${err.stdout ?? ''}${err.stderr ?? ''}`);
    return { ok: false, out, ms: Date.now() - started };
  }
}

function summarize(step, out) {
  const lines = out.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const picked = lines.filter((l) => step.pick.some((re) => re.test(l)));
  if (picked.length) return picked.join('\n');
  if (!lines.length) return step.emptyText ?? '（无输出）';
  return lines.slice(0, 6).join('\n');
}

const results = [];
for (const step of STEPS) {
  if (!quiet) process.stdout.write(`→ ${step.name} … `);
  const r = run(step);
  if (!quiet) process.stdout.write(`${r.ok ? 'OK' : 'FAIL'} (${r.ms}ms)\n`);
  results.push({ step, ...r, summary: summarize(step, r.out) });
}

const stamp = new Date();
const pad = (n) => String(n).padStart(2, '0');
const date = `${stamp.getFullYear()}-${pad(stamp.getMonth() + 1)}-${pad(stamp.getDate())}`;
const time = `${pad(stamp.getHours())}:${pad(stamp.getMinutes())}`;
const failed = results.filter((r) => !r.ok);

const lines = [
  `# 验收记录 · ${date} ${time}`,
  '',
  `> 由 \`node tools/verify.js\` 自动生成。**结论以本文件的原始输出为准**，口头/聊天记录里的数字不算数。`,
  '',
  `环境：node ${process.version} · ${process.platform} ${process.arch}`,
  '',
  `**总结果：${failed.length ? `❌ ${failed.length} 步失败` : '✅ 全部通过'}**（${results.length} 步）`,
  '',
  '| 步骤 | 结果 | 耗时 |',
  '|---|---|---|',
  ...results.map((r) => `| ${r.step.name} | ${r.ok ? '✅' : '❌'} | ${r.ms}ms |`),
  '',
];

for (const r of results) {
  lines.push(`## ${r.step.name}`, '', '```', `$ ${r.step.cmd}`, r.summary, '```', '');
  /* 失败时保留完整输出：排查要靠它 */
  if (!r.ok && r.out.trim() && r.summary !== r.out.trim()) {
    lines.push('<details><summary>完整输出</summary>', '', '```', r.out.trim().slice(0, 8000), '```', '', '</details>', '');
  }
}

const dest = outputPath
  ? path.resolve(ROOT, outputPath)
  : path.join(ROOT, 'reports', `verify-${date}.md`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, lines.join('\n'), 'utf8');

process.stdout.write(`\n报告：${path.relative(ROOT, dest)}\n`);
process.exit(failed.length ? 1 : 0);

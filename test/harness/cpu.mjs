// CPU cost of the sandboxed Obsidian (only this instance's process tree, built from ppid),
// measured as the DELTA of cumulative CPU time (ps TIME) over a window, never ps %CPU.
//
//   node test/harness/cpu.mjs [--vault daily-core] [--seconds 60] [--settle 10] [--stub]
//
// States, in this order:
//   visible  the Casa view is the active tab
//   hidden   the Casa view is open but another tab (Blank.md) is active in the same tab group
//   blank    control: no Casa view at all, only Blank.md open
// document.visibilityState is read inside the window (and the room) at start, middle and end.
// Result: a table on stdout and test/out/cpu/<vault>.json.
import fs from 'node:fs';
import path from 'node:path';
import { launch, parseArgs, log, sleep, guard, giveFocusBack, treeOf, cpuSeconds, processTable, PROFILE, OUT, REPO } from './launch.mjs';
import { Room } from './run.mjs';

const kindOf = (cmd) => {
  const m = cmd.match(/--type=(\S+)/);
  if (!m) return 'main';
  if (m[1] === 'utility') { const u = cmd.match(/--utility-sub-type=([\w.]+)/); return 'utility' + (u ? ':' + u[1].split('.')[0] : ''); }
  return m[1] === 'gpu-process' ? 'gpu' : m[1];
};

function snapshot(mainPid) {
  const tree = treeOf(mainPid, processTable()).filter((p) => p.command.includes(PROFILE) || p.pid === mainPid);
  return new Map(tree.map((p) => [p.pid, { cpu: cpuSeconds(p.time), kind: kindOf(p.command) }]));
}

async function measure(s, room, seconds) {
  const vis = [];
  const sampleVis = async () => vis.push(await room.visibility().catch((e) => ({ error: e.message })));
  await sampleVis();
  const a = snapshot(s.main);
  const t0 = process.hrtime.bigint();
  await sleep((seconds * 1000) / 2);
  await sampleVis();
  await sleep((seconds * 1000) / 2);
  const b = snapshot(s.main);
  const wall = Number(process.hrtime.bigint() - t0) / 1e9;
  await sampleVis();
  const byKind = {};
  let total = 0;
  for (const [pid, v] of b) {
    const d = v.cpu - (a.has(pid) ? a.get(pid).cpu : 0);
    byKind[v.kind] = (byKind[v.kind] || 0) + d;
    total += d;
  }
  const vanished = [...a.keys()].filter((pid) => !b.has(pid));
  return { wall, cpuSeconds: total, pctOfOneCore: (total / wall) * 100, byKind, processes: b.size, vanished, visibility: vis };
}

const a = parseArgs(process.argv.slice(2), { vault: 'daily-core', seconds: 60, settle: 10 });
const seconds = +a.seconds, settle = +a.settle;
let s;
guard(() => s, 120 + 3 * (seconds + settle + 15));
const results = [];
try {
  s = await launch({ vault: a.vault, build: a.stub ? 'stub' : (a.build || 'auto'), width: a.width || 1440, height: a.height || 900 });
  log('plugins:', s.trust, '| separation ok:', s.separation.ok, '| main pid', s.main);
  const room = new Room(s, null);
  await room.open({ via: 'command' });
  const states = [
    ['visible', async () => room.show()],
    ['hidden', async () => room.hide()],
    ['blank', async () => room.blankOnly()],
  ];
  for (const [name, enter] of states) {
    const entered = await enter();
    await giveFocusBack(s);
    log(`state ${name}: ${JSON.stringify(entered)}; settle ${settle}s, measure ${seconds}s`);
    await sleep(settle * 1000);
    const m = await measure(s, room, seconds);
    results.push({ state: name, entered, ...m });
    log(`  ${name}: ${m.cpuSeconds.toFixed(2)} s CPU in ${m.wall.toFixed(1)} s = ${m.pctOfOneCore.toFixed(1)}% of one core; visibility ${JSON.stringify(m.visibility.map((v) => v.window + '/' + v.room))}`);
  }
} catch (e) {
  console.error('CPU RUN FAILED:', e.message);
  process.exitCode = 1;
} finally {
  if (s) log('closed:', JSON.stringify(await s.close()));
}

if (results.length) {
  const kinds = [...new Set(results.flatMap((r) => Object.keys(r.byKind)))].sort();
  const head = ['state', 'window vis', 'room vis', 'CPU s', '% core', ...kinds];
  const rows = results.map((r) => [
    r.state,
    [...new Set(r.visibility.map((v) => v.window))].join('/'),
    [...new Set(r.visibility.map((v) => String(v.room)))].join('/'),
    r.cpuSeconds.toFixed(2),
    r.pctOfOneCore.toFixed(1),
    ...kinds.map((k) => (r.byKind[k] || 0).toFixed(2)),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (r) => '| ' + r.map((c, i) => c.padEnd(w[i])).join(' | ') + ' |';
  console.log(`\nCPU over ${seconds}s per state (vault ${a.vault}, build ${s ? s.vault.build : '?'}; CPU s = delta of cumulative CPU time of this instance's process tree):`);
  console.log(line(head));
  console.log('|' + w.map((n) => '-'.repeat(n + 2)).join('|') + '|');
  rows.forEach((r) => console.log(line(r)));
  const outDir = path.join(OUT, 'cpu');
  fs.mkdirSync(outDir, { recursive: true });
  const file = path.join(outDir, `${a.vault}.json`);
  fs.writeFileSync(file, JSON.stringify({ vault: a.vault, build: s && s.vault.build, plugin: s && `${s.vault.manifest.id} ${s.vault.manifest.version}`, seconds, settle, at: new Date().toISOString(), results }, null, 2));
  console.log(`\n-> ${path.relative(REPO, file)}`);
}

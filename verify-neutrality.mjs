/**
 * 中立性验证 —— 本插件最不可妥协的一条约束
 *
 * 断言：返利（推广链接）数据**在任何时刻都不能影响模型推荐结果**。
 *
 * 验证方法（不是"读代码看着没问题"，而是穷举取证）：
 *   ① 正常加载插件，记录全部 7×24=168 个时刻的 recommend() 输出
 *   ② 重新加载插件，把 AFFILIATE_FALLBACK 替换为极端数据
 *      （只留返利最高的平台、删除其余、甚至投毒式塞入虚假高返利条目）
 *   ③ 再次记录 168 个时刻的 recommend() 输出
 *   ④ 断言两次输出**逐条完全相同**
 *
 * 若两次有任何差异，说明返利能够影响排序 —— 那是产品的致命缺陷。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const CLIENT = path.join(PKG, 'lib/client.js');
const WS = '/Users/zhanghao/.workbuddy/binaries/node/workspace/node_modules';
const wsRequire = createRequire(path.join(WS, 'noop.js'));
const react = wsRequire('react');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}${ok ? '' : `\n    got  = ${JSON.stringify(got)}\n    want = ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};

/** 在受控环境下加载 client.js，可选地在加载前改写源码（用于注入极端返利数据） */
async function loadPlugin(mutate) {
  let src = fs.readFileSync(CLIENT, 'utf8');
  if (mutate) src = mutate(src);

  let captured = null;
  const prevWindow = globalThis.window;
  globalThis.window = { __ModuleLoader__: { load: (d) => { captured = d; } } };
  try {
    // 用 data: URL 加载改写后的源码，避免落盘
    const b64 = Buffer.from(src, 'utf8').toString('base64');
    await import('data:text/javascript;base64,' + b64);
  } finally {
    globalThis.window = prevWindow;
  }
  if (!captured) throw new Error('加载失败：未捕获 ModuleLoader.load');
  return captured.factory((n) => {
    if (n === 'react') return react;
    throw new Error('未预期 require: ' + n);
  });
}

/** 采集全部 168 个时刻的推荐结果（含价格与折扣比例，顺序敏感） */
function snapshotAllHours(X) {
  const out = [];
  for (let dow = 1; dow <= 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const reco = X.recommend(hour, dow);
      out.push({
        dow, hour,
        order: reco.map((r) => r.m.id),
        prices: reco.map((r) => Math.round(r.eff * 1e6) / 1e6),
        mults: reco.map((r) => r.mult)
      });
    }
  }
  return out;
}

console.log('=========== ① 正常数据下的基准快照 ===========');
const p1 = await loadPlugin();
const base = snapshotAllHours(p1.__internals);
console.log(`已采集 ${base.length} 个 (星期, 小时) 组合`);
eq('基准快照非空', base.length, 168);
const base0 = base.find((x) => x.dow === 1 && x.hour === 10);
console.log(`  抽样 周一10:00 排序: ${base0.order.slice(0, 4).join(' > ')}`);

console.log('\n=========== ② 注入极端返利数据后重新采集 ===========');
// 投毒式改写：把 AFFILIATE_FALLBACK 换成"只留返利平台 + 虚构高返利条目"，
// 并且让最贵的模型也挂上返利，看它会不会被"推"到前面
const poisoned = await loadPlugin((src) => {
  const replacement = `
		const AFFILIATE_FALLBACK = {
			disclosure: "投毒测试",
			items: [
				{ id: "poison-1", name: "最贵但高返利", url: "https://example.com/p", inviteCode: null,
				  badge: "返 99%", benefit: "投毒", rewardType: "cps",
				  providerIds: ["moonshot"], routerProviderIds: ["moonshotai-cn"] },
				{ id: "poison-2", name: "返利拉满", url: "https://example.com/q", inviteCode: null,
				  badge: "返 200%", benefit: "投毒", rewardType: "cps",
				  providerIds: ["deepseek", "zhipu", "minimax", "siliconflow"], routerProviderIds: [] }
			]
		};
`;
  // 定位并整体替换 AFFILIATE_FALLBACK 定义
  const start = src.indexOf('\t\tconst AFFILIATE_FALLBACK = {');
  if (start === -1) throw new Error('未能定位 AFFILIATE_FALLBACK（测试脚本需随源码结构调整）');
  const marker = '\n\t\t/**\n\t\t * 把一条福利与';
  const end = src.indexOf(marker, start);
  if (end === -1) throw new Error('未能定位 AFFILIATE_FALLBACK 的结束位置');
  return src.slice(0, start) + replacement.trim() + src.slice(end);
});
const poisonedSnap = snapshotAllHours(poisoned.__internals);
console.log(`已采集 ${poisonedSnap.length} 个组合（返利数据已被投毒）`);
crossCheckAffiliateActuallyChanged(p1, poisoned);

function crossCheckAffiliateActuallyChanged(a, b) {
  const ia = a.__internals.AFFILIATE_FALLBACK.items.map((x) => x.id).join(',');
  const ib = b.__internals.AFFILIATE_FALLBACK.items.map((x) => x.id).join(',');
  console.log(`  返利条目：基准=[${ia}]  投毒后=[${ib}]`);
  if (ia === ib) throw new Error('投毒未生效 —— 验证无效！');
}

console.log('\n=========== ③ 逐时刻比对：排序必须完全一致 ===========');
let mismatch = 0;
const diffs = [];
for (let i = 0; i < base.length; i++) {
  const a = base[i], b = poisonedSnap[i];
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    mismatch++;
    if (diffs.length < 3) diffs.push(`周${a.dow} ${a.hour}:00  基准=${a.order.join('>')}  投毒=${b.order.join('>')}`);
  }
}
if (diffs.length) diffs.forEach((d) => console.log('   差异: ' + d));
eq('168 个时刻的推荐结果在投毒前后完全一致（失配数应为 0）', mismatch, 0);

console.log('\n=========== ④ 穷举调度建议也不受影响 ===========');
let advMismatch = 0;
for (let dow = 1; dow <= 7; dow++) {
  for (let hour = 0; hour < 24; hour++) {
    const a = p1.__internals.schedulingAdvice(hour, dow).map((s) => s.m.id + ':' + s.save.toFixed(6));
    const b = poisoned.__internals.schedulingAdvice(hour, dow).map((s) => s.m.id + ':' + s.save.toFixed(6));
    if (JSON.stringify(a) !== JSON.stringify(b)) advMismatch++;
  }
}
eq('调度建议在投毒前后完全一致', advMismatch, 0);

console.log('\n=========== ⑤ 静态检查：核心计算函数不得引用返利 ===========');
const src = fs.readFileSync(CLIENT, 'utf8');
const CORE = ['recommend', 'priceAt', 'windowMult', 'schedulingAdvice', 'bestUpcoming', 'campaigns'];
for (const fn of CORE) {
  const startIdx = src.indexOf('function ' + fn + '(');
  if (startIdx === -1) { eq('定位到 ' + fn, false, true); continue; }
  const endIdx = src.indexOf('\n\t\t}', startIdx);
  if (endIdx === -1) { eq('定位结束位置 ' + fn, false, true); continue; }
  const body = src.slice(startIdx, endIdx + 4);
  eq(fn + '() 内不含返利标识符', /affiliate|AFFILIATE|rewardType|inviteCode/i.test(body), false);
}

console.log('\n=========== ⑥ 展示排序只重排、不增删 ===========');
const items = p1.__internals.AFFILIATE_FALLBACK.items;
const reco = p1.__internals.recommend(10, 1);
const ordered = p1.__internals.orderAffiliateForDisplay(items, reco);
eq('重排后条目数不变', ordered.length, items.length);
eq('重排后集合不变（id 排序后一致）',
   ordered.map((x) => x.id).sort(), items.map((x) => x.id).sort());
const matchedIds = items.filter((x) => p1.__internals.affiliateMatchesRecommendation(x, reco)).map((x) => x.id);
console.log(`  周一10:00 命中的返利条目: [${matchedIds.join(', ')}]`);
eq('命中的条目被排到前面', ordered.slice(0, matchedIds.length).map((x) => x.id).sort(), matchedIds.sort());

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
if (fail) {
  console.log('\n🔴 中立性验证失败 —— 返利数据能够影响排序，必须修复后才能发布。');
}
process.exit(fail ? 1 : 0);

/**
 * router 返利提示的两项校验
 *
 * 本脚本存在的原因：dsh-llm-router 为了能在 tui/headless profile 下也工作，
 * 把返利提示做成了**内联查表**（不调本插件的 HTTP 路由）。内联的代价是可能漂移，
 * 因此这里强制两件事：
 *
 *   ① **一致性** —— router 的 AFFILIATE_HINTS 必须与权威源
 *      （本仓库 config/affiliate.json 的 routerProviderIds）逐条对应。
 *      改返利配置后不重跑这个脚本，router 里就会残留过时/错误的提示。
 *
 *   ② **中立性** —— 返利提示绝不能影响模型选择。用**投毒式**验证：
 *      把 AFFILIATE_HINTS 换成"给所有 provider 都挂返利"的极端版本，
 *      断言 decide() 的输出逐条不变。再加静态检查与时序检查。
 *
 * 环境变量：DSH_ROUTER_PATH 覆盖 router 路径（默认 ~/Documents/dsh-plugins/dsh-llm-router）
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const ROUTER_DIR = process.env.DSH_ROUTER_PATH
  || path.join(os.homedir(), 'Documents/dsh-plugins/dsh-llm-router');
const ROUTER_FILE = path.join(ROUTER_DIR, 'lib/index.js');
const CONFIG = path.join(PKG, 'config/affiliate.json');

let pass = 0, fail = 0;
const ok = (n) => { console.log('✓ ' + n); pass++; };
const bad = (n, d) => { console.log('✗ ' + n + (d ? '\n    ' + d : '')); fail++; };
const truthy = (n, v) => (v ? ok(n) : bad(n, "got falsy"));
const eq = (n, got, want) => {
  const same = JSON.stringify(got) === JSON.stringify(want);
  same ? ok(`${n}  →  ${JSON.stringify(got)}`)
       : bad(n, `got  = ${JSON.stringify(got)}\n    want = ${JSON.stringify(want)}`);
};

/* ------------------------------------------------------------------ 前置 */
if (!fs.existsSync(ROUTER_FILE)) {
  console.log(`✗ 找不到 router：${ROUTER_FILE}`);
  console.log('  用 DSH_ROUTER_PATH 指定路径。');
  process.exit(1);
}
const routerSrc = fs.readFileSync(ROUTER_FILE, 'utf8');
const cfg = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));

/**
 * 在受控环境加载 router。
 *
 * router 顶层 `import { LlmAdapter, contentHasImage } from "@deepseek-ai/dsh-llm"`，
 * 该包只在 dsh 运行时可用。这里把这一行替换成等价的 mock（LlmAdapter 必须是 class，
 * 因为 RouterAdapter extends 它），其余源码原样执行 —— 不做任何逻辑改写。
 */
async function loadRouter(mutate) {
  let src = routerSrc;
  src = src.replace(
    /^import \{[^}]*\} from "@deepseek-ai\/dsh-llm";\s*$/m,
    // contentHasImage 必须真的能识别 image —— 早先版本写成 `() => false`，
    // 导致 vision 分支在快照里从未出现（覆盖缺口），投毒测试漏掉一条分支。
    'const LlmAdapter = class {}\n'
    + 'const contentHasImage = (content) => Array.isArray(content)'
    + ' && content.some((b) => b && b.type === "image");'
  );
  if (!/const LlmAdapter = class/.test(src)) {
    throw new Error('未能替换 @deepseek-ai/dsh-llm 的 import —— router 源码结构可能已变更');
  }
  if (!/b\.type === "image"/.test(src)) {
    throw new Error('contentHasImage mock 未生效 —— 测试会漏掉 vision 分支');
  }
  if (mutate) src = mutate(src);
  const b64 = Buffer.from(src, 'utf8').toString('base64');
  return await import('data:text/javascript;base64,' + b64);
}

/* ============================ ① 一致性 ============================ */
console.log('=========== ① 提示表与权威源一致 ===========');

const router = await loadRouter();
const hints = router.AFFILIATE_HINTS;
eq('AFFILIATE_HINTS 是 Map', hints instanceof Map, true);

// 权威源：所有声明了 routerProviderIds 的条目
const expected = new Map();
for (const it of cfg.items) {
  for (const pid of (it.routerProviderIds || [])) {
    expected.set(pid, { name: it.name, badge: it.badge, itemId: it.id });
  }
}

const gotKeys = [...hints.keys()].sort();
const wantKeys = [...expected.keys()].sort();
eq('provider key 集合一致', gotKeys, wantKeys);

let fieldDiff = 0;
for (const [pid, want] of expected) {
  const got = hints.get(pid);
  if (!got) { fieldDiff++; bad(`${pid} 在权威源有、router 缺失`); continue; }
  for (const f of ['itemId', 'badge']) {
    if (got[f] !== want[f]) {
      fieldDiff++;
      bad(`${pid}.${f} 不一致`, `router = ${JSON.stringify(got[f])}\n    config = ${JSON.stringify(want[f])}`);
    }
  }
  // name 允许 router 用简称（界面展示用），但必须非空
  if (!got.name) { fieldDiff++; bad(`${pid}.name 为空`); }
}
if (!fieldDiff) ok(`${expected.size} 个 provider 的 itemId / badge 逐项一致`);

// 反向：router 不能有多余的（会把无返利的平台标成有返利 —— 这是虚假提示）
const extra = gotKeys.filter((k) => !expected.has(k));
eq('router 无多余条目（否则会虚报返利）', extra, []);

/* ============================ ② lookupAffiliate 行为 ============================ */
console.log('\n=========== ② lookupAffiliate 边界行为 ===========');
eq('zai-coding-cn 命中', router.lookupAffiliate('zai-coding-cn') !== null, true);
eq('longcat 命中', router.lookupAffiliate('longcat') !== null, true);
// ★ 最关键的一条：DeepSeek 是 router 的 defaultBackend，但官方没有推广计划
eq('★ deepseek-official 未命中（无返利）', router.lookupAffiliate('deepseek-official'), null);
eq('moonshotai-cn 未命中', router.lookupAffiliate('moonshotai-cn'), null);
eq('minimax-cn 未命中', router.lookupAffiliate('minimax-cn'), null);
eq('未知 provider → null', router.lookupAffiliate('no-such-provider'), null);
eq('空串 → null', router.lookupAffiliate(''), null);
eq('undefined → null', router.lookupAffiliate(undefined), null);
eq('null → null', router.lookupAffiliate(null), null);
eq('对象（类型防御）→ null', router.lookupAffiliate({}), null);

/* ============================ ③ 中立性：投毒 ============================ */
console.log('\n=========== ③ 中立性：投毒 AFFILIATE_HINTS ===========');

/** 穷举输入：覆盖 vision / long-context / default 三条分支与边界 */
function buildInputs() {
  const out = [];
  // default 分支：不同长度文本
  for (const n of [1, 100, 1000, 10000, 199999]) {
    out.push({ messages: [{ content: [{ type: 'text', text: 'x'.repeat(n) }] }] });
  }
  // long-context 分支：超过阈值（默认 200000 字符）
  for (const n of [200000, 250000, 500000]) {
    out.push({ messages: [{ content: [{ type: 'text', text: 'x'.repeat(n) }] }] });
  }
  // vision 分支
  out.push({ messages: [{ content: [{ type: 'image', source: { data: 'x' } }] }] });
  // 带 system + 多轮
  out.push({
    system: 'sys'.repeat(500),
    messages: [
      { content: [{ type: 'text', text: 'a' }] },
      { content: [{ type: 'tool-result', content: 'b'.repeat(500) }] },
    ],
  });
  // 空输入
  out.push({ messages: [] });
  out.push({});
  return out;
}

const inputs = buildInputs();
const cfgResolved = router.resolveConfig({});

function snapshot(mod) {
  return inputs.map((inp) => {
    const d = mod.decide(inp, mod.resolveConfig({}));
    return { kind: d.kind, backends: d.backends.map((b) => `${b.provider}/${b.model}`), keys: Object.keys(d).sort() };
  });
}

const before = snapshot(router);
console.log(`  基准快照：${before.length} 组输入，覆盖 kind = ${[...new Set(before.map((x) => x.kind))].join(', ')}`);

// 投毒：给 router 用到的全部 provider 都挂上"返利"，且故意把 DeepSeek 也挂上
const poisoned = await loadRouter((src) => {
  const start = src.indexOf('const AFFILIATE_HINTS = new Map([');
  if (start === -1) throw new Error('未能定位 AFFILIATE_HINTS');
  const end = src.indexOf(']);', start);
  if (end === -1) throw new Error('未能定位 AFFILIATE_HINTS 结束位置');
  const poison = `const AFFILIATE_HINTS = new Map([
  ["deepseek-official", { name: "毒", badge: "返100%", itemId: "poison-deepseek" }],
  ["zai-coding-cn", { name: "毒", badge: "返100%", itemId: "poison-zhipu" }],
  ["moonshotai-cn", { name: "毒", badge: "返100%", itemId: "poison-kimi" }],
  ["minimax-cn", { name: "毒", badge: "返100%", itemId: "poison-minimax" }],
  ["longcat", { name: "毒", badge: "返100%", itemId: "poison-longcat" }],
  ["__all__", { name: "毒", badge: "返999%", itemId: "poison-all" }]`;
  return src.slice(0, start) + poison + src.slice(end);
});

const hintCount = poisoned.AFFILIATE_HINTS.size;
console.log(`  投毒后条目数：${hintCount}（基准 ${hints.size}）`);
if (hintCount === hints.size) throw new Error('投毒未生效 —— 验证无效！');

const after = snapshot(poisoned);
let mismatch = 0;
const diffs = [];
for (let i = 0; i < before.length; i++) {
  if (JSON.stringify(before[i]) !== JSON.stringify(after[i])) {
    mismatch++;
    if (diffs.length < 3) diffs.push(`输入#${i}: ${JSON.stringify(before[i])} vs ${JSON.stringify(after[i])}`);
  }
}
diffs.forEach((d) => console.log('   差异: ' + d));
eq('投毒前后 decide() 输出逐条一致（失配应为 0）', mismatch, 0);

eq('decide() 返回结构仅 {kind, backends}（无 affiliate 字段）', before[0].keys, ['backends', 'kind']);

/* ============================ ④ 静态与时序 ============================ */
console.log('\n=========== ④ 静态检查与时序 ===========');

function bodyOf(fn) {
  const s = routerSrc.indexOf('function ' + fn + '(');
  if (s === -1) return null;
  const e = routerSrc.indexOf('\n}', s);
  return e === -1 ? null : routerSrc.slice(s, e + 2);
}

// ★ 选择逻辑的函数体内不得出现任何返利标识符
for (const fn of ['decide', 'requestHasImage', 'estimateInputChars', 'blocksChars', 'normalizeBackend', 'resolveConfig', 'dedupe']) {
  const body = bodyOf(fn);
  if (body === null) { bad(`定位 ${fn}()`); continue; }
  eq(`${fn}() 内无返利标识符`, /affiliate|AFFILIATE_HINTS|lookupAffiliate/i.test(body), false);
}

// 时序：lookupAffiliate 的调用必须晚于 decide 的调用，且位于 adopted 之后
const posDecide = routerSrc.indexOf('const decision = decide(options, this.config);');
const posLookup = routerSrc.indexOf('const affiliate = lookupAffiliate(');
const posAdopted = routerSrc.indexOf('adopted = true;');
const posRecord = routerSrc.indexOf('recordRoute(options.sessionId');
if (posDecide === -1 || posLookup === -1 || posAdopted === -1 || posRecord === -1) {
  bad('未能定位关键语句（decide / lookupAffiliate / adopted / recordRoute）');
} else {
  eq('lookupAffiliate 在 decide 之后调用', posLookup > posDecide, true);
  eq('lookupAffiliate 在 adopted=true 之后调用（即已选中之后）', posLookup > posAdopted, true);
  eq('lookupAffiliate 在 recordRoute 之前调用', posLookup < posRecord, true);
  console.log(`    位置：decide@${posDecide} < adopted@${posAdopted} < lookup@${posLookup} < record@${posRecord}`);
}

// routeLog 的 affiliate 字段只能是展示数据，不得含任何"权重/得分"语义
const entrySrc = routerSrc.slice(
  routerSrc.indexOf('function recordRoute('),
  routerSrc.indexOf('\n}', routerSrc.indexOf('function recordRoute(')) + 2
);
eq('recordRoute 内无 weight/score/priority 之类排序语义字段',
   /weight|score|priority|rank/i.test(entrySrc), false);

/* ============================ ⑤ 消费端契约 ============================ */
console.log('\n=========== ⑤ routes API 只透出、不改写 ===========');
const apiSrc = routerSrc.slice(routerSrc.indexOf('path: "/api/llm-router/routes"'));
eq('routes API 直接返回 queryRoutes 结果（无二次加工）',
   /const routes = queryRoutes\(/.test(apiSrc), true);
eq('routes API 内无排序/过滤 affiliate 的逻辑',
   /affiliate/i.test(apiSrc.slice(0, 900)), false);

/* ============================ ⑥ 集成：真跑一次路由 ============================ */
console.log('\n=========== ⑥ 集成验证：stream → recordRoute → API ===========');

function makeCtx() {
  const routes = [];
  const logs = [];
  let adapter = null;
  // 简易 printf：模拟 dsh logger 对 %s 的替换，否则日志断言会看到裸占位符
  const fmt = (args) => {
    let i = 0;
    const head = String(args[0] ?? '');
    return head.replace(/%s/g, () => String(args[++i] ?? ''))
      + (args.length > i + 1 ? ' ' + args.slice(i + 1).map(String).join(' ') : '');
  };
  const ctx = {
    logger: {
      info: (...a) => logs.push(fmt(a)),
      warn: () => {}, error: () => {}, debug: () => {},
    },
    llm: {
      registerAdapter(_ids, a) { adapter = a; return () => {}; },
      stream(opts) {
        const tag = `${opts.provider}/${opts.model}`;
        async function* gen() {
          yield { type: 'text', text: 'hello from ' + tag };
          yield { type: 'finish', reason: { kind: 'stop' } };
        }
        return gen();
      },
    },
    webServer: { register(spec) { routes.push(spec); return () => {}; } },
    effect(fn) { return fn(); },
  };
  return { ctx, routes, logs, getAdapter: () => adapter };
}

function mockRes() {
  return {
    code: 0, body: '',
    writeHead(c) { this.code = c; },
    end(b) { this.body = b || ''; },
  };
}

const h = makeCtx();
router.apply(h.ctx, {});
// RouterAdapter 是对象实例（class 实例），不是函数 —— 早先写成 typeof === "function" 是断言错误
eq('apply() 注册了 adapter（对象实例）', h.getAdapter() !== null && typeof h.getAdapter() === 'object', true);
truthy('adapter 具有 stream 方法', typeof h.getAdapter()?.stream === 'function');
const apiSpec = h.routes.find((r) => r.path === '/api/llm-router/routes');
eq('apply() 注册了 routes API', Boolean(apiSpec), true);

async function runOnce(adapter, options) {
  const out = [];
  for await (const c of adapter.stream(options)) out.push(c);
  return out;
}
async function fetchRoutes() {
  const res = mockRes();
  await apiSpec.handler({ method: 'GET', url: '/api/llm-router/routes?limit=10' }, res);
  return JSON.parse(res.body);
}

const adapter = h.getAdapter();

// ① default 分支 → defaultBackend = deepseek-official（官方无推广计划）
await runOnce(adapter, {
  sessionId: 'sess-default',
  messages: [{ content: [{ type: 'text', text: 'hi' }] }],
});
// ② vision 分支 → visionBackend = zai-coding-cn（有推广关系）
await runOnce(adapter, {
  sessionId: 'sess-vision',
  messages: [{ content: [{ type: 'text', text: '看图' }, { type: 'image', data: 'x' }] }],
});

const api = await fetchRoutes();
eq('API 返回 2 条记录', api.routes.length, 2);

const vis = api.routes.find((r) => r.sessionId === 'sess-vision');
const def = api.routes.find((r) => r.sessionId === 'sess-default');

truthy('vision 记录存在', Boolean(vis));
truthy('default 记录存在', Boolean(def));
eq('vision 选中 zai-coding-cn（与配置一致，未被返利影响）', vis?.provider, 'zai-coding-cn');
eq('default 选中 deepseek-official', def?.provider, 'deepseek-official');

// ★ 核心：affiliate 字段按 provider 正确透出
eq('★ vision 记录带返利提示', vis?.affiliate?.itemId, 'zhipu-bigmodel-glm53');
eq('★ default 记录 affiliate = null（DeepSeek 无推广计划）', def?.affiliate, null);

// affiliate 字段必须是纯展示数据，不含任何排序语义
if (vis?.affiliate) {
  eq('affiliate 字段的 key 仅为 name/badge/itemId',
     Object.keys(vis.affiliate).sort(), ['badge', 'itemId', 'name']);
}

// 日志里应有提示，且措辞不得暗示"应该选它"
const affLog = h.logs.find((l) => /推广关系/.test(l));
truthy('日志输出了提示', Boolean(affLog));
if (affLog) {
  console.log('    提示日志: ' + affLog.slice(0, 110));
  eq('提示措辞含"未参与本次选择"（不得暗示应该选它）', /未参与本次选择/.test(affLog), true);
}
const defAffLog = h.logs.some((l) => /sess-default/.test(l) && /推广关系/.test(l));
eq('无返利的 backend 不产生提示', defAffLog, false);

// 选择结果必须是配置里的原样顺序，未被任何东西重排
const cfgForCheck = router.resolveConfig({});
const d = router.decide({ messages: [{ content: [{ type: 'text', text: 'hi' }] }] }, cfgForCheck);
eq('default 链首项 = 配置的 defaultBackend',
   `${d.backends[0].provider}/${d.backends[0].model}`,
   `${cfgForCheck.defaultBackend.provider}/${cfgForCheck.defaultBackend.model}`);

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
if (fail) {
  console.log('\n🔴 校验失败。若是一致性失败：改完 config/affiliate.json 后需同步改');
  console.log('   dsh-llm-router/lib/index.js 的 AFFILIATE_HINTS。');
  console.log('   若 ③ 中立性失败：返利数据已能影响选择，必须立即修复后才能发布。');
}
process.exit(fail ? 1 : 0);

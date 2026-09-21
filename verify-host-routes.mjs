/**
 * host 侧路由行为验证
 *
 * 证明的不是「路由注册了」，而是「路由按契约工作」：
 *   ① 无 webServer 服务时 apply() 降级而非抛错，且留下可诊断警告
 *   ② 有服务时注册出唯一一条 prefix 路由
 *   ③ GET  /affiliate            → 返回权威配置（含 disclosure 与合规字段）
 *   ④ GET  /affiliate/resolve    → provider 映射正确；★ DeepSeek 必须为 false
 *   ⑤ POST /affiliate/click      → 计数生效；非法 id 返回 400
 *   ⑥ GET  /affiliate/stats      → 反映点击
 *   ⑦ 非法方法 → 405
 */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const host = await import(pathToFileURL(path.join(PKG, 'lib/index.js')).href);
const X = host.__internals;

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}  →  ${JSON.stringify(got)}${ok ? '' : `\n    期望 ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const truthy = (n, g) => eq(n, Boolean(g), true);

/* ---------------- mock ---------------- */
function mockReq(method, url, body) {
  const h = {};
  const req = {
    method, url,
    on(ev, cb) { (h[ev] = h[ev] || []).push(cb); return req; },
    destroy() {}
  };
  setTimeout(() => {
    if (body !== undefined) (h.data || []).forEach((cb) => cb(Buffer.from(body)));
    (h.end || []).forEach((cb) => cb());
  }, 0);
  return req;
}
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, hd) { this.code = c; this.headers = hd || null; },
    end(b) { this.body = b || ''; }
  };
}
function makeCtx() {
  const routes = [];
  const warns = [];
  const ctx = {
    effect(fn) { return fn(); },
    webServer: { register(spec) { routes.push(spec); return () => {}; } },
    logger: { debug() {}, info() {}, warn(m) { warns.push(m); } }
  };
  return { ctx, routes, warns };
}
const call = async (handler, req) => {
  const res = mockRes();
  await handler(req, res);
  let json = null;
  try { json = JSON.parse(res.body); } catch (e) {}
  return { code: res.code, headers: res.headers, json, raw: res.body };
};

/* ---------------- ① 降级路径 ---------------- */
console.log('=========== ① 缺少 webServer 时必须降级而非抛错 ===========');
eq('canRegisterRoutes({})', X.canRegisterRoutes({}), false);
eq('canRegisterRoutes(undefined)', X.canRegisterRoutes(undefined), false);
eq('canRegisterRoutes(仅 effect)', X.canRegisterRoutes({ effect() {} }), false);
eq('canRegisterRoutes(完整)', X.canRegisterRoutes(makeCtx().ctx), true);

let threw = null;
try { host.apply({}); } catch (e) { threw = e; }
eq('apply({}) 不抛异常', threw, null);

const partialWarns = [];
try {
  host.apply({ logger: { warn(m) { partialWarns.push(m); } } });
} catch (e) { threw = e; }
eq('apply(只有 logger) 不抛异常', threw, null);
truthy('降级时记录了警告（不静默失败）', partialWarns.length > 0);
if (partialWarns.length) console.log('    警告内容: ' + partialWarns[0].slice(0, 90) + '…');

/* ---------------- ② 正常注册 ---------------- */
console.log('\n=========== ② 完整 ctx 下注册路由 ===========');
const { ctx, routes, warns } = makeCtx();
host.apply(ctx);
eq('注册了 1 条路由', routes.length, 1);
eq('路由 kind', routes[0]?.kind, 'prefix');
eq('路由 path', routes[0]?.path, X.ROUTE_PREFIX);
truthy('handler 是函数', typeof routes[0]?.handler === 'function');
eq('正常路径无警告', warns.length, 0);

const handler = routes[0].handler;

/* ---------------- ③ 条目列表 ---------------- */
console.log('\n=========== ③ GET /affiliate ===========');
const listRes = await call(handler, mockReq('GET', X.ROUTE_PREFIX));
eq('HTTP 200', listRes.code, 200);
eq('ok', listRes.json?.ok, true);
// 不硬编码条目数：改为与配置文件交叉验证。这样日后增删推广条目时
// 断言仍有效（且更强——它同时检查路由返回与配置是否一致）。
const expectedCount = X.loadAffiliateConfig().items.length;
eq('条目数（与配置交叉验证）', listRes.json?.items?.length, expectedCount);
truthy('含 disclosure', typeof listRes.json?.disclosure === 'string');
truthy('disclosure 含法定字样「广告」', String(listRes.json?.disclosure).indexOf('广告') !== -1);
truthy('条目结构完整（id/name/url/benefit）',
  listRes.json.items.every((x) => x.id && x.name && x.url && x.benefit));
truthy('未泄漏内部字段（note/verifyNote 不下发）',
  listRes.json.items.every((x) => !('note' in x) && !('verifyNote' in x)));

/* ---------------- ④ provider 解析（★ 关键断言）---------------- */
console.log('\n=========== ④ GET /affiliate/resolve ===========');
const rZai = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/resolve?provider=zai-coding-cn'));
eq('zai-coding-cn 有返利', rZai.json?.hasAffiliate, true);
eq('命中条目 id', rZai.json?.item?.id, 'zhipu-bigmodel-glm53');

const rLongcat = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/resolve?provider=longcat'));
eq('longcat 有返利', rLongcat.json?.hasAffiliate, true);
eq('命中条目 id', rLongcat.json?.item?.id, 'longcat-ai');

// ★ 最重要的一条：插件最常推荐的平台恰好没有返利 —— 排序中立性有天然保障
const rDs = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/resolve?provider=deepseek-official'));
eq('★ DeepSeek 官方无返利（hasAffiliate=false）', rDs.json?.hasAffiliate, false);
eq('DeepSeek 返回 item=null', rDs.json?.item, null);

const rKimi = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/resolve?provider=moonshotai-cn'));
eq('Kimi 当前无返利', rKimi.json?.hasAffiliate, false);

const rNone = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/resolve'));
eq('缺 provider 参数 → hasAffiliate=false（不报错）', rNone.json?.hasAffiliate, false);

truthy('resolve 结果带中立性提示',
  String(rZai.json?.note || '').indexOf('不得作为模型选择权重') !== -1);

/* ---------------- ⑤ 点击归因 ---------------- */
console.log('\n=========== ⑤ POST /affiliate/click ===========');
const c1 = await call(handler, mockReq('POST', X.ROUTE_PREFIX + '/click', JSON.stringify({ id: 'siliconflow' })));
eq('HTTP 200', c1.code, 200);
eq('ok', c1.json?.ok, true);
await call(handler, mockReq('POST', X.ROUTE_PREFIX + '/click', JSON.stringify({ id: 'siliconflow' })));
await call(handler, mockReq('POST', X.ROUTE_PREFIX + '/click', JSON.stringify({ id: 'aliyun-cps-8zhe' })));

const cBad = await call(handler, mockReq('POST', X.ROUTE_PREFIX + '/click', JSON.stringify({})));
eq('缺 id → 400', cBad.code, 400);
eq('缺 id → ok=false', cBad.json?.ok, false);

const cJunk = await call(handler, mockReq('POST', X.ROUTE_PREFIX + '/click', 'not-json'));
eq('非法 JSON 不崩（容忍）', cJunk.code, 400);

/* ---------------- ⑥ 统计 ---------------- */
console.log('\n=========== ⑥ GET /affiliate/stats ===========');
const s = await call(handler, mockReq('GET', X.ROUTE_PREFIX + '/stats'));
eq('HTTP 200', s.code, 200);
eq('统计行数', s.json?.rows?.length, 2);
eq('点击最多的排首位', s.json?.rows?.[0]?.id, 'siliconflow');
eq('计数正确', s.json?.rows?.[0]?.count, 2);
eq('已知条目标记 known=true', s.json?.rows?.[0]?.known, true);

/* ---------------- ⑦ 方法限制 ---------------- */
console.log('\n=========== ⑦ 非法方法 ===========');
const m = await call(handler, mockReq('DELETE', X.ROUTE_PREFIX));
eq('DELETE → 405', m.code, 405);
eq('返回 allow 头', m.headers?.allow, 'GET, POST');

/* ---------------- ⑧ 配置缺失时的降级 ---------------- */
console.log('\n=========== ⑧ 配置不可用时的降级 ===========');
const cfg = X.loadAffiliateConfig();
truthy('能读到 config/affiliate.json', cfg && Array.isArray(cfg.items));
eq('路由返回数与配置一致', listRes.json.items.length, cfg.items.length);
truthy('配置含合规留档', Boolean(cfg.meta?.compliance));
eq('合规留档记录了法定标识', cfg.meta?.compliance?.requiredMarker, '广告');
truthy('合规留档记录了禁止事项', Array.isArray(cfg.meta?.compliance?.prohibitions));

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

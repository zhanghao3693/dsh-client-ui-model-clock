/**
 * dsh-client-ui-model-clock 实装验证
 *
 * 三层：
 *   ① 加载层 —— 模拟 window.__ModuleLoader__，确认插件能被加载且导出 NS/apply/inject
 *   ② 引擎层 —— 对纯函数喂固定输入（不依赖当前时钟），与独立推算的期望值逐项比对
 *   ③ 渲染层 —— 用真实 React + react-dom/server 渲染视图，断言产出 HTML 含应有内容
 *   ④ 集成层 —— 模拟 Cordis ctx 调 apply()，断言槽位与词典注册形状正确
 */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';

const PKG = path.dirname(new URL(import.meta.url).pathname);
const PLUGIN = path.join(PKG, 'lib/client.js');
const WS = '/Users/zhanghao/.workbuddy/binaries/node/workspace/node_modules';
const wsRequire = createRequire(path.join(WS, 'noop.js'));

const react = wsRequire('react');
const ReactDOMServer = wsRequire('react-dom/server');

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? '✓' : '✗'} ${name}  →  ${JSON.stringify(got)}${ok ? '' : `   期望 ${JSON.stringify(want)}`}`);
  ok ? pass++ : fail++;
};
const truthy = (name, got) => eq(name, Boolean(got), true);

/* ---------------- ① 加载层 ---------------- */
let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load: (def) => { captured = def; },
  },
};

await import(pathToFileURL(PLUGIN).href);

console.log('=========== ① 加载层 ===========');
truthy('模块被 __ModuleLoader__.load 接管', captured);
eq('插件 id 正确', captured?.id, 'dsh-client-ui-model-clock');
truthy('提供 factory', typeof captured?.factory === 'function');

const mockRequire = (name) => {
  if (name === 'react') return react;
  throw new Error('未预期的 require: ' + name);
};
const plugin = captured.factory(mockRequire);

console.log('\n=========== ② 协议导出 ===========');
eq('exports.NS', plugin.NS, 'model-clock');
eq('exports.inject', plugin.inject, ['slots', 'locale']);
truthy('exports.apply 是函数', typeof plugin.apply === 'function');
truthy('__internals 可用于测试', plugin.__internals);
eq('模块标记为 ESM', Object.prototype.toString.call(plugin), '[object Module]');

const X = plugin.__internals;

/* ---------------- ③ 引擎层：确定性纯函数 ---------------- */
console.log('\n=========== ③ 引擎层（固定输入，不依赖当前时钟）===========');

// 窗口匹配：DeepSeek 高峰 = 周一至周五 09:00-12:00 与 14:00-18:00
console.log('--- DeepSeek 峰谷 ---');
eq('周一 08:00 闲时', X.windowMult('deepseek', 8, 1), 0.5);
eq('周一 10:00 高峰（标准价）', X.windowMult('deepseek', 10, 1), 1);
eq('周一 13:00 午间闲时', X.windowMult('deepseek', 13, 1), 0.5);
eq('周一 15:00 高峰（标准价）', X.windowMult('deepseek', 15, 1), 1);
eq('周一 22:00 晚间闲时', X.windowMult('deepseek', 22, 1), 0.5);
eq('周六 10:00 按周末低谷', X.windowMult('deepseek', 10, 6), 0.5);
eq('周日 15:00 按周末低谷', X.windowMult('deepseek', 15, 7), 0.5);

// 智谱：高峰仅周一至周五 14:00-18:00 —— 这是最容易写错的一条
console.log('--- 智谱 Coding Plan（高峰口径与 DeepSeek 不同）---');
eq('周一 15:00 为高峰（无折扣）', X.windowMult('zhipu', 15, 1), 1);
eq('周一 11:00 非高峰（与 DeepSeek 相反）', X.windowMult('zhipu', 11, 1), 0.5);
eq('周一 20:00 非高峰', X.windowMult('zhipu', 20, 1), 0.5);
eq('周六 15:00 非高峰（周末无高峰）', X.windowMult('zhipu', 15, 6), 0.5);

// 百度千帆：全时段梯度 —— 不存在标准价时段
console.log('--- 百度千帆全时段梯度 ---');
eq('工作日 10:00 → 2 折', X.windowMult('baidu-qianfan', 10, 1), 0.2);
eq('工作日 23:00 → 0.5 折', X.windowMult('baidu-qianfan', 23, 1), 0.05);
eq('周末 10:00 → 1 折', X.windowMult('baidu-qianfan', 10, 6), 0.1);
let uncovered = 0;
for (let hh = 0; hh < 24; hh++) if (X.windowMult('baidu-qianfan', hh, 3) >= 1) uncovered++;
eq('工作日 24 小时无标准价时段', uncovered, 0);

console.log('--- 其余平台 ---');
eq('百炼 23:00 五折', X.windowMult('aliyun-bailian', 23, 1), 0.5);
eq('百炼 12:00 无折扣', X.windowMult('aliyun-bailian', 12, 1), 1);
eq('硅基流动 05:00 闲时 1/3', Math.round(X.windowMult('siliconflow', 5, 1) * 10000) / 10000, 0.3333);
eq('硅基流动 12:00 标准价', X.windowMult('siliconflow', 12, 1), 1);
eq('MiniMax 全天无时段折扣（结构性五折已含在标价）', X.windowMult('minimax', 3, 1), 1);
eq('火山方舟路由优化不影响价格', X.windowMult('volcano-ark', 5, 1), 1);

// 中文「折」口径：折数 = 支付比例 × 10
console.log('--- 折扣文案口径 ---');
eq('0.5 → 5 折', X.discText(0.5), '5');
eq('0.95 → 9.5 折', X.discText(0.95), '9.5');
eq('0.2 → 2 折', X.discText(0.2), '2');
eq('0.05 → 0.5 折', X.discText(0.05), '0.5');
eq('1/3 → 3.33 折', X.discText(1 / 3), '3.33');
eq('0.1 → 1 折', X.discText(0.1), '1');

// 价格与推荐
console.log('--- 推荐排序 ---');
const reco = X.recommend(10, 1);
let asc = true;
for (let i = 1; i < reco.length; i++) if (reco[i - 1].eff > reco[i].eff) asc = false;
truthy('推荐列表按生效单价升序', asc);
const dsFlash = reco.filter((r) => r.m.id === 'deepseek-flash')[0];
eq('周一 10:00 DeepSeek Flash 处于高峰（无折扣）', dsFlash.mult, 1);
const dsFlash12 = X.recommend(12, 1).filter((r) => r.m.id === 'deepseek-flash')[0];
eq('周一 12:00 DeepSeek Flash 半价', dsFlash12.mult, 0.5);
eq('半价后单价 = 标价 × 0.5', dsFlash12.eff, dsFlash12.m.base * 0.5);

// 调度建议
console.log('--- 调度建议 ---');
const adv = X.schedulingAdvice(23, 1);
truthy('存在可省空间的模型', adv.length > 0);
let desc = true;
for (let i = 1; i < adv.length; i++) if (adv[i - 1].save < adv[i].save) desc = false;
truthy('建议按省幅降序', desc);
for (const s of adv) {
  if (!(s.save > 0.02)) { truthy('每项省幅 > 2%', false); break; }
}
const sifAdv = adv.filter((s) => s.m.id === 'siliconflow-ds-flash')[0];
if (sifAdv) {
  eq('硅基流动在 23:00 应可省到闲时价', sifAdv.best.hour, 2);
  eq('闲时单价 = 9 × 1/3', Math.round(sifAdv.best.p * 100) / 100, 3);
}
eq('DeepSeek Flash 在 23:00 已处最低，不应出现在建议中',
   adv.some((s) => s.m.id === 'deepseek-flash'), false);

// 日期与活动
console.log('--- 限时活动 ---');
eq('daysFromToday 同日 = 0', X.daysFromToday('2026-09-21', '2026-09-21'), 0);
eq('daysFromToday 未来 9 天', X.daysFromToday('2026-09-30', '2026-09-21'), 9);
eq('daysFromToday 过去 8 天', X.daysFromToday('2026-09-13', '2026-09-21'), -8);
const camps = X.campaigns('2026-09-21');
const byId = {};
for (const c of camps) byId[c.d.id] = c;
eq('智谱夜间畅用（9/20 截止）判为已结束', byId['zp-night-free'].state, 'done');
eq('腾讯 9 月活动剩 9 天且为进行中', byId['tx-sep'].state, 'live');
eq('腾讯 9 月活动剩余天数', byId['tx-sep'].left, 9);
eq('国家超算（10/13 截止）仍进行中', byId['sc-maas'].state, 'live');
eq('未公布截止日的促销标为 unknown', byId['zp-flash-half'].state, 'unknown');
truthy('已结束的活动仍保留在列表中（不删除）', camps.some((c) => c.state === 'done'));

// 可信度
console.log('--- 数据可信度 ---');
const conf = X.confidenceStats();
eq('统计总数与数据条数一致', conf.total, X.DISCOUNTS.length);
eq('verified + stale 覆盖全部', conf.verified + conf.stale, conf.total);
truthy('存在已核实条目', conf.verified > 0);
truthy('存在待核条目（诚实标注）', conf.reported > 0);

// 热力带
console.log('--- 热力带 ---');
const bps = X.bandProviders();
truthy('产出热力带平台列表', bps.length > 0);
eq('热力带不含无时间维度的平台（MiniMax）', bps.some((p) => p.id === 'minimax'), false);
const cells = X.bandCells('deepseek', 1);
eq('每行 24 格', cells.length, 24);
eq('周一 10:00 格为标准价', cells[10].mult, 1);
eq('周一 12:00 格为半价', cells[12].mult, 0.5);
const vc = X.bandCells('volcano-ark', 1);
truthy('火山 05:00 标记为路由优化', vc[5].routing);
eq('火山 12:00 非路由时段', vc[12].routing, false);
truthy('热力色为标准 CSS 色值', /^rgba\(\d+,\d+,\d+,[\d.]+\)$/.test(X.heatColor(0.5)));

/* ---------------- ④ 集成层：apply(ctx) ---------------- */
console.log('\n=========== ④ 集成层（模拟 Cordis ctx）===========');
const registered = [];
const dicts = {};
const effects = [];
const ctx = {
  effect(fn, label) { effects.push(label); const d = fn(); return d; },
  locale: {
    register(ns, d) { dicts[ns] = d; },
    bind(ns) {
      const l = dicts[ns] || { zh: {} };
      return (k, vars) => {
        let s = (l.zh && l.zh[k]) || k;
        if (vars) for (const key of Object.keys(vars)) s = s.replace('{' + key + '}', vars[key]);
        return s;
      };
    },
  },
  slots: {
    inject(slot, cb) { cb(); },
    register(spec, comp) { registered.push({ spec, comp }); return () => {}; },
  },
};

try {
  plugin.apply(ctx);
  truthy('apply() 执行无异常', true);
} catch (e) {
  truthy('apply() 执行无异常: ' + e.message, false);
}

eq('注册了 1 个槽位', registered.length, 1);
eq('槽位名', registered[0]?.spec.name, 'conversation.view');
eq('槽位 id', registered[0]?.spec.id, 'model-clock');
eq('槽位 locale 命名空间', registered[0]?.spec.locale, 'model-clock');
truthy('槽位 label 可求值', typeof registered[0]?.spec.label() === 'string');
truthy('槽位 order 为数字', typeof registered[0]?.spec.order === 'number');
truthy('已注册 zh 词典', Boolean(dicts['model-clock']?.zh));
truthy('已注册 en 词典', Boolean(dicts['model-clock']?.en));
truthy('注入了 locale 字典 effect', effects.length > 0);

const zhKeys = Object.keys(dicts['model-clock']?.zh || {});
const enKeys = Object.keys(dicts['model-clock']?.en || {});
const missingInEn = zhKeys.filter((k) => !(k in (dicts['model-clock']?.en || {})));
eq('zh/en 词典键完全对齐', missingInEn, []);
truthy('词典条目数合理', zhKeys.length >= 40);

/* ---------------- ⑤ 渲染层：真实 React SSR ---------------- */
console.log('\n=========== ⑤ 渲染层（react-dom/server 真实渲染）===========');
const Bound = registered[0].comp;
let html = '';
try {
  html = ReactDOMServer.renderToStaticMarkup(react.createElement(Bound));
  truthy('SSR 渲染成功且产出非空', html.length > 2000);
} catch (e) {
  truthy('SSR 渲染成功: ' + e.message, false);
}

const must = [
  ['标题', '模型使用时钟'],
  ['此刻推荐区块', '此刻推荐'],
  ['热力带区块', '全天成本热力带'],
  ['调度建议区块', '等一等更省'],
  ['限时活动区块', '限时活动'],
  ['溯源区块', '数据溯源'],
  ['数据版本', '2026.09.21'],
  ['已结束状态可见', '已结束'],
  ['来源链接', 'api-docs.deepseek.com'],
  ['北京时间标注', '北京时间'],
];
for (const [label, needle] of must) {
  truthy(`HTML 含「${label}」`, html.indexOf(needle) !== -1);
}
truthy('注入的样式表存在', html.indexOf('.mc_root') !== -1);
truthy('热力带渲染出 24 格', (html.match(/class="mc_cell"/g) || []).length >= 24);
truthy('推荐卡渲染出 4 张', (html.match(/class="mc_card/g) || []).length >= 4);
truthy('外链带 noopener（安全）', html.indexOf('rel="noopener noreferrer"') !== -1);
eq('未出现未替换的模板占位符', /\{(d|p|n|t|name)\}/.test(html), false);

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

/**
 * 返利配置同步校验
 *
 * 插件里的推广数据有两份：
 *   - 权威源：config/affiliate.json（host 侧读取并对外提供）
 *   - 离线兜底：lib/client.js 里的 AFFILIATE_FALLBACK
 *
 * 两份并存是刻意的（客户端要能在离线/host 未注册路由时照常工作），
 * 但代价是可能漂移。本脚本把漂移变成**可检测的失败**：
 * 只要两份数据在任一关键字段上不一致，就报错并指出是哪个条目、哪个字段。
 *
 * 修改推广链接时必须两边都改，然后跑这个脚本确认。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const PKG = path.dirname(fileURLToPath(import.meta.url));
const WS = '/Users/zhanghao/.workbuddy/binaries/node/workspace/node_modules';
const wsRequire = createRequire(path.join(WS, 'noop.js'));
const react = wsRequire('react');

let pass = 0, fail = 0;
const ok = (name) => { console.log('✓ ' + name); pass++; };
const bad = (name, detail) => { console.log('✗ ' + name + (detail ? '\n    ' + detail : '')); fail++; };

/* ---------- 读权威源 ---------- */
const cfg = JSON.parse(fs.readFileSync(path.join(PKG, 'config/affiliate.json'), 'utf8'));
const cfgItems = cfg.items || [];

/* ---------- 读离线兜底副本 ---------- */
let captured = null;
globalThis.window = { __ModuleLoader__: { load: (d) => { captured = d; } } };
await import(new URL('./lib/client.js', import.meta.url).href);
globalThis.window = undefined;
const plugin = captured.factory((n) => {
  if (n === 'react') return react;
  throw new Error('未预期 require: ' + n);
});
const clientItems = plugin.__internals.AFFILIATE_FALLBACK.items || [];

console.log('权威源 config/affiliate.json :', cfgItems.length, '条');
console.log('兜底   client.js 内置副本   :', clientItems.length, '条');
console.log('');

/* ---------- ① 条目数量与 id 集合 ---------- */
const cfgIds = cfgItems.map((x) => x.id).sort();
const cliIds = clientItems.map((x) => x.id).sort();
if (JSON.stringify(cfgIds) === JSON.stringify(cliIds)) {
  ok('两边的条目 id 集合完全一致');
} else {
  bad('条目 id 集合不一致',
    '仅在 JSON: ' + cfgIds.filter((i) => cliIds.indexOf(i) === -1).join(',') + '\n' +
    '    仅在 client: ' + cliIds.filter((i) => cfgIds.indexOf(i) === -1).join(','));
}

/* ---------- ② 逐条逐字段比对 ---------- */
const FIELDS = ['name', 'url', 'inviteCode', 'badge', 'benefit', 'rewardType'];
const LIST_FIELDS = ['providerIds', 'routerProviderIds'];
let fieldDiffs = 0;
for (const ci of cfgItems) {
  const cc = clientItems.find((x) => x.id === ci.id);
  if (!cc) continue;
  for (const f of FIELDS) {
    const a = ci[f] === undefined ? null : ci[f];
    const b = cc[f] === undefined ? null : cc[f];
    if (a !== b) {
      fieldDiffs++;
      bad(`${ci.id} 的字段 ${f} 不一致`,
        `JSON: ${JSON.stringify(a)}\n    client: ${JSON.stringify(b)}`);
    }
  }
  for (const f of LIST_FIELDS) {
    const a = (ci[f] || []).slice().sort();
    const b = (cc[f] || []).slice().sort();
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      fieldDiffs++;
      bad(`${ci.id} 的字段 ${f} 不一致`,
        `JSON: ${JSON.stringify(a)}  client: ${JSON.stringify(b)}`);
    }
  }
}
if (!fieldDiffs) ok(`${cfgItems.length} 条 × ${FIELDS.length + LIST_FIELDS.length} 个字段逐项比对一致`);

/* ---------- ③ 合规底线：必须显著标明「广告」 ----------
   依据：《互联网广告管理办法》第九条第三款 + 《互联网广告可识别性执法指南》第七条。
   法定字样是「广告」——「推广」「返利」「佣金」「赞助」均不可替代。
   未显著标明对广告发布者可处 10 万元以下罚款，故这里作为硬断言。 */
const disc = (cfg.meta && cfg.meta.disclosure) || '';
if (disc.length > 5 && disc.indexOf('广告') !== -1) {
  ok('权威源披露文案含法定字样「广告」');
} else {
  bad('权威源披露文案缺少「广告」字样（不合法定要求）', 'meta.disclosure = ' + JSON.stringify(disc));
}
const cbDisc = plugin.__internals.AFFILIATE_FALLBACK.disclosure || '';
if (cbDisc.length > 5 && cbDisc.indexOf('广告') !== -1) {
  ok('兜底副本披露文案含法定字样「广告」');
} else {
  bad('兜底副本披露文案缺少「广告」字样');
}
if (disc && cbDisc && disc === cbDisc) {
  ok('两处披露文案逐字一致');
} else {
  bad('两处披露文案不一致', 'JSON: ' + disc + '\n    client: ' + cbDisc);
}
if (cfg.meta && cfg.meta.compliance && cfg.meta.compliance.requiredMarker === '广告') {
  ok('合规依据随配置留档（含 requiredMarker / basis / prohibitions）');
} else {
  bad('配置缺少 compliance 合规依据留档');
}

/* ---------- ④ 链接必须是 https 且带 rel 安全属性 ---------- */
let badUrl = 0;
for (const it of cfgItems) {
  if (!/^https:\/\//.test(it.url || '')) { badUrl++; bad(it.id + ' 的 url 不是 https', it.url); }
}
if (!badUrl) ok('全部推广链接均为 https');
const src = fs.readFileSync(path.join(PKG, 'lib/client.js'), 'utf8');
if (src.indexOf('noopener noreferrer nofollow sponsored') !== -1) {
  ok('推广链接带 rel="noopener noreferrer nofollow sponsored"（安全 + 合规标注）');
} else {
  bad('推广链接缺少 rel 安全/标注属性');
}

/* ---------- ⑤ 排除项必须显式记录 ---------- */
if (Array.isArray(cfg.excluded) && cfg.excluded.length) {
  ok('已显式记录"没有推广关系"的平台（excluded 段）');
} else {
  bad('缺少 excluded 段：无法区分"没返利"与"漏配"');
}

/* ---------- ⑥ 合规硬约束：禁止参数注入 + 必须可关闭 ---------- */
// 阿里云 3.1.2 / 腾讯云 CPS 第3项禁止以插件或可执行代码"强制"建立推广关系。
// 本插件的合规基础是「用户主动点击 + 原始链接」，因此代码中不得存在
// 向 URL 拼接推广参数的行为。逐个检查跳转构造处只使用 item.url。
const injectPatterns = [
  /\burl\s*\+\s*['"`]\?/,          // url + "?"+ 拼接
  /[?&](utm_|ref=|aff_|cps_key=)/, // 代码里硬编码拼接改写参数
  /\.set\(\s*['"](ref|aff|utm)/    // URLSearchParams 注入
];
let injected = 0;
for (const re of injectPatterns) {
  if (re.test(src)) { injected++; bad('检测到可能的 URL 参数注入：' + re); }
}
if (!injected) ok('未发现 URL 参数改写逻辑（跳转使用平台原始链接）');
if (src.indexOf('href: item.url') !== -1) {
  ok('跳转直接使用 item.url，未做拼接');
} else {
  bad('未找到预期的 href: item.url —— 跳转实现可能已变更，需人工复核合规性');
}
if (src.indexOf('rel: "noopener noreferrer nofollow sponsored"') !== -1) {
  ok('外链带 nofollow + sponsored 标注');
} else {
  bad('外链缺少 nofollow/sponsored 标注');
}

// 用户必须能够关闭商业内容（广告法第 44 条：不得以任何方式干扰用户正常使用网络，
// 且执法指南第十四条鼓励通过明示身份、允许拒绝来保障用户的知情选择权）
if (src.indexOf('aff.hide') !== -1 && src.indexOf('writeHiddenPref') !== -1) {
  ok('提供「关闭广告」入口并持久化用户选择');
} else {
  bad('缺少可关闭入口 —— 商业内容必须允许用户拒绝');
}
// 待核实的条目必须在数据中标记，避免展示未经确认的优惠
const pending = cfgItems.filter((x) => x.verifyStatus === 'pending');
if (pending.length) {
  console.log(`  ℹ️  ${pending.length} 条标记为待核实：${pending.map((x) => x.id).join(', ')}`);
  ok('未确认的推广条目已标记 verifyStatus=pending（如实标注）');
} else {
  ok('无待核实的推广条目');
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
if (fail) console.log('\n提示：改推广链接时需同时改 config/affiliate.json 与 lib/client.js 的 AFFILIATE_FALLBACK。');
process.exit(fail ? 1 : 0);

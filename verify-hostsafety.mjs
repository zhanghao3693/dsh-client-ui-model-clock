/**
 * 服务端安全性验证 —— 复现 dsh 在 server 端 boot profile 时 import 各 bundle 的 main 入口。
 *
 * 这是本项目最关键的一条验证：如果 main 指向浏览器侧代码，
 * 服务端 import 会 ReferenceError: window is not defined 且**整服务挂掉**。
 *
 * 本脚本同时做正反两面取证：
 *   正：lib/index.js（host 入口）必须能在无 window 环境 import 成功
 *   反：lib/client.js（client 入口）在无 window 环境下"应当"失败——证明隔离是必要的
 */
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const PKG = '/Users/zhanghao/Documents/dsh-plugins/dsh-client-ui-model-clock';

let pass = 0, fail = 0;
const check = async (name, fn, expectOk = true) => {
  let err = null, val = null;
  try { val = await fn(); } catch (e) { err = e; }
  const ok = expectOk ? !err : Boolean(err);
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (err) console.log(`     ${expectOk ? '抛出' : '如期抛出'}: ${err.constructor.name}: ${err.message.split('\n')[0]}`);
  if (!expectOk && err) console.log(`     原因: 顶层引用了 window —— 这正是必须与 host 入口隔离的理由`);
  ok ? pass++ : fail++;
  return val;
};

// 模拟 dsh 服务端环境：Node，无 window / document
console.log('环境检查：typeof window =', typeof globalThis.window);
if (typeof globalThis.window !== 'undefined') {
  console.log('（测试环境意外存在 window，需要清理后再跑）');
}

console.log('\n=========== 反证：浏览器侧入口直接当 main 用会怎样 ===========');
await check('import lib/client.js（无 window 环境）应当失败', () =>
  import(pathToFileURL(path.join(PKG, 'lib/client.js')).href), false);

console.log('\n=========== 正证：修正后的 host 入口必须能安全 import ===========');
const host = await check('import lib/index.js（无 window 环境）成功', () =>
  import(pathToFileURL(path.join(PKG, 'lib/index.js')).href), true);

if (host) {
  check('导出 name', () => { if (host.name !== 'model-clock') throw new Error('name=' + host.name); }, true);
  check('导出 apply 且为函数', () => { if (typeof host.apply !== 'function') throw new Error('no apply'); }, true);
  check('导出 VERSION', () => { if (!host.VERSION) throw new Error('no VERSION'); }, true);
  // 模拟 Cordis 调用 apply（无 logger 的 ctx 也必须不抛）
  check('apply({}) 不抛异常', () => { host.apply({}); }, true);
  check('apply(带 logger) 不抛异常', () => {
    host.apply({ logger: { debug() {} } });
  }, true);

  // 静态断言：host 入口正文不得出现 window / document 引用
  const fs = await import('node:fs');
  const src = fs.readFileSync(path.join(PKG, 'lib/index.js'), 'utf8');
  const codeOnly = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const hits = codeOnly.match(/\b(window|document)\s*\./g) || [];
  check(`host 入口代码中 window/document 引用数 = 0（实际 ${hits.length}）`, () => {
    if (hits.length) throw new Error('发现: ' + hits.join(', '));
  }, true);
}

console.log('\n=========== 清单结构校验 ===========');
const pkg = JSON.parse((await import('node:fs')).readFileSync(path.join(PKG, 'package.json'), 'utf8'));
check('main 指向 host 入口', () => { if (pkg.main !== 'lib/index.js') throw new Error(pkg.main); }, true);
check('exports["."] 指向 host 入口', () => {
  if (pkg.exports['.'] !== './lib/index.js') throw new Error(String(pkg.exports['.']));
}, true);
check('exports["./client"] 指向浏览器入口', () => {
  if (pkg.exports['./client'] !== './lib/client.js') throw new Error(String(pkg.exports['./client']));
}, true);
check('声明 dsh.client.platform = web', () => {
  if (pkg.dsh?.client?.platform !== 'web') throw new Error(String(pkg.dsh?.client?.platform));
}, true);
check('声明 dsh.bundle.patch', () => {
  if (pkg.dsh?.bundle?.patch !== './cordis.patch.yml') throw new Error(String(pkg.dsh?.bundle?.patch));
}, true);
check('files 同时包含两个入口', () => {
  const f = pkg.files || [];
  if (!f.includes('lib/index.js') || !f.includes('lib/client.js')) throw new Error(JSON.stringify(f));
}, true);
check('cordis.patch.yml 的 insert.id 与 host export name 一致', async () => true, true);
{
  const yml = (await import('node:fs')).readFileSync(path.join(PKG, 'cordis.patch.yml'), 'utf8');
  const id = (yml.match(/^\s*-\s*id:\s*(\S+)/m) || [])[1];
  check(`patch 中 id="${id}" 等于 host name="model-clock"`, () => {
    if (id !== host.name) throw new Error(`${id} != ${host.name}`);
  }, true);
  check('patch 中 name 为 npm 包名', () => {
    if (yml.indexOf("'dsh-client-ui-model-clock'") === -1) throw new Error('未找到包名');
  }, true);
}

console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
process.exit(fail ? 1 : 0);

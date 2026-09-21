/**
 * dsh-client-ui-model-clock — host half（服务端入口）
 * ================================================================
 * ⚠️ 这个文件的存在本身就是一条硬约束：
 *
 * dsh 在**服务端** boot profile 时会 import 每个 bundle 的 `main` 入口来组装
 * plugin tree。如果 `main` 指向的是浏览器侧代码（含顶层 `window.*` 引用），
 * 服务端会直接 `ReferenceError: window is not defined` 并**整服务挂掉**。
 *
 * 因此本包必须双入口：
 *   - `lib/index.js`  ← 本文件，服务端安全，不得出现任何 window/document 引用
 *   - `lib/client.js` ← 浏览器侧，顶层调用 window.__ModuleLoader__.load(...)，
 *                       由 dsh 通过 package.json 的 `exports["./client"]`
 *                       与 `dsh.client.platform = "web"` 单独在浏览器中拾取
 *
 * 历史教训（作者环境内已实际发生过）：dsh-client-ui-route-badge 因把 client.js
 * 写成 `main`，导致整服务无法启动，只能在 profile 里注释掉该条目。
 *
 * ---------------------------------------------------------------
 * 职责划分（重要）：
 *   - **定价与时段计算** 全部在浏览器侧（离线可用、无网络依赖）
 *   - **本 host half** 只做三件事，都是「必须由服务端持有」的：
 *       ① 提供推广链接配置的权威源（config/affiliate.json）
 *       ② 提供「dsh provider → 返利条目」的解析（供客户端与调度侧查询）
 *       ③ 记录推广链接点击（归因），进程内聚合
 *
 * 🔴 中立性约束（与 client 侧同一条铁律）：
 *   本文件提供的任何返利数据**不得参与模型选择**。
 *   dsh-llm-router 若接入本数据，只允许用于「选中之后」的展示提示，
 *   绝不允许把返利比例作为选择权重。见 affiliateForRouter() 的注释。
 */

import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** 插件在 Cordis 组合中的名字。必须与 cordis.patch.yml 里的 insert.id 一致。 */
export const name = "model-clock";

/** 与 package.json 的 version 保持同步，便于在服务端日志里核对装载版本。 */
export const VERSION = "0.1.1";

/** 注册 HTTP 路由所用的服务。 */
export const inject = ["webServer"];

const ROUTE_PREFIX = "/api/model-clock/affiliate";

/** 配置文件定位：以本文件为基准，避免依赖 cwd（dsh 可能从任意目录启动）。 */
function configPath() {
	try {
		return fileURLToPath(new URL("../config/affiliate.json", import.meta.url));
	} catch (e) {
		return null;
	}
}

/**
 * 读取推广配置。
 *
 * 失败一律降级为 null，**绝不抛错** —— 这个插件是辅助功能，
 * 不能因为一个配置文件读不到就让整个 dsh 服务或路由报 500。
 * 客户端在拿不到时会自动沿用其内置副本，功能不受影响。
 */
function loadAffiliateConfig() {
	const p = configPath();
	if (!p) return null;
	try {
		const raw = fs.readFileSync(p, "utf8");
		const json = JSON.parse(raw);
		if (!json || !Array.isArray(json.items)) return null;
		return json;
	} catch (e) {
		return null;
	}
}

/** 进程内点击计数（不落库：归因只需相对比较，且避免引入存储依赖）。 */
const clickCounters = new Map();

function recordClick(id) {
	if (typeof id !== "string" || !id) return false;
	const cur = clickCounters.get(id) || { count: 0, lastAt: 0 };
	cur.count += 1;
	cur.lastAt = Date.now();
	clickCounters.set(id, cur);
	return true;
}

function clickStats(config) {
	const known = new Set();
	if (config && Array.isArray(config.items)) {
		for (const it of config.items) known.add(it.id);
	}
	const rows = [];
	for (const [id, v] of clickCounters.entries()) {
		rows.push({ id, count: v.count, lastAt: v.lastAt, known: known.has(id) });
	}
	rows.sort((a, b) => b.count - a.count);
	return rows;
}

/**
 * ★ 供模型调度侧（如 dsh-llm-router）查询「某个 provider 有没有返利」。
 *
 * 契约与红线：
 *   - 返回的 rewardType 只描述**商业关系**，不含任何可用于排序的权重。
 *   - 调用方**只允许**在已选定 backend 之后用它做展示提示；
 *     不得把返回值折算成权重参与候选选择。
 *   - dsh 的 provider id 与厂商 id 是两套命名，故同时匹配
 *     providerIds（厂商）与 routerProviderIds（dsh provider）。
 */
function affiliateForRouter(config, routerProviderId) {
	if (!config || !routerProviderId) return null;
	const items = config.items || [];
	for (const it of items) {
		const list = (it.routerProviderIds || []).concat(it.providerIds || []);
		if (list.indexOf(routerProviderId) !== -1) return it;
	}
	return null;
}

function sendJson(res, code, obj) {
	const body = JSON.stringify(obj);
	res.writeHead(code, {
		"content-type": "application/json; charset=utf-8",
		"cache-control": "no-store"
	});
	res.end(body);
}

function readBody(req) {
	return new Promise((resolve) => {
		let data = "";
		req.on("data", (c) => {
			data += c;
			if (data.length > 64 * 1024) { data = data.slice(0, 64 * 1024); req.destroy(); }
		});
		req.on("end", () => resolve(data));
		req.on("error", () => resolve(""));
	});
}

/** 与 dsh-dpharness 同款注册方式：包在 ctx.effect 里以便随插件卸载而回收。 */
function registerRoute(ctx, pathname, handler) {
	ctx.effect(
		() => ctx.webServer.register({ kind: "prefix", path: pathname, handler }),
		`model-clock: ${pathname} route`
	);
}

/**
 * 是否具备注册路由的条件。
 *
 * 为什么要有这个判断：本插件是**辅助功能**，其可视化主体在浏览器侧、
 * 且有内置数据副本可独立工作。如果因为运行环境缺少 webServer 服务
 * （例如被加载进一个不含 web 能力的 profile）就让 apply() 抛错，
 * 会拖累整个 boot —— 这不符合「辅助插件不得搞挂主服务」的原则。
 *
 * 但也**不能静默跳过**：降级必须留下可诊断的日志，否则会出现
 * 「路由没注册、点击归因悄悄全丢」这种沉默失败。见 SKILL 的铁律
 * 「执行了 ≠ 成功了」。
 */
function canRegisterRoutes(ctx) {
	return Boolean(
		ctx && typeof ctx.effect === "function" &&
		ctx.webServer && typeof ctx.webServer.register === "function"
	);
}

function logLine(ctx, level, msg) {
	const logger = ctx && ctx.logger;
	if (logger && typeof logger[level] === "function") { logger[level](msg); return; }
	if (level !== "debug" && typeof console !== "undefined" && typeof console.warn === "function") {
		console.warn(msg);
	}
}

export function apply(ctx) {
	if (!canRegisterRoutes(ctx)) {
		logLine(ctx, "warn",
			`[model-clock] webServer 服务不可用，推广配置路由 ${ROUTE_PREFIX} 未注册。` +
			`插件可视化仍可用（走内置数据副本），仅缺少点击归因与配置热更新能力。`);
		return;
	}

	registerRoute(ctx, ROUTE_PREFIX, async (req, res) => {
		let pathname = req.url || "";
		let search = "";
		try {
			const u = new URL(req.url, "http://localhost");
			pathname = u.pathname;
			search = u.search;
		} catch (e) { /* 解析失败则保留原样 */ }

		const config = loadAffiliateConfig();
		const isClick = pathname === ROUTE_PREFIX + "/click";
		const isStats = pathname === ROUTE_PREFIX + "/stats";
		const isResolve = pathname === ROUTE_PREFIX + "/resolve";

		// ---- GET /api/model-clock/affiliate —— 推广条目（客户端取权威源）----
		if (!isClick && !isStats && !isResolve && req.method === "GET") {
			if (!config) {
				// 明确告知不可用，客户端会沿用其内置副本
				sendJson(res, 200, { ok: false, reason: "config_unavailable", items: [] });
				return;
			}
			sendJson(res, 200, {
				ok: true,
				disclosure: config.meta && config.meta.disclosure ? config.meta.disclosure : "",
				verifiedAt: config.meta && config.meta.verifiedAt ? config.meta.verifiedAt : null,
				items: config.items.map((it) => ({
					id: it.id, name: it.name, url: it.url,
					inviteCode: it.inviteCode || null, badge: it.badge || null,
					benefit: it.benefit, rewardType: it.rewardType,
					providerIds: it.providerIds || [], routerProviderIds: it.routerProviderIds || []
				}))
			});
			return;
		}

		// ---- GET /api/model-clock/affiliate/resolve?provider=<id> ----
		// 供调度侧使用；只回答「有没有」，不返回任何排序权重。
		if (isResolve && req.method === "GET") {
			const q = new URLSearchParams(search);
			const pid = q.get("provider") || "";
			const hit = affiliateForRouter(config, pid);
			sendJson(res, 200, {
				ok: true,
				provider: pid,
				hasAffiliate: Boolean(hit),
				item: hit ? { id: hit.id, name: hit.name, url: hit.url, badge: hit.badge || null } : null,
				note: "此结果仅用于选中后的展示提示，不得作为模型选择权重。"
			});
			return;
		}

		// ---- POST /api/model-clock/affiliate/click —— 归因 ----
		if (isClick && req.method === "POST") {
			const raw = await readBody(req);
			let id = "";
			try { id = (JSON.parse(raw) || {}).id || ""; } catch (e) { /* 容忍非 JSON */ }
			const ok = recordClick(id);
			if (ok && ctx.logger && typeof ctx.logger.info === "function") {
				ctx.logger.info(`[model-clock] 推广链接点击: ${id}`);
			}
			sendJson(res, ok ? 200 : 400, { ok });
			return;
		}

		// ---- GET /api/model-clock/affiliate/stats —— 点击统计 ----
		if (isStats && req.method === "GET") {
			sendJson(res, 200, {
				ok: true,
				note: "进程内计数，重启归零。仅用于比较各条目的相对点击量。",
				rows: clickStats(config)
			});
			return;
		}

		res.writeHead(405, { allow: "GET, POST", "content-type": "application/json; charset=utf-8" });
		res.end(JSON.stringify({ ok: false, reason: "method_not_allowed" }));
	});

	if (ctx && ctx.logger && typeof ctx.logger.debug === "function") {
		ctx.logger.debug(
			`[model-clock] host half v${VERSION} loaded：推广配置路由 ${ROUTE_PREFIX}（可视化在浏览器侧）`
		);
	}
}

export default { name, apply, inject, VERSION };

/* 供测试读取的内部实现（不影响 Cordis 协议）。 */
export const __internals = {
	loadAffiliateConfig,
	affiliateForRouter,
	recordClick,
	clickStats,
	canRegisterRoutes,
	ROUTE_PREFIX
};

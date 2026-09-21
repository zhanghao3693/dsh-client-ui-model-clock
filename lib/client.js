/**
 * dsh-client-ui-model-clock
 * ================================================================
 * 模型使用时钟 —— DeepSeek Harness 客户端 UI 插件
 *
 * 解决的问题：同一份代码在不同时刻调用大模型，成本可以相差 2–5 倍。
 * 国内主流厂商普遍采用「时间维度定价」（峰谷、夜间、周末、限时活动），
 * 但这些信息散落在 10 家以上平台的官方文档站里，且大量优惠带渠道门槛。
 * 本插件把这些信息汇总为一张**以时间轴为主视图**的决策面板。
 *
 * 三个设计立场（与「比价站」的区别）：
 *   1. 时钟优先、日历为辅 —— 国内主流优惠是每日循环的时段折扣，
 *      用月历格子无法表达「22:00 至次日 08:00」，只有时间轴能表达。
 *   2. 只横比可横比的对象 —— 按量计费模型可直接比价；套餐/积分类平台
 *      需按倍率二次折算、口径不透明，只展示折扣深度，不展示绝对单价，
 *      否则给出的是错误对比。
 *   3. 每条优惠必须可溯源 —— 强制携带官方来源链接与人工核实时间；
 *      已过期的活动不删除而是标记已结束（「昨天还有五折」本身是决策信息）。
 *
 * 数据口径：本插件内置一份人工核实的数据集（离线可用）。由于厂商活动
 * 以周为单位变动，插件会在界面上显示数据核实时间，并对超期未复核的
 * 条目降级展示。所有价格单位为「元 / 百万 token」。
 *
 * @see https://dpharness.com
 */

window.__ModuleLoader__.load({
	id: "dsh-client-ui-model-clock",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		let react = require("react");
		const h = react.createElement;

		/* ================================================================
		 *  一、样式
		 *  优先使用 Harness 主题变量（--dsw-alias-*），并为独立运行留兜底值。
		 * ================================================================ */
		const CSS = `
.mc_root{display:flex;flex-direction:column;gap:18px;width:100%;max-width:940px;margin:0 auto;padding:14px 10px 32px}

/* ---------- 头部 ---------- */
.mc_head{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;flex-wrap:wrap}
.mc_title{margin:0;font-size:17px;font-weight:700;color:var(--dsw-alias-label-primary,#1a1a1a);letter-spacing:-.01em}
.mc_sub{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b929b);margin-top:4px}
.mc_clock{text-align:right}
.mc_clock-time{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:26px;font-weight:500;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#1a1a1a)}
.mc_clock-date{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b929b);margin-top:2px}
.mc_zone{display:inline-flex;align-items:center;gap:6px;font-size:11.5px;padding:3px 10px;border-radius:999px;
  border:1px solid var(--dsw-alias-border-l2,#d2d7dd);color:var(--dsw-alias-label-secondary,#5a626c);margin-top:6px}
.mc_zone-dot{width:6px;height:6px;border-radius:50%;background:#30a46c}
.mc_zone-dot.warn{background:#e8a33d}

/* ---------- 通用区块 ---------- */
.mc_sec{display:flex;flex-direction:column;gap:12px}
.mc_sec-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);
  display:flex;align-items:center;gap:8px;margin:0}
.mc_sec-hint{font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b929b);line-height:1.65;margin:0}
.mc_sec-hint b{color:var(--dsw-alias-label-secondary,#5a626c);font-weight:600}
.mc_panel{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.025));
  border:1px solid var(--dsw-alias-border-l2,#e3e6ea);border-radius:11px;padding:14px}

/* ---------- 此刻推荐 ---------- */
.mc_grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(196px,1fr));gap:11px}
.mc_card{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.025));
  border:1px solid var(--dsw-alias-border-l2,#e3e6ea);border-radius:11px;padding:13px 14px;transition:transform .12s}
.mc_card:hover{transform:translateY(-2px)}
.mc_card.best{border-color:rgba(91,141,239,.5);box-shadow:0 0 0 1px rgba(91,141,239,.16)}
.mc_card-top{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--dsw-alias-label-tertiary,#8b929b);margin-bottom:8px}
.mc_card-name{font-size:14px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);margin-bottom:2px}
.mc_card-prov{font-size:11.5px;color:var(--dsw-alias-label-secondary,#5a626c);margin-bottom:9px}
.mc_card-price{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:21px;font-weight:500;
  letter-spacing:-.02em;color:var(--dsw-alias-label-primary,#1a1a1a);font-variant-numeric:tabular-nums}
.mc_card-unit{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b929b);margin-left:4px;
  font-family:inherit;letter-spacing:0}
.mc_card-was{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;
  color:var(--dsw-alias-label-tertiary,#8b929b);text-decoration:line-through;margin-left:6px}
.mc_tag{display:inline-block;font-size:10.5px;padding:2px 8px;border-radius:5px;margin-top:9px;font-weight:500}
.mc_tag.green{background:rgba(48,164,108,.14);color:#1f8a57;border:1px solid rgba(48,164,108,.28)}
.mc_tag.amber{background:rgba(232,163,61,.16);color:#b06000;border:1px solid rgba(232,163,61,.3)}
.mc_tag.grey{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-tertiary,#8b929b);border:1px solid var(--dsw-alias-border-l2,#e3e6ea)}
.mc_tag.blue{background:rgba(91,141,239,.14);color:#2f6fd8;border:1px solid rgba(91,141,239,.3)}

/* ---------- 热力带 ---------- */
.mc_rows{display:flex;flex-direction:column}
.mc_row{display:grid;grid-template-columns:188px 1fr;gap:12px;align-items:center;padding:5px 0}
.mc_row-label{font-size:11.5px;line-height:1.35;color:var(--dsw-alias-label-secondary,#5a626c);
  overflow:hidden;text-overflow:ellipsis}
.mc_row-label b{display:block;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a)}
.mc_row-label i{font-style:normal;font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b929b)}
.mc_band{position:relative;display:grid;grid-template-columns:repeat(24,1fr);gap:1.5px;height:20px}
.mc_cell{border-radius:2px;transition:transform .1s}
.mc_cell:hover{transform:scaleY(1.25)}
.mc_now{position:absolute;top:-3px;bottom:-3px;width:2px;background:var(--dsw-alias-label-primary,#1a1a1a);
  z-index:5;border-radius:1px;box-shadow:0 0 0 1.5px var(--dsw-alias-bg-layer-1,#fff)}
.mc_axis{display:grid;grid-template-columns:188px 1fr;gap:12px;margin-top:6px}
.mc_ticks{display:grid;grid-template-columns:repeat(24,1fr);gap:1.5px}
.mc_ticks span{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:9px;
  color:var(--dsw-alias-label-tertiary,#8b929b)}
.mc_legend{display:flex;gap:16px;flex-wrap:wrap;font-size:11px;margin-top:12px;padding-top:11px;
  border-top:1px solid var(--dsw-alias-border-l2,#e3e6ea);color:var(--dsw-alias-label-tertiary,#8b929b)}
.mc_legend-item{display:flex;align-items:center;gap:6px}
.mc_sw{width:11px;height:11px;border-radius:2.5px}

/* ---------- 调度建议 ---------- */
.mc_adv{display:grid;grid-template-columns:repeat(auto-fit,minmax(268px,1fr));gap:11px}
.mc_adv-card{background:var(--dsw-alias-bg-layer-2,rgba(0,0,0,.025));
  border:1px solid var(--dsw-alias-border-l2,#e3e6ea);border-radius:11px;padding:14px}
.mc_adv-head{font-size:10.5px;letter-spacing:.06em;text-transform:uppercase;
  color:var(--dsw-alias-label-tertiary,#8b929b);display:flex;justify-content:space-between;gap:8px}
.mc_adv-big{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:25px;font-weight:500;
  letter-spacing:-.02em;margin:6px 0 4px;color:#1f8a57}
.mc_adv-big.blue{color:#2f6fd8}
.mc_adv-desc{font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#5a626c)}
.mc_adv-desc b{color:var(--dsw-alias-label-primary,#1a1a1a)}

/* ---------- 限时活动 ---------- */
.mc_camps{display:flex;flex-direction:column;gap:2px}
.mc_camp{display:grid;grid-template-columns:88px 1fr auto;gap:10px;align-items:center;
  padding:8px 0;border-bottom:1px solid var(--dsw-alias-border-l2,#e3e6ea);font-size:12px}
.mc_camp:last-child{border-bottom:none}
.mc_camp-prov{font-size:11px;color:var(--dsw-alias-label-secondary,#5a626c);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc_camp-title{color:var(--dsw-alias-label-primary,#1a1a1a);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mc_camp-row.done .mc_camp-title,.mc_camp-row.done .mc_camp-prov{opacity:.5}
.mc_camp-badge{font-size:10.5px;padding:2px 8px;border-radius:5px;white-space:nowrap}
.mc_camp-badge.live{background:rgba(48,164,108,.14);color:#1f8a57}
.mc_camp-badge.soon{background:rgba(232,163,61,.18);color:#b06000}
.mc_camp-badge.done{background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));
  color:var(--dsw-alias-label-tertiary,#8b929b)}
.mc_camp-badge.unknown{background:rgba(91,141,239,.14);color:#2f6fd8}

/* ---------- 溯源 ---------- */
.mc_meta{font-size:11.5px;line-height:1.75;color:var(--dsw-alias-label-tertiary,#8b929b)}
.mc_meta b{color:var(--dsw-alias-label-secondary,#5a626c)}
.mc_meta-row{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;font-size:11px}
.mc_pill{padding:3px 9px;border-radius:999px;background:var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05));
  border:1px solid var(--dsw-alias-border-l2,#e3e6ea);color:var(--dsw-alias-label-secondary,#5a626c)}
.mc_src{font-size:10.5px;color:var(--dsw-alias-label-tertiary,#8b929b);word-break:break-all;margin-top:6px;line-height:1.5}
.mc_btn{border:1px solid var(--dsw-alias-border-l2,#d2d7dd);background:transparent;
  color:var(--dsw-alias-label-primary,#1a1a1a);border-radius:8px;padding:5px 13px;font:inherit;
  font-size:12px;cursor:pointer;transition:all .18s}
.mc_btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05));transform:translateY(-1px)}
.mc_details{margin-top:11px}
.mc_details summary{cursor:pointer;font-size:11.5px;color:var(--dsw-alias-label-tertiary,#8b929b);
  list-style:none;padding:5px 0;user-select:none}
.mc_details summary::-webkit-details-marker{display:none}
.mc_details summary:hover{color:var(--dsw-alias-label-secondary,#5a626c)}
.mc_details summary::before{content:"▸ ";font-size:10px}
.mc_details[open] summary::before{content:"▾ "}
.mc_empty{font-size:12px;color:var(--dsw-alias-label-tertiary,#8b929b);padding:16px;text-align:center}

/* ---------- 注册专属福利（推广链接）----------
   视觉上刻意与价格信息区分：用虚线边框 + 蓝色系，不用绿色（绿色在本插件里专指「省」）。
   目的是让用户一眼看出「这是一段商业内容」，而不是把它当成价格结论的一部分。 */
.mc_aff-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px}
.mc_aff-card{display:flex;flex-direction:column;padding:12px 13px;border-radius:10px;
  border:1px dashed rgba(91,141,239,.45);background:rgba(91,141,239,.05);
  text-decoration:none;transition:background .15s,border-color .15s}
.mc_aff-card:hover{background:rgba(91,141,239,.1);border-color:rgba(91,141,239,.7)}
.mc_aff-top{display:flex;align-items:flex-start;justify-content:space-between;gap:8px}
.mc_aff-name{font-size:12.5px;font-weight:600;color:var(--dsw-alias-label-primary,#1a1a1a);line-height:1.4}
.mc_aff-badge{font-size:10px;padding:2px 7px;border-radius:999px;white-space:nowrap;flex-shrink:0;
  background:rgba(91,141,239,.16);color:#2f6fd8}
.mc_aff-benefit{font-size:11px;line-height:1.65;color:var(--dsw-alias-label-secondary,#5a626c);margin-top:7px;flex:1}
.mc_aff-code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10.5px;
  color:var(--dsw-alias-label-tertiary,#8b929b);margin-top:8px;word-break:break-all}
.mc_aff-flag{font-size:10px;color:#2f6fd8;margin-top:7px;font-weight:500}
.mc_aff-bar{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap;
  margin-top:11px;padding-top:10px;border-top:1px solid var(--dsw-alias-border-l2,#e3e6ea)}
.mc_aff-disc{font-size:10.5px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#8b929b);flex:1;min-width:200px}
.mc_aff-link{font-size:11px;color:#2f6fd8;cursor:pointer;background:none;border:none;
  padding:0;font:inherit;text-decoration:underline;white-space:nowrap}

/* 「广告」法定标识：必须显著。用实色高对比（浅色/深色主题下都醒目），
   不随主题变量走 —— 合规标识的可读性优先于视觉统一。 */
.mc_ad-tag{display:inline-block;font-size:10px;font-weight:700;letter-spacing:.08em;
  padding:2px 6px;border-radius:3px;background:#B45309;color:#FFFFFF;
  vertical-align:middle;margin-right:7px;border:1px solid #8A3E06}
.mc_aff-zone-note{font-size:10.5px;font-weight:600;color:#B45309;margin-bottom:10px}
.mc_aff-notices{margin-top:10px;padding-top:9px;border-top:1px dashed var(--dsw-alias-border-l2,#e3e6ea)}
.mc_aff-notices div{font-size:10.5px;line-height:1.7;color:var(--dsw-alias-label-tertiary,#8b929b)}
`;

		/* ================================================================
		 *  二、文案（中英双语）
		 * ================================================================ */
		const NS = "model-clock";

		const zh = {
			"view.tab": "🕐 模型使用时钟",
			"title": "模型使用时钟",
			"sub": "此刻该用哪家最省 · 时间窗优惠实时视图",
			"zone.off": "DeepSeek 闲时窗口 · 半价生效中",
			"zone.peak": "DeepSeek 高峰窗口 · 标准价",
			"best": "此刻推荐",
			"best.hint": "按「叠加当前生效优惠后的实际输出单价」排序。仅含<b>按量计费</b>模型——套餐/积分类平台需二次折算、口径不透明，不进入本榜，避免给出错误的价格对比。",
			"best.lowest": "此刻最低",
			"best.off": "享 {d} 折",
			"best.none": "无时段优惠",
			"unit": "/M 输出",
			"band": "全天成本热力带",
			"band.hint": "每格 1 小时，颜色表示<b>该平台在该时段的折扣深度</b>（越冷越省）。竖线为当前时刻。注意各家的高峰口径互不相同——DeepSeek 有两个高峰段，智谱只有下午一段，百度千帆则是全时段梯度折扣：<b>没有统一口径，正是本插件存在的理由</b>。",
			"band.legend.std": "标准价（无折扣）",
			"band.legend.mid": "中度折扣",
			"band.legend.low": "深度折扣",
			"band.legend.route": "路由优化（价格不变、模型更强）",
			"band.sessionTz": "北京时间",
			"adv": "「等一等更省」调度建议",
			"adv.hint": "本插件真正的价值落点：不只让人查，而是给出可执行的调度决策——把可延迟的批处理任务挪到低成本窗口。",
			"adv.save": "省 {p}%",
			"adv.now": "当前",
			"adv.at": "未来 48 小时内最低出现在 {t}（约 {n} 小时后）",
			"adv.tip": "批处理任务建议调度到该窗口；在线请求无可选空间。",
			"adv.noneTitle": "当前即最优窗口",
			"adv.noneDesc": "所有纳入监控的按量模型此刻均处于其自身的最低价格窗口，未来 48 小时内无更省的调度空间。",
			"adv.pick": "此刻建议",
			"adv.pickHint": "叠加当前生效优惠后最低",
			"adv.next": "次选 {name} ¥{p}/M。需按任务能力要求二次筛选。",
			"camp": "限时活动",
			"camp.hint": "只有「有明确起止日」的活动才进日历。已结束的不删除——<b>「昨天还有五折」本身就是决策信息</b>。",
			"camp.left": "剩 {n} 天",
			"camp.lastday": "最后一天",
			"camp.done": "已结束",
			"camp.unknown": "未公布截止日",
			"camp.none": "暂无生效中的限时活动记录。",
			"meta": "数据溯源",
			"meta.verified": "已核实",
			"meta.reported": "待官方核实",
			"meta.stale": "待复核",
			"meta.total": "共 {n} 条优惠记录",
			"meta.updated": "数据核实时间：{t}",
			"meta.note": "本插件内置人工核实的数据集，离线可用。厂商活动以周为单位变动，<b>请以官方页面为准</b>；标记「待官方核实」的条目尚未取得官方一手来源，仅供参考。",
			"meta.sources": "查看各条来源与核实状态",
			"refresh": "刷新",
			"scope.payg": "按量计费",
			"scope.sub": "套餐内",
			"scope.credits": "积分抵扣",
			"scope.channel": "指定渠道",
			"conf.verified": "已核实",
			"conf.reported": "二手待核",
			"conf.stale": "待复核",

			/* ---- 注册专属福利（广告专区）----
			   合规口径依据（2026-09-21 核实）：
			     ·《互联网广告管理办法》第九条第三款：通过知识介绍、体验分享、消费测评等
			       形式推销商品或服务并附加购物链接的，广告发布者应当**显著标明"广告"**。
			     ·《互联网广告可识别性执法指南》第七条：设置专门区域并显著标明"广告"的，
			       可认定该区域内广告具有可识别性 —— 这正是本专区采用「独立区域 + 打包标注」
			       形态而非逐条零散标注的依据。
			   ⚠️ 法定字样是「广告」。写「推广」「返利」「佣金」「赞助」都**不能**替代。
			   ⚠️ 阿里云《云大使推广规范》3.1.2 与腾讯云 CPS 协议第 3 项均明文禁止以
			      网页插件、可执行代码等方式强制建立推广关系 —— 故本插件只做展示与
			      用户主动点击跳转，**不得自动注入或改写 URL 参数**。 */
			"aff.title": "注册专属福利",
			"aff.adTag": "广告",
			"aff.zoneNote": "本区域为商业推广内容",
			"aff.hint": "如果你已决定长期使用某家平台，从下面的入口注册可以额外拿到新用户福利。",
			"aff.disclosure": "广告：以上为商业推广链接，作者（本插件开发者）可获得佣金或奖励。你的注册价格与账户权益不受影响。",
			"aff.publisher": "广告发布者：本插件作者",
			"aff.independence": "推广关系不影响本页任何排序与成本计算——排序仅依据价格与时段规则，且可被 verify-neutrality.mjs 复现验证。",
			"aff.noInject": "跳转使用平台提供的原始链接，未附加或改写任何推广参数。",
			"aff.badge": "邀请码",
			"aff.matched": "与当前推荐相关",
			"aff.all": "全部福利",
			"aff.hide": "关闭广告",
			"aff.show": "显示注册福利",
			"aff.hiddenTip": "广告区域已关闭。本插件的价格与时段信息不受影响，仍正常展示。",
			"aff.empty": "暂无可用的注册福利条目。",
			"aff.source": "福利信息于 {t} 人工核实",
			"aff.learn": "了解该平台",
			"aff.verifyPending": "待核实"
		};

		const en = {
			"view.tab": "🕐 Model Clock",
			"title": "Model Clock",
			"sub": "Cheapest model right now · live view of time-window discounts",
			"zone.off": "DeepSeek off-peak · 50% off active",
			"zone.peak": "DeepSeek peak · standard rate",
			"best": "Best right now",
			"best.hint": "Sorted by effective output price with all currently active discounts applied. Pay-as-you-go models only — subscription/credit plans need opaque secondary conversion and are excluded to avoid misleading comparisons.",
			"best.lowest": "Lowest now",
			"best.off": "{d}% off",
			"best.none": "No time discount",
			"unit": "/M output",
			"band": "All-day cost heatmap",
			"band.hint": "One cell per hour; colour shows discount depth for that platform (cooler = cheaper). The vertical line marks now. Note that peak definitions differ per vendor — DeepSeek has two peak blocks, Zhipu only one in the afternoon, Baidu Qianfan uses an all-day tiered scheme.",
			"band.legend.std": "Standard rate",
			"band.legend.mid": "Moderate discount",
			"band.legend.low": "Deep discount",
			"band.legend.route": "Routing upgrade (same price, stronger model)",
			"band.sessionTz": "Beijing time",
			"adv": "\"Wait and save\" scheduling advice",
			"adv.hint": "The real payoff: not just lookup, but an executable scheduling decision — move deferrable batch work into the cheap window.",
			"adv.save": "Save {p}%",
			"adv.now": "now",
			"adv.at": "Lowest in the next 48h at {t} (about {n}h away)",
			"adv.tip": "Schedule batch work into that window; online requests have no slack.",
			"adv.noneTitle": "Already the cheapest window",
			"adv.noneDesc": "Every monitored pay-as-you-go model is currently at its own lowest price window. No cheaper slot within 48 hours.",
			"adv.pick": "Suggested now",
			"adv.pickHint": "Lowest after active discounts",
			"adv.next": "Next best: {name} ¥{p}/M. Filter by capability before switching.",
			"camp": "Limited-time campaigns",
			"camp.hint": "Only campaigns with explicit start/end dates appear here. Ended ones are kept — \"50% off yesterday\" is decision-relevant information.",
			"camp.left": "{n}d left",
			"camp.lastday": "Last day",
			"camp.done": "Ended",
			"camp.unknown": "End date unpublished",
			"camp.none": "No active limited-time campaigns on record.",
			"meta": "Data provenance",
			"meta.verified": "Verified",
			"meta.reported": "Unverified",
			"meta.stale": "Needs re-check",
			"meta.total": "{n} discount records",
			"meta.updated": "Data last verified: {t}",
			"meta.note": "A hand-curated dataset ships with this plugin so it works offline. Vendor campaigns change weekly — <b>always confirm on the official page</b>. Records marked \"unverified\" lack a first-party source and are indicative only.",
			"meta.sources": "Show sources and verification status",
			"refresh": "Refresh",
			"scope.payg": "Pay-as-you-go",
			"scope.sub": "In plan",
			"scope.credits": "Credit-based",
			"scope.channel": "Specific channel",
			"conf.verified": "Verified",
			"conf.reported": "Unverified",
			"conf.stale": "Stale",

			/* ---- Signup perks (AD ZONE) ----
			   The legally required marker in China is the word "广告" (advertisement).
			   "promotion" / "affiliate" / "sponsored" do NOT substitute for it.
			   A dedicated zone prominently marked as advertising is treated as
			   identifiable advertising (执法指南 art. 7), which is why this is a
			   self-contained labelled block rather than per-link annotations. */
			"aff.title": "Signup perks",
			"aff.adTag": "Ad",
			"aff.zoneNote": "This section is commercial promotion",
			"aff.hint": "If you've already settled on a platform, signing up through the links below gets you extra new-user benefits.",
			"aff.disclosure": "Ad: the links above are commercial promotions and the author earns a commission. Your price and account benefits are unaffected.",
			"aff.publisher": "Advertiser: the plugin author",
			"aff.independence": "Promotional relationships do not affect any ranking or cost calculation on this page — ranking uses price and time rules only, reproducible via verify-neutrality.mjs.",
			"aff.noInject": "Links open the platform's original URL; no promotional parameters are added or rewritten.",
			"aff.badge": "Code",
			"aff.matched": "Related to top pick",
			"aff.all": "All perks",
			"aff.hide": "Close ad",
			"aff.show": "Show signup perks",
			"aff.hiddenTip": "The ad section is closed. Pricing and time-window features are unaffected.",
			"aff.empty": "No signup perks available.",
			"aff.source": "Perks manually verified on {t}",
			"aff.learn": "Learn more",
			"aff.verifyPending": "Unverified"
		};

		/* ================================================================
		 *  三、数据
		 *
		 *  DATA_VERSION / DATA_VERIFIED_AT 用于界面上做「数据新鲜度」提示。
		 *  confidence: verified = 已从官方一手来源核实；reported = 二手汇总待核。
		 *  过期的 campaign 不删除，保留 status="expired"。
		 * ================================================================ */
		const DATA_VERSION = "2026.09.21";
		const DATA_VERIFIED_AT = "2026-09-21";
		/** 超过该天数未复核的条目在界面上降级提示 */
		const STALE_AFTER_DAYS = 14;

		const PROVIDERS = [
			{ id: "deepseek", name: "DeepSeek 官方", tier: "direct",
			  url: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/", parse: "static" },
			{ id: "zhipu", name: "智谱 AI / BigModel", tier: "direct",
			  url: "https://open.bigmodel.cn/pricing", parse: "mixed" },
			{ id: "aliyun-bailian", name: "阿里云百炼", tier: "cloud",
			  url: "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview", parse: "static" },
			{ id: "baidu-qianfan", name: "百度智能云千帆", tier: "cloud",
			  url: "https://cloud.baidu.com/product/qianfan_home/token_plan_personal.html", parse: "static" },
			{ id: "volcano-ark", name: "火山方舟", tier: "cloud",
			  url: "https://docs.volcengine.com/docs/82379/2658332", parse: "api" },
			{ id: "tencent-cloud", name: "腾讯云 Token Plan", tier: "cloud",
			  url: "https://cloud.tencent.com/document/product/1823/133811", parse: "static" },
			{ id: "siliconflow", name: "硅基流动", tier: "aggregator",
			  url: "https://siliconflow.cn/pricing", parse: "static" },
			{ id: "moonshot", name: "月之暗面 Kimi", tier: "direct",
			  url: "https://platform.kimi.com/docs/pricing/chat.md", parse: "static" },
			{ id: "minimax", name: "MiniMax", tier: "direct",
			  url: "https://platform.minimaxi.com/docs/guides/pricing-paygo.md", parse: "static" },
			{ id: "scnet", name: "国家超算互联网", tier: "cloud",
			  url: "https://www.scnet.cn/home/subject/maas/index.html", parse: "static" },
			{ id: "zhipu-intl", name: "智谱国际版 Z.ai", tier: "direct",
			  url: "https://docs.z.ai/guides/overview/pricing", parse: "static" }
		];

		/** 按量计费模型：base = 标准输出价（元 / 百万 token） */
		const MODELS = [
			{ id: "glm-5.3-flash", providerId: "zhipu", name: "GLM-5.3-Flash", prov: "智谱 AI",
			  base: 2.8, tag: "轻量", note: "开源轻量档" },
			{ id: "deepseek-flash", providerId: "deepseek", name: "V4.1 Flash", prov: "DeepSeek 官方",
			  base: 8, tag: "轻量 · 1M", isDeepSeek: true },
			{ id: "deepseek-v4-pro", providerId: "deepseek", name: "V4 Pro", prov: "DeepSeek 官方",
			  base: 27, tag: "旗舰 · 1M", isDeepSeek: true,
			  note: "9/14 起疑似全部路由至 Flash 计费" },
			{ id: "siliconflow-ds-flash", providerId: "siliconflow", name: "DeepSeek-V4-Flash",
			  prov: "硅基流动", base: 9, tag: "转售" },
			{ id: "minimax-m3", providerId: "minimax", name: "M3", prov: "MiniMax",
			  base: 16.8, tag: "旗舰 · 1M", note: "永久五折后价" },
			{ id: "kimi-k3", providerId: "moonshot", name: "K3", prov: "月之暗面 Kimi",
			  base: 100, tag: "旗舰 · 1M" }
		];

		/**
		 * 优惠时间窗
		 *   kind: recurring = 每日/每周循环时段；campaign = 有起止日的限时活动；
		 *         structural = 结构性定价（无时间窗，但与限时活动严格区分）
		 *   days: 1=周一 … 7=周日
		 *   start/end: 小时（0-24）。end <= start 表示跨天。end=24 表示到当日 24:00。
		 *   mult: 折扣后的价格比例（0.5 = 五折；1 = 无折扣）
		 */
		const DISCOUNTS = [
			/* ---------- DeepSeek：峰谷定价 ---------- */
			{ id: "ds-wd-night", providerId: "deepseek", kind: "recurring",
			  title: "工作日凌晨至早间闲时半价", days: [1, 2, 3, 4, 5], start: 0, end: 9, mult: 0.5,
			  scope: "pay_as_you_go", holidayRule: true,
			  src: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
			  conf: "verified", verifiedAt: "2026-09-21" },
			{ id: "ds-wd-midday", providerId: "deepseek", kind: "recurring",
			  title: "工作日午间闲时半价", days: [1, 2, 3, 4, 5], start: 12, end: 14, mult: 0.5,
			  scope: "pay_as_you_go", holidayRule: true,
			  src: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
			  conf: "verified", verifiedAt: "2026-09-21" },
			{ id: "ds-wd-eve", providerId: "deepseek", kind: "recurring",
			  title: "工作日晚间闲时半价", days: [1, 2, 3, 4, 5], start: 18, end: 24, mult: 0.5,
			  scope: "pay_as_you_go", holidayRule: true,
			  src: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
			  conf: "verified", verifiedAt: "2026-09-21" },
			{ id: "ds-weekend", providerId: "deepseek", kind: "recurring",
			  title: "周末全天按低谷价计费", days: [6, 7], start: 0, end: 24, mult: 0.5,
			  scope: "pay_as_you_go",
			  note: "仅见权威媒体报道，官方定价页正文未载，待官方确认",
			  src: "https://api-docs.deepseek.com/zh-cn/quick_start/pricing/",
			  conf: "reported", verifiedAt: null },

			/* ---------- 智谱：Coding Plan 非高峰抵扣（拆 3 段，因为高峰仅限工作日）---------- */
			{ id: "zp-off-eve", providerId: "zhipu", kind: "recurring",
			  title: "Coding Plan 非高峰按基础积分 50% 抵扣（每日 18:00–24:00）",
			  days: [1, 2, 3, 4, 5, 6, 7], start: 18, end: 24, mult: 0.5, scope: "subscription",
			  src: "https://docs.bigmodel.cn/cn/coding-plan/overview.md",
			  conf: "verified", verifiedAt: "2026-09-21" },
			{ id: "zp-off-morn", providerId: "zhipu", kind: "recurring",
			  title: "Coding Plan 非高峰按基础积分 50% 抵扣（每日 00:00–14:00）",
			  days: [1, 2, 3, 4, 5, 6, 7], start: 0, end: 14, mult: 0.5, scope: "subscription",
			  src: "https://docs.bigmodel.cn/cn/coding-plan/overview.md",
			  conf: "verified", verifiedAt: "2026-09-21" },
			{ id: "zp-off-wknd", providerId: "zhipu", kind: "recurring",
			  title: "Coding Plan 非高峰按基础积分 50% 抵扣（周末 14:00–18:00）",
			  days: [6, 7], start: 14, end: 18, mult: 0.5, scope: "subscription",
			  note: "高峰仅限周一至周五 14:00–18:00，故周末该时段仍属非高峰，必须单独成条",
			  src: "https://docs.bigmodel.cn/cn/coding-plan/overview.md",
			  conf: "verified", verifiedAt: "2026-09-21" },

			/* ---------- 百度千帆：全时段梯度折扣 ---------- */
			{ id: "bd-wd-day", providerId: "baidu-qianfan", kind: "recurring",
			  title: "工作日白天 2 折", days: [1, 2, 3, 4, 5], start: 8, end: 21, mult: 0.2,
			  scope: "subscription", src: "https://cloud.baidu.com/product/qianfan_home/token_plan_personal.html",
			  conf: "reported", verifiedAt: null },
			{ id: "bd-night", providerId: "baidu-qianfan", kind: "recurring",
			  title: "夜间低至 0.5 折", days: [1, 2, 3, 4, 5, 6, 7], start: 21, end: 8, mult: 0.05,
			  scope: "subscription", src: "https://cloud.baidu.com/product/qianfan_home/token_plan_personal.html",
			  conf: "reported", verifiedAt: null },
			{ id: "bd-weekend", providerId: "baidu-qianfan", kind: "recurring",
			  title: "周末全天 1 折", days: [6, 7], start: 8, end: 21, mult: 0.1,
			  scope: "subscription", src: "https://cloud.baidu.com/product/qianfan_home/token_plan_personal.html",
			  conf: "reported", verifiedAt: null },

			/* ---------- 阿里云百炼 ---------- */
			{ id: "ali-night", providerId: "aliyun-bailian", kind: "recurring",
			  title: "Token Plan 夜间五折", days: [1, 2, 3, 4, 5, 6, 7], start: 22, end: 8, mult: 0.5,
			  scope: "subscription", src: "https://help.aliyun.com/zh/model-studio/token-plan-personal-overview",
			  conf: "reported", verifiedAt: null },
			{ id: "ali-savings", providerId: "aliyun-bailian", kind: "structural",
			  title: "AI 通用型节省计划（A 类最高 7 折 / C 类最高 5.3 折）",
			  scope: "subscription", src: "https://www.aliyun.com/benefit/scene/ai-discount",
			  conf: "reported", verifiedAt: null,
			  note: "承诺消费类折扣，非时间窗优惠" },

			/* ---------- 硅基流动 ---------- */
			{ id: "sif-off", providerId: "siliconflow", kind: "recurring",
			  title: "DeepSeek-Flash 闲时价", days: [1, 2, 3, 4, 5, 6, 7], start: 2, end: 8,
			  mult: 1 / 3, scope: "pay_as_you_go", src: "https://siliconflow.cn/pricing",
			  conf: "reported", verifiedAt: null,
			  note: "聚合平台转售价，其余时段为标准价" },

			/* ---------- 火山方舟 ---------- */
			{ id: "vol-route", providerId: "volcano-ark", kind: "recurring", routing: true,
			  title: "Auto 模式夜间路由至 Kimi-K3 比例提升",
			  days: [1, 2, 3, 4, 5, 6, 7], start: 0, end: 8, mult: 1,
			  scope: "subscription", src: "https://docs.volcengine.com/docs/82379/2658332",
			  conf: "reported", verifiedAt: null,
			  note: "隐性优惠：价格不变但夜间路由到更强模型，不体现在单价表上" },
			{ id: "vol-agent-plan", providerId: "volcano-ark", kind: "campaign",
			  title: "Agent Plan Small/Medium 2.5 折普惠",
			  from: "2026-06-08", until: "2026-11-08", scope: "subscription",
			  src: "https://docs.volcengine.com/docs/82379/2658332",
			  conf: "reported", verifiedAt: null },

			/* ---------- 腾讯云 ---------- */
			{ id: "tx-sep", providerId: "tencent-cloud", kind: "campaign",
			  title: "Token Plan 9 月限时优惠（Auto / Kimi K2.7 Code / MiniMax-M3 五折）",
			  from: "2026-09-01", until: "2026-09-30", scope: "subscription",
			  src: "https://cloud.tencent.com/document/product/1823/133811",
			  conf: "reported", verifiedAt: null },
			{ id: "tx-k3-credits", providerId: "tencent-cloud", kind: "campaign",
			  title: "Kimi K3 积分 95 折", from: "2026-09-04", until: "2026-09-30",
			  scope: "credits", src: "https://cloud.tencent.com/document/product/1823/133811",
			  conf: "reported", verifiedAt: null },

			/* ---------- 国家超算 ---------- */
			{ id: "sc-maas", providerId: "scnet", kind: "campaign",
			  title: "MaaS 特惠专场（含每日冰点秒杀）",
			  from: "2026-08-13", until: "2026-10-13", scope: "subscription",
			  src: "https://www.scnet.cn/home/subject/maas/index.html",
			  conf: "verified", verifiedAt: "2026-09-21",
			  note: "9/1 起改按「综合扣减倍率」计费且倍率按周调整——价格曲线每周变化" },

			/* ---------- 智谱：已结束的活动（保留，因为「昨天还有」本身是决策信息）---------- */
			{ id: "zp-night-free", providerId: "zhipu", kind: "campaign",
			  title: "GLM Coding Plan 夜间畅用（通过 ZCode 额度归零）",
			  from: "2026-09-03", until: "2026-09-20", scope: "subscription",
			  src: "https://docs.bigmodel.cn/cn/coding-plan/notice/event-glm-5.3-flash",
			  conf: "verified", verifiedAt: "2026-09-21", status: "expired",
			  note: "覆盖所有付费套餐用户，仅限 GLM-5.3-Flash；其他 Agent 使用时额度翻倍（相当于半价）" },
			{ id: "zp-flash-half", providerId: "zhipu", kind: "campaign",
			  title: "GLM-5.3-Flash 限时五折",
			  from: null, until: null, scope: "pay_as_you_go",
			  src: "https://open.bigmodel.cn/pricing",
			  conf: "reported", verifiedAt: null,
			  note: "官方仅写「限时五折」未给起止日期 —— 未公布截止日的促销必须以复核周期兜底" },

			/* ---------- 结构性定价 ---------- */
			{ id: "mm-permanent", providerId: "minimax", kind: "structural",
			  title: "M3 永久五折", scope: "pay_as_you_go",
			  src: "https://platform.minimaxi.com/docs/guides/pricing-paygo.md",
			  conf: "reported", verifiedAt: null,
			  note: "官方标注 Permanent 50% off，无截止日。必须与限时活动区分，避免用户误判「会涨价」"
			}
		];

		/* ================================================================
		 *  三之二、推广链接配置（注册专属福利）
		 *
		 *  🔴 中立性硬约束 —— 这是本插件最不可妥协的一条：
		 *
		 *  AFFILIATE_* 这些数据**不得以任何形式参与 recommend() / priceAt() /
		 *  schedulingAdvice() 的计算**。排序只看成本，推广关系绝不进入权重。
		 *
		 *  做法不是「小心不要用在排序里」，而是**物理隔离**：
		 *  recommend(hour, dow) 的签名里根本没有 affiliate 参数，
		 *  它无法读到这些数据。verify-neutrality.mjs 会断言这一点。
		 *
		 *  理由：用户信任本插件的前提是「此刻推荐」的排序客观。
		 *  一旦返利能影响排序，产品核心价值立即归零，
		 *  而且用户无法察觉——这是最坏的一类失信。
		 *
		 *  另：DeepSeek 没有推广计划，而它恰是最常被推荐的平台（闲时半价最便宜）。
		 *  排序中立性因此有天然保障——最省钱的那个不带任何商业动机。
		 *
		 *  数据来源与同步：host 侧权威源为 config/affiliate.json；
		 *  下面的 AFFILIATE_FALLBACK 是离线兜底副本，
		 *  由 verify-affiliate-sync.mjs 强制校验与 JSON 一致，避免双份漂移。
		 * ================================================================ */
		const AFFILIATE_ENDPOINT = "/api/model-clock/affiliate";
		const AFFILIATE_CLICK_ENDPOINT = "/api/model-clock/affiliate/click";
		const AFF_PREF_KEY = "model-clock.affiliate.hidden";
		const AFFILIATE_VERIFIED_AT = "2026-09-21";

		const AFFILIATE_FALLBACK = {
			disclosure: "广告：以上为商业推广链接，作者（本插件开发者）可获得佣金或奖励。你的注册价格与账户权益不受影响。",
			items: [
				{ id: "zhipu-bigmodel-glm53", name: "智谱 BigModel · GLM-5.3",
				  url: "https://www.bigmodel.cn/invite?icode=wcPM7tDBWHKpP5q407C%2BsEjPr3uHog9F4g5tjuOUqno%3D",
				  inviteCode: "wcPM7tDBWHKpP5q407C+sEjPr3uHog9F4g5tjuOUqno=", badge: "2000万Tokens",
				  benefit: "通过邀请链接注册即得 2000 万 Tokens 大礼包；GLM-5.3 旗舰模型，推理 / 代码 / 智能体综合能力达开源 SOTA。",
				  rewardType: "invite_both", providerIds: ["zhipu"], routerProviderIds: ["zai-coding-cn"],
				  verifyStatus: "verified" },
				{ id: "siliconflow", name: "硅基流动 SiliconFlow",
				  url: "https://cloud.siliconflow.cn/i/qPS9knTI", inviteCode: "qPS9knTI", badge: "新人福利",
				  benefit: "完成实名认证可得 ¥16 全平台通用代金券，可用于抵扣 API 调用；支持 DeepSeek、Qwen 等主流开源模型。",
				  rewardType: "invite_both", providerIds: ["siliconflow"], routerProviderIds: [] },
				{ id: "volcano-coding-plan", name: "火山方舟 · Coding Plan",
				  url: "https://volcengine.com/L/ctwEY-4gCoY/", inviteCode: "T5BK3K2L", badge: "受邀9.5折",
				  benefit: "方舟 Coding Plan 支持 GLM-5.3 系列、DeepSeek-V4 系列（正式版）、Doubao-Seed-Evolving、MiniMax-M3 等模型，工具不限。通过邀请入口订阅可叠加 9.5 折。",
				  rewardType: "invite_both", providerIds: ["volcano-ark"], routerProviderIds: [] },
				{ id: "aliyun-cps-8zhe", name: "阿里云 · 新客首购 8 折",
				  url: "https://www.aliyun.com/minisite/goods?userCode=w7rmnuid", inviteCode: null, badge: "首购8折",
				  benefit: "阿里云新客户首购享 8 折补贴；百炼（Model Studio）Token Plan 有 22:00–08:00 夜间五折。",
				  rewardType: "cps", providerIds: ["aliyun-bailian"], routerProviderIds: [] },
				{ id: "tencent-cloud-cps", name: "腾讯云 · 合作伙伴专享",
				  url: "https://cloud.tencent.com/act/pro/cps_3", inviteCode: null, badge: "合作专享",
				  benefit: "腾讯云合作伙伴专享入口；Token Plan 侧 9 月有限时优惠（Auto / Kimi K2.7 Code / MiniMax-M3 五折）。",
				  rewardType: "cps", providerIds: ["tencent-cloud"], routerProviderIds: [] },
				{ id: "longcat-ai", name: "LongCat AI 开放平台",
				  url: "https://longcat.chat/platform/product?inviteCode=ECBF1E71", inviteCode: "ECBF1E71",
				  badge: "送2000万Tokens",
				  benefit: "通过邀请链接完成实名认证，你我各得 1000 万 Tokens（叠加平台新人礼包最高可得 2000 万）；首购下单返实付金额 5%。",
				  rewardType: "invite_both", providerIds: [], routerProviderIds: ["longcat"] }
			]
		};

		/**
		 * 把一条福利与「当前推荐」建立关联——**只用于标记，不用于排序**。
		 * 返回 true 仅表示「这条福利对应的平台此刻出现在推荐列表里」，
		 * 供 UI 打一个「与当前推荐相关」的标记，不影响任何顺序。
		 */
		function affiliateMatchesRecommendation(item, recoList) {
			const ids = item.providerIds || [];
			if (!ids.length) return false;
			for (let i = 0; i < recoList.length; i++) {
				if (ids.indexOf(recoList[i].m.providerId) !== -1) return true;
			}
			return false;
		}

		/** 仅做展示排序：命中的排前面。**不参与价格排序，不改变推荐结果。** */
		function orderAffiliateForDisplay(items, recoList) {
			const hit = [], rest = [];
			for (let i = 0; i < items.length; i++) {
				(affiliateMatchesRecommendation(items[i], recoList) ? hit : rest).push(items[i]);
			}
			return hit.concat(rest);
		}

		/* ================================================================
		 *  四、计算引擎
		 * ================================================================ */

		const WEEKDAY_CN = ["一", "二", "三", "四", "五", "六", "日"];

		/**
		 * 取北京时间。不能用 new Date().getHours() —— 那取的是本机时区，
		 * 开发者不在 UTC+8 时会得到完全错误的时段判断。
		 */
		function beijingNow(d) {
			const t = d || new Date();
			let hour = t.getHours(), minute = t.getMinutes();
			let dow = t.getDay() === 0 ? 7 : t.getDay();
			let y = t.getFullYear(), mo = t.getMonth() + 1, da = t.getDate();
			try {
				const parts = new Intl.DateTimeFormat("en-US", {
					timeZone: "Asia/Shanghai", hour12: false,
					weekday: "short", hour: "2-digit", minute: "2-digit",
					year: "numeric", month: "2-digit", day: "2-digit"
				}).formatToParts(t);
				const get = (k) => { const p = parts.find((x) => x.type === k); return p ? p.value : null; };
				const map = { Sun: 7, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
				const hh = get("hour");
				if (hh != null) hour = Number(hh) % 24;
				const mm = get("minute");
				if (mm != null) minute = Number(mm);
				const wd = get("weekday");
				if (wd && map[wd]) dow = map[wd];
				if (get("year")) y = Number(get("year"));
				if (get("month")) mo = Number(get("month"));
				if (get("day")) da = Number(get("day"));
			} catch (e) { /* Intl 不可用时退回本机时区，不阻断渲染 */ }
			const pad = (n) => String(n).padStart(2, "0");
			return {
				hour: hour, minute: minute, dow: dow,
				dateStr: y + "-" + pad(mo) + "-" + pad(da),
				dateCn: y + "-" + pad(mo) + "-" + pad(da) + "　周" + WEEKDAY_CN[dow - 1],
				hhmm: pad(hour) + ":" + pad(minute)
			};
		}

		/** 小时是否落在某窗口内（end <= start 视为跨天）。
		 *  注意：这里**不**判断星期——星期由调用方 windowMult 先过滤，
		 *  两块职责分开是为了让「跨天窗口 + 星期」的组合语义保持单一。 */
		function inWindow(hour, w) {
			const s = w.start, e = w.end;
			if (e <= s) return hour >= s || hour < e;
			return hour >= s && hour < e;
		}

		/** 某个平台在指定时刻(小时,星期)的折扣比例；返回 1 表示无折扣 */
		function windowMult(providerId, hour, dow) {
			let mult = 1;
			for (let i = 0; i < DISCOUNTS.length; i++) {
				const d = DISCOUNTS[i];
				if (d.providerId !== providerId) continue;
				if (d.kind !== "recurring") continue;
				if (d.status === "expired") continue;
				if (d.days.indexOf(dow) === -1) continue;
				if (!inWindow(hour, d)) continue;
				if (d.mult < mult) mult = d.mult;
			}
			return mult;
		}

		/** 某个平台在指定时刻是否存在「路由优化」（价格不变但模型更好） */
		function hasRouting(providerId, hour, dow) {
			for (let i = 0; i < DISCOUNTS.length; i++) {
				const d = DISCOUNTS[i];
				if (d.providerId !== providerId || !d.routing) continue;
				if (d.days.indexOf(dow) === -1) continue;
				if (inWindow(hour, d)) return true;
			}
			return false;
		}

		/** 模型在指定时刻的生效单价（元 / 百万 token 输出） */
		function priceAt(model, hour, dow) {
			return model.base * windowMult(model.providerId, hour, dow);
		}

		/** 中文「折」的口径：0.5 → 5 折（折数 = 支付比例 × 10） */
		function discText(mult) {
			const z = Math.round(mult * 1000) / 100;
			return String(z);
		}

		function pctOff(mult) { return Math.round((1 - mult) * 100); }

		/** 当天是否命中「高峰」——用于头部状态提示，仅针对 DeepSeek */
		function isDeepSeekOffPeak(hour, dow) {
			const ds = MODELS.filter((m) => m.isDeepSeek)[0];
			if (!ds) return true;
			return windowMult(ds.providerId, hour, dow) < 1 - 1e-9;
		}

		/** 此刻推荐：按当前生效单价升序 */
		function recommend(hour, dow) {
			const list = MODELS.map((m) => {
				const mult = windowMult(m.providerId, hour, dow);
				return { m: m, mult: mult, eff: m.base * mult };
			});
			list.sort((a, b) => a.eff - b.eff);
			return list;
		}

		/** 未来 hours 小时内该模型的最低价位窗口 */
		function bestUpcoming(model, hour, dow, hours) {
			const span = hours || 48;
			let best = null;
			for (let step = 1; step <= span; step++) {
				const t = (hour + step) % 24;
				const d = ((dow - 1 + Math.floor((hour + step) / 24)) % 7) + 1;
				const p = priceAt(model, t, d);
				if (!best || p < best.p - 1e-9) best = { step: step, hour: t, dow: d, p: p };
			}
			return best;
		}

		/** 调度建议：找出「现在不限最低、但未来有明显更省窗口」的模型 */
		function schedulingAdvice(hour, dow) {
			const out = [];
			for (let i = 0; i < MODELS.length; i++) {
				const m = MODELS[i];
				const cur = priceAt(m, hour, dow);
				if (cur <= 1e-9) continue;
				const b = bestUpcoming(m, hour, dow, 48);
				if (!b) continue;
				const save = 1 - b.p / cur;
				if (save > 0.02) out.push({ m: m, cur: cur, best: b, save: save });
			}
			out.sort((a, b) => b.save - a.save);
			return out;
		}

		/** 解析日期字符串为「相对今天的天数偏移」——用 UTC 归一到日界线，避免时区误差 */
		function daysFromToday(dateStr, nowDateStr) {
			if (!dateStr) return null;
			const a = Date.parse(dateStr + "T00:00:00Z");
			const b = Date.parse(nowDateStr + "T00:00:00Z");
			if (isNaN(a) || isNaN(b)) return null;
			return Math.round((a - b) / 86400000);
		}

		/** 限时活动：计算剩余天数与状态 */
		function campaigns(nowDateStr) {
			const out = [];
			for (let i = 0; i < DISCOUNTS.length; i++) {
				const d = DISCOUNTS[i];
				if (d.kind !== "campaign") continue;
				let left = d.until ? daysFromToday(d.until, nowDateStr) : null;
				let state;
				if (d.status === "expired") state = "done";
				else if (left === null) state = "unknown";
				else if (left < 0) state = "done";
				else if (left <= 1) state = "soon";
				else state = "live";
				out.push({ d: d, left: left, state: state });
			}
			// 进行中 → 即将结束 → 未公布 → 已结束
			const order = { live: 0, soon: 1, unknown: 2, done: 3 };
			out.sort((a, b) => (order[a.state] - order[b.state]) || ((a.left ?? 999) - (b.left ?? 999)));
			return out;
		}

		/** 数据可信度统计 */
		function confidenceStats() {
			let verified = 0, reported = 0, stale = 0;
			for (let i = 0; i < DISCOUNTS.length; i++) {
				const d = DISCOUNTS[i];
				const staleDays = d.verifiedAt ? -daysFromToday(d.verifiedAt, DATA_VERIFIED_AT) : null;
				const isStale = d.conf === "reported" || (staleDays != null && staleDays > STALE_AFTER_DAYS) || !d.verifiedAt;
				if (isStale) { stale++; if (d.conf === "reported") reported++; }
				else verified++;
			}
			return { total: DISCOUNTS.length, verified: verified, reported: reported, stale: stale };
		}

		/** 折扣深度 → 颜色（绿=深折扣，红=无折扣） */
		function heatColor(mult) {
			const r = Math.max(0, Math.min(1, (mult - 0.3) / 0.7));
			const stops = [[0, [48, 164, 108]], [0.5, [232, 163, 61]], [1, [229, 72, 77]]];
			let a = stops[0], b = stops[stops.length - 1];
			for (let i = 0; i < stops.length - 1; i++) {
				if (r >= stops[i][0] && r <= stops[i + 1][0]) { a = stops[i]; b = stops[i + 1]; break; }
			}
			const t = (r - a[0]) / ((b[0] - a[0]) || 1);
			const c = [0, 1, 2].map((i) => Math.round(a[1][i] + (b[1][i] - a[1][i]) * t));
			const alpha = (0.34 + 0.48 * (1 - r)).toFixed(2);
			return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + alpha + ")";
		}

		/** 参与热力带展示的平台（只保留存在时段差异的，无时间维度信息的不占位） */
		function bandProviders() {
			const seen = {};
			const out = [];
			for (let i = 0; i < DISCOUNTS.length; i++) {
				const d = DISCOUNTS[i];
				if (d.kind !== "recurring") continue;
				if (d.status === "expired") continue;
				if (seen[d.providerId]) continue;
				seen[d.providerId] = true;
				const p = PROVIDERS.filter((x) => x.id === d.providerId)[0];
				if (p) out.push(p);
			}
			return out;
		}

		/** 热力带一行：24 个小时的折扣比例 */
		function bandCells(providerId, dow) {
			const arr = [];
			for (let hour = 0; hour < 24; hour++) {
				arr.push({
					hour: hour,
					mult: windowMult(providerId, hour, dow),
					routing: hasRouting(providerId, hour, dow)
				});
			}
			return arr;
		}

		/* ================================================================
		 *  五、辅助
		 * ================================================================ */

		function providerName(id) {
			const p = PROVIDERS.filter((x) => x.id === id)[0];
			return p ? p.name : id;
		}

		const SCOPE_KEY = {
			pay_as_you_go: "scope.payg",
			subscription: "scope.sub",
			credits: "scope.credits",
			channel: "scope.channel"
		};

		/** 给 <a> 加上统一的外链属性 */
		function link(url, text, key) {
			return h("a", {
				key: key, href: url, target: "_blank", rel: "noopener noreferrer",
				style: { color: "#2f6fd8", textDecoration: "none" }
			}, text);
		}

		/* ================================================================
		 *  六、子组件
		 * ================================================================ */

		/** 单张推荐卡 */
		function RecommendCard(props) {
			const r = props.item, idx = props.index, t = props.t;
			const m = r.m, off = r.mult < 1 - 1e-9;
			let tagCls = "grey", tagTxt = t("best.none");
			if (idx === 0) { tagCls = "green"; tagTxt = t("best.lowest"); }
			else if (off) { tagCls = r.mult <= 0.5 ? "green" : "amber"; tagTxt = t("best.off", { d: discText(r.mult) }); }
			return h("div", { className: idx === 0 ? "mc_card best" : "mc_card" },
				h("div", { className: "mc_card-top" },
					h("span", null, "#" + (idx + 1)),
					h("span", null, m.note ? m.note : "")
				),
				h("div", { className: "mc_card-name" }, m.name),
				h("div", { className: "mc_card-prov" }, m.prov + " · " + m.tag),
				h("div", { className: "mc_card-price" },
					"¥" + r.eff.toFixed(2),
					h("span", { className: "mc_card-unit" }, t("unit")),
					off ? h("span", { className: "mc_card-was" }, "¥" + m.base.toFixed(2)) : null
				),
				h("div", null, h("span", { className: "mc_tag " + tagCls }, tagTxt))
			);
		}

		/** 一行热力带 */
		function BandRow(props) {
			const p = props.provider, cells = props.cells, nowPct = props.nowPct, showNow = props.showNow, t = props.t;
			const total = cells.length;
			// 该平台是否有任何时段折扣（没有则不画竖线，避免误导）
			let any = false;
			for (let i = 0; i < cells.length; i++) { if (cells[i].mult < 1 - 1e-9 || cells[i].routing) { any = true; break; } }
			const childs = cells.map((c) => {
				let bg;
				if (c.routing) bg = "rgba(139,92,246,.85)";
				else if (!any) bg = "var(--dsw-alias-bg-layer-3,rgba(0,0,0,.05))";
				else bg = heatColor(c.mult);
				let tip = String(c.hour).padStart(2, "0") + ":00";
				if (c.routing) tip += "　路由至更强模型（价格不变）";
				else tip += "　" + (c.mult < 1 - 1e-9 ? discText(c.mult) + " 折" : "标准价");
				return h("div", { key: c.hour, className: "mc_cell", style: { background: bg }, title: tip });
			});
			if (showNow) {
				childs.push(h("div", {
					key: "__now",
					className: "mc_now",
					style: { left: "calc(" + (nowPct * 100).toFixed(3) + "% - 1px)" },
					title: t("band.sessionTz")
				}));
			}
			return h("div", { className: "mc_row" },
				h("div", { className: "mc_row-label" },
					h("b", null, p.name),
					h("i", null, providerSummary(p.id))
				),
				h("div", { className: "mc_band" }, childs)
			);
		}

		/** 平台时段描述（由数据推导，不硬编码） */
		function providerSummary(providerId) {
			const wins = DISCOUNTS.filter((d) => d.providerId === providerId && d.kind === "recurring" && d.status !== "expired");
			if (!wins.length) return "";
			let min = 1;
			for (let i = 0; i < wins.length; i++) if (wins[i].mult < min) min = wins[i].mult;
			const parts = [];
			if (wins.some((w) => w.routing)) parts.push("路由优化");
			if (min < 1 - 1e-9) parts.push("最低 " + discText(min) + " 折");
			const scopes = {};
			for (let i = 0; i < wins.length; i++) scopes[wins[i].scope || "pay_as_you_go"] = 1;
			const sk = Object.keys(scopes).map((k) => SCOPE_KEY[k] || k);
			if (sk.length && sk.indexOf("scope.payg") === -1) parts.push("套餐/积分口径");
			return parts.join(" · ");
		}

		/** 限时活动一行 */
		function CampaignRow(props) {
			const c = props.item, t = props.t;
			const d = c.d;
			let badgeCls = "live", badgeTxt;
			if (c.state === "done") { badgeCls = "done"; badgeTxt = t("camp.done"); }
			else if (c.state === "unknown") { badgeCls = "unknown"; badgeTxt = t("camp.unknown"); }
			else if (c.state === "soon") { badgeCls = "soon"; badgeTxt = c.left <= 0 ? t("camp.lastday") : t("camp.left", { n: c.left }); }
			else { badgeCls = "live"; badgeTxt = t("camp.left", { n: c.left }); }
			const range = (d.from || d.until)
				? (d.from || "—") + " → " + (d.until || "—")
				: "起止日期未公布";
			return h("div", { className: "mc_camp mc_camp-row" + (c.state === "done" ? " done" : ""), key: d.id },
				h("div", { className: "mc_camp-prov" }, providerName(d.providerId)),
				h("div", { className: "mc_camp-title", title: d.title + "　" + range + (d.note ? "　" + d.note : "") },
					d.title,
					h("span", { style: { color: "var(--dsw-alias-label-tertiary,#8b929b)", fontSize: "11px", marginLeft: "8px" } }, range)
				),
				h("div", { className: "mc_camp-badge " + badgeCls }, badgeTxt)
			);
		}

		/** 调度建议卡 */
		function AdviceCard(props) {
			const s = props.item, t = props.t;
			const inOff = s.cur < s.m.base - 1e-9;
			const mult = windowMult(s.m.providerId, props.hour, props.dow);
			return h("div", { className: "mc_adv-card" },
				h("div", { className: "mc_adv-head" },
					h("span", null, s.m.prov + " · " + s.m.name),
					h("span", null, t("unit").replace("/M ", ""))
				),
				h("div", { className: "mc_adv-big" }, t("adv.save", { p: Math.round(s.save * 100) })),
				h("div", { className: "mc_adv-desc" },
					"当前 ",
					h("b", null, "¥" + s.cur.toFixed(2) + "/M"),
					"，" + (inOff ? "正享受 " + discText(mult) + " 折优惠" : "处于标准价") + "。",
					h("br"),
					t("adv.at", { t: String(s.best.hour).padStart(2, "0") + ":00", n: s.best.step }),
					" → ",
					h("b", null, "¥" + s.best.p.toFixed(2) + "/M"),
					"。",
					h("br"),
					t("adv.tip")
				)
			);
		}

		/* ----------------------------------------------------------------
		 *  注册专属福利区块
		 *
		 *  设计要点（都是为了不损害「此刻推荐」的可信度）：
		 *   1. 独立成区，标题自明，不混进推荐卡里
		 *   2. 视觉用虚线边框 + 蓝色系，与价格信息（绿色=省）明显区分
		 *   3. 有显式披露语句，且提供「不再显示」一键关闭
		 *   4. 卡片顺序只按「是否与当前推荐相关」分组，不按返利高低排
		 *   5. 点击上报为尽力而为，失败静默——不影响跳转
		 * ---------------------------------------------------------------- */
		const STORAGE_KEY = "model-clock.affiliate.hidden";

		function readHiddenPref() {
			try {
				const ls = typeof window !== "undefined" ? window.localStorage : null;
				return ls ? ls.getItem(STORAGE_KEY) === "1" : false;
			} catch (e) { return false; }
		}

		function writeHiddenPref(v) {
			try {
				const ls = typeof window !== "undefined" ? window.localStorage : null;
				if (ls) ls.setItem(STORAGE_KEY, v ? "1" : "0");
			} catch (e) { /* 隐私模式 / 存储禁用时静默降级 */ }
		}

		function reportAffiliateClick(id) {
			try {
				const body = JSON.stringify({ id: id, at: Date.now() });
				// sendBeacon 不阻塞跳转，且在页面切走时仍能送达
				if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
					navigator.sendBeacon(AFFILIATE_CLICK_ENDPOINT, new Blob([body], { type: "application/json" }));
					return;
				}
				if (typeof fetch === "function") {
					fetch(AFFILIATE_CLICK_ENDPOINT, {
						method: "POST", headers: { "content-type": "application/json" },
						body: body, keepalive: true
					}).catch(function () {});
				}
			} catch (e) { /* 归因失败不影响用户跳转 —— 这是尽力而为的埋点 */ }
		}

		function AffiliateCard(props) {
			const item = props.item, matched = props.matched, t = props.t;
			const styleA = {
				href: item.url, target: "_blank", rel: "noopener noreferrer nofollow sponsored",
				className: "mc_aff-card",
				onClick: function () { reportAffiliateClick(item.id); }
			};
			const kids = [
				h("div", { className: "mc_aff-top", key: "top" },
					h("span", { className: "mc_aff-name" }, item.name),
					item.badge ? h("span", { className: "mc_aff-badge", key: "b" }, item.badge) : null
				),
				h("div", { className: "mc_aff-benefit", key: "ben" }, item.benefit),
				item.inviteCode
					? h("div", { className: "mc_aff-code", key: "code" }, t("aff.badge") + " " + item.inviteCode)
					: null,
				matched ? h("div", { className: "mc_aff-flag", key: "flag" }, "◦ " + t("aff.matched")) : null
			];
			return h("a", Object.assign({ key: item.id }, styleA), kids);
		}

		function AffiliateSection(props) {
			const t = props.t, items = props.items;
			const recoList = props.reco, disclosure = props.disclosure;
			const [hidden, setHidden] = react.useState(readHiddenPref);

			const toggle = react.useCallback(function (v) {
				setHidden(v);
				writeHiddenPref(v);
			}, []);

			if (hidden) {
				return h("section", { className: "mc_sec" },
					h("h3", { className: "mc_sec-title" }, "④ " + t("aff.title")),
					h("div", { className: "mc_panel" },
						h("div", { className: "mc_meta" }, t("aff.hiddenTip")),
						h("div", { style: { marginTop: "9px" } },
							h("button", { className: "mc_btn", onClick: function () { toggle(false); } }, t("aff.show"))
						)
					)
				);
			}

			if (!items || !items.length) {
				return h("section", { className: "mc_sec" },
					h("h3", { className: "mc_sec-title" }, "④ " + t("aff.title")),
					h("div", { className: "mc_panel" }, h("div", { className: "mc_empty" }, t("aff.empty")))
				);
			}

			const ordered = orderAffiliateForDisplay(items, recoList);

			return h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" },
					"④ " + t("aff.title"),
					h("span", { className: "mc_ad-tag", key: "ad" }, t("aff.adTag"))
				),
				h("p", { className: "mc_sec-hint" }, t("aff.hint")),
				h("div", { className: "mc_panel" },
					h("div", { className: "mc_aff-zone-note" }, t("aff.zoneNote")),
					h("div", { className: "mc_aff-grid" },
						ordered.map(function (it) {
							return h(AffiliateCard, {
								key: it.id, item: it, t: t,
								matched: affiliateMatchesRecommendation(it, recoList)
							});
						})
					),
					h("div", { className: "mc_aff-bar" },
						h("div", { className: "mc_aff-disc" },
							disclosure || t("aff.disclosure"),
							h("br"),
							t("aff.publisher"),
							"　·　",
							t("aff.source", { t: AFFILIATE_VERIFIED_AT })
						),
						h("button", {
							className: "mc_aff-link",
							onClick: function () { toggle(true); },
							title: t("aff.hide")
						}, t("aff.hide"))
					),
					/* 三条自证式声明：把「不影响排序」「不注入参数」写在界面上，
					   既是合规交待，也让用户可以据此质疑与核验。 */
					h("div", { className: "mc_aff-notices" },
						h("div", null, "· " + t("aff.independence")),
						h("div", null, "· " + t("aff.noInject"))
					)
				)
			);
		}

		/* ================================================================
		 *  七、主视图
		 * ================================================================ */

		function ModelClockView() {
			const ctxObj = react.useContext(LocaleContext);
			const t = ctxObj.t;

			const [now, setNow] = react.useState(function () { return beijingNow(); });
			const [tick, setTick] = react.useState(0);
			// 推广数据：默认用内置副本（保证离线可用），启动后尝试用 host 权威源覆盖。
			// host 未注册该路由（旧版本）或离线时静默沿用副本 —— 不报错、不阻断渲染。
			const [aff, setAff] = react.useState(function () { return AFFILIATE_FALLBACK; });

			react.useEffect(function () {
				const id = setInterval(function () {
					setNow(beijingNow());
					setTick(function (x) { return x + 1; });
				}, 30000);
				return function () { clearInterval(id); };
			}, []);

			react.useEffect(function () {
				let alive = true;
				if (typeof fetch !== "function") return function () { alive = false; };
				fetch(AFFILIATE_ENDPOINT, { headers: { accept: "application/json" } })
					.then(function (r) { return r && r.ok ? r.json() : null; })
					.then(function (j) {
						if (!alive || !j || !Array.isArray(j.items) || !j.items.length) return;
						setAff({
							items: j.items,
							disclosure: j.disclosure || AFFILIATE_FALLBACK.disclosure
						});
					})
					.catch(function () { /* 静默降级到内置副本 */ });
				return function () { alive = false; };
			}, []);

			const bj = now;
			const hour = bj.hour, dow = bj.dow;

			const reco = recommend(hour, dow);
			const advice = schedulingAdvice(hour, dow);
			const camps = campaigns(bj.dateStr);
			const offPeak = isDeepSeekOffPeak(hour, dow);
			const conf = confidenceStats();
			const bps = bandProviders();
			const nowPct = (hour + bj.minute / 60) / 24;

			/* ---- 此刻推荐 ---- */
			const bestSection = h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" }, "① " + t("best")),
				h("p", { className: "mc_sec-hint", dangerouslySetInnerHTML: { __html: t("best.hint") } }),
				h("div", { className: "mc_grid" },
					reco.slice(0, 4).map((r, i) => h(RecommendCard, { key: r.m.id, item: r, index: i, t: t }))
				)
			);

			/* ---- 热力带 ---- */
			const bandSection = h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" }, "② " + t("band")),
				h("p", { className: "mc_sec-hint", dangerouslySetInnerHTML: { __html: t("band.hint") } }),
				h("div", { className: "mc_panel" },
					h("div", { className: "mc_rows" },
						bps.map((p) => h(BandRow, {
							key: p.id, provider: p, cells: bandCells(p.id, dow),
							nowPct: nowPct, showNow: true, t: t
						}))
					),
					h("div", { className: "mc_axis" },
						h("div", null),
						h("div", { className: "mc_ticks" },
							Array.from({ length: 24 }, function (_, hh) {
								return h("span", { key: hh }, hh % 6 === 0 ? String(hh).padStart(2, "0") : "");
							})
						)
					),
					h("div", { className: "mc_legend" },
						h("div", { className: "mc_legend-item" },
							h("span", { className: "mc_sw", style: { background: "rgb(229,72,77)" } }), t("band.legend.std")),
						h("div", { className: "mc_legend-item" },
							h("span", { className: "mc_sw", style: { background: "rgb(232,163,61)" } }), t("band.legend.mid")),
						h("div", { className: "mc_legend-item" },
							h("span", { className: "mc_sw", style: { background: "rgb(48,164,108)" } }), t("band.legend.low")),
						h("div", { className: "mc_legend-item" },
							h("span", { className: "mc_sw", style: { background: "rgba(139,92,246,.85)" } }), t("band.legend.route"))
					)
				)
			);

			/* ---- 调度建议 ---- */
			const top = reco[0];
			let advCards;
			if (advice.length) {
				advCards = advice.slice(0, 2).map((s) => h(AdviceCard, { key: s.m.id, item: s, t: t, hour: hour, dow: dow }));
			} else {
				advCards = [h("div", { className: "mc_adv-card", key: "none" },
					h("div", { className: "mc_adv-head" }, h("span", null, t("adv.noneTitle"))),
					h("div", { className: "mc_adv-big" }, "—"),
					h("div", { className: "mc_adv-desc" }, t("adv.noneDesc"))
				)];
			}
			advCards.push(h("div", { className: "mc_adv-card", key: "pick" },
				h("div", { className: "mc_adv-head" },
					h("span", null, t("adv.pick")),
					h("span", null, t("adv.pickHint"))
				),
				h("div", { className: "mc_adv-big blue" }, top.m.name),
				h("div", { className: "mc_adv-desc" },
					"综合当前生效优惠后最低：",
					h("b", null, "¥" + top.eff.toFixed(2) + "/M"),
					"（" + top.m.prov + "）。",
					top.mult < 1 - 1e-9
						? "正在享受 " + discText(top.mult) + " 折" + (top.m.note ? "（" + top.m.note + "）" : "") + "。"
						: "无时段优惠，属其结构性低价。",
					h("br"),
					t("adv.next", { name: reco[1].m.name, p: reco[1].eff.toFixed(2) })
				)
			));

			const advSection = h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" }, "③ " + t("adv")),
				h("p", { className: "mc_sec-hint" }, t("adv.hint")),
				h("div", { className: "mc_adv" }, advCards)
			);

			/* ---- 注册专属福利（推广）----
			   位置刻意排在「此刻推荐」与「调度建议」之后：
			   用户先拿到客观的成本结论，再看到商业内容，顺序上不构成引导。 */
			const affSection = h(AffiliateSection, {
				t: t, items: aff.items, reco: reco, disclosure: aff.disclosure
			});

			/* ---- 限时活动 ---- */
			const liveCamps = camps.filter((c) => c.state !== "done");
			const campSection = h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" }, "⑤ " + t("camp")),
				h("p", { className: "mc_sec-hint", dangerouslySetInnerHTML: { __html: t("camp.hint") } }),
				h("div", { className: "mc_panel" },
					camps.length
						? h("div", { className: "mc_camps" }, camps.map((c) => h(CampaignRow, { key: c.d.id, item: c, t: t })))
						: h("div", { className: "mc_empty" }, t("camp.none"))
				)
			);

			/* ---- 溯源 ---- */
			const srcList = DISCOUNTS.map(function (d) {
				const staleDays = d.verifiedAt ? -daysFromToday(d.verifiedAt, bj.dateStr) : null;
				const isStale = !d.verifiedAt || (staleDays != null && staleDays > STALE_AFTER_DAYS);
				const confTxt = d.conf === "verified" && !isStale ? t("conf.verified") : (isStale && d.conf !== "reported" ? t("conf.stale") : t("conf.reported"));
				const color = d.conf === "verified" && !isStale ? "#1f8a57" : (isStale ? "#b06000" : "#8b929b");
				return h("div", { key: d.id, style: { padding: "7px 0", borderBottom: "1px solid var(--dsw-alias-border-l2,#e3e6ea)" } },
					h("div", { style: { display: "flex", gap: "8px", alignItems: "baseline", flexWrap: "wrap" } },
						h("span", { style: { fontSize: "11.5px", color: "var(--dsw-alias-label-primary,#1a1a1a)" } },
							providerName(d.providerId) + " · " + d.title),
						h("span", { style: { fontSize: "10.5px", color: color, whiteSpace: "nowrap" } }, confTxt),
						d.verifiedAt
							? h("span", { style: { fontSize: "10.5px", color: "var(--dsw-alias-label-tertiary,#8b929b)", whiteSpace: "nowrap" } },
								"核实于 " + d.verifiedAt)
							: null
					),
					d.note ? h("div", { style: { fontSize: "10.5px", color: "var(--dsw-alias-label-tertiary,#8b929b)", marginTop: "3px", lineHeight: "1.6" } }, d.note) : null,
					h("div", { className: "mc_src" }, link(d.src, d.src, "l"))
				);
			});

			const metaSection = h("section", { className: "mc_sec" },
				h("h3", { className: "mc_sec-title" }, "⑥ " + t("meta")),
				h("div", { className: "mc_panel" },
					h("div", { className: "mc_meta" },
						h("div", null, t("meta.total", { n: conf.total })),
						h("div", null, t("meta.updated", { t: DATA_VERIFIED_AT + "（版本 " + DATA_VERSION + "）" })),
						h("div", { className: "mc_meta-row" },
							h("span", { className: "mc_pill", style: { color: "#1f8a57" } }, t("meta.verified") + " " + conf.verified),
							h("span", { className: "mc_pill", style: { color: "#b06000" } }, t("meta.reported") + " " + conf.reported),
							h("span", { className: "mc_pill" }, t("meta.total", { n: conf.total }))
						),
						h("div", { style: { marginTop: "9px" }, dangerouslySetInnerHTML: { __html: t("meta.note") } })
					),
					h("details", { className: "mc_details" },
						h("summary", null, t("meta.sources")),
						h("div", { style: { marginTop: "8px" } }, srcList)
					)
				)
			);

			/* ---- 头部 ---- */
			const head = h("div", { className: "mc_head" },
				h("div", null,
					h("h2", { className: "mc_title" }, t("title")),
					h("div", { className: "mc_sub" }, t("sub"))
				),
				h("div", { className: "mc_clock" },
					h("div", { className: "mc_clock-time" }, bj.hhmm),
					h("div", { className: "mc_clock-date" }, bj.dateCn + "　" + t("band.sessionTz")),
					h("div", { className: "mc_zone" },
						h("span", { className: "mc_zone-dot" + (offPeak ? "" : " warn") }),
						h("span", null, offPeak ? t("zone.off") : t("zone.peak"))
					)
				)
			);

			return h(react.Fragment, null,
				h("style", { dangerouslySetInnerHTML: { __html: CSS } }),
				h("div", { className: "mc_root" },
					head, bestSection, bandSection, advSection, affSection, campSection, metaSection
				)
			);
		}

		/** 轻量 locale 通道：把 t 函数传给子组件，避免每个组件都依赖 ctx */
		const LocaleContext = react.createContext({ t: function (k) { return k; } });

		/* ================================================================
		 *  八、插件入口（Cordis 协议）
		 * ================================================================ */

		const inject = ["slots", "locale"];

		function apply(ctx) {
			// 注册词典
			ctx.effect(
				function () { return ctx.locale.register(NS, { zh: zh, en: en }); },
				"model-clock: locale dictionaries"
			);

			// 注入视图标签页
			ctx.slots.inject("conversation.view", function () {
				return ctx.slots.register(
					{
						name: "conversation.view",
						id: "model-clock",
						order: 12,
						locale: NS,
						label: function () { return ctx.locale.bind(NS)("view.tab"); },
						inject: function () { return {}; }
					},
					function ModelClockBound() {
						const t = ctx.locale.bind(NS);
						return h(LocaleContext.Provider, { value: { t: t } }, h(ModelClockView, null));
					}
				);
			});
		}

		/* 供外部/测试读取的公开面（不影响 Cordis 协议） */
		exports.__internals = {
			beijingNow: beijingNow,
			inWindow: inWindow,
			windowMult: windowMult,
			priceAt: priceAt,
			discText: discText,
			recommend: recommend,
			bestUpcoming: bestUpcoming,
			schedulingAdvice: schedulingAdvice,
			campaigns: campaigns,
			confidenceStats: confidenceStats,
			bandProviders: bandProviders,
			bandCells: bandCells,
			heatColor: heatColor,
			daysFromToday: daysFromToday,
			PROVIDERS: PROVIDERS,
			MODELS: MODELS,
			DISCOUNTS: DISCOUNTS,
			AFFILIATE_FALLBACK: AFFILIATE_FALLBACK,
			affiliateMatchesRecommendation: affiliateMatchesRecommendation,
			orderAffiliateForDisplay: orderAffiliateForDisplay,
			CSS: CSS
		};		exports.NS = NS;
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

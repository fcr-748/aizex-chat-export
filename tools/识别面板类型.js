// ============================================================
// AI 面板类型识别器 v1（只读，不改任何数据）
//
// 用法：在目标站点页面上按 F12 → Console → 粘贴本文件 → 回车
// 它会告诉你：这站属于哪套前端框架、能不能用我们的导出器、有没有原生导出
// 结果同时打印在控制台、复制到剪贴板、并下载一份 txt
// ============================================================
(function () {
  'use strict';
  var L = [];
  function line(s) { L.push(s); }

  var out = {
    url: location.href,
    host: location.host,
    title: document.title,
    type: '未知/自研',
    hasConvApi: null,
    foldBoxes: 0,
    nativeExport: [],
    supported: false,
    advice: ''
  };

  // ---------- 1. 前端框架指纹 ----------
  var html = document.documentElement.outerHTML.slice(0, 300000);
  var scripts = Array.prototype.map.call(document.scripts, function (s) { return s.src || ''; }).join(' ');
  var lsKeys = [];
  try { lsKeys = Object.keys(localStorage); } catch (e) {}
  var lsText = lsKeys.join(' ');

  var marks = {
    'ChatGPT 前端复刻系': 0,
    'NextChat 系': 0,
    'LobeChat 系': 0,
    'Open WebUI 系': 0,
    'ChatGPT 官网': 0
  };
  if (/oai\/apps|oai-did|nextc-batch-trigger|snorlax-history/i.test(lsText + ' ' + html)) marks['ChatGPT 前端复刻系'] += 2;
  if (/chatgpt\.com|oaistatic/i.test(html + ' ' + scripts)) marks['ChatGPT 官网'] += 1;
  if (/nextchat|next-web|ChatGPT Next Web/i.test(html + ' ' + scripts + ' ' + lsText)) marks['NextChat 系'] += 2;
  if (/lobe-?chat|lobehub/i.test(html + ' ' + scripts + ' ' + lsText)) marks['LobeChat 系'] += 2;
  if (/open-?webui|Open WebUI/i.test(html + ' ' + scripts + ' ' + lsText)) marks['Open WebUI 系'] += 2;

  // 折叠批次控件（只有 ChatGPT 复刻系有）
  try { out.foldBoxes = document.querySelectorAll('.nextc-batch-trigger-wrap, .nextc-batch-trigger-title').length; } catch (e) {}
  if (out.foldBoxes) marks['ChatGPT 前端复刻系'] += 3;

  // 侧边栏会话链接
  var convLinks = 0;
  try { convLinks = document.querySelectorAll('a[href*="/c/"]').length; } catch (e) {}
  if (convLinks) marks['ChatGPT 前端复刻系'] += 1;

  // ---------- 2. 原生导出入口 ----------
  try {
    var nodes = document.querySelectorAll('button, a, [role="menuitem"], [role="button"]');
    for (var i = 0; i < nodes.length && out.nativeExport.length < 8; i++) {
      var t = (nodes[i].innerText || nodes[i].getAttribute('aria-label') || '').trim();
      if (/导出|下载全部|export|备份|download all/i.test(t) && t.length < 24) out.nativeExport.push(t);
    }
  } catch (e) {}

  // ---------- 3. 后端接口探测（只发 1 个请求）----------
  function pickConvId() {
    var m = location.pathname.match(/\/c\/([0-9a-f-]{8,})/i);
    if (m) return m[1];
    var a = document.querySelector('a[href*="/c/"]');
    if (a) {
      var m2 = (a.getAttribute('href') || '').match(/\/c\/([0-9a-f-]{8,})/i);
      if (m2) return m2[1];
    }
    return null;
  }

  function finish() {
    var best = '', bestScore = 0;
    Object.keys(marks).forEach(function (k) { if (marks[k] > bestScore) { bestScore = marks[k]; best = k; } });
    out.type = bestScore >= 2 ? best : '未知/自研或无法判定';

    if (out.type === 'ChatGPT 前端复刻系') {
      out.supported = true;
      out.advice = '可以用我们的导出器（aizex_export_v317.js 或那个 Chrome 扩展）：走后端接口 + 展开折叠批次，还有完整性自检。';
    } else if (out.type === 'NextChat 系' || out.type === 'LobeChat 系') {
      out.advice = '属于浏览器本地存储型（IndexedDB），记录在你这台电脑上。导出器暂不支持，需要我加适配器（0.5-1 天/类）。';
    } else if (out.type === 'Open WebUI 系') {
      out.advice = 'Open WebUI 自建站有官方接口 /api/v1/chats，带 token 可全量拉取，加适配器约 0.5 天。';
    } else if (out.type === 'ChatGPT 官网') {
      out.advice = '这是 ChatGPT 官方站：官方自带 Settings → Data controls → 导出数据（conversations.json），不需要我们的工具。';
    } else {
      out.advice = '判定不了。把这份报告发我，看一眼接口就能判断要多久适配。';
    }

    line('== AI 面板类型识别 ==');
    line('页面: ' + out.url);
    line('标题: ' + out.title);
    line('判定: ' + out.type + '（置信分 ' + bestScore + '）');
    line('各框架得分: ' + JSON.stringify(marks));
    line('折叠批次控件数量: ' + out.foldBoxes + '（>0 说明是 ChatGPT 复刻系）');
    line('侧边栏会话链接数: ' + convLinks);
    line('后端接口探测: ' + (out.hasConvApi === null ? '未探测' : (out.hasConvApi ? '可用 /backend-api/conversation 有响应' : '不可用（只能走页面抓取）')));
    line('页面上的"导出/备份"入口: ' + (out.nativeExport.length ? out.nativeExport.join(' / ') : '没找到，说明这站没有原生批量导出'));
    line('');
    line('结论: ' + (out.supported ? '可以直接用我们的导出器' : '暂不支持，需要加适配器'));
    line('建议: ' + out.advice);

    var text = L.join('\n');
    console.log('%c' + text, 'font-family:monospace;color:#10a37f');
    try { navigator.clipboard.writeText(text); } catch (e) {}
    try {
      var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = '面板类型识别_' + location.host + '.txt';
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 4000);
    } catch (e) {}
  }

  var id = pickConvId();
  if (!id) { finish(); return; }
  fetch('/backend-api/conversation/' + encodeURIComponent(id), { credentials: 'include' })
    .then(function (r) { out.hasConvApi = r.ok; return r.text(); })
    .then(function (t) { if (t && t.indexOf('"mapping"') >= 0) out.hasConvApi = true; })
    .catch(function () { out.hasConvApi = false; })
    .then(finish);
})();

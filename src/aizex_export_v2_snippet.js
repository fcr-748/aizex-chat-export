// ============================================================
// Aizex 聊天记录一键导出 v2
//
// 用法（和 v1 一样）：
//   1. 用 Chrome / Edge 登录面板，进入聊天页面
//   2. 按 F12 -> Console（控制台）
//   3. 粘贴本文件全部内容，回车
//   4. 按右上角面板提示：选文件夹 -> 开始导出
//
// v2 与 v1 的区别：
//   - 先观察页面怎么加载会话，如果能找到后端接口就直接调接口
//     全量导出（快、完整）；找不到就退回页面抓取（更稳）。
//   - 修复了 v1 的问题：空回复、(空) 内容、中途停住、漏会话。
//   - 只在你自己的浏览器里运行，不上传任何数据。
// ============================================================
(function () {
  'use strict';

  if (window.__aizexV2) {
    alert('v2 已经在运行了。如果没看到面板，请刷新页面后再粘贴一次。');
    return;
  }
  window.__aizexV2 = true;

  var CONV_SEL = 'a[href*="/c/"]';
  var CONTAINER_SEL = '[data-testid="conversation"]';
  var MSG_SEL = '[data-message-author-role]';
  var STREAM_SEL = '.result-streaming, .typing-indicator';

  var state = {
    running: false,
    cancelled: false,
    dirHandle: null,
    convs: [],
    requests: [],
    ws: [],
    template: null,
    replaying: false,
    results: [],
    failed: [],
    mode: null
  };

  // ================= 1. 拦截所有网络请求 =================
  function installHooks() {
    if (window.fetch && !window.__aizexV2Fetch) {
      var origFetch = window.fetch;
      window.fetch = function (input, init) {
        var url = '';
        try { url = typeof input === 'string' ? input : (input && input.url) || ''; } catch (e) {}
        var method = (init && init.method) || (input && input.method) || 'GET';
        var headers = {};
        try {
          var h = (init && init.headers) ? new Headers(init.headers) : new Headers();
          h.forEach(function (v, k) { headers[k] = v; });
        } catch (e) {}
        var body = null;
        if (init && init.body != null) {
          try { body = typeof init.body === 'string' ? init.body : JSON.stringify(init.body); }
          catch (e) { body = String(init.body); }
        }
        var rec = {
          kind: 'fetch', method: method, url: url, headers: headers, body: body,
          credentials: init && init.credentials, t: Date.now()
        };
        if (!state.replaying) state.requests.push(rec);

        return origFetch.apply(this, arguments).then(function (res) {
          try {
            rec.respStatus = res.status;
            rec.respType = res.headers.get('content-type') || '';
            var keepText = state.replaying || !/conversation|history|message|chat|session|service-api/i.test(url);
            if (!keepText) {
              res.clone().text().then(function (text) {
                rec.respText = text.length > 800000 ? text.slice(0, 800000) : text;
              }).catch(function () {});
            }
          } catch (e) {}
          return res;
        });
      };
      window.__aizexV2Fetch = true;
    }

    if (!window.__aizexV2Xhr) {
      var origOpen = XMLHttpRequest.prototype.open;
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__aizexM = method;
        this.__aizexU = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        if (!state.replaying) {
          var rec = {
            kind: 'xhr', method: xhr.__aizexM || 'GET', url: xhr.__aizexU || '',
            headers: {}, body: body || null, t: Date.now()
          };
          state.requests.push(rec);
          this.addEventListener('load', function () {
            try {
              rec.respStatus = xhr.status;
              rec.respType = xhr.getResponseHeader('content-type') || '';
              if (/conversation|history|message|chat|session|service-api/i.test(rec.url)) {
                rec.respText = String(xhr.responseText || '').slice(0, 800000);
              }
            } catch (e) {}
          });
        }
        return origSend.apply(this, arguments);
      };
      window.__aizexV2Xhr = true;
    }

    if (window.WebSocket && !window.__aizexV2Ws) {
      var OrigWS = window.WebSocket;
      function WrappedWS(url, protocols) {
        var ws = protocols ? new OrigWS(url, protocols) : new OrigWS(url);
        var rec = { kind: 'ws', url: url, t: Date.now(), frames: [] };
        if (!state.replaying) state.ws.push(rec);
        ws.addEventListener('message', function (ev) {
          if (rec.frames.length < 300) {
            var s = '';
            try {
              s = typeof ev.data === 'string' ? ev.data : (ev.data instanceof Blob ? '[blob]' : '[binary]');
            } catch (e) { s = '[?]'; }
            rec.frames.push(s.length > 30000 ? s.slice(0, 30000) : s);
          }
        });
        return ws;
      }
      WrappedWS.prototype = OrigWS.prototype;
      Object.setPrototypeOf(WrappedWS, OrigWS);
      window.WebSocket = WrappedWS;
      window.__aizexV2Ws = true;
    }
  }

  function sleep(ms) {
    return new Promise(function (r) { setTimeout(r, ms); });
  }

  // ================= 2. 收集侧边栏全部会话 =================
  function findScroller(root) {
    var el = root;
    for (var depth = 0; el && depth < 8; depth++) {
      if (el.scrollHeight > el.clientHeight + 50) return el;
      el = el.parentElement;
    }
    return root;
  }

  async function collectConversations() {
    var seen = {};
    var list = [];
    var nav = document.querySelector('nav') || document.body;
    var scroller = findScroller(nav);
    var lastLen = -1;
    var stableRounds = 0;

    while (!state.cancelled && stableRounds < 6) {
      var links = document.querySelectorAll(CONV_SEL);
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (!href || href.indexOf('/c/') < 0) continue;
        var full = href.indexOf('http') === 0 ? href : location.origin + href;
        if (seen[full]) continue;
        seen[full] = true;
        var m = href.match(/\/c\/([^/?#]+)/);
        list.push({
          id: m ? m[1] : full,
          href: full,
          title: (links[i].innerText || '').trim().split('\n')[0] || '(无标题)'
        });
      }
      var btns = nav.querySelectorAll('button');
      for (var b = 0; b < btns.length; b++) {
        var t = (btns[b].innerText || '').trim();
        if (t.indexOf('更多') >= 0 || t.indexOf('加载') >= 0) {
          try { btns[b].click(); } catch (e) {}
        }
      }
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      await sleep(600);
      if (list.length === lastLen) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastLen = list.length;
      }
    }
    return list;
  }  // ================= 3. 观察：点开一条会话，找后端接口 =================
  async function findLink(conv) {
    var all = document.querySelectorAll(CONV_SEL);
    for (var i = 0; i < all.length; i++) {
      var h = all[i].getAttribute('href') || '';
      if (h.indexOf('/c/' + conv.id) >= 0) return all[i];
    }
    var nav = document.querySelector('nav') || document.body;
    var scroller = findScroller(nav);
    for (var t = 0; t < 10; t++) {
      if (scroller) {
        scroller.scrollTop = 0;
        await sleep(200);
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(200);
      }
      var again = document.querySelectorAll(CONV_SEL);
      for (var j = 0; j < again.length; j++) {
        var hh = again[j].getAttribute('href') || '';
        if (hh.indexOf('/c/' + conv.id) >= 0) return again[j];
      }
    }
    return null;
  }

  async function observe(conv) {
    var before = state.requests.length;
    var link = await findLink(conv);
    if (!link) return { ok: false, reason: 'link-not-found' };
    link.click();
    var t0 = Date.now();
    for (var i = 0; i < 40; i++) {
      await sleep(500);
      if (state.cancelled) break;
      var newReqs = state.requests.slice(before);
      var detail = newReqs.find(function (r) {
        var u = r.url;
        return (u.indexOf(conv.id) >= 0 || u.indexOf(encodeURIComponent(conv.id)) >= 0) &&
          (r.method === 'GET' || r.method === 'POST' || r.method === 'PUT');
      });
      if (detail) return { ok: true, detail: detail };
      if (Date.now() - t0 > 20000) break;
    }
    return { ok: false, reason: 'no-detail-request' };
  }

  function buildTemplate(conv, detail) {
    var enc = encodeURIComponent(conv.id);
    var url = detail.url.split(conv.id).join('{ID}').split(enc).join('{ID}');
    var body = null;
    if (detail.body) {
      body = detail.body.split(conv.id).join('{ID}').split(enc).join('{ID}');
    }
    return {
      url: url,
      method: detail.method,
      headers: detail.headers || {},
      body: body,
      credentials: detail.credentials,
      sampleUrl: detail.url
    };
  }

  // ================= 4. mapping 转消息（ChatGPT 结构） =================
  function mappingToMessages(mapping) {
    if (!mapping || typeof mapping !== 'object') return null;
    var nodes = Object.values(mapping);
    var root = nodes.find(function (n) { return n && n.message === null && !n.parent; }) ||
               nodes.find(function (n) { return n && n.message === null; }) ||
               nodes.find(function (n) { return n && !n.parent; }) ||
               nodes[0];
    if (!root) return [];
    var msgs = [];
    var cur = root;
    var guard = 0;
    while (cur && guard < 10000) {
      guard++;
      if (cur.message) {
        var m = cur.message;
        var role = m.author && m.author.role;
        var parts = (m.content && m.content.parts) || [];
        var text = parts.map(function (p) {
          return typeof p === 'string' ? p : (p && typeof p === 'object' ? JSON.stringify(p) : String(p));
        }).join('');
        if (role === 'user' || role === 'assistant') {
          msgs.push({ role: role, text: text });
        }
      }
      if (!cur.children || !cur.children.length) break;
      cur = mapping[cur.children[0]];
    }
    return msgs;
  }

  function anyToMessages(body) {
    if (!body) return null;
    if (body.mapping) {
      var msgs = mappingToMessages(body.mapping);
      return { msgs: msgs, full: body };
    }
    if (Array.isArray(body) && body.length && body[0].role !== undefined) {
      return { msgs: body.map(function (m) { return { role: m.role, text: Array.isArray(m.content) ? m.content.join('') : (m.content || '') }; }), full: body };
    }
    return null;
  }


  function rawToMessages(text) {
    if (!text) return null;
    var collected = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i].trim();
      if (!line) continue;
      if (line.indexOf('data:') === 0) line = line.slice(5).trim();
      if (!line) continue;
      var obj = null;
      try { obj = JSON.parse(line); } catch (e) { continue; }
      if (obj.message && obj.message.author && obj.message.content) {
        var role = obj.message.author.role;
        var parts = obj.message.content.parts || [];
        var t2 = parts.map(function (pp) { return typeof pp === "string" ? pp : JSON.stringify(pp); }).join("");
        if ((role === 'user' || role === 'assistant') && t2) collected.push({ role: role, text: t2 });
      } else if (obj.role && obj.content !== undefined) {
        var cc = Array.isArray(obj.content) ? obj.content.join("") : String(obj.content || "");
        if (obj.role === 'user' || obj.role === 'assistant') collected.push({ role: obj.role, text: cc });
      }
    }
    if (collected.length) return { msgs: collected, full: null };
    return null;
  }

  async function writeMdRaw(conv, rawText, index) {
    if (!state.dirHandle) return;
    try {
      var head = '# ' + (conv.title || '(no title)') + '\n\n> source: ' + location.host + '\n> conversation id: ' + conv.id + '\n> index: ' + index + '\n\n> NOTE: could not parse structured messages; raw response below\n\n```\n' + rawText + '\n```';
      await writeFile(state.dirHandle, safeFileName(conv.title, conv.id), head);
    } catch (e) {
      state.failed.push({ id: conv.id, title: conv.title, reason: 'write failed' });
    }
  }

  // ================= 5. 快速导出：直接调接口 =================
  async function apiExport() {
    var tpl = state.template;
    var convs = state.convs;
    for (var i = 0; i < convs.length; i++) {
      if (state.cancelled) break;
      var conv = convs[i];
      ui.progress(i + 1, convs.length, '接口模式 ' + (conv.title || ''));
      try {
        var url = tpl.url.replace(/\{ID\}/g, encodeURIComponent(conv.id));
        var init = { method: tpl.method, headers: Object.assign({}, tpl.headers) };
        if (tpl.credentials) init.credentials = tpl.credentials;
        if (tpl.body) init.body = tpl.body.replace(/\{ID\}/g, encodeURIComponent(conv.id));
        var res = await fetch(url, init);
        var text = await res.text();
        var parsed = null;
        try { parsed = JSON.parse(text); } catch (e) {}
        var got = anyToMessages(parsed) || rawToMessages(text);
        var messages = got ? got.msgs : null;
        if (messages && messages.length) {
          state.results.push({ id: conv.id, title: conv.title, messages: messages, raw: text });
          await writeMd(conv, messages, i + 1);
        } else if (text && text.length > 50) {
          state.results.push({ id: conv.id, title: conv.title, messages: null, raw: text });
          await writeMdRaw(conv, text, i + 1);
        } else {
          state.failed.push({ id: conv.id, title: conv.title, reason: 'empty response' });
        }
      } catch (e) {
        state.failed.push({ id: conv.id, title: conv.title, reason: String(e) });
      }
      await sleep(120);
    }
  }  // ================= 6. 页面抓取（备用，更稳） =================
  function messageEls() {
    var container = document.querySelector(CONTAINER_SEL);
    return container
      ? container.querySelectorAll(MSG_SEL)
      : document.querySelectorAll(MSG_SEL);
  }

  function tailText(els) {
    if (!els.length) return '';
    return (els[els.length - 1].innerText || els[els.length - 1].textContent || '').trim();
  }

  async function waitConversationReady(convId, timeoutMs) {
    var started = Date.now();
    var lastCount = -1;
    var lastTail = null;
    var stable = 0;
    while (Date.now() - started < timeoutMs) {
      if (state.cancelled) return false;
      var path = location.pathname || '';
      if (path.indexOf('/c/' + convId) >= 0) {
        var els = messageEls();
        var container = document.querySelector(CONTAINER_SEL);
        var streaming = container ? container.querySelectorAll(STREAM_SEL) : [];
        var tail = tailText(els);
        if (els.length > 0 && streaming.length === 0 && tail !== '') {
          if (els.length === lastCount && tail === lastTail) {
            stable++;
            if (stable >= 20) return true;
          } else {
            stable = 0;
            lastCount = els.length;
            lastTail = tail;
          }
        } else {
          lastCount = els.length;
          lastTail = tail;
        }
      }
      await sleep(300);
    }
    return (location.pathname || '').indexOf('/c/' + convId) >= 0;
  }

  function scrapeConversation() {
    var els = messageEls();
    var msgs = [];
    for (var i = 0; i < els.length; i++) {
      msgs.push({
        role: els[i].getAttribute('data-message-author-role'),
        text: (els[i].innerText || els[i].textContent || '').trim()
      });
    }
    return msgs;
  }

  async function domExport() {
    var convs = state.convs;
    for (var idx = 0; idx < convs.length; idx++) {
      if (state.cancelled) break;
      var conv = convs[idx];
      ui.progress(idx + 1, convs.length, '页面抓取 ' + (conv.title || ''));
      var ok = false;
      try {
        var link = await findLink(conv);
        if (link) {
          link.click();
          ok = await waitConversationReady(conv.id, 60000);
        }
      } catch (e) {
        ok = false;
      }
      if (ok) {
        var msgs = scrapeConversation();
        if (msgs.length === 0) {
          state.failed.push({ id: conv.id, title: conv.title, reason: '没有抓到内容' });
          continue;
        }
        await sleep(1500);
        var msgs2 = scrapeConversation();
        if (msgs2.length >= msgs.length && (tailTextFrom(msgs2) !== tailTextFrom(msgs) || msgs2.length > msgs.length)) {
          msgs = msgs2;
        }
        state.results.push({ id: conv.id, title: conv.title, messages: msgs });
        await writeMd(conv, msgs, idx + 1);
      } else {
        state.failed.push({ id: conv.id, title: conv.title, reason: '加载超时' });
      }
    }
  }

  function tailTextFrom(msgs) {
    return msgs.length ? (msgs[msgs.length - 1].text || '') : '';
  }

  // ================= 7. 保存 =================
  async function writeFile(dirHandle, name, content) {
    var fh = await dirHandle.getFileHandle(name, { create: true });
    var w = await fh.createWritable();
    await w.write(content);
    await w.close();
  }

  function downloadBlob(name, content) {
    var blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 3000);
  }

  function safeFileName(title, id) {
    var t = String(title || '')
      .replace(/[\\/:*?"<>|\r\n\t]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/[. ]+$/g, '')
      .slice(0, 60);
    if (!t) t = 'conversation';
    return t + '_' + String(id).slice(0, 8) + '.md';
  }

  function toMarkdown(conv, msgs, index) {
    var lines = [];
    lines.push('# ' + (conv.title || '(无标题)'));
    lines.push('');
    lines.push('> 来源面板: ' + location.host);
    lines.push('> 会话 ID: ' + conv.id);
    lines.push('> 序号: ' + index);
    lines.push('');
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      lines.push(m.role === 'user' ? '## 用户' : '## AI');
      lines.push('');
      lines.push(m.text || '(空)');
      lines.push('');
    }
    return lines.join('\n');
  }

  async function writeMd(conv, msgs, index) {
    if (!state.dirHandle) return;
    try {
      await writeFile(state.dirHandle, safeFileName(conv.title, conv.id), toMarkdown(conv, msgs, index));
    } catch (e) {
      state.failed.push({ id: conv.id, title: conv.title, reason: '写文件失败' });
    }
  }

  // ================= 8. 主流程 =================
  async function run() {
    if (state.running) return;
    state.running = true;
    state.cancelled = false;
    state.results = [];
    state.failed = [];
    ui.setBusy(true);

    var found = false;
    for (var i = 0; i < 60; i++) {
      if (document.querySelector(CONV_SEL)) { found = true; break; }
      await sleep(500);
    }
    if (!found) {
      ui.status('没有找到会话列表。\n请确认：1) 已登录 2) 当前是聊天页面（左侧能看到会话）3) 刷新页面后再试。');
      ui.setBusy(false);
      state.running = false;
      return;
    }

    ui.status('正在收集会话列表（自动向下滚动加载更多）...');
    state.convs = await collectConversations();
    if (state.convs.length === 0) {
      ui.status('没有找到任何会话。');
      ui.setBusy(false);
      state.running = false;
      return;
    }
    ui.status('共找到 ' + state.convs.length + ' 个会话。\n正在观察页面如何加载会话内容...');

    var obs = await observe(state.convs[0]);
    if (obs.ok) {
      state.template = buildTemplate(state.convs[0], obs.detail);
      state.mode = 'api';
      ui.status('已找到数据接口：' + state.template.sampleUrl + '\n开始全量快速导出...');
    } else {
      state.mode = 'dom';
      ui.status('页面内容走的是流式通道，改为页面抓取模式。\n开始导出（速度较慢，请保持标签页在前台）...');
    }

    if (state.mode === 'api') {
      state.replaying = true;
      await apiExport();
      state.replaying = false;
    } else {
      await domExport();
    }

    if (state.failed.length && !state.cancelled) {
      ui.status('有 ' + state.failed.length + ' 条失败，正在重试...');
      var retry = state.failed.slice();
      state.failed = [];
      for (var r = 0; r < retry.length; r++) {
        if (state.cancelled) break;
        var f = retry[r];
        var conv2 = null;
        for (var c = 0; c < state.convs.length; c++) {
          if (state.convs[c].id === f.id) { conv2 = state.convs[c]; break; }
        }
        if (!conv2) continue;
        ui.progress(state.results.length + 1, state.convs.length, '重试 ' + (conv2.title || ''));
        var ok2 = false;
        if (state.mode === 'api' && state.template) {
          try {
            var url2 = state.template.url.replace(/\{ID\}/g, encodeURIComponent(conv2.id));
            var init2 = { method: state.template.method, headers: Object.assign({}, state.template.headers) };
            if (state.template.credentials) init2.credentials = state.template.credentials;
            if (state.template.body) init2.body = state.template.body.replace(/\{ID\}/g, encodeURIComponent(conv2.id));
            var res2 = await fetch(url2, init2);
            var text2 = await res2.text();
            var got2 = anyToMessages(JSON.parse(text2)) || rawToMessages(text2);
            if (got2 && got2.msgs.length) {
              state.results.push({ id: conv2.id, title: conv2.title, messages: got2.msgs, raw: text2 });
              await writeMd(conv2, got2.msgs, state.results.length);
              continue;
            }
          } catch (e) {}
        } else {
          try {
            var link2 = await findLink(conv2);
            if (link2) {
              link2.click();
              var okWait = await waitConversationReady(conv2.id, 45000);
              if (okWait) {
                var msgs2 = scrapeConversation();
                if (msgs2.length) {
                  state.results.push({ id: conv2.id, title: conv2.title, messages: msgs2 });
                  await writeMd(conv2, msgs2, state.results.length);
                  continue;
                }
              }
            }
          } catch (e) {}
        }
        state.failed.push(f);
      }
    }

    var payload = {
      tool: 'aizex 聊天记录一键导出 v2',
      exportedAt: new Date().toISOString(),
      source: location.host,
      mode: state.mode,
      totalConversations: state.convs.length,
      exported: state.results.length,
      failed: state.failed.map(function (f) { return { id: f.id, title: f.title, reason: f.reason }; }),
      conversations: state.results
    };
    var json = JSON.stringify(payload, null, 1);

    var indexLines = [
      '# 聊天记录索引',
      '',
      '导出时间: ' + new Date().toLocaleString(),
      '来源面板: ' + location.host,
      '导出模式: ' + (state.mode === 'api' ? '接口直连' : '页面抓取'),
      '共 ' + state.results.length + ' 条' + (state.failed.length ? '，失败 ' + state.failed.length + ' 条' : ''),
      ''
    ];
    for (var k = 0; k < state.results.length; k++) {
      var rr = state.results[k];
      indexLines.push((k + 1) + '. [' + (rr.title || '(无标题)') + '](' + safeFileName(rr.title, rr.id) + ')  `' + rr.id + '`');
    }
    var indexMd = indexLines.join('\n');

    var summary = '完成！共导出 ' + state.results.length + '/' + state.convs.length + ' 条（模式：' + (state.mode === 'api' ? '接口' : '页面抓取') + '）。';
    if (state.failed.length) {
      summary += '\n失败 ' + state.failed.length + ' 条：\n' + state.failed.map(function (f) { return '  - ' + (f.title || f.id) + '（' + f.reason + '）'; }).join('\n');
    }

    if (state.dirHandle) {
      await writeFile(state.dirHandle, 'aizex_export.json', json);
      await writeFile(state.dirHandle, '00_索引.md', indexMd);
      summary += '\n文件已保存到所选文件夹。';
    } else {
      downloadBlob('aizex_export.json', json);
      downloadBlob('00_索引.md', indexMd);
      summary += '\n文件已开始下载（JSON 和索引）。';
    }
    ui.status(summary);
    ui.setBusy(false);
    state.running = false;
  }

  // ================= 9. 界面 =================
  var ui = (function () {
    var panel, statusEl, barWrap, bar, pickBtn, startBtn, cancelBtn;

    function build() {
      var style = 'position:fixed;top:16px;right:16px;width:340px;z-index:999999;' +
        'background:#ffffff;color:#111111;border:2px solid #10a37f;border-radius:10px;' +
        'padding:14px 14px 12px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:left;';
      panel = document.createElement('div');
      panel.style.cssText = style;
      panel.innerHTML =
        '<div style="font-weight:700;margin-bottom:8px;font-size:15px">Aizex 聊天记录导出 v2</div>' +
        '<div id="__aizex2_status" style="margin-bottom:8px;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;font-size:12px"></div>' +
        '<div id="__aizex2_barwrap" style="display:none;height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-bottom:10px"><div id="__aizex2_bar" style="height:100%;width:0%;background:#10a37f"></div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button id="__aizex2_pick" style="padding:6px 10px;border:1px solid #10a37f;background:#10a37f;color:#fff;border-radius:6px;cursor:pointer;font-size:13px">选择保存文件夹</button>' +
        '<button id="__aizex2_start" disabled style="padding:6px 10px;border:1px solid #10a37f;background:#fff;color:#10a37f;border-radius:6px;cursor:pointer;font-size:13px">开始导出</button>' +
        '<button id="__aizex2_cancel" disabled style="padding:6px 10px;border:1px solid #ccc;background:#fff;color:#666;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
        '</div>';
      document.body.appendChild(panel);

      statusEl = document.getElementById('__aizex2_status');
      barWrap = document.getElementById('__aizex2_barwrap');
      bar = document.getElementById('__aizex2_bar');
      pickBtn = document.getElementById('__aizex2_pick');
      startBtn = document.getElementById('__aizex2_start');
      cancelBtn = document.getElementById('__aizex2_cancel');

      pickBtn.addEventListener('click', pickFolder);
      startBtn.addEventListener('click', run);
      cancelBtn.addEventListener('click', function () {
        state.cancelled = true;
        cancelBtn.disabled = true;
        status('正在取消（处理完当前这条就停止，已抓到的会照常保存）...');
      });

      status('欢迎使用 v2！\n先点"选择保存文件夹"，再点"开始导出"。\n脚本会自动识别最快最全的方式导出全部。');

      if (!window.showDirectoryPicker) {
        pickBtn.style.display = 'none';
        startBtn.disabled = false;
      }
    }

    function pickFolder() {
      window.showDirectoryPicker({ mode: 'readwrite' })
        .then(function (h) {
          state.dirHandle = h;
          startBtn.disabled = false;
          status('已选择保存文件夹，可以点"开始导出"了。');
        })
        .catch(function (e) {
          startBtn.disabled = false;
          status('没有选择文件夹（' + (e && e.message ? e.message : e) + '）。\n也可以直接点"开始导出"，文件会下载到"下载"文件夹。');
        });
    }

    function status(text) {
      statusEl.textContent = text;
    }

    function progress(done, total, title) {
      barWrap.style.display = 'block';
      bar.style.width = Math.round((done / total) * 100) + '%';
      statusEl.textContent = '进度 ' + done + '/' + total + '\n' + (title || '');
    }

    function setBusy(busy) {
      startBtn.disabled = busy;
      pickBtn.disabled = busy;
      cancelBtn.disabled = !busy;
      if (!busy) barWrap.style.display = 'none';
    }

    return { build: build, status: status, progress: progress, setBusy: setBusy };
  })();

  installHooks();
  ui.build();
})();
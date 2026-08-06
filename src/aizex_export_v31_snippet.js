// ============================================================
// Aizex 聊天记录一键导出 v3.1（增量续跑 + 接口校验修复）
//
// 用法：
//   1. 用 Chrome / Edge 登录面板，进入聊天页面
//   2. 按 F12 -> Console（控制台）
//   3. 粘贴本文件全部内容，回车
//   4. 按右上角面板提示：选"上次的导出文件夹" -> 开始导出
//
// v3.1 相比 v3 的修复：
//   - 接口识别加固：不会再误把统计接口当成会话接口；
//     找到候选接口后先验证一次，不是聊天数据就退回页面抓取。
//   - 自动识别无效文件：上次被污染成 1KB 垃圾的文件（内容是
//     统计接口返回值）会被判定为"未导出"，自动重新导出。
//   - JSON 从文件重建：每次结束从所有有效的 .md 重建
//     aizex_export.json，不会因为重启或接口污染而丢失。
//   - 只在你自己的浏览器里运行，不上传任何数据。
// ============================================================
(function () {
  'use strict';

  if (window.__aizexV31) {
    alert('v3.1 已经在运行了。如果没看到面板，请刷新页面后再粘贴一次。');
    return;
  }
  window.__aizexV31 = true;

  var CONV_SEL = 'a[href*="/c/"]';
  var CONTAINER_SEL = '[data-testid="conversation"]';
  var MSG_SEL = '[data-message-author-role]';
  var STREAM_SEL = '.result-streaming, .typing-indicator';

  var state = {
    running: false,
    cancelled: false,
    aborted: '',
    dirHandle: null,
    convs: [],
    requests: [],
    ws: [],
    template: null,
    replaying: false,
    results: [],
    failed: [],
    mode: null,
    doneSet: {},
    skipExisting: true,
    forceKw: [],
    oldJson: null,
    skippedCount: 0
  };

  // ================= 1. 拦截所有网络请求 =================
  function installHooks() {
    if (window.fetch && !window.__aizexV31Fetch) {
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
      window.__aizexV31Fetch = true;
    }

    if (!window.__aizexV31Xhr) {
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
      window.__aizexV31Xhr = true;
    }

    if (window.WebSocket && !window.__aizexV31Ws) {
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
      window.__aizexV31Ws = true;
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

    while (!state.cancelled && stableRounds < 8) {
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
      if (scroller) {
        scroller.scrollTop = 0;
        await sleep(300);
        scroller.scrollTop = scroller.scrollHeight;
      }
      await sleep(600);
      if (list.length === lastLen) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastLen = list.length;
      }
    }
    return list;
  }  // ================= 3. 观察：点开一条会话，找后端接口（加固版） =================
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

  // 排除统计/系统类接口：跨域、umami、埋点、公告、用户信息等
  function isAnalyticsUrl(u) {
    if (!u) return true;
    if (/umami|analytics|api\/send|mirror-notice|\/info\b|\/menu\b/i.test(u)) return true;
    try {
      var origin = new URL(u, location.href).origin;
      if (origin !== location.origin) return true;
    } catch (e) { return true; }
    return false;
  }

  async function observe(conv) {
    var before = state.requests.length;
    var link = await findLink(conv);
    if (!link) return { ok: false, reason: 'link-not-found' };
    link.click();
    var t0 = Date.now();
    for (var i = 0; i < 30; i++) {
      await sleep(500);
      if (state.cancelled) break;
      var newReqs = state.requests.slice(before);
      var encId = encodeURIComponent(conv.id);
      var candidates = newReqs.filter(function (r) {
        var u = r.url;
        var b = r.body || '';
        if (isAnalyticsUrl(u)) return false;
        if (!(u.indexOf(conv.id) >= 0 || u.indexOf(encId) >= 0 || b.indexOf(conv.id) >= 0 || b.indexOf(encId) >= 0)) return false;
        return r.method === 'GET' || r.method === 'POST' || r.method === 'PUT';
      });
      // 优先选响应内容像聊天数据的
      for (var c = 0; c < candidates.length; c++) {
        var cand = candidates[c];
        var rt = cand.respText || '';
        if (rt.indexOf('"mapping"') >= 0 || rt.indexOf('"role"') >= 0 || rt.indexOf('"message"') >= 0 || rt.indexOf('conversation_id') >= 0) {
          return { ok: true, detail: cand };
        }
      }
      if (candidates.length) return { ok: true, detail: candidates[0] };
      if (Date.now() - t0 > 15000) break;
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

  // 重放一次验证：返回的必须是聊天数据，否则退回页面抓取
  async function verifyTemplate(conv) {
    var tpl = state.template;
    if (!tpl) return false;
    try {
      var url = tpl.url.replace(/\{ID\}/g, encodeURIComponent(conv.id));
      var init = { method: tpl.method, headers: Object.assign({}, tpl.headers) };
      if (tpl.credentials) init.credentials = tpl.credentials;
      if (tpl.body) init.body = tpl.body.replace(/\{ID\}/g, encodeURIComponent(conv.id));
      var res = await fetch(url, init);
      var text = await res.text();
      if (!text || text.length < 50) return false;
      var parsed = null;
      try { parsed = JSON.parse(text); } catch (e) {}
      var got = anyToMessages(parsed) || rawToMessages(text);
      if (got && got.msgs && got.msgs.length >= 2) return true;
      if (text.indexOf('"mapping"') >= 0 || text.indexOf('conversation_id') >= 0) return true;
      return false;
    } catch (e) {
      return false;
    }
  }

  // ================= 4. 解析各类返回格式 =================
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
        var t2 = parts.map(function (pp) { return typeof pp === 'string' ? pp : JSON.stringify(pp); }).join('');
        if ((role === 'user' || role === 'assistant') && t2) collected.push({ role: role, text: t2 });
      } else if (obj.role && obj.content !== undefined) {
        var cc = Array.isArray(obj.content) ? obj.content.join('') : String(obj.content || '');
        if (obj.role === 'user' || obj.role === 'assistant') collected.push({ role: obj.role, text: cc });
      }
    }
    if (collected.length) return { msgs: collected, full: null };
    return null;
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
          await writeMd(conv, messages);
        } else if (text && text.length > 50) {
          state.results.push({ id: conv.id, title: conv.title, messages: null, raw: text });
          await writeMdRaw(conv, text);
        } else {
          state.failed.push({ id: conv.id, title: conv.title, reason: 'empty response' });
        }
      } catch (e) {
        state.failed.push({ id: conv.id, title: conv.title, reason: String(e) });
      }
      await sleep(120);
    }
  }  // ================= 6. 页面抓取（带"加载更早消息"修复） =================
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

  async function waitStable(convId, timeoutMs) {
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
            if (stable >= 12) return true;
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

  function loadEarlierCandidates(container) {
    var found = [];
    if (!container) return found;
    var els = container.querySelectorAll('button, a');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || '').trim();
      if (/更早|加载更|查看更早|earlier|load more|load earlier/i.test(t)) {
        found.push(els[i]);
      }
    }
    return found;
  }

  async function loadFullConversation(convId, timeoutMs) {
    if (!(await waitStable(convId, timeoutMs))) return false;
    var container = document.querySelector(CONTAINER_SEL);
    if (!container) return true;
    var MAX_ROUNDS = 10;
    for (var r = 0; r < MAX_ROUNDS; r++) {
      if (state.cancelled) break;
      var before = messageEls().length;
      container.scrollTop = 0;
      await sleep(1000);
      var btns = loadEarlierCandidates(container);
      for (var b = 0; b < btns.length; b++) {
        try { btns[b].click(); } catch (e) {}
      }
      await sleep(1500);
      var after = messageEls().length;
      if (after <= before) break;
      await waitStable(convId, 15000);
    }
    return true;
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

  function sessionKicked() {
    var t = (document.body && document.body.innerText) || '';
    return /登录失效|请重新登录|其他地方登录|号池重进/.test(t);
  }

  async function domExport() {
    var convs = state.convs;
    for (var idx = 0; idx < convs.length; idx++) {
      if (state.cancelled) break;
      if (state.aborted) break;
      var conv = convs[idx];
      ui.progress(idx + 1, convs.length, '页面抓取 ' + (conv.title || ''));
      var ok = false;
      try {
        var link = await findLink(conv);
        if (link) {
          link.click();
          ok = await loadFullConversation(conv.id, 60000);
        }
      } catch (e) {
        ok = false;
      }
      if (ok) {
        var msgs = scrapeConversation();
        if (msgs.length === 0) {
          if (sessionKicked()) {
            state.aborted = '检测到登录失效，请重新登录后再运行（已导出的会自动跳过）。';
            break;
          }
          state.failed.push({ id: conv.id, title: conv.title, reason: '没有抓到内容' });
          continue;
        }
        await sleep(1200);
        var msgs2 = scrapeConversation();
        if (msgs2.length >= msgs.length && (tailTextFrom(msgs2) !== tailTextFrom(msgs) || msgs2.length > msgs.length)) {
          msgs = msgs2;
        }
        state.results.push({ id: conv.id, title: conv.title, messages: msgs });
        await writeMd(conv, msgs);
      } else {
        if (sessionKicked()) {
          state.aborted = '检测到登录失效，请重新登录后再运行（已导出的会自动跳过）。';
          break;
        }
        state.failed.push({ id: conv.id, title: conv.title, reason: '加载超时' });
      }
    }
  }

  function tailTextFrom(msgs) {
    return msgs.length ? (msgs[msgs.length - 1].text || '') : '';
  }

  // ================= 7. 保存与合并 =================
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

  async function writeMd(conv, msgs) {
    if (!state.dirHandle) return;
    try {
      await writeFile(state.dirHandle, safeFileName(conv.title, conv.id), toMarkdown(conv, msgs, state.results.length));
    } catch (e) {
      state.failed.push({ id: conv.id, title: conv.title, reason: '写文件失败' });
    }
  }

  async function writeMdRaw(conv, rawText) {
    if (!state.dirHandle) return;
    try {
      var head = '# ' + (conv.title || '(no title)') + '\n\n> source: ' + location.host + '\n> conversation id: ' + conv.id + '\n> index: ' + state.results.length + '\n\n> NOTE: could not parse structured messages; raw response below\n\n```\n' + rawText + '\n```';
      await writeFile(state.dirHandle, safeFileName(conv.title, conv.id), head);
    } catch (e) {
      state.failed.push({ id: conv.id, title: conv.title, reason: 'write failed' });
    }
  }

  // 判断文件是不是被污染的无效文件（内容是统计接口返回值等）
  function isBadMd(text) {
    return text.indexOf('> source:') >= 0 ||
      text.indexOf('could not parse structured messages') >= 0 ||
      text.indexOf('"cache":"eyJ') >= 0;
  }

  // 扫描文件夹里已有的 md：有效的算"已导出"，无效的标记为坏文件
  async function scanExisting() {
    var done = {};
    var bad = {};
    var count = 0;
    var badCount = 0;
    if (!state.dirHandle) return { done: done, bad: bad, count: count, badCount: badCount };
    try {
      for await (var entry of state.dirHandle.values()) {
        if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && entry.name !== '00_索引.md') {
          var m = entry.name.match(/_([0-9a-f]{8})\.md$/i);
          if (!m) continue;
          count++;
          var id8 = m[1].toLowerCase();
          var head = '';
          try {
            var f = await entry.getFile();
            head = (await f.text()).slice(0, 300);
          } catch (e) {}
          if (isBadMd(head)) { bad[id8] = true; badCount++; }
          else { done[id8] = true; }
        }
      }
    } catch (e) {}
    return { done: done, bad: bad, count: count, badCount: badCount };
  }

  async function readExistingJson() {
    if (!state.dirHandle) return null;
    try {
      var fh = await state.dirHandle.getFileHandle('aizex_export.json');
      var f = await fh.getFile();
      return JSON.parse(await f.text());
    } catch (e) { return null; }
  }

  function buildPending(convs) {
    var pending = [];
    var skipped = 0;
    for (var i = 0; i < convs.length; i++) {
      var c = convs[i];
      var id8 = c.id.slice(0, 8).toLowerCase();
      var already = !!state.doneSet[id8];
      var force = state.forceKw.length > 0 && state.forceKw.some(function (kw) {
        return (c.title || '').indexOf(kw) >= 0;
      });
      if (state.skipExisting && already && !force) {
        skipped++;
        continue;
      }
      pending.push(c);
    }
    state.skippedCount = skipped;
    return pending;
  }

  // 从单个 md 文件解析出会话结构
  function parseMdFile(text, name) {
    var lines = text.split('\n');
    var title = '';
    var id = '';
    var msgs = [];
    var current = null;
    for (var li = 0; li < lines.length; li++) {
      var line = lines[li];
      if (line.indexOf('# ') === 0) { title = line.slice(2).trim(); continue; }
      var idm = line.match(/^>\s*(?:会话 ID|conversation id):\s*(\S+)/);
      if (idm) { id = idm[1]; continue; }
      if (line.indexOf('## 用户') === 0 || line.indexOf('## AI') === 0) {
        current = { role: line.indexOf('用户') >= 0 ? 'user' : 'assistant', text: '' };
        msgs.push(current);
        continue;
      }
      if (current) current.text += (current.text ? '\n' : '') + line;
    }
    if (!id) {
      var m = name.match(/_([0-9a-f]{8})\.md$/);
      id = m ? m[1] : name;
    }
    for (var mi = 0; mi < msgs.length; mi++) msgs[mi].text = msgs[mi].text.trim();
    return { id: id, title: title || name.replace(/_\w+\.md$/, ''), messages: msgs };
  }

  // 从所有有效 md 重建会话列表（让 JSON 与文件保持一致）
  async function rebuildConvsFromFiles() {
    var convs = [];
    if (!state.dirHandle) return convs;
    try {
      for await (var entry of state.dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        var name = entry.name;
        if (!name.toLowerCase().endsWith('.md') || name === '00_索引.md') continue;
        var f = await entry.getFile();
        var text = await f.text();
        if (isBadMd(text.slice(0, 300))) continue;
        var parsed = parseMdFile(text, name);
        if (parsed.id) convs.push(parsed);
      }
    } catch (e) {}
    return convs;
  }

  // 根据文件夹里所有 md 重建索引（自然合并历次结果）
  async function buildIndexFromFiles() {
    var names = [];
    if (state.dirHandle) {
      try {
        for await (var entry of state.dirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && entry.name !== '00_索引.md') {
            names.push(entry.name);
          }
        }
      } catch (e) {}
    } else {
      for (var i = 0; i < state.results.length; i++) {
        names.push(safeFileName(state.results[i].title, state.results[i].id));
      }
    }
    names.sort(function (a, b) { return a.localeCompare(b, 'zh'); });
    var lines = [
      '# 聊天记录索引',
      '',
      '导出时间: ' + new Date().toLocaleString(),
      '来源面板: ' + location.host,
      '共 ' + names.length + ' 条',
      ''
    ];
    for (var k = 0; k < names.length; k++) {
      var name = names[k];
      var m = name.match(/^(.+)_([0-9a-f]{8})\.md$/i);
      var title = m ? m[1] : name;
      lines.push((k + 1) + '. [' + title + '](' + name + ')');
    }
    return lines.join('\n');
  }

  // 以"从文件重建的会话"为基础，合并本次结果（按 id 去重）
  function mergeJson(baseConvs, totalCount, mode) {
    var byId = {};
    (baseConvs || []).forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    state.results.forEach(function (c) { if (c && c.id) byId[c.id] = c; });
    var convs = Object.values(byId);
    var failed = [];
    if (state.oldJson && Array.isArray(state.oldJson.failed)) {
      failed = state.oldJson.failed.slice();
    }
    state.failed.forEach(function (f) {
      if (!failed.some(function (x) { return x.id === f.id; })) failed.push(f);
    });
    return {
      tool: 'aizex 聊天记录一键导出 v3.1',
      exportedAt: new Date().toISOString(),
      source: location.host,
      mode: mode,
      totalConversations: totalCount,
      exported: convs.length,
      failed: failed,
      conversations: convs
    };
  }  // ================= 8. 主流程 =================
  async function run() {
    if (state.running) return;
    state.running = true;
    state.cancelled = false;
    state.aborted = '';
    state.results = [];
    state.failed = [];
    ui.setBusy(true);

    // 读取界面选项
    state.skipExisting = ui.skipCheckbox.checked;
    var kwText = ui.forceInput.value || '';
    state.forceKw = kwText.split(/[,，;；]/).map(function (s) { return s.trim(); }).filter(Boolean);

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
    var allConvs = await collectConversations();
    if (allConvs.length === 0) {
      ui.status('没有找到任何会话。');
      ui.setBusy(false);
      state.running = false;
      return;
    }
    ui.status('共找到 ' + allConvs.length + ' 个会话。\n正在读取文件夹里已有的导出...');

    // 增量：扫描已有文件 + 读取旧 JSON（旧 JSON 仅用于失败列表合并）
    var scan = await scanExisting();
    state.doneSet = scan.done;
    state.oldJson = await readExistingJson();
    state.convs = buildPending(allConvs);
    var pendingTotal = state.convs.length;

    var msg = '面板共 ' + allConvs.length + ' 个会话；文件夹里已有 ' + scan.count + ' 个文件';
    if (scan.badCount > 0) {
      msg += '（其中 ' + scan.badCount + ' 个是无效文件，会自动重新导出）';
    }
    if (state.skipExisting) {
      msg += '；本次需导出 ' + pendingTotal + ' 个（已跳过 ' + state.skippedCount + ' 个）';
    } else {
      msg += '；勾选了"不跳过"，本次将全部重新导出';
    }
    ui.status(msg + '\n正在观察页面如何加载会话内容...');

    if (pendingTotal === 0) {
      state.mode = state.mode || 'dom';
      var baseConvs0 = await rebuildConvsFromFiles();
      var payload0 = mergeJson(baseConvs0, allConvs.length, state.mode);
      var json0 = JSON.stringify(payload0, null, 1);
      if (state.dirHandle) {
        await writeFile(state.dirHandle, 'aizex_export.json', json0);
        await writeFile(state.dirHandle, '00_索引.md', await buildIndexFromFiles());
      }
      ui.status('全部会话都已导出过（累计 ' + payload0.exported + ' / ' + allConvs.length + ' 条），索引和 JSON 已刷新合并。\n如果想强制重新导出某些会话，在"强制重导关键词"里填标题关键词再运行。');
      ui.setBusy(false);
      state.running = false;
      return;
    }

    // 观察第一条，尝试找接口（找到后会先验证）
    var obs = await observe(state.convs[0]);
    if (obs.ok) {
      state.template = buildTemplate(state.convs[0], obs.detail);
      var verified = await verifyTemplate(state.convs[0]);
      if (verified) {
        state.mode = 'api';
        ui.status('已找到并验证数据接口：' + state.template.sampleUrl + '\n开始全量快速导出...');
      } else {
        state.mode = 'dom';
        ui.status('找到的接口验证失败（可能是统计类接口），已改用页面抓取模式。\n开始导出（速度较慢，请保持标签页在前台）...');
      }
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

    // 重试失败的
    if (state.failed.length && !state.cancelled && !state.aborted) {
      ui.status('有 ' + state.failed.length + ' 条失败，正在重试...');
      var retry = state.failed.slice();
      state.failed = [];
      for (var r = 0; r < retry.length; r++) {
        if (state.cancelled || state.aborted) break;
        var f = retry[r];
        var conv2 = null;
        for (var c = 0; c < allConvs.length; c++) {
          if (allConvs[c].id === f.id) { conv2 = allConvs[c]; break; }
        }
        if (!conv2) continue;
        ui.progress(state.results.length + 1, pendingTotal, '重试 ' + (conv2.title || ''));
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
              await writeMd(conv2, got2.msgs);
              continue;
            }
          } catch (e) {}
        } else {
          try {
            var link2 = await findLink(conv2);
            if (link2) {
              link2.click();
              var okWait = await loadFullConversation(conv2.id, 45000);
              if (okWait) {
                var msgs2 = scrapeConversation();
                if (msgs2.length) {
                  state.results.push({ id: conv2.id, title: conv2.title, messages: msgs2 });
                  await writeMd(conv2, msgs2);
                  continue;
                }
              }
            }
          } catch (e) {}
        }
        state.failed.push(f);
      }
    }

    // 保存：索引从文件重建；JSON 从所有有效文件重建后再合并本次结果
    var indexMd = await buildIndexFromFiles();
    var baseConvs = await rebuildConvsFromFiles();
    var payload = mergeJson(baseConvs, allConvs.length, state.mode);
    var json = JSON.stringify(payload, null, 1);

    var summary = '完成！本次导出 ' + state.results.length + ' 条';
    if (state.skippedCount) summary += '，跳过已有 ' + state.skippedCount + ' 条';
    if (scan.badCount > 0) summary += '，已重新导出无效文件 ' + scan.badCount + ' 个';
    summary += '。累计 ' + payload.exported + ' / ' + allConvs.length + ' 条（模式：' + (state.mode === 'api' ? '接口' : '页面抓取') + '）。';
    if (state.failed.length) {
      summary += '\n失败 ' + state.failed.length + ' 条：\n' + state.failed.map(function (f) { return '  - ' + (f.title || f.id) + '（' + f.reason + '）'; }).join('\n');
    }
    if (state.aborted) {
      summary += '\n注意：' + state.aborted;
    }

    if (state.dirHandle) {
      await writeFile(state.dirHandle, 'aizex_export.json', json);
      await writeFile(state.dirHandle, '00_索引.md', indexMd);
      summary += '\n索引和 JSON 已合并保存到文件夹。';
    } else {
      downloadBlob('aizex_export.json', json);
      downloadBlob('00_索引.md', indexMd);
      summary += '\n未选择文件夹，索引和 JSON 已开始下载。';
    }
    ui.status(summary);
    ui.setBusy(false);
    state.running = false;
  }

  // ================= 9. 界面 =================
  var ui = (function () {
    var panel, statusEl, barWrap, bar, pickBtn, startBtn, cancelBtn;

    function build() {
      var style = 'position:fixed;top:16px;right:16px;width:350px;z-index:999999;' +
        'background:#ffffff;color:#111111;border:2px solid #10a37f;border-radius:10px;' +
        'padding:14px 14px 12px;font:13px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:left;';
      panel = document.createElement('div');
      panel.style.cssText = style;
      panel.innerHTML =
        '<div style="font-weight:700;margin-bottom:8px;font-size:15px">Aizex 聊天记录导出 v3.1</div>' +
        '<div id="__aizex31_status" style="margin-bottom:8px;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;font-size:12px"></div>' +
        '<div id="__aizex31_barwrap" style="display:none;height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-bottom:10px"><div id="__aizex31_bar" style="height:100%;width:0%;background:#10a37f"></div></div>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:4px"><input type="checkbox" id="__aizex31_skip" checked> 跳过已导出的会话（增量续跑）</label>' +
        '<input id="__aizex31_force" placeholder="强制重导的标题关键词，逗号分隔（可留空）" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:4px 6px;font-size:12px;border:1px solid #ccc;border-radius:4px">' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button id="__aizex31_pick" style="padding:6px 10px;border:1px solid #10a37f;background:#10a37f;color:#fff;border-radius:6px;cursor:pointer;font-size:13px">选择保存文件夹</button>' +
        '<button id="__aizex31_start" disabled style="padding:6px 10px;border:1px solid #10a37f;background:#fff;color:#10a37f;border-radius:6px;cursor:pointer;font-size:13px">开始导出</button>' +
        '<button id="__aizex31_cancel" disabled style="padding:6px 10px;border:1px solid #ccc;background:#fff;color:#666;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
        '</div>';
      document.body.appendChild(panel);

      statusEl = document.getElementById('__aizex31_status');
      barWrap = document.getElementById('__aizex31_barwrap');
      bar = document.getElementById('__aizex31_bar');
      pickBtn = document.getElementById('__aizex31_pick');
      startBtn = document.getElementById('__aizex31_start');
      cancelBtn = document.getElementById('__aizex31_cancel');
      ui.skipCheckbox = document.getElementById('__aizex31_skip');
      ui.forceInput = document.getElementById('__aizex31_force');

      pickBtn.addEventListener('click', pickFolder);
      startBtn.addEventListener('click', run);
      cancelBtn.addEventListener('click', function () {
        state.cancelled = true;
        cancelBtn.disabled = true;
        status('正在取消（处理完当前这条就停止，已导出的会照常保存，下次运行自动接续）...');
      });

      status('欢迎使用 v3.1（增量 + 接口校验修复）！\n请选择你上次用的同一个导出文件夹。\n脚本会扫描已有文件：有效的自动跳过，无效的（上次被污染成 1KB 的）自动重新导出。');

      if (!window.showDirectoryPicker) {
        pickBtn.style.display = 'none';
        startBtn.disabled = false;
        status('当前浏览器不支持选文件夹，无法增量续跑。建议用 Chrome 或 Edge。\n继续运行会导出本次找到的全部会话。');
      }
    }

    function pickFolder() {
      window.showDirectoryPicker({ mode: 'readwrite' })
        .then(function (h) {
          state.dirHandle = h;
          startBtn.disabled = false;
          status('已选择文件夹，可以点"开始导出"了。\n会先扫描已有文件，自动重导无效文件，再增量导出缺失的会话。');
        })
        .catch(function (e) {
          startBtn.disabled = false;
          status('没有选择文件夹（' + (e && e.message ? e.message : e) + '）。\n也可以直接点"开始导出"，文件会下载到"下载"文件夹（无法增量）。');
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

    return { build: build, status: status, progress: progress, setBusy: setBusy, skipCheckbox: null, forceInput: null };
  })();

  installHooks();
  ui.build();
})();
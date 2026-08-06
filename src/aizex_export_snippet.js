// ============================================================
// Aizex 面板聊天记录一键导出工具
//
// 用法：
//   1. 用 Chrome / Edge 登录你的面板，进入聊天页面（左侧能看到会话列表）
//   2. 按 F12 打开开发者工具，点 Console（控制台）
//   3. 把本文件全部内容粘贴进去，按回车
//   4. 按屏幕右上角绿色面板的提示操作：先"选择保存文件夹"，再"开始导出"
//
// 说明：本脚本只在你自己的浏览器里运行，不上传任何数据，
//       所有文件都保存在你自己电脑上。
// ============================================================
(function () {
  'use strict';

  if (window.__aizexExportUI) {
    alert('导出工具已经在运行了。如果没看到面板，请刷新页面后再粘贴一次。');
    return;
  }
  window.__aizexExportUI = true;

  var CONV_SEL = 'a[href*="/c/"]';
  var CONTAINER_SEL = '[data-testid="conversation"]';
  var MSG_SEL = '[data-message-author-role]';
  var STREAM_SEL = '.result-streaming, .typing-indicator';

  var state = {
    running: false,
    cancelled: false,
    dirHandle: null,
    conversations: [],
    results: [],
    failed: [],
    captured: []
  };

  // ================= 1. 记录网络请求（保留原始数据） =================
  function installNetHooks() {
    if (!window.__aizexFetchHooked) {
      var origFetch = window.fetch;
      if (origFetch) {
        window.fetch = function () {
          var args = arguments;
          var url = '';
          try {
            url = typeof args[0] === 'string' ? args[0] : (args[0] && args[0].url) || '';
          } catch (e) {}
          return origFetch.apply(this, args).then(function (res) {
            try {
              var ct = res.headers.get('content-type') || '';
              if (ct.indexOf('json') >= 0) {
                res.clone().json().then(function (body) {
                  state.captured.push({
                    kind: 'fetch',
                    url: url,
                    status: res.status,
                    convId: convIdFromPath(),
                    time: new Date().toISOString(),
                    body: body
                  });
                }).catch(function () {});
              }
            } catch (e) {}
            return res;
          });
        };
      }
      window.__aizexFetchHooked = true;
    }
    if (!window.__aizexXhrHooked) {
      var origOpen = XMLHttpRequest.prototype.open;
      var origSend = XMLHttpRequest.prototype.send;
      XMLHttpRequest.prototype.open = function (method, url) {
        this.__aizexM = method;
        this.__aizexU = url;
        return origOpen.apply(this, arguments);
      };
      XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        this.addEventListener('load', function () {
          try {
            var ct = xhr.getResponseHeader('content-type') || '';
            if (ct.indexOf('json') >= 0) {
              state.captured.push({
                kind: 'xhr',
                url: xhr.__aizexU,
                method: xhr.__aizexM,
                status: xhr.status,
                convId: convIdFromPath(),
                time: new Date().toISOString(),
                body: JSON.parse(xhr.responseText)
              });
            }
          } catch (e) {}
        });
        return origSend.apply(this, arguments);
      };
      window.__aizexXhrHooked = true;
    }
  }

  function convIdFromPath() {
    var m = (location.pathname || '').match(/\/c\/([^/?#]+)/);
    return m ? m[1] : '';
  }

  function sleep(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
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

  function clickLoadMore(nav) {
    var btns = nav.querySelectorAll('button');
    for (var b = 0; b < btns.length; b++) {
      var t = (btns[b].innerText || '').trim();
      if (t.indexOf('更多') >= 0 || t.indexOf('加载') >= 0) {
        try { btns[b].click(); } catch (e) {}
      }
    }
  }

  async function collectConversations() {
    var seen = {};
    var list = [];
    var nav = document.querySelector('nav') || document.body;
    var scroller = findScroller(nav);
    var lastLen = -1;
    var stableRounds = 0;

    while (!state.cancelled && stableRounds < 5) {
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
      clickLoadMore(nav);
      if (scroller) scroller.scrollTop = scroller.scrollHeight;
      await sleep(700);
      if (list.length === lastLen) {
        stableRounds++;
      } else {
        stableRounds = 0;
        lastLen = list.length;
      }
    }
    return list;
  }

  // ================= 3. 打开一条会话并等待加载完成 =================
  async function findLink(conv) {
    var all = document.querySelectorAll(CONV_SEL);
    for (var i = 0; i < all.length; i++) {
      var h = all[i].getAttribute('href') || '';
      if (h.indexOf('/c/' + conv.id) >= 0) return all[i];
    }
    var nav = document.querySelector('nav') || document.body;
    var scroller = findScroller(nav);
    for (var t = 0; t < 12; t++) {
      if (scroller) {
        scroller.scrollTop = 0;
        await sleep(250);
        scroller.scrollTop = scroller.scrollHeight;
        await sleep(250);
      }
      var again = document.querySelectorAll(CONV_SEL);
      for (var j = 0; j < again.length; j++) {
        var hh = again[j].getAttribute('href') || '';
        if (hh.indexOf('/c/' + conv.id) >= 0) return again[j];
      }
    }
    return null;
  }

  async function openConversation(conv) {
    var link = await findLink(conv);
    if (!link) return false;
    link.click();
    var ok = await waitConversationReady(conv.id, 45000);
    if (!ok) return false;
    await sleep(400);
    return true;
  }

  function messageEls() {
    var container = document.querySelector(CONTAINER_SEL);
    return container
      ? container.querySelectorAll(MSG_SEL)
      : document.querySelectorAll(MSG_SEL);
  }

  async function waitConversationReady(convId, timeoutMs) {
    var started = Date.now();
    var lastCount = -1;
    var stable = 0;
    while (Date.now() - started < timeoutMs) {
      if (state.cancelled) return false;
      var path = location.pathname || '';
      if (path.indexOf('/c/' + convId) >= 0) {
        var msgs = messageEls();
        var container = document.querySelector(CONTAINER_SEL);
        var streaming = container ? container.querySelectorAll(STREAM_SEL) : [];
        if (msgs.length > 0 && streaming.length === 0) {
          if (msgs.length === lastCount) {
            stable++;
            if (stable >= 10) return true;
          } else {
            stable = 0;
            lastCount = msgs.length;
          }
        } else {
          lastCount = msgs.length;
        }
      }
      await sleep(300);
    }
    return (location.pathname || '').indexOf('/c/' + convId) >= 0;
  }

  // ================= 4. 抓取消息 =================
  function scrapeConversation() {
    var els = messageEls();
    var msgs = [];
    for (var i = 0; i < els.length; i++) {
      msgs.push({
        role: els[i].getAttribute('data-message-author-role'),
        text: (els[i].innerText || '').trim()
      });
    }
    return msgs;
  }

  // ================= 5. 保存文件 =================
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
    setTimeout(function () {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 3000);
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

  // ================= 6. 主流程 =================
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

    ui.status('正在收集会话列表（会自动向下滚动加载更多）...');
    var conversations = await collectConversations();
    state.conversations = conversations;
    if (conversations.length === 0) {
      ui.status('没有找到任何会话。');
      ui.setBusy(false);
      state.running = false;
      return;
    }
    ui.status('共找到 ' + conversations.length + ' 个会话，开始逐个导出...');

    var mdSnippets = [];

    for (var idx = 0; idx < conversations.length; idx++) {
      if (state.cancelled) break;
      var conv = conversations[idx];
      ui.progress(idx + 1, conversations.length, conv.title);
      var ok = false;
      try {
        ok = await openConversation(conv);
      } catch (e) {
        ok = false;
      }
      if (ok) {
        var msgs = scrapeConversation();
        state.results.push({ id: conv.id, title: conv.title, messages: msgs });
        mdSnippets.push(toMarkdown(conv, msgs, idx + 1));
        if (state.dirHandle) {
          try {
            await writeFile(state.dirHandle, safeFileName(conv.title, conv.id), mdSnippets[mdSnippets.length - 1]);
          } catch (e) {
            state.failed.push({ id: conv.id, title: conv.title, reason: '写文件失败' });
          }
        }
      } else {
        state.failed.push({ id: conv.id, title: conv.title, reason: '加载失败' });
      }
    }

    // 重试失败的
    if (state.failed.length && !state.cancelled) {
      ui.status('有 ' + state.failed.length + ' 条没抓到，正在重试...');
      var retry = state.failed.slice();
      state.failed = [];
      for (var r = 0; r < retry.length; r++) {
        if (state.cancelled) break;
        var f = retry[r];
        var conv2 = null;
        for (var c = 0; c < conversations.length; c++) {
          if (conversations[c].id === f.id) { conv2 = conversations[c]; break; }
        }
        if (!conv2) continue;
        ui.progress(conversations.length + r + 1, conversations.length + retry.length, conv2.title);
        var ok2 = false;
        try {
          ok2 = await openConversation(conv2);
        } catch (e) {
          ok2 = false;
        }
        if (ok2) {
          var msgs2 = scrapeConversation();
          state.results.push({ id: conv2.id, title: conv2.title, messages: msgs2 });
          var md2 = toMarkdown(conv2, msgs2, conversations.length + r + 1);
          mdSnippets.push(md2);
          if (state.dirHandle) {
            try {
              await writeFile(state.dirHandle, safeFileName(conv2.title, conv2.id), md2);
            } catch (e) {
              state.failed.push({ id: conv2.id, title: conv2.title, reason: '写文件失败' });
            }
          }
        } else {
          state.failed.push(f);
        }
      }
    }

    // 汇总文件
    var payload = {
      tool: 'aizex 聊天记录一键导出',
      exportedAt: new Date().toISOString(),
      source: location.host,
      totalConversations: conversations.length,
      exported: state.results.length,
      failed: state.failed.map(function (f) { return { id: f.id, title: f.title, reason: f.reason }; }),
      conversations: state.results,
      networkLog: state.captured
    };
    var json = JSON.stringify(payload, null, 1);

    var indexLines = [
      '# 聊天记录索引',
      '',
      '导出时间: ' + new Date().toLocaleString(),
      '来源面板: ' + location.host,
      '共 ' + state.results.length + ' 条' + (state.failed.length ? '，失败 ' + state.failed.length + ' 条' : ''),
      ''
    ];
    for (var k = 0; k < conversations.length; k++) {
      indexLines.push((k + 1) + '. [' + (conversations[k].title || '(无标题)') + '](' + safeFileName(conversations[k].title, conversations[k].id) + ')  `' + conversations[k].id + '`');
    }
    var indexMd = indexLines.join('\n');

    var summary = '完成！共导出 ' + state.results.length + ' 条。';
    if (state.failed.length) {
      summary += '\n失败 ' + state.failed.length + ' 条：\n' + state.failed.map(function (f) { return '  - ' + (f.title || f.id) + '（' + f.reason + '）'; }).join('\n');
    }
    summary += '\n正在写入文件...';

    if (state.dirHandle) {
      await writeFile(state.dirHandle, 'aizex_export.json', json);
      await writeFile(state.dirHandle, '00_索引.md', indexMd);
      summary += '\n文件已保存到所选文件夹：aizex_export.json、00_索引.md、以及每个聊天一个 .md';
    } else {
      downloadBlob('aizex_export.json', json);
      downloadBlob('00_索引.md', indexMd);
      var merged = '# 全部聊天记录\n\n来源面板: ' + location.host + '\n\n' + mdSnippets.join('\n\n---\n\n');
      downloadBlob('全部聊天记录_合并.md', merged);
      summary += '\n文件已开始下载（JSON、索引、合并版 Markdown）。';
    }
    ui.status(summary);
    ui.setBusy(false);
    state.running = false;
  }

  // ================= 7. 界面 =================
  var ui = (function () {
    var panel, statusEl, barWrap, bar, pickBtn, startBtn, cancelBtn;

    function build() {
      var style = 'position:fixed;top:16px;right:16px;width:320px;z-index:999999;' +
        'background:#ffffff;color:#111111;border:2px solid #10a37f;border-radius:10px;' +
        'padding:14px 14px 12px;font:14px/1.6 -apple-system,"Segoe UI","Microsoft YaHei",sans-serif;' +
        'box-shadow:0 8px 30px rgba(0,0,0,0.25);text-align:left;';
      panel = document.createElement('div');
      panel.style.cssText = style;
      panel.innerHTML =
        '<div style="font-weight:700;margin-bottom:8px;font-size:15px">Aizex 聊天记录导出</div>' +
        '<div id="__aizex_status" style="margin-bottom:8px;white-space:pre-wrap;word-break:break-all;max-height:200px;overflow:auto;font-size:13px"></div>' +
        '<div id="__aizex_barwrap" style="display:none;height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-bottom:10px"><div id="__aizex_bar" style="height:100%;width:0%;background:#10a37f"></div></div>' +
        '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button id="__aizex_pick" style="padding:6px 10px;border:1px solid #10a37f;background:#10a37f;color:#fff;border-radius:6px;cursor:pointer;font-size:13px">选择保存文件夹</button>' +
        '<button id="__aizex_start" disabled style="padding:6px 10px;border:1px solid #10a37f;background:#fff;color:#10a37f;border-radius:6px;cursor:pointer;font-size:13px">开始导出</button>' +
        '<button id="__aizex_cancel" disabled style="padding:6px 10px;border:1px solid #ccc;background:#fff;color:#666;border-radius:6px;cursor:pointer;font-size:13px">取消</button>' +
        '</div>';
      document.body.appendChild(panel);

      statusEl = document.getElementById('__aizex_status');
      barWrap = document.getElementById('__aizex_barwrap');
      bar = document.getElementById('__aizex_bar');
      pickBtn = document.getElementById('__aizex_pick');
      startBtn = document.getElementById('__aizex_start');
      cancelBtn = document.getElementById('__aizex_cancel');

      pickBtn.addEventListener('click', pickFolder);
      startBtn.addEventListener('click', run);
      cancelBtn.addEventListener('click', function () {
        state.cancelled = true;
        cancelBtn.disabled = true;
        status('正在取消（等当前这条处理完就会停止）...');
      });

      status('欢迎使用！\n先点"选择保存文件夹"，再点"开始导出"。\n（如果浏览器不支持选文件夹，直接点"开始导出"即可，文件会下载到"下载"文件夹）');

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

  installNetHooks();
  ui.build();
})();

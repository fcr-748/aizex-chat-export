// ============================================================
// aizex 聊天记录一键导出 v3.33（公式保真 + 结构还原 + 接口按 current_node 取主链）
//
// 用法：
//   1. 用 Chrome / Edge 登录面板，进入聊天页面
//   2. 按 F12 -> Console（控制台）
//   3. 粘贴本文件全部内容，回车
//   4. 若本机在跑桥接服务（127.0.0.1:8787），脚本会自动连上，
//      直接写入上次那个导出文件夹，无需再选文件夹；
//      桥接不可用时退回原方式：选"上次的导出文件夹" -> 开始导出
//
// v3.33（2026-10-09）：
//   - 图片/附件不再一律堆到文末，改成**就地标在它出现的那条消息里**：
//     面板里的图片信息本来就在用户的提问位置上，现在按位置换成
//     ![](images/xxx.png) + `> 附件: 名字`，一眼能看到"这张图是配哪个问题的"。
//   - 占位符带上身份：［图片:file-abc］、［文件:报告.pdf:file-abc］（拿不到文件名就是 ［文件:报告.pdf］）。
//     接口的结构化附件、页面的 JSON blob 两条来源都会产出这种记号。
//   - 文末附录只在"正文里没定位到"时出现（比如从页面顺手捞到的签名 URL），
//     标题也写清楚"正文里没定位到的 N 个"。
//   - 文件头多一行 `> 附件: N 个（已就地标在对应消息里）`。
//   - 格式标记 md-v6 → md-v7（附件要重排，需要重导一次）。
//
// v3.32（2026-10-09）：
//   - 更新时间台账做实：以前只有"本次导出的会话"才进 _同步台账.json，而且只在跑完时才写，
//     跑一半停掉等于没记。现在开跑后先把面板上**每一条**的更新时间记成快照，
//     之后每 5 条再写一次盘，中断也不丢。
//   - 台账的语义说清楚：记的是"磁盘上这份内容对应的面板更新时间"。已经记过时间、
//     但这轮没抓到、而面板时间又变了的，台账**不动** —— 那是"有更新还没抓"，留给下次。
//   - 诊断里新增一节「面板上有更新的会话（本次重抓）」，列出标题 / 新时间 / 台账里的旧时间；
//     收尾提示也会写"其中面板上有更新的 N 条已重抓"。
//   - 索引里的更新时间：文件自己带的优先，没有的取台账快照，所以不用等全部重抓完就能看到。
//
// v3.31（2026-10-09）：
//   - 修一个会"吞括号"的错：KaTeX 把放大括号（\left( \bigl| 这类）放在 .delimsizing 里，
//     而它被当成排版辅助元素跳过了 → 还原出来的公式丢了括号。现在把它当可见内容处理，
//     并按 KaTeX 的"拼片"字符（⎛⎜⎝ 这些）拼回真实括号。
//   - 加一道保险：还原结果的括号必须覆盖页面上的括号，否则判定结构认错了，
//     退回普通文字，不让错误公式混进文件。
//   - 样本按"结构指纹"去重保存（以前只留前 8 个，往往全是同一种结构），
//     并在诊断里列出"还认不出的结构"，方便按真实结构继续补还原规则。
//
// v3.30（2026-10-09）：
//   - 接口按会话自己的 current_node 取主链。以前取"create_time 最大的那条往上回溯"，
//     遇到重新生成/编辑过的会话会挑到别的分支 → 接口少了消息，只能靠页面版补，
//     而页面版拿不到公式原文，公式就成了排版结果。
//   - 页面版公式改成"按 KaTeX 的 HTML 结构反推 LaTeX"：分数在 HTML 里是两行绝对定位，
//     DOM 顺序是先分母后分子，直接拼文字会得到 MΔM 这种怪东西；现在按行的 top 值排序，
//     拼回 \frac{分子}{分母}，\text{…} 也还原。结构认不出来时（根号、单边上下标）
//     老实当普通文字写，不硬塞 $…$。
//   - 格式标记 md-v5 → md-v6（附录内容会变，需要重导一次）。
//
// v3.29（2026-10-09）：
//   - 修"文末附录塞重复内容"：两份来源合并时用的是"前 50 个字符"指纹，
//     而第 30~40 字常常正好撞上公式（接口是 \[…\]、页面是排版结果），
//     指纹一比就判定成"新消息"，于是同一段内容在正文里出现一次、文末又抄一遍。
//     现在指纹改成"只留汉字/字母/数字的前 20 字"，公式和标点的差异不再影响判断。
//   - 附录里的公式不再假装成公式：页面版拿不到公式原文（面板 KaTeX 没有 mathml 层），
//     以前会把排版结果包成 $$…$$，预览出来是一堆乱码公式；现在这种只能当普通文字写。
//   - 附录标题写清来源（来自接口版还是页面版），并记进诊断。
//   - 格式标记 md-v4 → md-v5（文末附录会变，需要重导一次）。
//
// v3.28（2026-10-09）：
//   - 修 v3.27 的漏网：图片 JSON 的清理只加在 DOM 抓取那条路上，接口来的正文没走，
//     于是导出文件里出现 ［图片］ 后面跟着半截 `,"size_bytes":327298,"width":1005}`。
//     现在接口、页面、流式三条来源的正文统一过一遍清理（整块 JSON + 拆散后的残渣都清）。
//   - 诊断里补一行"数学节点没取到原始 TeX 的原因"：面板的 KaTeX 是纯 HTML 渲染、
//     没有 mathml 层时，公式原文只在接口文本里，DOM 那份只能退化成可见层文字。
//
// v3.27（2026-10-09）：
//   - 公式不再被拼成三份。面板把数学公式渲染成"TeX 源 + 可见层 + 无障碍层"，
//     以前的兜底路径（innerText）把三层一起抓了，导出文件里同一个公式出现两三遍。
//     现在识别 .katex / mjx-container / <math> 节点，优先取里面的 annotation 原始 TeX，
//     统一写成 $…$（行内）和 $$…$$（独立行），其余渲染层跳过。
//   - 纯文本消息不再"空格变换行"。以前没有代码块/表格/列表的消息走 innerText，
//     而 innerText 反映的是"排版后的文字"，浏览器自动折的行也会变成换行；
//     现在改成按 DOM 结构换行（块级元素才换行，<br> 才换行），折行不再冒充换行。
//   - 过滤面板塞在 DOM 里的图片 JSON（asset_pointer 那一大坨），只留 ［图片］ 占位 +
//     照旧把图片指针捞出来。
//   - 新增更新时间：从接口 /backend-api/conversations 读每条会话的 update_time，
//     写进 `_同步台账.json`、每条 md 的文件头、00_索引.md 和 manifest.json；
//     下次运行时"面板上有更新"的会话会自动重抓，没更新的仍然跳过。
//   - 格式升级：文件头标记从 md-v2 升到 md-v3，旧格式的 md 会自动重导一次（只这一次）。
//
// v3.7（2026-09-25 诊断后重写）：
//   - 折叠展开改用面板真实控件：span.nextc-batch-trigger-action（全部展开/继续阅读）、
//     span.nextc-batch-trigger-title（点击展示…）、button.A_HxFq_toggleControl（长消息展开）。
//     外层 div.nextc-batch-trigger-wrap 点了没用——之前就是点在它身上，所以只展开一点点。
//   - 每轮点一个，连续两次没变化才拉黑（避免渲染慢被误判）；折叠块一层层出现就一路点到没有。
//   - 完整性自检：读面板自己标的"共 N 轮"，只要还残留折叠块就再开一轮展开，
//     跑完把"预期条数 / 实际条数 / 是否完整"写进诊断文件。
//   - 双源合并：后端接口 + 页面展开，取更全的一份，另一份独有的消息附在文件末尾。
//   - 保护已有内容：新抓的比已有文件少时，保留已有文件不覆盖（今天就是这么把文件写小的）。
//   - 断点续跑：`_已完成清单.txt` 记录已用新机制抓过的会话，中途停了再跑不会重头来。
//
// v3.6（2026-09-25 诊断后）：
//   - 面板就是 ChatGPT 前端，优先走 /backend-api：
//       /backend-api/conversations?offset=&limit=100&order=updated  列全部会话
//       /backend-api/conversation/<id>                              完整会话（含折叠轮次）
//     接口可用时：每条会话一次请求，完整且极快；接口不通时自动退回下面这套 DOM 抓取。
//   - DOM 兜底修好了真正的折叠控件：面板用的是
//       span.nextc-batch-trigger-action（全部展开/继续阅读）
//       span.nextc-batch-trigger-title（点击展示…）
//       button.A_HxFq_toggleControl（长消息里的"展开"）
//     外层 div.nextc-batch-trigger-wrap 点了没用，以前就是点在它身上（所以只展开一点点）。
//   - 变化判定改成"内容指纹"（条数+文本长度），展开段落也能识别；
//     点了没反应的元素立刻拉黑，不再重复点（修 v3.4 的卡死）。
//   - 侧边栏被收起（窗口窄于 ~768px）时，自动点开边栏再收集。
//
// v3.5 相比之前版本的变化：
//   - 防卡死：点过但没有任何变化的折叠块会被拉黑，不再反复重试
//     （v3.4 就卡在这里：长会话里那个块点了没反应，会一直点）。
//   - 单条会话总时长上限 150 秒；诊断文件每 3 条写一次，
//     中途取消也能看到已经跑到哪儿。
//   - 侧边栏收集重写：从第一条会话链接往上找真正的滚动容器
//     （v3.3/v3.4 只在 <nav> 里找，所以没滚动起来，只拿到 38 条）。
//   - 自动点开"点击展示全部折叠的消息（共 N 轮）/ 全部展开 / 继续阅读"，
//     直到不再出现新的折叠块（这是之前长会话只抓到一半的根因）。
//     v3.4 重写了这一层：每轮只点一个（避免展开又被收起）、优先点
//     "全部展开/继续阅读"、按候选签名判断是否有进展，折叠块一轮轮出现
//     也能一路点到底；折叠按钮的文案会记进诊断文件。
//   - 消息区改为"逐屏向上滚动 + 累积合并"，不再只抓当前 DOM 里
//     渲染出来的那几条，虚拟化长列表也能收全。
//   - 侧边栏收集改为多容器滚动 + 滚轮事件，并记录诊断信息。
//   - 跑完会在导出文件夹里写一份 `_诊断_导出.md`（每条会话抓了多少、
//     点了多少次展开、在哪一步停下），方便核查哪儿还漏。
//   - 本地桥接（127.0.0.1:8787）仍然可用；面板 CSP 拦掉时自动退回选文件夹。
//   - 只在你自己的浏览器里运行，不上传任何数据。
// ============================================================
(function () {
  'use strict';

  if (window.__aizexV333) {
    alert('v3.33 已经在运行了。如果没看到面板，请刷新页面后再粘贴一次。');
    return;
  }
  window.__aizexV333 = true;

  // ---------- 授权（由扩展 popup 注入；直接粘贴到控制台时为免费版） ----------
  var LIC = (window.__AIZEX_LICENSE__ && typeof window.__AIZEX_LICENSE__ === 'object') ? window.__AIZEX_LICENSE__ : null;
  var IS_PRO = !!(LIC && LIC.pro);
  var FREE_MAX = (LIC && LIC.freeMax) || 30;
  var UPGRADE_URL = (LIC && LIC.upgradeUrl) || '';
  var PLAN_NAME = (LIC && LIC.planName) || '免费版';

  // ---------- 用户设置（存在浏览器本地，下次自动记住） ----------
  var OPTS_KEY = 'aizex_opts_v1';
  var DEFAULT_OPTS = { downloadImages: true, intervalMs: 300, archivePack: true };
  function loadOpts() {
    try {
      var raw = localStorage.getItem(OPTS_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        return { downloadImages: o.downloadImages !== false, intervalMs: (typeof o.intervalMs === 'number' ? o.intervalMs : 300), archivePack: o.archivePack !== false };
      }
    } catch (e) {}
    return { downloadImages: true, intervalMs: 300, archivePack: true };
  }
  function persistOpts() {
    try { localStorage.setItem(OPTS_KEY, JSON.stringify(state.opts || DEFAULT_OPTS)); } catch (e) {}
  }

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
    bridge: false,
    bridgeInfo: null,
    diag: [],
    listDiag: {},
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
      window.__aizexV32Fetch = true;
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
      window.__aizexV32Xhr = true;
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
      window.__aizexV32Ws = true;
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

  async function collectConversations(expandList) {
    var seen = {};
    var list = [];
    var nav = document.querySelector('nav') || document.querySelector('aside') || document.body;

    // 窗口太窄时侧边栏会被收起（ChatGPT 前端在 <768px 会隐藏侧栏），先尝试展开
    var sidebarOpened = '';
    if (!document.querySelector(CONV_SEL)) {
      var toggles = document.querySelectorAll('button, [role="button"]');
      for (var tgi = 0; tgi < toggles.length && !sidebarOpened; tgi++) {
        var lab = ((toggles[tgi].getAttribute('aria-label') || '') + ' ' +
          (toggles[tgi].getAttribute('title') || '') + ' ' +
          (toggles[tgi].getAttribute('data-testid') || '')).trim();
        if (/sidebar|边栏|侧边栏|导航|navigation|menu/i.test(lab)) {
          try { toggles[tgi].click(); sidebarOpened = lab; } catch (e) {}
        }
      }
      if (sidebarOpened) await sleep(1500);
    }

    function collectLinks() {
      var links = document.querySelectorAll(CONV_SEL);
      for (var i = 0; i < links.length; i++) {
        var href = links[i].getAttribute('href') || '';
        if (!href || href.indexOf('/c/') < 0) continue;
        var full = href.indexOf('http') === 0 ? href : location.origin + href;
        var m = href.match(/\/c\/([^/?#]+)/);
        var key = m ? m[1] : full;
        if (seen[key]) continue;
        seen[key] = true;
        // 侧边栏每个会话一般只有标题；有日期行的话顺手记下来（接口拿不到时间的兜底显示）
        var rowText = [];
        try {
          rowText = String(links[i].innerText || '').replace(/\u00a0/g, ' ')
            .split('\n').map(function (x) { return x.trim(); }).filter(Boolean);
        } catch (e) {}
        list.push({
          id: key,
          href: full,
          title: rowText[0] || '(无标题)',
          panelTimeText: rowText.slice(1).filter(function (x) {
            return /^\d{4}[-/年]\d{1,2}|^\d{1,2}月\d{1,2}日|^昨天|^今天|^星期|前$/.test(x);
          })[0] || ''
        });
      }
      return document.querySelectorAll(CONV_SEL).length;
    }

    function describe(el) {
      if (!el) return '(无)';
      var tag = (el.tagName || '?').toLowerCase();
      var cls = (el.className && typeof el.className === 'string') ? '.' + el.className.split(/\s+/).slice(0, 2).join('.') : '';
      return tag + cls + '[scrollH=' + Math.round(el.scrollHeight || 0) + ',clientH=' + Math.round(el.clientHeight || 0) + ',top=' + Math.round(el.scrollTop || 0) + ']';
    }

    function wheelAt(el, dy) {
      if (!el) return;
      try {
        var r = el.getBoundingClientRect();
        var x = r.left + Math.max(20, r.width / 2);
        var y = r.top + Math.min(Math.max(30, r.height - 30), 300);
        var ev = new WheelEvent('wheel', { deltaY: dy || 1200, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y });
        el.dispatchEvent(ev);
        var under = document.elementFromPoint(Math.round(x), Math.round(y));
        if (under && under !== el) under.dispatchEvent(new WheelEvent('wheel', { deltaY: dy || 1200, deltaMode: 0, bubbles: true, cancelable: true, clientX: x, clientY: y }));
      } catch (e) {}
    }

    // 候选滚动容器：从第一条会话链接往上找，再加上文档里 overflow-y 可滚且含会话链接的容器
    function scrollCandidates() {
      var out = [];
      var el = document.querySelector(CONV_SEL);
      while (el && el !== document.documentElement && out.length < 10) {
        var cs = null;
        try { cs = getComputedStyle(el); } catch (e) {}
        var styleScroll = cs && /(auto|scroll|overlay)/.test(String(cs.overflowY || ''));
        if (styleScroll || el.scrollHeight > el.clientHeight + 20) out.push(el);
        el = el.parentElement;
      }
      var all = document.querySelectorAll('div, ul, section, main, aside, nav');
      for (var i = 0; i < all.length && out.length < 14; i++) {
        var e2 = all[i];
        if (out.indexOf(e2) >= 0) continue;
        var cs2 = null;
        try { cs2 = getComputedStyle(e2); } catch (e) {}
        if (!(cs2 && /(auto|scroll|overlay)/.test(String(cs2.overflowY || '')))) continue;
        try { if (!e2.querySelector(CONV_SEL)) continue; } catch (e) { continue; }
        out.push(e2);
      }
      out.push(document.scrollingElement || document.documentElement);
      return out;
    }

    var moreClicked = '';
    if (expandList) {
      try {
        var scopeBtns = nav.querySelectorAll('button, [role="button"], a, div, span');
        for (var mi = 0; mi < scopeBtns.length && !moreClicked; mi++) {
          var mt = (scopeBtns[mi].innerText || '').replace(/\s+/g, ' ').trim();
          if (/^(更多|全部会话|所有聊天|查看全部|历史记录|更多会话)$/.test(mt)) {
            realClick(scopeBtns[mi]);
            moreClicked = mt;
          }
        }
        if (moreClicked) await sleep(2500);
      } catch (e) {}
    }

    collectLinks();

    // 后端接口的会话列表优先（面板是 ChatGPT 前端，通常能一次列全）
    var apiItems = [];
    try { apiItems = await apiList(); } catch (e) {}
    if (apiItems.length) {
      var domById = {};
      for (var li = 0; li < list.length; li++) domById[list[li].id] = list[li];
      for (var ri = 0; ri < apiItems.length; ri++) {
        var it = apiItems[ri];
        if (!it || !it.id) continue;
        if (seen[it.id]) {
          // 侧边栏先收进来的那条，把接口给的更新时间补上
          var ex = domById[it.id];
          if (ex) {
            if (it.update_time) ex.update_time = it.update_time;
            if (it.create_time) ex.create_time = it.create_time;
            if ((!ex.title || ex.title === '(无标题)') && it.title) ex.title = it.title;
          }
          continue;
        }
        seen[it.id] = true;
        list.push({
          id: it.id, href: it.href, title: it.title || '(无标题)',
          create_time: it.create_time || 0, update_time: it.update_time || 0, panelTimeText: ''
        });
      }
    }

    var candidates = scrollCandidates();

    // 逐个候选试一遍，找出"滚它就能加载更多"的那个
    var working = null;
    var probe = [];
    for (var pi = 0; pi < candidates.length && !working; pi++) {
      var cand = candidates[pi];
      var c0 = document.querySelectorAll(CONV_SEL).length;
      try { cand.scrollTop = Math.max(0, (cand.scrollHeight || 0) - (cand.clientHeight || 0)); } catch (e) {}
      wheelAt(cand, 1500);
      await sleep(1500);
      var c1 = document.querySelectorAll(CONV_SEL).length;
      probe.push(describe(cand) + ' ' + c0 + '->' + c1);
      collectLinks();
      if (c1 > c0) working = cand;
    }

    var stable = 0;
    var rounds = 0;
    while (!state.cancelled && rounds < 150 && stable < 6) {
      rounds++;
      var beforeN = document.querySelectorAll(CONV_SEL).length;
      var targets = working ? [working] : candidates;
      for (var ti = 0; ti < targets.length; ti++) {
        var el2 = targets[ti];
        try { el2.scrollTop = Math.max(0, (el2.scrollHeight || 0) - (el2.clientHeight || 0)); } catch (e) {}
        wheelAt(el2, 1200);
        await sleep(120);
      }
      await sleep(1100);
      var afterN = document.querySelectorAll(CONV_SEL).length;
      collectLinks();
      if (afterN > beforeN) stable = 0; else stable++;
      // 已锁定容器但连着几轮不动了：再试试其它候选，防止中途换容器
      if (working && stable === 3) {
        for (var oi = 0; oi < candidates.length; oi++) {
          if (candidates[oi] === working) continue;
          try { candidates[oi].scrollTop = Math.max(0, (candidates[oi].scrollHeight || 0) - (candidates[oi].clientHeight || 0)); } catch (e) {}
          wheelAt(candidates[oi], 1200);
        }
      }
    }
    collectLinks();

    state.listDiag = {
      rounds: rounds,
      found: list.length,
      inDom: document.querySelectorAll(CONV_SEL).length,
      moreClicked: moreClicked,
      sidebarOpened: sidebarOpened,
      working: describe(working),
      probe: probe.slice(0, 8),
      candidates: candidates.slice(0, 6).map(describe),
      sidebarButtons: (function () {
        var out = [];
        var btns = nav.querySelectorAll('button, [role="button"]');
        for (var bi = 0; bi < btns.length && out.length < 20; bi++) {
          var t = (btns[bi].innerText || '').trim().slice(0, 24);
          if (t && out.indexOf(t) < 0) out.push(t);
        }
        return out;
      })()
    };
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
  function mappingToMessages(mapping, bag, currentNodeId) {
    if (!mapping || typeof mapping !== 'object') return null;
    // 主链取法（v3.30 起）：优先用会话自己的 current_node —— 那才是页面上"当前显示"的那条，
    // 从它往上回溯到根再正序输出。以前按 create_time 最大来找，遇到"重新生成/编辑过"的会话
    // 会挑到另一条分支，结果接口少了消息，只能靠页面版补，公式就变成排版结果了。
    var nodes = [];
    for (var k in mapping) {
      if (Object.prototype.hasOwnProperty.call(mapping, k) && mapping[k]) nodes.push(mapping[k]);
    }
    var leaf = null, best = -Infinity;
    if (currentNodeId && mapping[currentNodeId] && mapping[currentNodeId].message) {
      leaf = mapping[currentNodeId];
    }
    if (!leaf) {
      for (var i = 0; i < nodes.length; i++) {
        var n = nodes[i];
        if (!n.message) continue;
        var t = n.message.create_time || 0;
        if (t > best) { best = t; leaf = n; }
      }
    }
    if (!leaf) return [];
    var chain = [];
    var cur = leaf, guard = 0;
    while (cur && guard++ < 20000) {
      chain.push(cur);
      cur = cur.parent ? mapping[cur.parent] : null;
    }
    chain.reverse();
    var msgs = [];
    for (var c = 0; c < chain.length; c++) {
      var m = chain[c].message;
      if (!m) continue;
      var role = m.author && m.author.role;
      if (role !== 'user' && role !== 'assistant') continue;
      var ct = (m.content && m.content.content_type) || '';
      if (ct === 'thoughts' || ct === 'reasoning_recap') continue;   // 思维链不导出
      var parts = (m.content && m.content.parts) || [];
      var text = parts.map(function (p) {
        if (typeof p === 'string') return p;
        if (p && typeof p === 'object') {
          // 图片 / 文件：写一个带身份信息的占位符，把指针收集起来（后面下载，并就地标注）
          var ptr = p.asset_pointer || (p.metadata && p.metadata.asset_pointer) || '';
          var nm = p.name || p.file_name || p.filename ||
            (p.metadata && (p.metadata.name || p.metadata.file_name || p.metadata.filename)) || '';
          if (ptr && /^file-service:\/\//.test(ptr)) {
            if (bag && bag.images && bag.images.indexOf(ptr) < 0) bag.images.push(ptr);
            var pid = ptr.replace('file-service://', '');
            return nm ? ('［文件:' + nm + ':' + pid + '］') : ('［图片:' + pid + '］');
          }
          if (nm) return '［文件:' + nm + '］';
          if (typeof p.text === 'string') return p.text;
          return JSON.stringify(p);
        }
        return String(p == null ? '' : p);
      }).join('');
      if (!text && m.content && typeof m.content.text === 'string') text = m.content.text;
      if (!text) continue;
      msgs.push({ role: role, text: cleanText(text) });
    }
    return msgs;
  }

  function anyToMessages(body) {
    if (!body) return null;
    if (body.mapping) {
      var msgs = mappingToMessages(body.mapping, null, body.current_node);
      return { msgs: msgs, full: body };
    }
    if (Array.isArray(body) && body.length && body[0].role !== undefined) {
      return {
        msgs: body.map(function (m) {
          return { role: m.role, text: cleanText(Array.isArray(m.content) ? m.content.join('') : (m.content || '')) };
        }),
        full: body
      };
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
        if ((role === 'user' || role === 'assistant') && t2) collected.push({ role: role, text: cleanText(t2) });
      } else if (obj.role && obj.content !== undefined) {
        var cc = Array.isArray(obj.content) ? obj.content.join('') : String(obj.content || '');
        if (obj.role === 'user' || obj.role === 'assistant') collected.push({ role: obj.role, text: cleanText(cc) });
      }
    }
    if (collected.length) return { msgs: collected, full: null };
    return null;
  }

  // ================= 5. 快速导出：直接调接口 =================
  // ---------- 5.0 面板就是 ChatGPT 前端，优先走后端接口 ----------
  //   GET /backend-api/conversations?offset=&limit=&order=updated → 会话列表
  //   GET /backend-api/conversation/<id>                          → 完整会话（含折叠轮次）
  var apiCache = { list: null };

  async function apiGet(path) {
    var res = await fetch(path, { credentials: 'include', headers: { 'accept': '*/*' } });
    if (!res.ok) return null;
    var text = await res.text();
    if (!text) return null;
    try { return JSON.parse(text); } catch (e) { return null; }
  }

  async function apiList() {
    if (apiCache.list) return apiCache.list;
    var out = [];
    for (var offset = 0; offset < 3000; offset += 100) {
      var obj = null;
      try { obj = await apiGet('/backend-api/conversations?offset=' + offset + '&limit=100&order=updated'); } catch (e) {}
      if (!obj || !obj.items || !obj.items.length) break;
      for (var i = 0; i < obj.items.length; i++) {
        var it = obj.items[i];
        if (it && it.id) {
          out.push({
            id: it.id,
            href: location.origin + '/c/' + it.id,
            title: it.title || '(无标题)',
            create_time: it.create_time || 0,
            update_time: it.update_time || 0
          });
        }
      }
      if (obj.items.length < 100) break;
    }
    if (out.length) apiCache.list = out;
    return apiCache.list || [];
  }

  // 一次拿到完整会话（含折叠的早期轮次）；失败返回 null
  async function apiConversation(id) {
    var obj = null;
    try { obj = await apiGet('/backend-api/conversation/' + encodeURIComponent(id) + '?include_visually_hidden_messages=true'); } catch (e) {}
    var bag = { images: [] };
    var msgs = obj && obj.mapping ? mappingToMessages(obj.mapping, bag, obj.current_node) : null;
    if (msgs && msgs.length >= 2) {
      return {
        msgs: msgs, images: bag.images,
        create_time: (obj && obj.create_time) || 0,
        update_time: (obj && obj.update_time) || 0
      };
    }
    return null;
  }

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

  // ---------- v3.3：折叠消息自动展开 + 边滚边累积 ----------
  // 面板会把较早的对话折叠成"点击展示全部折叠的消息（共 N 轮）/ 全部展开"，
  // 不点开就只能抓到已展开的那部分；此外长会话的消息区是虚拟化渲染，
  // 只抓当前 DOM 会漏。这里改成：自动点开折叠 + 逐屏向上滚动累积。
  var FOLD_HINT = /折叠|展开|继续阅读|显示更多|查看更多|更早的消息|加载更早|earlier|show more|expand/i;
  var FOLD_COUNT = /共\s*\d+\s*轮|共\s*\d+\s*条|\d+\s*轮折叠|折叠的消息/;
  var EXPAND_ACTION = /全部展开|展开全部|继续阅读|展开剩余|显示全部/;

  function inSidebar(el) {
    try { return !!(el.closest && el.closest('nav, aside')); } catch (e) { return false; }
  }

  function directText(el) {
    var s = '';
    for (var c = 0; c < el.childNodes.length; c++) {
      if (el.childNodes[c].nodeType === 3) s += el.childNodes[c].nodeValue;
    }
    return s.replace(/\s+/g, ' ').trim();
  }

  function ownLabel(el) {
    var t = directText(el);
    if (t) return t;
    return (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
  }

  // 面板实际用的折叠控件类名（2026-09-25 实测）：
  //   span.nextc-batch-trigger-action = 全部展开 / 继续阅读（点了有效）
  //   span.nextc-batch-trigger-title  = 点击展示...（点了有效）
  //   div.nextc-batch-trigger-wrap    = 外层容器（点了无效，别点）
  //   span.A_HxFq_showMoreLabel / button.A_HxFq_toggleControl = 单条长消息里的"展开"
  var FOLD_KNOWN_SEL = '.nextc-batch-trigger-action, .nextc-batch-trigger-title, button.nextc-batch-trigger, .A_HxFq_toggleControl, .A_HxFq_showMoreLabel';

  // 内容指纹：消息条数 + 全部文本长度（展开段落时条数不变，但长度会变）
  function contentSig() {
    return messageEls().length + ':' + contentChars();
  }

  function contentChars() {
    var els = messageEls();
    var len = 0;
    for (var i = 0; i < els.length; i++) {
      // 用 textContent（不触发排版），长会话时比 innerText 快很多
      len += ((els[i].textContent || '').length);
    }
    return len;
  }

  // 面板自己标的"还有 N 轮被折叠"：用来判断这次到底抓全没有
  function foldRoundsLeft() {
    var max = 0;
    var sum = 0;
    var els = document.querySelectorAll('.nextc-batch-trigger-title');
    if (!els.length) els = document.querySelectorAll('.nextc-batch-trigger-wrap');
    for (var i = 0; i < els.length; i++) {
      var t = (els[i].innerText || els[i].textContent || '').replace(/\s+/g, ' ');
      var m = t.match(/共\s*(\d+)\s*轮/) || t.match(/(\d+)\s*轮折叠/);
      if (m) {
        var n = parseInt(m[1], 10) || 0;
        if (n > max) max = n;
        sum += n;
      }
    }
    return { max: max, sum: sum, boxes: els.length };
  }

  // 收集可点的折叠/展开控件，按"点了最可能有效"排序
  function foldCandidates() {
    var out = [];
    var seen = [];
    state.deadFoldEls = state.deadFoldEls || [];

    function push(el, score) {
      if (!el || seen.indexOf(el) >= 0) return;
      if (state.deadFoldEls.indexOf(el) >= 0) return;
      try { if (el.closest('nav, aside')) return; } catch (e) {}
      if (el.querySelector && el.querySelectorAll(MSG_SEL).length) return;
      var whole = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
      if (!whole || whole.length > 300) return;
      seen.push(el);
      out.push({ el: el, label: whole.slice(0, 60), whole: whole.slice(0, 160), score: score });
    }

    var known = document.querySelectorAll(FOLD_KNOWN_SEL);
    for (var i = 0; i < known.length && out.length < 200; i++) {
      var el = known[i];
      var cls = String(el.className || '');
      var score = 3;
      if (/trigger-action/.test(cls)) score = 10;       // 全部展开 / 继续阅读
      else if (/toggleControl/.test(cls)) score = 9;    // 长消息内的"展开"
      else if (/showMoreLabel/.test(cls)) score = 8;
      else if (/trigger-title/.test(cls)) score = 7;    // 点击展示…
      else if (/batch-trigger/.test(cls)) score = 4;    // 外层 button，兜底
      if (el.__aizexStrikes) score -= 3;                // 点过一次没反应的，排到后面
      push(el, score);
    }

    // 兜底：类名变了也能用（按文案找）
    if (!out.length) {
      var scope = document.querySelector(CONTAINER_SEL) || document.body;
      var els = scope.querySelectorAll('div, button, [role="button"], a, span, summary, p');
      for (var j = 0; j < els.length && out.length < 120; j++) {
        var e2 = els[j];
        var whole2 = (e2.innerText || e2.textContent || '').replace(/\s+/g, ' ').trim();
        if (!whole2 || whole2.length > 300) continue;
        if (!FOLD_HINT.test(whole2)) continue;
        var clickable = /^(BUTTON|A|SUMMARY)$/.test(e2.tagName) || e2.getAttribute('role') === 'button' || e2.hasAttribute('tabindex');
        if (!(FOLD_COUNT.test(whole2) || EXPAND_ACTION.test(whole2) || clickable)) continue;
        // 取"最内层"那个（外层盒子点了没用）
        push(e2, clickable ? 5 : 2);
      }
    }
    out.sort(function (a, b) { return b.score - a.score; });
    // 每个折叠盒只留一个最优元素：同一个盒子点两次可能又把内容收起来
    var byBox = [];
    var filtered = [];
    for (var i2 = 0; i2 < out.length; i2++) {
      var box = null;
      try { box = out[i2].el.closest('.nextc-batch-trigger-wrap'); } catch (e) {}
      if (!box) { try { box = out[i2].el.closest('button, [role="button"], summary'); } catch (e) {} }
      if (!box) box = out[i2].el.parentElement || out[i2].el;
      var key = box || out[i2].el;
      if (byBox.indexOf(key) >= 0) continue;
      byBox.push(key);
      filtered.push(out[i2]);
    }
    return filtered;
  }

  function realClick(el) {
    try {
      var r = el.getBoundingClientRect();
      var opts = {
        bubbles: true, cancelable: true, view: window, detail: 1,
        clientX: r.left + Math.max(4, r.width / 2), clientY: r.top + Math.max(4, Math.min(r.height / 2, 24))
      };
      try { el.dispatchEvent(new PointerEvent('pointerdown', opts)); } catch (e) {}
      el.dispatchEvent(new MouseEvent('mousedown', opts));
      try { el.dispatchEvent(new PointerEvent('pointerup', opts)); } catch (e) {}
      el.dispatchEvent(new MouseEvent('mouseup', opts));
      el.dispatchEvent(new MouseEvent('click', opts));
      return true;
    } catch (e) {
      try { el.click(); return true; } catch (e2) { return false; }
    }
  }

  function pickBestFold(cands) {
    var best = null, bestScore = -1;
    for (var i = 0; i < cands.length; i++) {
      var t = (cands[i].whole || '') + ' ' + (cands[i].label || '');
      var score = 1;
      if (/继续阅读/.test(t)) score = 3;
      if (/全部展开|展开全部/.test(t)) score = 5;
      if (FOLD_COUNT.test(t)) score += 2;
      if (score > bestScore) { bestScore = score; best = cands[i]; }
    }
    return best;
  }

  // 反复点折叠/展开控件：每轮点一个最高的；点了没变化的那个元素拉黑，不再重复点
  // （v3.4 卡死就是这里：外层盒子点了没反应还一直点）
  async function expandCollapsed(diag, deadline) {
    return expandCollapsedSplit(diag, deadline);
  }

  // 两类"展开"必须分开处理：
  //   A. 聊天块批次折叠：.nextc-batch-trigger-*（"点击展示全部折叠的消息（共 N 轮）"）
  //      —— 这才是丢历史内容的元凶，要点到没有为止
  //   B. 单条长消息自己的"展开"：.A_HxFq_toggleControl / .A_HxFq_showMoreLabel
  //      —— 只是把一条长消息展开，点一次就够；点不动就必须停（v3.13 就是在这里空点了 400 次）
  function isBatchFoldNode(c) {
    var cls = String((c.el && c.el.className) || '');
    if (/nextc-batch-trigger/.test(cls)) return true;
    try { if (c.el && c.el.closest && c.el.closest('.nextc-batch-trigger-wrap')) return true; } catch (e) {}
    var t = String((c.whole || c.label || '')).replace(/\s+/g, ' ');
    return /共\s*\d+\s*轮|轮折叠的消息|全部展开|继续阅读|展开剩余/.test(t);
  }

  function isMsgExpandNode(c) {
    var cls = String((c.el && c.el.className) || '');
    if (/A_HxFq_/.test(cls)) return true;
    var t = String((c.whole || c.label || '')).replace(/\s+/g, ' ').trim();
    return /^展开$/.test(t);
  }

  async function expandCollapsedSplit(diag, deadline) {
    var clicked = 0;
    state.deadFoldEls = state.deadFoldEls || [];
    var roundsFirst = foldRoundsLeft().max;
    if (diag) diag.foldRoundsFirst = roundsFirst;
    var clickBudget = state.expandCap || 400;

    // ---------- A. 批次折叠：一直点，直到没有 ----------
    var noProgress = 0;
    for (var rA = 0; rA < 400 && clicked < clickBudget; rA++) {
      if (state.cancelled) break;
      if (deadline && Date.now() > deadline) { if (diag) diag.foldStop = 'deadline'; break; }
      var candsA = foldCandidates().filter(isBatchFoldNode);
      if (!candsA.length) { if (diag) diag.foldLeft = 0; break; }
      // "全部展开"一次就能把整批放出来，"继续阅读"只是一小段——必须优先前者
      candsA.sort(function (a, b) {
        var sa = /全部展开|展开全部/.test((a.whole || '') + (a.label || '')) ? 2
               : (/继续阅读/.test((a.whole || '') + (a.label || '')) ? 1 : 0);
        var sb = /全部展开|展开全部/.test((b.whole || '') + (b.label || '')) ? 2
               : (/继续阅读/.test((b.whole || '') + (b.label || '')) ? 1 : 0);
        return sb - sa;
      });
      if (diag) {
        diag.foldLeft = candsA.length;
        if (!diag.foldLabels) diag.foldLabels = [];
        if (diag.foldLabels.length < 8) {
          var lbA = candsA[0].label || '';
          if (lbA && diag.foldLabels.indexOf(lbA) < 0) diag.foldLabels.push(lbA);
        }
      }
      var batchA = candsA.slice(0, 1);   // 一次一下：全部展开通常一次就够
      var beforeA = contentSig();
      try { batchA[0].el.click(); } catch (e) { realClick(batchA[0].el); }
      clicked++;
      state.hbClicks = clicked;
      var changedA = false;
      for (var wA = 0; wA < 8; wA++) {
        await sleep(500);
        if (contentSig() !== beforeA) { changedA = true; break; }
        if (state.cancelled) break;
        if (deadline && Date.now() > deadline) break;
      }
      for (var jA = 0; jA < batchA.length; jA++) {
        var elA = batchA[jA].el;
        if (changedA) { elA.__aizexWorked = true; }
        else {
          elA.__aizexStrikes = (elA.__aizexStrikes || 0) + 1;
          if (elA.__aizexStrikes >= 2 && !elA.__aizexWorked && state.deadFoldEls.length < 600) {
            state.deadFoldEls.push(elA);
            if (diag) diag.foldDead = (diag.foldDead || 0) + 1;
          }
        }
      }
      var leftNow = foldRoundsLeft();
      state.hbLeft = leftNow.max;
      if (diag) diag.foldRoundsLeft = leftNow.max;
      if (rA % 2 === 0) {
        hb('正在点「全部展开」展开聊天块', '已点 ' + clicked + ' 次；面板还剩约 ' + leftNow.max + ' 轮未展开');
        try { ui.status('处理中：' + (state.hbTitle || '') + '\n点了 ' + clicked + ' 次「全部展开」，面板还剩约 ' + leftNow.max + ' 轮｜已用 ' + Math.round((Date.now() - state.hbStart) / 1000) + ' 秒'); } catch (e) {}
      }
      if (changedA) noProgress = 0; else noProgress++;
      if (noProgress >= 2) { if (diag) diag.foldStop = 'batch-no-progress'; break; }
      if (roundsFirst > 0 && clicked >= 60 && leftNow.max >= roundsFirst) {
        if (diag) diag.foldStop = 'no-progress';
        break;
      }
    }

    // ---------- B. 单条长消息的"展开"：每个点一次，最多 60 次，点不动就停 ----------
    var msgAttempts = 0;
    var msgFlat = 0;
    var msgStop = '';
    for (var rB = 0; rB < 40 && msgAttempts < 60; rB++) {
      if (state.cancelled) break;
      if (deadline && Date.now() > deadline) { msgStop = 'deadline'; break; }
      var candsB = foldCandidates().filter(isMsgExpandNode);
      if (!candsB.length) break;
      var batchB = candsB.slice(0, 3);
      var beforeB = contentSig();
      for (var iB = 0; iB < batchB.length; iB++) {
        try { batchB[iB].el.click(); } catch (e) { realClick(batchB[iB].el); }
        msgAttempts++;
        clicked++;
      }
      state.hbClicks = clicked;
      await sleep(420);
      var changedB = contentSig() !== beforeB;
      if (changedB) { msgFlat = 0; }
      else {
        msgFlat++;
        for (var jB = 0; jB < batchB.length; jB++) {
          var elB = batchB[jB].el;
          if (state.deadFoldEls.indexOf(elB) < 0) state.deadFoldEls.push(elB);
        }
        if (msgFlat >= 2) { msgStop = 'msg-expand-no-progress'; break; }
      }
    }
    if (diag) {
      diag.msgExpandClicks = msgAttempts;
      if (msgStop) diag.msgExpandStop = msgStop;
    }
    return clicked;
  }

  async function expandCollapsedLegacy(diag, deadline) {
    var clicked = 0;
    state.deadFoldEls = state.deadFoldEls || [];
    var roundsFirst = foldRoundsLeft().max;   // 面板一开始标的"共 N 轮"
    if (diag) diag.foldRoundsFirst = roundsFirst;
    for (var r = 0; r < (state.expandCap || 400); r++) {
      if (state.cancelled) break;
      if (deadline && Date.now() > deadline) { if (diag) diag.foldStop = 'deadline'; break; }
      var cands = foldCandidates();
      if (!cands.length) { if (diag) diag.foldLeft = 0; break; }
      if (diag) {
        diag.foldLeft = cands.length;
        if (!diag.foldLabels) diag.foldLabels = [];
        if (diag.foldLabels.length < 8) {
          var lb = cands[0].label;
          if (lb && diag.foldLabels.indexOf(lb) < 0) diag.foldLabels.push(lb);
        }
      }
      // 一次点 5 个不同折叠盒，然后只判定一次"内容有没有变"（比一个个点快好几倍）
      var batch = cands.slice(0, 5);
      var before = contentSig();
      for (var bi = 0; bi < batch.length; bi++) {
        try { batch[bi].el.click(); } catch (e) { realClick(batch[bi].el); }
        clicked++;
      }
      state.hbClicks = clicked;
      await sleep(520);
      var changed = contentSig() !== before;
      for (var bj = 0; bj < batch.length; bj++) {
        var elB = batch[bj].el;
        if (changed) {
          elB.__aizexWorked = true;
        } else {
          elB.__aizexStrikes = (elB.__aizexStrikes || 0) + 1;
          if (elB.__aizexStrikes >= 2 && !elB.__aizexWorked && state.deadFoldEls.length < 600) {
            state.deadFoldEls.push(elB);
            if (diag) diag.foldDead = (diag.foldDead || 0) + 1;
          }
        }
      }
      var leftNow = foldRoundsLeft();
      state.hbLeft = leftNow.max;
      if (diag) { diag.foldRoundsLeft = leftNow.max; }
      if (r % 2 === 0) {
        hb('正在点开折叠块（每轮 5 个）', '已点 ' + clicked + ' 次；面板还剩约 ' + leftNow.max + ' 轮未展开');
        try { ui.status('处理中：' + (state.hbTitle || '') + '\n已点开 ' + clicked + ' 个折叠块，面板还剩约 ' + leftNow.max + ' 轮｜已用 ' + Math.round((Date.now() - state.hbStart) / 1000) + ' 秒'); } catch (e) {}
      }
      // 兜底：点了很多次而"剩余轮数"纹丝不动 → 说明点错了，别继续浪费
      if (roundsFirst > 0 && clicked >= 40 && leftNow.max >= roundsFirst) {
        if (diag) diag.foldStop = 'no-progress';
        break;
      }
      if (state.expandCap && clicked >= state.expandCap) break;
    }
    return clicked;
  }

  function msgScroller() {
    // 真正的滚动容器：往上找"可视高度像窗口 + 确实有溢出"的那一层。
    // 之前找错的原因：内容包裹层 scrollHeight≈clientHeight≈40 万像素（它不是滚动口），
    // 用它滚动当然没反应，早窗口的消息也就永远不会被渲染出来。
    var seeds = [];
    var first = document.querySelector(MSG_SEL);
    if (first) seeds.push(first);
    var box = document.querySelector(CONTAINER_SEL);
    if (box) seeds.push(box);
    var viewportLimit = Math.max(700, (window.innerHeight || 800) * 1.5);
    var cands = [];
    for (var s = 0; s < seeds.length; s++) {
      var el = seeds[s];
      while (el && el !== document.documentElement) {
        var cs = null;
        try { cs = getComputedStyle(el); } catch (e) {}
        var overflow = String((cs && cs.overflowY) || '');
        var scrollStyle = /(auto|scroll|overlay)/.test(overflow);
        var clientH = el.clientHeight || 0;
        var scrollH = el.scrollHeight || 0;
        var windowish = clientH > 120 && clientH < viewportLimit;
        if (scrollH > clientH + 20 && (scrollStyle || windowish)) {
          var score = (scrollStyle ? 2 : 0) + (windowish ? 2 : 0) + (scrollH - clientH > 400 ? 1 : 0);
          cands.push({ el: el, score: score, over: scrollH - clientH });
        }
        el = el.parentElement;
      }
    }
    cands.sort(function (a, b) { return (b.score - a.score) || (b.over - a.over); });
    if (cands.length) return cands[0].el;
    return document.scrollingElement || document.documentElement;
  }

  function wheelUp(el) {
    if (!el) return;
    try {
      var r = el.getBoundingClientRect();
      var ev = new WheelEvent('wheel', {
        deltaY: -700, deltaMode: 0, bubbles: true, cancelable: true,
        clientX: r.left + Math.max(20, r.width / 2), clientY: r.top + Math.max(80, Math.min(r.height / 2, 300))
      });
      el.dispatchEvent(ev);
    } catch (e) {}
  }

  function snapshotMessages() {
    var els = messageEls();
    var arr = [];
    state.pendingImages = state.pendingImages || [];
    for (var i = 0; i < els.length; i++) {
      var role = els[i].getAttribute('data-message-author-role') || 'unknown';
      // 先在"原始文本"里捞图片指针（面板把图片信息当文本 JSON 存，转换后再捞就晚了）
      var raw = '';
      try { raw = (els[i].innerText || els[i].textContent || ''); } catch (e) { raw = ''; }
      harvestPointersFromText(raw);
      var text = mdFromElement(els[i]);
      if (text) harvestPointersFromText(text);
      if (!text) continue;
      arr.push({ role: role, text: text });
    }
    try { harvestDomImagesInto(state.pendingImages, els); } catch (e) {}
    return arr;
  }

  // 从任意文本里捞 file-service 图片指针
  function harvestPointersFromText(text) {
    if (!text || text.indexOf('file-service://') < 0) return;
    state.pendingImages = state.pendingImages || [];
    var re = /file-service:\/\/([A-Za-z0-9_-]+)/g;
    var m;
    while ((m = re.exec(text)) !== null) {
      var ptr = 'file-service://' + m[1];
      if (state.pendingImages.indexOf(ptr) < 0) state.pendingImages.push(ptr);
    }
  }

  // 页面上的 <img>：懒加载的图片 src 可能是空的，要连 data-src / srcset / currentSrc 一起看
  function harvestDomImagesInto(bag, scopedEls) {
    bag = bag || [];
    var roots = [];
    if (scopedEls && scopedEls.length) { for (var s = 0; s < scopedEls.length; s++) roots.push(scopedEls[s]); }
    else { try { roots.push(document.querySelector(CONTAINER_SEL) || document.body); } catch (e) {} }
    for (var r = 0; r < roots.length; r++) {
      var imgs = [];
      try { imgs = roots[r].querySelectorAll ? roots[r].querySelectorAll('img') : []; } catch (e) { imgs = []; }
      for (var i = 0; i < imgs.length; i++) {
        var el = imgs[i];
        var src = el.currentSrc || el.getAttribute('src') || el.getAttribute('data-src') || '';
        if (!src) {
          var ss = el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
          if (ss) src = ss.split(',')[0].trim().split(/\s+/)[0];
        }
        if (!src || /^data:/i.test(src)) continue;
        if (/avatar|emoji|favicon/i.test(src)) continue;
        if (bag.indexOf(src) < 0) bag.push(src);
      }
    }
    return bag;
  }

  // 从当前页面的 DOM 里顺手捞图片地址（有些图片只在页面上有签名 URL，接口里拿不到）
  function harvestDomImages() {
    return harvestDomImagesInto([], null);
  }

  // ---------------- HTML → Markdown（保真度核心） ----------------
  // 面板里代码块是 <pre><code>、表格是 <table>、列表是 <ul>/<ol>；
  // 之前用 innerText 抓，这些结构全丢了（代码没有围栏、表格变纯文本）。
  var MD_SKIP_TAGS = { 'button': 1, 'svg': 1, 'script': 1, 'style': 1, 'noscript': 1, 'textarea': 1, 'select': 1, 'input': 1 };
  var LANG_RE = /^(python|javascript|typescript|js|ts|java|c\+\+|cpp|c#|csharp|go|golang|rust|sql|json|bash|sh|shell|html|css|xml|yaml|yml|markdown|md|matlab|r|text|plaintext)$/i;

  // ================= 文本规整（v3.27） =================
  // 面板把数学公式渲染成"TeX 源 + 可见层 + 无障碍层"三层；把它们的文字直接拼起来，
  // 导出文件里同一个公式就会出现两三遍。这里改成识别公式节点、只取原始 TeX。
  var ZW_RE = /[\u200b\u200c\u200d\u2060\ufeff]/g;
  // 图片附件在 DOM / 接口里都是一坨 JSON（有时还被拆成几段），导出时全是噪声
  var NOISE_KEYS_RE = /"(asset_pointer|content_type|container_pixel_width|watermarked_asset_pointer|size_bytes)"\s*:/;
  // 文本里出现这些键，就说明这段是图片元数据，可以放心删 JSON 残渣
  var IMG_KEYS_RE = /"(asset_pointer|asset_pointer_link|content_type|container_pixel_width|container_pixel_height|watermarked_asset_pointer|size_bytes|fovea|sanitized|dalle|emu_omit_glimpse_image|emu_patches_override|lpe_delta_encoding_channel|lpe_keep_patch_ijhw|is_no_auth_placeholder|metadata)"\s*:/;
  var JSON_VALUE = '(?:"(?:[^"\\\\]|\\\\.)*"|null|true|false|-?\\d+(?:\\.\\d+)?|\\[[^\\]]*\\]|\\{[^{}]*\\})';
  var JSON_MEMBER = '"[A-Za-z_][A-Za-z0-9_]*"\\s*:\\s*' + JSON_VALUE;
  var JSON_RUN_RE = new RegExp('(?:^|[,\\s])(?:' + JSON_MEMBER + ')(?:\\s*,\\s*' + JSON_MEMBER + ')*', 'g');
  var INLINE_TAGS = {
    a: 1, span: 1, strong: 1, b: 1, em: 1, i: 1, u: 1, s: 1, del: 1, ins: 1, mark: 1, small: 1,
    sup: 1, sub: 1, code: 1, kbd: 1, samp: 1, var: 1, abbr: 1, cite: 1, q: 1, time: 1, bdi: 1,
    bdo: 1, wbr: 1, label: 1, font: 1, big: 1, tt: 1, nobr: 1
  };

  function noteFmt(key) {
    state.fmtDiag = state.fmtDiag || {};
    state.fmtDiag[key] = (state.fmtDiag[key] || 0) + 1;
  }

  function looksLikePanelJson(t) {
    return !!(t && t.indexOf('{') >= 0 && NOISE_KEYS_RE.test(t));
  }

  // 附件占位符（v3.33）：把原来的「［图片］」变成带身份信息的记号，
  // 写文件时才能就地换成真正的图片/文件链接，而不是统统堆到文末。
  //   图片：［图片:file-abc123］
  //   文件：［文件:报告.pdf:file-abc123］（拿不到文件名时是 ［文件:报告.pdf］）
  var ATT_IMG_RE = /［图片:([^］]+)］/g;
  var ATT_FILE_ID_RE = /［文件:([^］:]+):([^］]+)］/g;
  var ATT_FILE_RE = /［文件:([^］]+)］/g;
  var ATT_PLAIN_RE = /［图片］/g;

  function attachTokenFromBlob(blob) {
    var s = String(blob || '');
    var idM = /file-service:\/\/([A-Za-z0-9_-]+)/.exec(s);
    var nmM = /"(?:name|file_name|filename|title)"\s*:\s*"([^"]{1,80})"/.exec(s);
    var id = idM ? idM[1] : '';
    var nm = nmM ? nmM[1] : '';
    if (nm && id) return '［文件:' + nm + ':' + id + '］';
    if (id) return '［图片:' + id + '］';
    if (nm) return '［文件:' + nm + '］';
    return '［图片］';
  }

  // 从消息正文里收集"文件名 → 文件 ID"，供下载时命名和展示用
  function nameHintsFromMsgs(msgs) {
    var out = {};
    (msgs || []).forEach(function (m) {
      var t = String((m && m.text) || '');
      var re = new RegExp(ATT_FILE_ID_RE.source, 'g');
      var mm;
      while ((mm = re.exec(t)) !== null) {
        if (mm[2] && mm[1]) out[mm[2]] = mm[1];
      }
    });
    return out;
  }

  // 就地把占位符换成图片/文件标注
  function attMarkdown(att, id, name) {
    var rel = '';
    if (att && id && att.map && att.map[id]) {
      rel = att.map[id];
      if (att.used) att.used[id] = 1;
    }
    var label = name || id || '附件';
    if (rel) {
      // 图片是块级元素：前后各留一个空行，免得把后面的正文粘到标注这一行上
      return '\n\n![' + (name ? name : '图片') + '](' + rel + ')\n\n> 附件: `' + label + '`\n\n';
    }
    if (name) return '\n\n> 附件: `' + label + '`（未下载成功，可在面板里查看）\n\n';
    if (id) return '\n\n［图片］`' + id + '`（未下载成功，可在面板里查看）\n\n';
    return '［图片］';
  }

  function resolveAttachments(text, att) {
    var s = String(text == null ? '' : text);
    if (!att || s.indexOf('［') < 0) return s;
    s = s.replace(new RegExp(ATT_FILE_ID_RE.source, 'g'), function (m, nm, id) { return attMarkdown(att, id, nm); });
    s = s.replace(new RegExp(ATT_IMG_RE.source, 'g'), function (m, id) { return attMarkdown(att, id, ''); });
    s = s.replace(new RegExp(ATT_FILE_RE.source, 'g'), function (m, nm) { return attMarkdown(att, '', nm); });
    s = s.replace(new RegExp(ATT_PLAIN_RE.source, 'g'), function () { return attMarkdown(att, '', ''); });
    return s;
  }

  // 把文本里夹着的图片 JSON 片段抠掉（面板常把 JSON 和正文塞在同一个文本节点里）
  function stripPanelJson(text) {
    var s = String(text == null ? '' : text);
    // 也可能是被拆散后只剩半截（没有左花括号，只有 ,"size_bytes":…} 这种），所以两个条件都要看
    if (s.indexOf('{') < 0 && !IMG_KEYS_RE.test(s)) return s;
    var out = '', i = 0, dropped = 0;
    while (i < s.length) {
      if (s.charAt(i) !== '{') { out += s.charAt(i); i++; continue; }
      var depth = 0, j = i, inStr = false, esc = false, end = -1;
      for (; j < s.length; j++) {
        var cj = s.charAt(j);
        if (inStr) {
          if (esc) { esc = false; continue; }
          if (cj === '\\') { esc = true; continue; }
          if (cj === '"') inStr = false;
          continue;
        }
        if (cj === '"') { inStr = true; continue; }
        if (cj === '{') depth++;
        else if (cj === '}' && --depth === 0) { end = j; break; }
      }
      if (end < 0) { out += s.slice(i); break; }
      var blob = s.slice(i, end + 1);
      if (NOISE_KEYS_RE.test(blob)) { dropped++; out += attachTokenFromBlob(blob); }
      else out += blob;
      i = end + 1;
    }
    if (dropped) {
      state.fmtDiag = state.fmtDiag || {};
      state.fmtDiag.jsonDropped = (state.fmtDiag.jsonDropped || 0) + dropped;
    }
    // 同一个 JSON 被拆到多个节点/part 时，会剩下 ,"size_bytes":327298,"width":1005} 这种残渣
    var cleaned = out;
    if (IMG_KEYS_RE.test(cleaned)) {
      cleaned = cleaned.replace(JSON_RUN_RE, '');
      cleaned = cleaned.replace(/^[\s,}]+/, '').replace(/[\s,}]+$/, '');
      noteFmt('jsonDropped');
    }
    return cleaned;
  }

  function isMathEl(el) {
    if (!el || !el.tagName) return false;
    var tag = String(el.tagName).toLowerCase();
    if (tag === 'math' || tag === 'mjx-container') return true;
    var cls = '';
    try { cls = String(el.className || ''); } catch (e) {}
    return /(^|\s)(katex|katex-display|katex-block|MathJax|math-block)(\s|$)/.test(cls);
  }

  // 公式的原始 TeX：KaTeX / MathJax 都会把它放在 <annotation encoding="application/x-tex">
  function mathTexOf(el) {
    try {
      var an = el.querySelector('annotation[encoding*="tex"]') || el.querySelector('annotation');
      if (an && an.textContent && an.textContent.trim()) return { tex: an.textContent.trim(), exact: true };
    } catch (e) {}
    try {
      var hid = el.querySelector('.katex-mathml') || el.querySelector('mjx-assistive-mml');
      if (hid && hid.textContent && hid.textContent.trim()) {
        return { tex: hid.textContent.replace(ZW_RE, '').trim(), exact: true };
      }
    } catch (e) {}
    var vis = '';
    try { vis = String(el.textContent || '').replace(ZW_RE, '').replace(/\s+/g, ' ').trim(); } catch (e) {}
    return vis ? { tex: vis, exact: false } : null;
  }

  function isDisplayMath(el) {
    var node = el, depth = 0;
    while (node && depth < 4) {
      var cls = '';
      try { cls = String(node.className || ''); } catch (e) {}
      if (/katex-display|math-block|MathJax_Display/.test(cls)) return true;
      try {
        if (node.getAttribute) {
          var dv = node.getAttribute('display');
          if (dv === 'block' || dv === 'true') return true;
        }
      } catch (e) {}
      node = node.parentElement; depth++;
    }
    return false;
  }

  // ---------- 从 KaTeX 的 HTML 反推 LaTeX（v3.30） ----------
  // 面板的 KaTeX 只输出 HTML。分数、上下标在里面是"绝对定位的行"，DOM 里的文字顺序
  // 不是你看到的顺序（分数会变成先分母后分子），所以直接把文字拼起来就成了 π=MΔM 这种。
  // 这里按结构还原：行按 style 里的 top 值排序（越负越靠上），分数拼回 \frac{}{}。
  // 注意 delimsizing 不在这里：它是"可见的"放大括号（\left( \bigl| 这类），跳过它会把括号弄丢
  var KATEX_SKIP_RE = /strut|pstrut|mspace|frac-line|vlist-s|nulldelimiter|fontsize-ensurer|reset-size|sizing|mtight|hide-tail|katex-mathml/;
  var KATEX_STRUCT_RE = /mfrac|msupsub|sqrt|accent|vlist/;
  var KATEX_WRAP_RE = /(^|\s)(katex|katex-display|katex-html)(\s|$)/;
  // 高括号在 KaTeX 里是"拼出来的"（上中下三片），要拼回一个字符
  var DELIM_PIECE_MAP = {
    '⎛': '(', '⎜': '', '⎝': '(', '⎞': ')', '⎟': '', '⎠': ')',
    '⎡': '[', '⎢': '', '⎣': '[', '⎤': ']', '⎥': '', '⎦': ']',
    '⎧': '{', '⎨': '', '⎩': '{', '⎫': '}', '⎬': '', '⎭': '}',
    '⎪': '|', '‖': '|'
  };

  function delimsFromPieces(s) {
    var out = '';
    for (var i = 0; i < String(s).length; i++) {
      var c = String(s).charAt(i);
      var isPiece = Object.prototype.hasOwnProperty.call(DELIM_PIECE_MAP, c);
      var m = isPiece ? DELIM_PIECE_MAP[c] : c;
      if (!m) continue;
      if (isPiece && out.charAt(out.length - 1) === m) continue;   // 只有"拼片"才压重复，普通字符不动
      out += m;
    }
    return out;
  }

  function katexSymbolText(el) {
    var raw = '';
    try { raw = katexTextOf(el); } catch (e) {}
    var cls = '';
    try { cls = String(el.className || ''); } catch (e) {}
    return (/delimsizing/.test(cls) || /[⎛⎜⎝⎞⎟⎠⎡⎢⎣⎤⎥⎦⎧⎨⎩⎫⎬⎭⎪]/.test(raw)) ? delimsFromPieces(raw) : raw;
  }

  // 还原结果的"括号"必须覆盖住页面上看到的括号，否则说明结构认错了 → 当作不可用
  var DELIM_CHECK_CHARS = '[](){}|';
  function katexCoverageOk(el, tex) {
    var vis = '', rec = '';
    // 页面上放大括号是"拼片"字符（⎛⎜⎝），先归一成真实括号再比
    try { vis = delimsFromPieces(katexTextOf(el)); } catch (e) {}
    try { rec = String(tex || '').replace(/\\[a-zA-Z]+/g, '').replace(/[\\{}]/g, ''); } catch (e) {}
    for (var i = 0; i < DELIM_CHECK_CHARS.length; i++) {
      var c = DELIM_CHECK_CHARS.charAt(i);
      if (vis.indexOf(c) >= 0 && rec.indexOf(c) < 0) return false;
    }
    return true;
  }

  function katexTextOf(el) {
    var s = '';
    try { s = String(el.textContent || ''); } catch (e) {}
    return s.replace(ZW_RE, '');
  }

  // 一个公式节点的"结构指纹"：把里面出现过的 class 排序拼起来，
  // 用来按结构去重地留样本、也用来在诊断里列出"还没支持的结构"
  function katexSignature(el) {
    var set = {};
    try {
      var spans = el.querySelectorAll('span');
      for (var i = 0; i < spans.length; i++) {
        var c = String(spans[i].className || '').trim();
        if (c) set[c] = 1;
      }
    } catch (e) {}
    return Object.keys(set).sort().join('|').slice(0, 220);
  }

  function katexHasStruct(el) {
    try {
      var kids = el.querySelectorAll('span');
      for (var i = 0; i < kids.length; i++) {
        if (KATEX_STRUCT_RE.test(String(kids[i].className || ''))) return true;
      }
    } catch (e) {}
    return false;
  }

  // 一个"行堆叠"结构里的各行，按视觉位置从上到下
  function katexRows(struct) {
    var rows = [];
    try {
      var vl = struct.querySelector('.vlist') || struct;
      var kids = vl.children || [];
      for (var i = 0; i < kids.length; i++) {
        var st = '';
        try { st = String(kids[i].getAttribute('style') || ''); } catch (e) {}
        var m = /top:\s*(-?[\d.]+)em/.exec(st);
        if (!m) continue;
        var got = katexToLatex(kids[i]);
        rows.push({ top: parseFloat(m[1]), tex: got.tex, ok: got.ok });
      }
    } catch (e) {}
    rows.sort(function (a, b) { return a.top - b.top; });
    return rows;
  }

  function katexToLatex(root) {
    var out = { tex: '', ok: true };
    (function walk(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) { out.tex += String(n.nodeValue || '').replace(ZW_RE, ''); continue; }
        if (n.nodeType !== 1) continue;
        var cls = '';
        try { cls = String(n.className || ''); } catch (e) {}
        if (KATEX_SKIP_RE.test(cls)) continue;
        if (KATEX_WRAP_RE.test(cls)) { walk(n); continue; }   // KaTeX 的外层包裹
        if (/(^|\s)base(\s|$)/.test(cls)) {         // 每个 base 是公式里的一"行"
          if (out.tex) out.tex += '\n';
          walk(n);
          continue;
        }
        if (/(^|\s)mfrac(\s|$)/.test(cls)) {
          // 行里有一行是分数线（renderRule），文字是空的，要滤掉
          var fr = katexRows(n).filter(function (r) { return r.tex; });
          if (fr.length >= 2) out.tex += '\\frac{' + fr[0].tex + '}{' + fr[1].tex + '}';
          else { out.ok = false; out.tex += katexTextOf(n); }
          continue;
        }
        if (/(^|\s)msupsub(\s|$)/.test(cls)) {
          var sr = katexRows(n).filter(function (r) { return r.tex; });
          if (sr.length === 2) out.tex += '^{' + sr[0].tex + '}_{' + sr[1].tex + '}';
          else { out.ok = false; out.tex += katexTextOf(n); }   // 单个上/下标分不清，退回文字
          continue;
        }
        if (/(^|\s)sqrt(\s|$)|(^|\s)accent(\s|$)/.test(cls)) { out.ok = false; out.tex += katexTextOf(n); continue; }
        if (/(^|\s)delimsizing/.test(cls)) { out.tex += delimsFromPieces(katexTextOf(n)); continue; }
        if (/(^|\s)text(\s|$)|cjk_fallback/.test(cls)) {
          var tt = katexTextOf(n).trim();
          out.tex += tt ? ('\\text{' + tt + '}') : '';
          continue;
        }
        if (/(^|\s)vlist/.test(cls)) { walk(n); continue; }
        if (/(^|\s)(mord|mbin|mrel|mopen|mclose|mpunct|minner|mop|mathnormal|mathit|mathrm|mtext)\b/.test(cls)) {
          if (katexHasStruct(n)) walk(n);
          else out.tex += katexSymbolText(n);
          continue;
        }
        out.ok = false;
        walk(n);
      }
    })(root);
    return out;
  }

  // 公式统一写成 $…$ / $$…$$
  function mathMd(el) {
    noteFmt('mathNodes');
    var got = mathTexOf(el);
    var tex = '', usable = false;
    if (got && got.exact) {
      noteFmt('mathTex');
      tex = got.tex;
      usable = true;
    } else {
      // 面板的 KaTeX 只输出 HTML：按结构反推 LaTeX（分数、\text 这些能还原回去）
      var rec = null;
      try { rec = katexToLatex(el); } catch (e) {}
      if (rec && rec.tex && rec.ok && katexCoverageOk(el, rec.tex)) {
        noteFmt('mathRebuilt');
        tex = rec.tex;
        usable = true;
      } else {
        noteFmt('mathRenderedText');
        // 记下认不出来的结构签名，下次按真实结构补规则
        try {
          if (rec && rec.tex) {
            state.fmtDiag.mathSuspect = state.fmtDiag.mathSuspect || [];
            var sig = katexSignature(el);
            if (sig && state.fmtDiag.mathSuspect.indexOf(sig) < 0 && state.fmtDiag.mathSuspect.length < 12) {
              state.fmtDiag.mathSuspect.push(sig);
            }
          }
        } catch (e) {}
        tex = (got && got.tex) ? got.tex : katexTextOf(el);
        usable = false;
      }
      if (!state.fmtDiag.mathSample) {
        try { state.fmtDiag.mathSample = String(el.outerHTML || '').replace(/\s+/g, ' ').slice(0, 220); } catch (e) {}
      }
      try {
        state.mathSamples = state.mathSamples || [];
        state.mathSampleSigs = state.mathSampleSigs || {};
        // 按"结构指纹"去重地留样本：只留前 8 个的话，往往全是同一种结构（比如全是分数），
        // 真正认不出来的那种反而没被记录下来
        var sampleSig = katexSignature(el);
        if (state.mathSamples.length < 10 && !state.mathSampleSigs[sampleSig]) {
          var html = String(el.outerHTML || '');
          if (html.length > 40) {
            state.mathSampleSigs[sampleSig] = 1;
            state.mathSamples.push(html.slice(0, 2500));
          }
        }
      } catch (e) {}
    }
    tex = String(tex || '');
    if (tex.indexOf('\n') >= 0) {
      tex = tex.split('\n').map(function (x) { return x.trim(); }).filter(Boolean).join('\n');
    }
    if (!tex.replace(/\s/g, '')) return '';
    // 还原不出来（未知结构）就当普通文字写，别包成 $…$ 在预览里散架
    if (!usable) return isDisplayMath(el) ? ('\n\n' + tex + '\n\n') : tex;
    if (isDisplayMath(el) || tex.indexOf('\n') >= 0) return '\n\n$$\n' + tex + '\n$$\n\n';
    return '$' + tex + '$';
  }

  // 同一段被渲染成两三份时拼在一起会重复，这里压掉（公式三重渲染的兜底）
  function collapseRepeats(text) {
    var lines = String(text).split('\n');
    for (var i = 0; i < lines.length; i++) {
      var t = lines[i].trim();
      if (t.length < 12) continue;
      // 只对"像公式"的行做去重，免得误伤 ==== 分隔线或普通的重复文字
      if (!/[\\^_{}]/.test(t)) continue;
      for (var k = 3; k >= 2; k--) {
        if (t.length % k !== 0) continue;
        var seg = t.slice(0, t.length / k);
        if (seg.length < 6) continue;
        var same = true;
        for (var j = 1; j < k; j++) {
          if (t.substr(j * seg.length, seg.length) !== seg) { same = false; break; }
        }
        if (same) { lines[i] = lines[i].replace(t, seg); break; }
      }
    }
    return lines.join('\n');
  }

  // 安全版：结构化正文（含代码块）走这个，只做不会改内容本身的清理
  function tidyMarkdown(s) {
    var t = String(s == null ? '' : s);
    t = t.replace(/\r\n?/g, '\n').replace(ZW_RE, '').replace(/\u00a0/g, ' ').replace(/\uFFFD/g, '');
    t = normalizeMathDelims(t);
    t = t.split('\n').map(function (x) { return x.replace(/[ ]+$/g, ''); }).join('\n');
    return t.replace(/\n{3,}/g, '\n\n').trim();
  }

  // 面板/接口给的公式是 ChatGPT 自己的写法：\[ … \] 独立行、\( … \) 行内。
  // 多数 Markdown 预览器不把这两种当数学公式（会把 \[ 当成转义的中括号），
  // 预览出来就是 [ \boxed{...} ] 这种散架的样子。这里换成通行的 $$…$$ / $…$。
  // 代码块（``` … ```）和行内代码（`…`）里的内容原样不动。
  function convertMathOutsideFence(seg) {
    var bits = String(seg).split(/(`[^`\n]*`)/);
    var out = '';
    for (var i = 0; i < bits.length; i++) {
      if (i % 2 === 1) { out += bits[i]; continue; }   // 行内代码
      out += convertMathSpans(bits[i]);
    }
    return out;
  }

  function mathInlineBody(body) {
    // 行内公式必须是一行，而且首尾不能有空格，否则不少预览器会认不出来
    return String(body).replace(/\s+/g, ' ').trim();
  }

  function convertMathSpans(t) {
    // 1) 只有"自己独占一行"的 \[ … \] 才当独立行公式
    t = t.replace(/(^|\n)([ \t]*)\\\[([\s\S]*?)\\\]([ \t]*)(?=\n|$)/g, function (m, pre, indent, body) {
      var b = String(body).replace(/^[ \t]*\n/, '').replace(/\n[ \t]*$/, '');
      return pre + '$$\n' + b.trim() + '\n$$';
    });
    // 2) 夹在句子里（或自己跨了行）的 \[ … \] 一律按行内处理
    //    以前不管三七二十一就插 $$，会在段落中间劈出公式块，把后面的 $ 全部带歪
    t = t.replace(/(^|[^\\])\\\[([\s\S]*?)(?<!\\)\\\]/g, function (m, pre, body) {
      return pre + '$' + mathInlineBody(body) + '$';
    });
    // 3) 行内公式 \( … \) → $ … $
    t = t.replace(/(^|[^\\])\\\(([\s\S]*?)(?<!\\)\\\)/g, function (m, pre, body) {
      return pre + '$' + mathInlineBody(body) + '$';
    });
    return t;
  }

  function normalizeMathDelims(text) {
    var s = String(text == null ? '' : text);
    if (s.indexOf('\\[') < 0 && s.indexOf('\\(') < 0) return s;
    // 先按 ``` 围栏切段，围栏里的内容一个字都不改
    var parts = s.split(/(```[\s\S]*?```)/);
    var out = '';
    for (var i = 0; i < parts.length; i++) {
      out += (i % 2 === 1) ? parts[i] : convertMathOutsideFence(parts[i]);
    }
    return out;
  }

  // 纯文本 / 接口正文走这个：再顺手把制表符和公式三连压掉
  function normalizeText(s) {
    return collapseRepeats(tidyMarkdown(String(s == null ? '' : s).replace(/\t+/g, '  ')));
  }

  // 接口正文走这个：清图片 JSON（整块 + 残渣）+ 规整空白；不动制表符（代码块要保真）
  function cleanText(t) {
    return collapseRepeats(tidyMarkdown(stripPanelJson(t)));
  }

  // 纯文本消息（没有代码块/表格/列表）：按块换行，不用 innerText ——
  // innerText 拿的是"排版后的文字"，浏览器自动折的行也会变成换行，看着就像"空格变回车"
  function plainTextOf(root, skipFn) {
    var out = [];
    (function walk(node) {
      var kids = node.childNodes || [];
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) {
          out.push(stripPanelJson(n.nodeValue));
          continue;
        }
        if (n.nodeType !== 1) continue;
        if (skipFn && skipFn(n)) continue;
        var tag = String(n.tagName || '').toLowerCase();
        if (tag === 'br') { out.push('\n'); continue; }
        if (tag === 'img') {
          var alt = '', src = '';
          try { alt = n.getAttribute('alt') || ''; } catch (e) {}
          try { src = n.currentSrc || n.getAttribute('src') || n.getAttribute('data-src') || ''; } catch (e) {}
          if (src && !/^data:/i.test(src)) out.push('![' + ((alt && !looksLikePanelJson(alt)) ? alt : '图片') + '](' + src + ')');
          else out.push('［图片］');
          continue;
        }
        if (isMathEl(n)) { out.push(mathMd(n)); continue; }
        var inlineTag = !!INLINE_TAGS[tag];
        if (!inlineTag) out.push('\n');
        walk(n);
        if (!inlineTag) out.push('\n');
      }
    })(root);
    return normalizeText(out.join(''));
  }

  function mdFromElement(root) {
    if (!root) return '';
    var content = root;
    try {
      // 助手消息的正文通常在 .markdown 容器里，优先只转它，避免把按钮/工具栏转进来
      var md = root.querySelector('.markdown, [class*="markdown"]');
      if (md) content = md;
    } catch (e) {}
    var structured = false;
    try { structured = !!(content.querySelector && content.querySelector('pre, table, ul, ol, blockquote, h1, h2, h3, h4, h5, h6')); } catch (e) {}
    if (!structured) return plainTextOf(content, skip);

    function skip(el) {
      var tag = (el.tagName || '').toLowerCase();
      if (MD_SKIP_TAGS[tag]) return true;
      if (el.getAttribute && (el.getAttribute('aria-hidden') === 'true' || el.getAttribute('role') === 'button')) return true;
      // 公式的三层渲染里，可见层和无障碍层都是重复内容，只留 mathMd() 输出的那份
      var cls = '';
      try { cls = String(el.className || ''); } catch (e) {}
      if (/katex-html|katex-mathml|mjx-assistive-mml|MathJax_Preview/.test(cls)) return true;
      // 代码块的语言标签（"python" 这类）：紧跟着一个 <pre> 的纯文本小块，跳过不写进正文
      try {
        var txt = String(el.textContent || '').trim();
        var next = el.nextElementSibling;
        if (txt && txt.length <= 12 && LANG_RE.test(txt) && next && next.tagName && next.tagName.toLowerCase() === 'pre') return true;
      } catch (e) {}
      return false;
    }

    function inline(el) {
      var s = '';
      var kids = el.childNodes;
      for (var i = 0; i < kids.length; i++) {
        var n = kids[i];
        if (n.nodeType === 3) {
          var s0 = String(n.nodeValue || '');
          s += stripPanelJson(s0).replace(/\u00a0/g, ' ').replace(ZW_RE, '');
          continue;
        }
        if (n.nodeType !== 1) continue;
        if (isMathEl(n)) { s += mathMd(n); continue; }
        if (skip(n)) continue;
        var tag = n.tagName.toLowerCase();
        if (tag === 'br') { s += '\n'; continue; }
        if (tag === 'pre') { s += block(n); continue; }
        if (tag === 'table') { s += block(n); continue; }
        if (tag === 'ul' || tag === 'ol') { s += block(n); continue; }
        if (tag === 'code') { s += '`' + (n.textContent || '').trim() + '`'; continue; }
        if (tag === 'strong' || tag === 'b') { s += '**' + inline(n).trim() + '**'; continue; }
        if (tag === 'em' || tag === 'i') { s += '*' + inline(n).trim() + '*'; continue; }
        if (tag === 'a') {
          var href = n.getAttribute('href') || '';
          var t = inline(n).trim();
          s += href ? ('[' + t + '](' + href + ')') : t;
          continue;
        }
        if (tag === 'img') {
          var src = n.currentSrc || n.getAttribute('src') || n.getAttribute('data-src') || '';
          if (!src) {
            var ss2 = n.getAttribute('srcset') || n.getAttribute('data-srcset') || '';
            if (ss2) src = ss2.split(',')[0].trim().split(/\s+/)[0];
          }
          var alt = n.getAttribute('alt') || '';
          if (!alt || looksLikePanelJson(alt)) alt = '图片';
          s += src ? ('![' + alt + '](' + src + ')') : '［图片］';
          continue;
        }
        s += inline(n);
      }
      return s;
    }

    function tableMd(tbl) {
      var rows = tbl.querySelectorAll('tr');
      var out = [];
      for (var r = 0; r < rows.length; r++) {
        var cells = rows[r].querySelectorAll('th, td');
        if (!cells.length) continue;
        var line = [];
        for (var c = 0; c < cells.length; c++) {
          line.push(inline(cells[c]).replace(/\n+/g, ' ').replace(/\|/g, '\\|').trim());
        }
        out.push('| ' + line.join(' | ') + ' |');
        if (r === 0 || !out.some(function (x) { return /^\|\s*---/.test(x); })) {
          var sep = [];
          for (var k = 0; k < cells.length; k++) sep.push('---');
          if (r === 0) out.push('| ' + sep.join(' | ') + ' |');
        }
      }
      return '\n' + out.join('\n') + '\n';
    }

    function listMd(list, depth) {
      var out = [];
      var idx = 1;
      var direct = list.children;
      for (var i = 0; i < direct.length; i++) {
        var li = direct[i];
        if (!li.tagName || li.tagName.toLowerCase() !== 'li') continue;
        var clone = li.cloneNode(true);
        var subs = clone.querySelectorAll('ul, ol');
        var nested = [];
        for (var s = 0; s < subs.length; s++) { nested.push(block(subs[s], depth + 1)); subs[s].parentNode.removeChild(subs[s]); }
        var marker = (list.tagName.toLowerCase() === 'ol') ? (idx++ + '. ') : '- ';
        out.push('  '.repeat(depth) + marker + inline(clone).replace(/\n+/g, ' ').trim());
        for (var n = 0; n < nested.length; n++) out.push(nested[n]);
      }
      return '\n' + out.join('\n') + '\n';
    }

    function codeBlock(pre) {
      var codeEl = pre.querySelector('code') || pre;
      var code = String(codeEl.textContent || '').replace(/\n+$/, '');
      var lang = '';
      try {
        // 语言名可能在：pre 的前一个兄弟节点 / pre 所在包装容器里 pre 之前的节点 / 再上一层
        var candidates = [];
        if (pre.previousElementSibling) candidates.push(pre.previousElementSibling);
        var wrap = pre.parentElement;
        if (wrap) {
          if (wrap.previousElementSibling) candidates.push(wrap.previousElementSibling);
          var kids = wrap.children || [];
          for (var i = 0; i < kids.length; i++) {
            if (kids[i] === pre) break;
            candidates.push(kids[i]);
          }
        }
        for (var c = 0; c < candidates.length && !lang; c++) {
          var t = String(candidates[c].textContent || '').trim();
          var m = t.match(LANG_RE);
          if (m) lang = m[1].toLowerCase();
        }
        // 有的版本语言名在 pre 内部第一行
        if (!lang) {
          var first = (code.split('\n')[0] || '').trim();
          var m2 = first.match(/^[a-z+#]{2,12}$/i);
          if (m2 && first.length <= 12) { lang = first.toLowerCase(); code = code.split('\n').slice(1).join('\n'); }
        }
      } catch (e) {}
      return '\n```' + lang + '\n' + code + '\n```\n';
    }

    function block(el, depth) {
      depth = depth || 0;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'pre') return codeBlock(el);
      if (tag === 'table') return tableMd(el);
      if (tag === 'ul' || tag === 'ol') return listMd(el, depth);
      // 标题：面板渲染成 <h2>/<h3>，以前只导出纯文字，标题层级全丢了
      if (/^h[1-6]$/.test(tag)) return '\n' + '######'.slice(0, Number(tag.charAt(1))) + ' ' + inline(el).replace(/\n+/g, ' ').trim() + '\n';
      if (tag === 'blockquote') return '\n> ' + inline(el).trim().split('\n').join('\n> ') + '\n';
      if (tag === 'hr') return '\n---\n';
      return inline(el);
    }

    var buf = [];
    var top = content.children;
    for (var i = 0; i < top.length; i++) {
      if (skip(top[i])) continue;
      var tag = top[i].tagName ? top[i].tagName.toLowerCase() : '';
      if (tag === 'pre' || tag === 'table' || tag === 'ul' || tag === 'ol' ||
          tag === 'blockquote' || tag === 'hr' || /^h[1-6]$/.test(tag)) buf.push(block(top[i]));
      else buf.push(inline(top[i]));
    }
    var text = tidyMarkdown(buf.join('\n\n'));
    return text || plainTextOf(content, skip);
  }

  function fp(m) {
    if (m.__fp) return m.__fp;
    m.__fp = m.role + '#' + m.text.length + '#' + m.text.slice(0, 60) + '#' + m.text.slice(-30);
    return m.__fp;
  }

  // 新快照并入累积结果：优先按"快照尾部=累积头部"（向上滚）或"快照头部=累积尾部"（向下滚）对齐
  function mergeSnapshot(acc, snap, diag) {
    if (!snap || !snap.length) return 0;
    if (!acc.length) {
      for (var i0 = 0; i0 < snap.length; i0++) acc.push(snap[i0]);
      return snap.length;
    }
    var maxK = Math.min(acc.length, snap.length);
    var upK = 0, downK = 0;
    for (var k = maxK; k >= 1; k--) {
      var okUp = true;
      for (var i = 0; i < k; i++) {
        if (fp(acc[i]) !== fp(snap[snap.length - k + i])) { okUp = false; break; }
      }
      if (okUp) { upK = k; break; }
    }
    for (var k2 = maxK; k2 >= 1; k2--) {
      var okDown = true;
      for (var j = 0; j < k2; j++) {
        if (fp(snap[j]) !== fp(acc[acc.length - k2 + j])) { okDown = false; break; }
      }
      if (okDown) { downK = k2; break; }
    }
    var added = 0;
    if (upK >= downK && upK > 0) {
      var head = snap.slice(0, snap.length - upK);
      for (var h = head.length - 1; h >= 0; h--) acc.unshift(head[h]);
      added = head.length;
    } else if (downK > 0) {
      var tail = snap.slice(downK);
      for (var t = 0; t < tail.length; t++) acc.push(tail[t]);
      added = tail.length;
    } else {
      if (diag) diag.noOverlap = (diag.noOverlap || 0) + 1;
      for (var s = 0; s < snap.length; s++) {
        var seenThis = false;
        for (var a2 = 0; a2 < acc.length; a2++) { if (fp(acc[a2]) === fp(snap[s])) { seenThis = true; break; } }
        if (!seenThis) { acc.push(snap[s]); added++; }
      }
    }
    return added;
  }

  // 打开会话 → 展开折叠 → 逐屏向上滚动累积到底
  // 页面抓取（展开折叠 + 逐屏累积）
  async function captureByDom(conv, apiCount) {
    var d = { id: conv.id, title: conv.title, expandClicks: 0, rounds: 0, added: 0, noOverlap: 0, stop: 'unknown', msgs: 0 };
    var link = await findLink(conv);
    if (!link) { d.stop = 'link-not-found'; return { ok: false, diag: d }; }
    link.click();
    if (!(await waitStable(conv.id, 60000))) { d.stop = 'load-timeout'; return { ok: false, diag: d }; }

    var t0 = Date.now();
    var deadline = t0 + (state.budgetSec || 300) * 1000;
    state.deadFoldEls = [];
    d.expectedRounds = foldRoundsLeft().max;   // 展开前先记住面板标的"共 N 轮"
    state.hbRounds = d.expectedRounds;
    hb('已打开会话，面板标 ' + d.expectedRounds + ' 轮');

    // 接口已经给全了这一条（接口条数 ≥ 面板标的轮数×2）**且页面上已经没有折叠块**→ 只做一次快照
    // 注意：如果页面上还留着折叠块，说明接口那份可能缺东西，必须继续展开（v3.19 修的坑）
    var boxesAtOpen = foldRoundsLeft().boxes;
    if (apiCount && d.expectedRounds && boxesAtOpen === 0 && apiCount >= d.expectedRounds * 2 * 0.9) {
      var quick = snapshotMessages();
      hb('接口已覆盖全部内容且无残留折叠，跳过分折叠加滚动（快照 ' + quick.length + ' 条）');
      d.stop = 'api-covers';
      d.quickSnapshot = quick.length;
      d.msgs = quick.length;
      d.foldLeftBoxes = foldRoundsLeft().boxes;
      d.notAtTop = false;
      d.expectedMsgs = d.expectedRounds * 2;
      return { ok: true, msgs: quick, diag: d };
    }

    if (IS_PRO) {
      d.expandClicks += await expandCollapsed(d, deadline);
    } else {
      d.freeNoFold = true;          // 免费版：不展开被折叠的历史轮次
    }

    var acc = [];
    d.added += mergeSnapshot(acc, snapshotMessages(), d);
    var scroller = msgScroller();
    var flat = 0;

    // 完整性自检：面板自己标着"共 N 轮"就说明还有折叠没展开，继续点
    var roundsInfo = foldRoundsLeft();
    var passes = 0;
    while (IS_PRO && roundsInfo.boxes > 0 && passes < 4 && !state.cancelled && Date.now() < deadline) {
      passes++;
      state.deadFoldEls = [];
      d.expandClicks += await expandCollapsed(d, deadline);
      d.added += mergeSnapshot(acc, snapshotMessages(), d);
      roundsInfo = foldRoundsLeft();
      if (!roundsInfo.boxes) break;
      if (acc.length >= roundsInfo.max * 2) break;
      await sleep(1200);
    }
    d.passes = passes;

    var minTop = scroller ? (scroller.scrollTop || 0) : 0;
    for (var step = 0; step < 120; step++) {
      if (state.cancelled) break;
      if (Date.now() > deadline) { d.stop = 'time-budget'; break; }
      var sigBefore = contentSig();
      if (IS_PRO) d.expandClicks += await expandCollapsed(d, deadline);
      var before = scroller ? (scroller.scrollTop || 0) : 0;
      if (scroller) {
        var stepPx = Math.round((scroller.clientHeight || 500) * 0.8);
        var want = Math.max(0, before - stepPx);
        scroller.scrollTop = want;
        if ((scroller.scrollTop || 0) === before && before > 0) {
          // 这个容器滚不动：换姿势（scrollTo / 把最上面那条消息滚进视野 / 往上找真正的滚动口）
          try { scroller.scrollTo({ top: want, behavior: 'auto' }); } catch (e) {}
          if ((scroller.scrollTop || 0) === before) {
            var fm = document.querySelector(MSG_SEL);
            if (fm) { try { fm.scrollIntoView({ block: 'start' }); } catch (e) {} }
            var ps = scroller.parentElement;
            while (ps && ps !== document.body) {
              if ((ps.scrollHeight || 0) > (ps.clientHeight || 0) + 20) {
                ps.scrollTop = Math.max(0, (ps.scrollTop || 0) - stepPx);
                if ((ps.scrollTop || 0) !== before) { scroller = ps; break; }
              }
              ps = ps.parentElement;
            }
          }
        }
        var nowTop = scroller.scrollTop || 0;
        if (nowTop < minTop) minTop = nowTop;
      }
      wheelUp(scroller);
      await sleep(900);
      d.rounds++;
      state.hbSteps = d.rounds;
      if (d.rounds % 5 === 0) {
        hb('向上滚动累积中', '第 ' + d.rounds + ' 轮，当前累计 ' + acc.length + ' 条');
        try { ui.status('处理中：' + (state.hbTitle || '') + '\n滚动第 ' + d.rounds + ' 轮，已收 ' + acc.length + ' 条，已用 ' + Math.round((Date.now() - state.hbStart) / 1000) + ' 秒'); } catch (e) {}
      }
      var grew = mergeSnapshot(acc, snapshotMessages(), d);
      d.added += grew;
      var candsLeft = foldCandidates().length;
      d.foldLeft = candsLeft;
      var atTop = !scroller || (scroller.scrollTop || 0) <= 2;
      var progressed = (grew > 0) || (contentSig() !== sigBefore);
      if (progressed) { flat = 0; } else { flat++; }
      if (atTop && flat >= 3 && candsLeft === 0) { d.stop = 'top-ok'; break; }
      if (flat >= 6) { d.stop = 'flat-6'; break; }
    }
    d.minScrollTop = minTop;
    d.notAtTop = !!(scroller && (scroller.scrollTop || 0) > 2);
    if (d.stop === 'unknown') d.stop = 'max-steps';
    if (IS_PRO) d.expandClicks += await expandCollapsed(d, Date.now() + 30000);
    d.added += mergeSnapshot(acc, snapshotMessages(), d);
    // 触发懒加载：滚到底再滚到顶，让图片真正加载出来，然后重新采集图片地址
    try {
      var sc2 = msgScroller();
      for (var lp = 0; lp < 2; lp++) {
        try { sc2.scrollTop = sc2.scrollHeight; } catch (e) {}
        await sleep(700);
        try { sc2.scrollTop = 0; } catch (e) {}
        await sleep(700);
      }
      harvestDomImagesInto(state.pendingImages, null);
    } catch (e) {}
    var leftInfo = foldRoundsLeft();
    d.foldLeftBoxes = leftInfo.boxes;
    d.foldLeftRounds = leftInfo.max;
    d.expectedMsgs = (d.expectedRounds || 0) * 2;
    d.incomplete = !!(leftInfo.boxes > 0 ||
      (d.expectedMsgs > 0 && acc.length < d.expectedMsgs * 0.75) ||
      d.notAtTop);
    d.msgs = acc.length;
    return { ok: acc.length > 0, msgs: acc, diag: d };
  }

  function totalChars(msgs) {
    var n = 0;
    for (var i = 0; i < (msgs || []).length; i++) n += (msgs[i].text || '').length;
    return n;
  }

  // 消息正文里常常夹着图片指针的原始 JSON（面板把图片当文本存了），
  // 这里把它们抽出来变成可读占位，并把指针收进图片清单。
  function harvestImagePointers(msgs) {
    var found = [];
    var re = /"asset_pointer"\s*:\s*"file-service:\/\/([^"]+)"/g;
    for (var i = 0; i < (msgs || []).length; i++) {
      var t = msgs[i].text || '';
      if (t.indexOf('asset_pointer') < 0) continue;
      var m;
      re.lastIndex = 0;
      while ((m = re.exec(t)) !== null) {
        var ptr = 'file-service://' + m[1];
        if (found.indexOf(ptr) < 0) found.push(ptr);
      }
      // 把整段 JSON 换成可读占位（保留图片 id，读起来清爽）
      msgs[i].text = t.replace(/\{"asset_pointer"[\s\S]{0,600}?\}\s*/g, function (blk) {
        var idm = blk.match(/file-service:\/\/([^"]+)/);
        return idm ? ('［图片 ' + idm[1] + '］\n') : '［图片］\n';
      });
      msgs[i].__fp = null;   // 文本变了，指纹缓存作废
    }
    return found;
  }

  function msgKey(t) {
    var p = proseOf(t);
    // 只留汉字/字母/数字：公式在两份来源里写法完全不同（接口 \[…\]、页面排版结果），
    // 拿原始前 50 字做指纹，撞上公式就会被误判成"新消息"，整段抄到文末附录
    if (p.length >= 4) return p.slice(0, 20);
    return String(t || '').replace(/\s+/g, '').slice(0, 50);
  }

  function proseOf(t) {
    var m = String(t == null ? '' : t).match(/[\u4e00-\u9fa5\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7afA-Za-z0-9]/g);
    return m ? m.join('') : '';
  }

  // 另一个来源里"这边没有"的消息（按内容指纹判断，避免重复）
  function unionExtra(chosen, other) {
    var have = {};
    var clean = [];
    for (var i = 0; i < chosen.length; i++) {
      have[msgKey(chosen[i].text)] = 1;
      clean.push(proseOf(chosen[i].text));
    }
    var extra = [];
    for (var j = 0; j < (other || []).length; j++) {
      var k = msgKey(other[j].text);
      if (!k || have[k]) continue;
      var contained = false;
      for (var c = 0; c < clean.length; c++) {
        if (clean[c] === k) { contained = true; break; }
        if (k.length >= 8 && clean[c].indexOf(k) >= 0) { contained = true; break; }
      }
      if (contained) continue;
      have[k] = 1;
      extra.push(other[j]);
    }
    return extra;
  }

  // 两个来源都抓，取内容更全的那个，并把另一边的独有消息附在后面
  async function captureConversation(conv) {
    var d = { id: conv.id, title: conv.title, expandClicks: 0, rounds: 0, added: 0, noOverlap: 0, stop: 'unknown', msgs: 0, apiMsgs: 0, domMsgs: 0, source: '', images: [] };
    state.pendingImages = [];
    state.hbStart = Date.now();
    state.hbStartText = new Date().toLocaleTimeString();
    state.hbTitle = conv.title;
    state.hbId = conv.id;
    state.hbClicks = 0;
    state.hbSteps = 0;
    state.hbRounds = 0;
    state.hbApi = 0;
    hb('开始处理（请求后端接口）');
    var apiMsgs = null;
    var apiImages = [];
    try {
      var apiRes = await apiConversation(conv.id);
      if (apiRes) {
        apiMsgs = apiRes.msgs; apiImages = apiRes.images || [];
        // 详情接口也带更新时间：列表接口没给时靠它兜住
        if (apiRes.update_time) { conv.update_time = apiRes.update_time; d.remoteTimeFrom = 'detail'; }
        if (apiRes.create_time && !conv.create_time) conv.create_time = apiRes.create_time;
      }
    } catch (e) {}
    d.remoteUpdate = conv.update_time || 0;
    d.apiMsgs = apiMsgs ? apiMsgs.length : 0;
    d.apiChars = apiMsgs ? totalChars(apiMsgs) : 0;
    state.hbApi = d.apiMsgs;
    hb('接口返回 ' + d.apiMsgs + ' 条（接着打开页面核对/兜底）');

    var domMsgs = null;
    try {
        var domRes = await captureByDom(conv, d.apiMsgs);
      if (domRes && domRes.ok) {
        domMsgs = domRes.msgs;
        var dd = domRes.diag || {};
        d.expandClicks = dd.expandClicks || 0;
        d.rounds = dd.rounds || 0;
        d.added = dd.added || 0;
        d.noOverlap = dd.noOverlap || 0;
        d.stop = dd.stop || 'unknown';
        d.foldLabels = dd.foldLabels;
        d.foldDead = dd.foldDead;
        d.foldLeft = dd.foldLeft;
        d.expectedRounds = dd.expectedRounds;
        d.passes = dd.passes;
        d.incomplete = dd.incomplete;
        d.foldLeftBoxes = dd.foldLeftBoxes;
        d.expectedMsgs = dd.expectedMsgs;
        d.notAtTop = dd.notAtTop;
        d.minScrollTop = dd.minScrollTop;
      } else {
        d.domStop = (domRes && domRes.diag && domRes.diag.stop) || 'dom-failed';
      }
    } catch (e) {
      d.domStop = 'dom-error: ' + ((e && e.message) || e);
    }
    d.domMsgs = domMsgs ? domMsgs.length : 0;
    d.domChars = domMsgs ? totalChars(domMsgs) : 0;
    // 把 DOM 抓取过程中攒下的图片指针合并进来（所有分支都受益）
    d.images = d.images || [];
    try {
      if (state.pendingImages && state.pendingImages.length) {
        for (var pk = 0; pk < state.pendingImages.length; pk++) {
          if (d.images.indexOf(state.pendingImages[pk]) < 0) d.images.push(state.pendingImages[pk]);
        }
      }
    } catch (e) { d.imageMergeError = String((e && e.message) || e); }
    // 页面上的图片地址也收进来（接口里可能没有）
    try {
      var domImgs = harvestDomImages();
      for (var di = 0; di < domImgs.length; di++) {
        if (d.images.indexOf(domImgs[di]) < 0) d.images.push(domImgs[di]);
      }
      d.domImages = domImgs.length;
    } catch (e) { d.imageHarvestError = String((e && e.message) || e); }

    for (var ai2 = 0; ai2 < apiImages.length; ai2++) {
      if (d.images.indexOf(apiImages[ai2]) < 0) d.images.push(apiImages[ai2]);
    }
    if (!apiMsgs && !domMsgs) {
      d.emptyConversation = true;      // 接口和页面都拿不到消息 → 空会话（不算失败）
      return { ok: false, empty: true, diag: d };
    }
    if (apiMsgs && !domMsgs) {
      d.source = 'api';
      d.msgs = apiMsgs.length;
      d.incomplete = !!(d.expectedRounds && apiMsgs.length < d.expectedRounds * 2 * 0.75);
      return { ok: true, msgs: apiMsgs, extra: [], images: d.images, diag: d };
    }
    if (!apiMsgs && domMsgs) {
      d.source = 'dom';
      d.msgs = domMsgs.length;
      return { ok: true, msgs: domMsgs, extra: [], images: d.images, diag: d };
    }

    var chosen, other, source;
    // v3.28：接口那份是"原始 Markdown"（公式是 LaTeX 原文），页面那份是渲染后的近似文本
    // （面板的 KaTeX 只输出 HTML，拿不到公式源）。所以只要接口那份基本覆盖得住，就用接口的，
    // 页面那份只用来补接口没有的消息；只有接口明显残缺时才退回页面版。
    var expectedTotal2 = (d.expectedRounds || 0) * 2;
    var apiCovers = apiMsgs.length >= Math.max(4, domMsgs.length * 0.9) ||
      (expectedTotal2 > 0 && apiMsgs.length >= expectedTotal2 * 0.9);
    if (apiCovers || d.apiChars > d.domChars) { chosen = apiMsgs; other = domMsgs; source = 'api'; }
    else { chosen = domMsgs; other = apiMsgs; source = 'dom'; }
    var extra = unionExtra(chosen, other);
    d.extraFrom = extra.length ? (source === 'api' ? 'dom' : 'api') : '';
    conv.extraFrom = d.extraFrom;
    // 图片：结构化 part 里没抓到的，再从正文文本里捞一遍（面板常把图片存成文本 JSON）
    var extraImgs = harvestImagePointers(chosen).concat(harvestImagePointers(extra));
    for (var ii = 0; ii < extraImgs.length; ii++) {
      if (d.images.indexOf(extraImgs[ii]) < 0) d.images.push(extraImgs[ii]);
    }
    d.source = source;
    d.extraMsgs = extra.length;
    d.msgs = chosen.length + extra.length;
    // 最终完整性判定（v3.20 收紧，避免短会话误报）：
    //   只有"面板自己标了还有 N 轮折叠、而实际条数明显不够"才算不完整；
    //   "没滚到顶"这条去掉——短会话里滚动容器根本不会归零，全是误报。
    var expectedTotal = (d.expectedRounds || 0) * 2;
    d.incomplete = !!(
      (expectedTotal > 0 && d.msgs < expectedTotal * 0.75) ||
      (d.foldLeftBoxes > 0 && expectedTotal > 0 && d.msgs < expectedTotal)
    );
    return { ok: chosen.length > 0, msgs: chosen, extra: extra, images: d.images, diag: d };
  }

  function sessionKicked() {
    var t = (document.body && document.body.innerText) || '';
    return /登录失效|请重新登录|其他地方登录|号池重进/.test(t);
  }

  async function domExport() {
    var convs = state.convs;
    state.diag = [];
    for (var idx = 0; idx < convs.length; idx++) {
      if (state.cancelled) break;
      if (state.aborted) break;
      var conv = convs[idx];
      ui.progress(idx + 1, convs.length, '页面抓取 ' + (conv.title || ''));
      var res = null;
      try {
        res = await captureConversation(conv);
      } catch (e) {
        res = { ok: false, diag: { id: conv.id, title: conv.title, stop: 'exception: ' + ((e && e.message) || e) } };
      }
      // 抓完自检发现"不完整"（还有残留折叠 / 没滚到顶 / 条数明显少于面板标的轮数）→ 立刻补抓一次
      if (res && res.ok && res.diag && res.diag.incomplete && !state.cancelled && !state.aborted) {
        ui.progress(idx + 1, convs.length, '补抓 ' + (conv.title || ''));
        var retryRes = null;
        try { retryRes = await captureConversation(conv); } catch (e2) {}
        if (retryRes && retryRes.ok &&
            (totalChars(retryRes.msgs) + totalChars(retryRes.extra || [])) >
            (totalChars(res.msgs) + totalChars(res.extra || []))) {
          res = retryRes;
          if (res.diag) res.diag.retried = 'improved';
        } else if (res.diag) {
          res.diag.retried = 'no-improve';
        }
      }
      state.diag.push((res && res.diag) || { id: conv.id, title: conv.title, stop: 'no-diag' });
      if (idx % 3 === 0) await flushDiag(convs.length + (state.skippedCount || 0), 'dom');
      if (res && res.ok) {
        state.results.push({ id: conv.id, title: conv.title, messages: res.msgs });
        hb('正在写文件', (res.diag && res.diag.source ? '来源 ' + res.diag.source + '，' : '') + '共 ' + res.msgs.length + ' 条');
        await writeMd(conv, res.msgs, res.extra, res.images);
        if (!state.doneNew) { state.doneNew = {}; state.doneNewList = []; }
        if (!state.doneNew[conv.id]) { state.doneNew[conv.id] = 1; state.doneNewList.push(conv.id); }
        if (state.dirHandle && state.doneNewList.length % 1 === 0) {
          try { await writeFile(state.dirHandle, '_已完成清单.txt', state.doneNewList.join('\n')); } catch (e) {}
        }
        // 台账每 5 条写一次：中途停掉也不会把"更新时间"的账丢掉
        if (state.dirHandle && state.results.length % 5 === 0) {
          try { await writeLedger(); } catch (e) {}
        }
      } else {
        if (sessionKicked()) {
          state.aborted = '检测到登录失效，请重新登录后再运行（已导出的会自动跳过）。';
          break;
        }
        if (res && res.empty) {
          // 接口和页面都没有消息 → 空会话，单独记一份，不算失败
          if (!state.emptyList) state.emptyList = [];
          state.emptyList.push({ id: conv.id, title: conv.title });
          if (state.dirHandle) {
            try {
              await writeFile(state.dirHandle, '_空会话清单.txt',
                state.emptyList.map(function (x) { return x.id + '\t' + x.title; }).join('\n'));
            } catch (e) {}
          }
        } else {
        state.failed.push({ id: conv.id, title: conv.title, reason: '没有抓到内容' });
        }
      }
      // 每条之间的间隔（可在设置里调，默认 300ms）
      var gap = (state.opts && state.opts.intervalMs) || 0;
      if (gap > 0 && idx < convs.length - 1) await sleep(gap);
    }
  }

  function tailTextFrom(msgs) {
    return msgs.length ? (msgs[msgs.length - 1].text || '') : '';
  }

  // ================= 6.5 本地桥接（可选的直写磁盘通道） =================
  // 本机若在跑 aizex_bridge_server.js（127.0.0.1:8787），
  // 这里会伪造一个"文件夹句柄"，让下面的保存逻辑原样复用，
  // 但实际写盘由本机 Node 进程完成：不需要选文件夹、不受浏览器授权影响。
  var BRIDGE_BASE = 'http://127.0.0.1:8787';

  function bridgeFetch(pathname, opts) {
    var init = opts || {};
    init.cache = 'no-store';
    return fetch(BRIDGE_BASE + pathname, init);
  }

  async function bridgeProbe() {
    try {
      var ctl = ('AbortController' in window) ? new AbortController() : null;
      var init = { cache: 'no-store' };
      if (ctl) init.signal = ctl.signal;
      var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 2500);
      var res = await fetch(BRIDGE_BASE + '/status', init);
      clearTimeout(timer);
      if (!res.ok) return null;
      var info = await res.json();
      if (!info || !info.ok) return null;
      return info;
    } catch (e) {
      return null;
    }
  }

  function makeBridgeDirHandle() {
    function handleFor(name) {
      return {
        kind: 'file',
        name: name,
        getFile: async function () {
          var res = await bridgeFetch('/file/' + encodeURIComponent(name));
          if (!res.ok) throw new Error('bridge read failed: ' + name + ' ' + res.status);
          var text = await res.text();
          return { name: name, text: async function () { return text; } };
        },
        createWritable: async function () {
          var parts = [];
          return {
            write: async function (chunk) { parts.push(String(chunk)); },
            close: async function () {
              var body = parts.join('');
              var res = await bridgeFetch('/file/' + encodeURIComponent(name), {
                method: 'PUT',
                headers: { 'content-type': 'text/plain;charset=utf-8' },
                body: body
              });
              if (!res.ok) throw new Error('bridge write failed: ' + name + ' ' + res.status);
            }
          };
        }
      };
    }

    return {
      __bridge: true,
      getFileHandle: function (name) { return Promise.resolve(handleFor(name)); },
      values: function () {
        var names = (state.bridgeInfo && state.bridgeInfo.names) || [];
        var i = 0;
        return {
          next: function () {
            if (i >= names.length) return Promise.resolve({ done: true, value: undefined });
            return Promise.resolve({ done: false, value: handleFor(names[i++]) });
          },
          'return': function () { return Promise.resolve({ done: true, value: undefined }); },
          [Symbol.asyncIterator]: function () { return this; }
        };
      }
    };
  }

  // ================= 7. 保存与合并 =================
  // ---------- 实时心跳：把"正在处理哪条、进行到哪一步"写到 _正在处理.txt ----------
  function hb(stage, extra) {
    if (!state.dirHandle) return;
    var elapsed = state.hbStart ? Math.round((Date.now() - state.hbStart) / 1000) : 0;
    var text = [
      '时间: ' + new Date().toLocaleString(),
      '会话: ' + (state.hbTitle || '-') + ' (' + String(state.hbId || '-').slice(0, 8) + ')',
      '本条开始: ' + (state.hbStartText || '-') + '（已 ' + elapsed + ' 秒）',
      '阶段: ' + stage,
      '接口条数: ' + (state.hbApi || 0),
      '面板标的轮数: ' + (state.hbRounds || 0),
      '展开点击: ' + (state.hbClicks || 0),
      '面板剩余轮数: ' + (state.hbLeft === undefined ? '-' : state.hbLeft),
      '滚动轮次: ' + (state.hbSteps || 0),
      '整体进度: 已完成 ' + ((state.doneNewList || []).length) + ' 条',
      '备注: ' + (extra || '')
    ].join('\n');
    try {
      state.dirHandle.getFileHandle('_正在处理.txt', { create: true })
        .then(function (fh) { return fh.createWritable(); })
        .then(function (w) { return w.write(text).then(function () { return w.close(); }); })
        .catch(function () {});
    } catch (e) {}
  }

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

  function toMarkdown(conv, msgs, index, extra, att) {
    var lines = [];
    lines.push('# ' + (conv.title || '(无标题)'));
    lines.push('');
    lines.push('> 来源面板: ' + location.host);
    lines.push('> 会话 ID: ' + conv.id);
    lines.push('> 序号: ' + index);
    lines.push('> 抓取机制: new');   // 标记"已用新机制（折叠全展开/接口双源）抓过"，断点续跑靠它
    lines.push('> 保真度: md-v7');    // 公式以接口原文为准 + 附件就地标注（v3.33 起）
    if (conv.update_time) lines.push('> 最后更新: ' + fmtLocalTime(toEpochMs(conv.update_time)));
    else if (conv.panelTimeText) lines.push('> 面板显示更新: ' + conv.panelTimeText);
    if (att && att.total) lines.push('> 附件: ' + att.total + ' 个（已就地标在对应消息里）');
    lines.push('');
    for (var i = 0; i < msgs.length; i++) {
      var m = msgs[i];
      lines.push(m.role === 'user' ? '## 用户' : '## AI');
      lines.push('');
      lines.push(resolveAttachments(m.text || '(空)', att).trim());
      lines.push('');
    }
    if (extra && extra.length) {
      lines.push('---');
      lines.push('');
      var fromLabel = (conv.extraFrom === 'dom') ? '页面' : (conv.extraFrom === 'api' ? '接口' : '');
      lines.push('## 附：另一来源里独有的消息（共 ' + extra.length + ' 条' + (fromLabel ? '，只有' + fromLabel + '版' : '') + '）');
      lines.push('');
      if (conv.extraFrom === 'dom') {
        lines.push('> 这一节是接口那份缺、只有页面版才有的内容。页面版拿不到公式原文（面板的 KaTeX 只输出 HTML），');
        lines.push('> 所以这里的公式保留的是页面上的排版结果，不是 LaTeX 原文。');
        lines.push('');
      }
      for (var j = 0; j < extra.length; j++) {
        lines.push(extra[j].role === 'user' ? '### 用户' : '### AI');
        lines.push('');
        lines.push(resolveAttachments(extra[j].text || '(空)', att).trim());
        lines.push('');
      }
    }
    // 只有"没能在正文里标到"的图片才进文末附录（比如从页面上顺手捞到的地址）
    var leftAtt = [];
    if (att && att.order) {
      for (var a2 = 0; a2 < att.order.length; a2++) {
        if (!(att.used && att.used[att.order[a2].key])) leftAtt.push(att.order[a2]);
      }
    }
    if (leftAtt.length) {
      lines.push('---');
      lines.push('');
      lines.push('## 附：本会话涉及的图片（正文里没定位到的 ' + leftAtt.length + ' 个）');
      lines.push('');
      for (var k = 0; k < leftAtt.length; k++) lines.push(leftAtt[k].line);
      lines.push('');
    }
    return lines.join('\n');
  }

  async function writeMd(conv, msgs, extra, images) {
    if (!state.dirHandle) return;
    try {
      var id8 = String(conv.id).slice(0, 8).toLowerCase();
      var existing = (state.idFileMap && state.idFileMap[id8]) || [];
      // 同一会话只留一份：如果之前已按别的标题存过，就沿用那个文件名，不再新建
      var name = existing.length ? existing[0] : safeFileName(conv.title, conv.id);
      // 附件：先按正文里的占位符收集文件名提示，再把图片下下来，最后就地标注
      var att = await collectImages(conv, images || [], nameHintsFromMsgs((msgs || []).concat(extra || [])));
      var content = toMarkdown(conv, msgs, state.results.length, extra, att);
      // 保护：新抓到的内容明显比已有文件少时，保留已有文件（不覆盖）
      try {
        var fh = await state.dirHandle.getFileHandle(name);
        var oldText = await (await fh.getFile()).text();
        var oldChars = oldText.replace(/\s+/g, '').length;
        var newChars = content.replace(/\s+/g, '').length;
        var oldVer = (oldText.match(/^>\s*保真度:\s*(md-v\d+)/m) || [])[1] || '';
        // 不是当前格式的一律允许覆盖（哪怕字数少）—— 公式去重后正文本来就变短，这是格式升级
        var upgrading = oldVer !== 'md-v7';
        if (!upgrading && oldChars > newChars) {
          state.keptOld = (state.keptOld || 0) + 1;
          state.lastKeepOld = { oldChars: oldChars, newChars: newChars };
          return 'kept';
        }
      } catch (e) {}
      await writeFile(state.dirHandle, name, content);
      ledgerTouch(conv, { msgs: msgs.length, chars: content.length, file: name });
      // 把同一会话的重复文件挪进 _duplicates/（不删除，可恢复）
      if (existing.length > 1 && state.dirHandle) {
        try {
          var dupDir = await state.dirHandle.getDirectoryHandle('_duplicates', { create: true });
          for (var dq = 1; dq < existing.length; dq++) {
            var srcName = existing[dq];
            if (srcName === name) continue;
            try {
              var fhS = await state.dirHandle.getFileHandle(srcName);
              var txtS = await (await fhS.getFile()).text();
              var fhD = await dupDir.getFileHandle(srcName, { create: true });
              var wD = await fhD.createWritable();
              await wD.write(txtS);
              await wD.close();
              try { await state.dirHandle.removeEntry(srcName); } catch (e2) {}
              state.deduped = (state.deduped || 0) + 1;
            } catch (e3) {}
          }
        } catch (e4) {}
        state.idFileMap[id8] = [name];
      } else if (!state.idFileMap[id8]) {
        state.idFileMap[id8] = [name];
      }
      return 'written';
    } catch (e) {
      state.failed.push({ id: conv.id, title: conv.title, reason: '写文件失败' });
      return 'error';
    }
  }

  // 图片：先尝试下载到 images/ 子目录，下载不到就只留指针（至少不丢信息）
  // 返回 { total, map, used, order, lines }：map 用来把正文里的占位符就地换成链接，
  // order + used 用来判断哪些图片没能标进正文（只有那些才进文末附录）
  async function collectImages(conv, images, nameHints) {
    var att = { total: 0, map: {}, used: {}, order: [], lines: [] };
    if (!images || !images.length) return att;
    att.total = images.length;
    if (state.opts && state.opts.downloadImages === false) {
      for (var q = 0; q < images.length; q++) {
        var k0 = String(images[q]).replace('file-service://', '');
        var h0 = (nameHints && nameHints[k0]) || '';
        var l0 = '- ［未下载·已在设置里关闭图片下载］`' + (h0 || k0) + '`';
        att.order.push({ key: k0, hint: h0, line: l0 });
        att.lines.push(l0);
      }
      return att;
    }
    var dir = null;
    try { dir = await state.dirHandle.getDirectoryHandle('images', { create: true }); } catch (e) {}
    for (var i = 0; i < images.length; i++) {
      var ptr = images[i];
      var isUrl = /^https?:\/\//i.test(String(ptr));
      var fid = isUrl ? ('url-' + String(ptr).replace(/[^a-z0-9]+/gi, '').slice(-24)) : String(ptr).replace('file-service://', '');
      var saved = '';
      if (dir) {
        if (isUrl) {
          // 页面里直接拿到的图片地址（可能是签名 URL），直接拉
          try {
            var rr = await fetch(ptr, { credentials: 'include' });
            if (rr.ok) saved = await saveImageBlob(dir, fid, await rr.blob(), rr.headers.get('content-type') || '');
          } catch (e) {}
        }
        // 面板/镜像站的文件端点不统一，这里挨个试（哪个通就用哪个）
        var tries = [
          '/backend-api/files/' + encodeURIComponent(fid) + '/download',
          '/backend-api/files/' + encodeURIComponent(fid),
          '/backend-api/files/' + encodeURIComponent(fid) + '/raw',
          '/backend-api/files/' + encodeURIComponent(fid) + '/content'
        ];
        for (var t = 0; t < tries.length && !saved && !isUrl; t++) {
          try {
            var res = await fetch(tries[t], { credentials: 'include' });
            if (!res.ok) continue;
            var ctype = res.headers.get('content-type') || '';
            if (/json/i.test(ctype)) {
              var j = null;
              try { j = await res.json(); } catch (e) { j = null; }
              var url = (j && (j.download_url || j.url || (j.file && j.file.download_url))) || '';
              if (url) {
                var r2 = await fetch(url, { credentials: 'include' });
                if (r2.ok) saved = await saveImageBlob(dir, fid, await r2.blob(), r2.headers.get('content-type') || '');
              }
            } else if (/image|octet-stream/i.test(ctype)) {
              saved = await saveImageBlob(dir, fid, await res.blob(), ctype);
            }
          } catch (e) {}
        }
      }
      att.map[fid] = saved;
      if (!isUrl) att.map[ptr] = saved;
      var hint = (nameHints && nameHints[fid]) || '';
      var line = saved ? ('- ![](' + saved + ')　`' + (hint || fid) + '`')
                       : ('- ［未下载］`' + (hint || fid) + '`（在面板里打开该会话可直接看到图）');
      att.order.push({ key: fid, hint: hint, line: line });
      att.lines.push(line);
      if (saved) { state.imgOk = (state.imgOk || 0) + 1; } else { state.imgFail = (state.imgFail || 0) + 1; }
    }
    return att;
  }

  async function saveImageBlob(dir, fid, blob, ctype) {
    var ext = /png/i.test(ctype) ? 'png' : (/jpe?g/i.test(ctype) ? 'jpg' : (/webp/i.test(ctype) ? 'webp' : 'bin'));
    var fileName = fid + '.' + ext;
    try {
      var fh = await dir.getFileHandle(fileName, { create: true });
      var w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      return 'images/' + fileName;
    } catch (e) { return ''; }
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

  // ================= 更新时间 / 同步台账（v3.27） =================
  // 面板接口给的 update_time 是"秒"（有时是毫秒），统一成毫秒再比
  var LEDGER_FILE = '_同步台账.json';

  function toEpochMs(v) {
    var n = Number(v) || 0;
    if (!n) return 0;
    return n > 1e12 ? n : n * 1000;
  }

  function fmtLocalTime(ms) {
    if (!ms) return '';
    var d = new Date(ms);
    function p(x) { return (x < 10 ? '0' : '') + x; }
    return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + ' ' + p(d.getHours()) + ':' + p(d.getMinutes());
  }

  async function readLedger() {
    if (!state.dirHandle) return {};
    try {
      var fh = await state.dirHandle.getFileHandle(LEDGER_FILE);
      var obj = JSON.parse(await (await fh.getFile()).text());
      return (obj && obj.convs) || {};
    } catch (e) { return {}; }
  }

  // 台账快照（v3.32）：把面板上**每一条**会话的更新时间都记进台账，不只是本次导出的那些。
  // 这样索引能立刻显示所有会话的更新时间，而且中断了也不丢。
  // 注意：已经记过时间、但这轮没导出、且面板时间又变了的——**不动它**，
  // 那是"有更新还没抓"，留着下次继续抓；否则就会把没抓到的更新当成已处理。
  function snapshotLedger(convs) {
    state.ledger = state.ledger || {};
    var nowIso = new Date().toISOString();
    for (var i = 0; i < (convs || []).length; i++) {
      var c = convs[i];
      if (!c || !c.id) continue;
      var rec = state.ledger[c.id];
      if (!rec) {
        state.ledger[c.id] = {
          title: c.title || '',
          updateEpoch: c.update_time || undefined,
          updatedAt: c.update_time ? fmtLocalTime(toEpochMs(c.update_time)) : '',
          panelTimeText: c.panelTimeText || '',
          snapshottedAt: nowIso
        };
        continue;
      }
      if (c.title && !rec.title) rec.title = c.title;
      if (c.panelTimeText && !rec.panelTimeText) rec.panelTimeText = c.panelTimeText;
    }
  }

  // 记下这条会话在面板上的更新时间 + 本次导出结果
  function ledgerTouch(conv, info) {
    if (!conv || !conv.id) return;
    if (!state.ledger) state.ledger = {};
    var rec = state.ledger[conv.id] || {};
    if (conv.title) rec.title = conv.title;
    if (conv.update_time) { rec.updateEpoch = Number(conv.update_time); rec.updatedAt = fmtLocalTime(toEpochMs(conv.update_time)); }
    if (conv.create_time) rec.createEpoch = Number(conv.create_time);
    if (conv.panelTimeText) rec.panelTimeText = conv.panelTimeText;
    if (info) {
      if (info.msgs != null) rec.msgs = info.msgs;
      if (info.chars != null) rec.chars = info.chars;
      if (info.file) rec.file = info.file;
    }
    rec.exportedAt = new Date().toISOString();
    state.ledger[conv.id] = rec;
  }

  // 面板 KaTeX 只有 HTML 渲染、没有 mathml/annotation 层时，页面里就没有公式原文。
  // 这里把几个真实节点的 HTML 存下来，用来研究"从排版结果反推 LaTeX"。
  async function writeMathSamples() {
    if (!state.dirHandle || !state.mathSamples || !state.mathSamples.length) return;
    try {
      var out = [
        '<!--',
        '  这是面板里数学公式的真实 HTML（前几个样本）。',
        '  用途：面板的 KaTeX 只有 HTML 渲染、没有 mathml/annotation 层，',
        '  页面里拿不到公式原文；要还原成 LaTeX 只能按这些 class 结构反推。',
        '-->',
        ''
      ];
      for (var i = 0; i < state.mathSamples.length; i++) {
        out.push('<!-- 样本 ' + (i + 1) + ' -->');
        out.push(state.mathSamples[i]);
        out.push('');
      }
      await writeFile(state.dirHandle, '_数学节点样本.html', out.join('\n'));
    } catch (e) {}
  }

  async function writeLedger() {
    if (!state.dirHandle || !state.ledger) return;
    try {
      var out = {
        tool: 'Aizex 聊天记录导出 v3.33',
        updatedAt: new Date().toISOString(),
        note: '记录每条会话在面板上的更新时间（接口 update_time）。下次运行时只有"更新时间变了"的会话会重抓，其余跳过。',
        hasApiTime: !!state.hasApiTime,
        convs: state.ledger
      };
      await writeFile(state.dirHandle, LEDGER_FILE, JSON.stringify(out, null, 1));
    } catch (e) {}
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
    var doneNew = {};
    var bad = {};
    var byId = {};        // id8 → [文件名…]，用来发现"同一会话被存成多个文件"
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
          if (!byId[id8]) byId[id8] = [];
          byId[id8].push(entry.name);
          var head = '';
          try {
            var f = await entry.getFile();
            head = (await f.text()).slice(0, 300);
          } catch (e) {}
          if (isBadMd(head)) { bad[id8] = true; badCount++; }
          else {
            done[id8] = true;
            // 只有"新机制 + 当前格式(md-v7)"才算抓全了；旧格式会重导一次（格式升级）
            if (head.indexOf('抓取机制: new') >= 0 && head.indexOf('保真度: md-v7') >= 0) doneNew[id8] = true;
          }
        }
      }
    } catch (e) {}
    return { done: done, doneNew: doneNew, bad: bad, byId: byId, count: count, badCount: badCount };
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
    var skippedOld = 0;
    var stale = 0;
    var staleTitles = [];
    for (var i = 0; i < convs.length; i++) {
      var c = convs[i];
      var id8 = c.id.slice(0, 8).toLowerCase();
      var already = !!state.doneSet[id8];
      var namedForce = state.forceKw.length > 0 && state.forceKw.some(function (kw) {
        return (c.title || '').indexOf(kw) >= 0 || String(c.id || '').indexOf(kw) === 0;
      });
      var tagged = !!(state.doneNewSet && state.doneNewSet[id8]);   // 文件头带"抓取机制: new"
      // 面板上有更新：接口给的 update_time 和台账里记的不一样 → 即使抓过也要重抓
      var led = (state.ledger && state.ledger[c.id]) || null;
      var remoteU = c.update_time || 0;
      var changed = !!(remoteU && (!led || Number(led.updateEpoch) !== Number(remoteU)));
      if (changed) {
        stale++;
        if (staleTitles.length < 5) staleTitles.push(c.title || c.id);
        if (!state.changedList) state.changedList = [];
        if (state.changedList.length < 200) {
          state.changedList.push({
            title: c.title || c.id,
            id: c.id,
            updatedAt: fmtLocalTime(toEpochMs(remoteU)),
            was: led && led.updatedAt ? led.updatedAt : '（台账里没有）'
          });
        }
      }
      // 规则只有一条，避免两套跳过逻辑打架：
      //   勾选"跳过已抓过的" → 只跳过带新机制标记的；没标记的（旧残缺版）一律重抓
      //   但"面板上更新过"的不跳过（这条优先）
      //   不勾选 → 全部重抓（连标记过的也重抓）
      if (state.skipExisting && tagged && !namedForce && !changed) {
        skipped++;
        continue;
      }
      if (already && !tagged) skippedOld++;
      c.__changed = changed;
      pending.push(c);
    }
    state.skippedCount = skipped;
    state.skippedOldCount = skippedOld;
    state.staleCount = stale;
    state.staleTitles = staleTitles;
    return pending;
  }

  // 从单个 md 文件解析出会话结构
  function buildDiagReport(panelCount, mode) {
    var lines = [];
    lines.push('# 导出诊断');
    lines.push('');
    lines.push('时间: ' + new Date().toLocaleString());
    lines.push('模式: ' + mode);
    lines.push('取源规则: 接口那份是原始 Markdown（公式是 LaTeX 原文），页面那份只用来补接口没有的消息');
    lines.push('侧边栏收集: ' + JSON.stringify(state.listDiag || {}));
    lines.push('面板会话数: ' + panelCount + '；本次实际抓取: ' + ((state.diag || []).length));
    lines.push('更新时间: ' + (state.hasApiTime ? '接口给了 update_time' : '接口没给（无法自动判断哪条有更新）') +
      '；本轮因"面板上有更新"而重抓: ' + (state.staleCount || 0) + ' 条');
    var fd = state.fmtDiag || {};
    lines.push('格式自检: 数学节点 ' + (fd.mathNodes || 0) + ' 个（接口原文 ' + (fd.mathTex || 0) + ' 个，按 HTML 结构还原 ' +
      (fd.mathRebuilt || 0) + ' 个，只能退回文字 ' + (fd.mathRenderedText || 0) + ' 个）；过滤掉的图片 JSON 片段 ' + (fd.jsonDropped || 0) + ' 处');
    if (fd.mathSample) lines.push('数学节点样本: ' + fd.mathSample);
    if (state.mathSamples && state.mathSamples.length) {
      lines.push('数学节点完整样本: 已写入 _数学节点样本.html（' + state.mathSamples.length + ' 个）');
    }
    if (fd.mathSuspect && fd.mathSuspect.length) {
      lines.push('还认不出的公式结构（下次照这个补规则）:');
      for (var si = 0; si < fd.mathSuspect.length; si++) lines.push('  - ' + fd.mathSuspect[si]);
    }
    lines.push('');
    lines.push('| 标题 | 抓取源 | 接口条 | 页面条 | 最终条 | 面板标的轮数 | 展开点击 | 残留折叠 | 完整 | 停止原因 |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
    var incompleteCount = 0;
    (state.diag || []).forEach(function (d) {
      if (d.incomplete) incompleteCount++;
      lines.push('| ' + (d.title || d.id) + ' | ' + (d.source || '-') + ' | ' + (d.apiMsgs || 0) + ' | ' + (d.domMsgs || 0) +
        ' | ' + (d.msgs || 0) + ' | ' + (d.expectedRounds || 0) + ' | ' + (d.expandClicks || 0) + ' | ' +
        ((d.foldLeftBoxes === undefined) ? '-' : d.foldLeftBoxes) + ' | ' +
        (d.incomplete ? '**不完整**' : 'ok') + ' | ' + (d.stop || '') + ' |');
    });
    lines.push('');
    lines.push('是否完整为"不完整"的会话数: ' + incompleteCount);
    if (state.keptOld) lines.push('为保护内容而未覆盖（新抓的更少）的会话数: ' + state.keptOld);
    lines.push('');
    if ((state.changedList || []).length) {
      lines.push('## 面板上有更新的会话（本次重抓，更新时间已记进 _同步台账.json）');
      lines.push('');
      lines.push('| 标题 | 面板更新时间 | 台账里原来的时间 |');
      lines.push('| --- | --- | --- |');
      state.changedList.forEach(function (x) {
        lines.push('| ' + x.title + ' | ' + x.updatedAt + ' | ' + x.was + ' |');
      });
      lines.push('');
    }
    lines.push('## 失败');
    (state.failed || []).forEach(function (f) { lines.push('- ' + (f.title || f.id) + ' :: ' + f.reason); });
    return lines.join('\n');
  }

  // 每跑几条就把诊断写一次，这样中途取消也能看到进度
  async function flushDiag(panelCount, mode) {
    if (!state.dirHandle) return;
    try {
      await writeFile(state.dirHandle, '_诊断_导出.md', buildDiagReport(panelCount, mode || state.mode || 'dom'));
    } catch (e) {}
  }

  // 可选：导出结束后生成 manifest.json + 归档说明.md（给客户看的那份"这包是什么"）
  // ---------- 内置 ZIP 打包（不依赖任何库） ----------
  var CRC_TABLE = (function () {
    var t = new Uint32Array(256);
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c >>> 0;
    }
    return t;
  })();
  function crc32(u8) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  var _utf8 = (typeof TextEncoder !== 'undefined') ? new TextEncoder() : null;
  function utf8(s) {
    if (_utf8) return _utf8.encode(s);
    var out = [];
    for (var i = 0; i < s.length; i++) out.push(s.charCodeAt(i) & 0xFF);
    return new Uint8Array(out);
  }
  async function deflateRaw(u8) {
    if (typeof CompressionStream === 'undefined') return null;
    try {
      var cs = new CompressionStream('deflate-raw');
      var stream = new Blob([u8]).stream().pipeThrough(cs);
      var buf = await new Response(stream).arrayBuffer();
      return new Uint8Array(buf);
    } catch (e) { return null; }
  }
  // entries: [{ name, data:Uint8Array }] → Blob（能压缩就压缩，压不了就原样存）
  async function makeZipBlob(entries) {
    var parts = [], central = [], offset = 0;
    for (var i = 0; i < entries.length; i++) {
      var nameB = utf8(entries[i].name);
      var raw = entries[i].data;
      var comp = await deflateRaw(raw);
      var method = comp ? 8 : 0;
      var body = comp || raw;
      var crc = crc32(raw);
      var lh = new Uint8Array(30 + nameB.length);
      var dv = new DataView(lh.buffer);
      dv.setUint32(0, 0x04034b50, true);
      dv.setUint16(4, 20, true);
      dv.setUint16(6, 0x0800, true);
      dv.setUint16(8, method, true);
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x2100, true);
      dv.setUint32(14, crc, true);
      dv.setUint32(18, body.length, true);
      dv.setUint32(22, raw.length, true);
      dv.setUint16(26, nameB.length, true);
      dv.setUint16(28, 0, true);
      lh.set(nameB, 30);
      parts.push(lh, body);
      central.push({ nameB: nameB, crc: crc, comp: body.length, size: raw.length, method: method, offset: offset });
      offset += lh.length + body.length;
    }
    var cdSize = 0;
    var cdParts = central.map(function (c) {
      var rec = new Uint8Array(46 + c.nameB.length);
      var dv2 = new DataView(rec.buffer);
      dv2.setUint32(0, 0x02014b50, true);
      dv2.setUint16(4, 20, true); dv2.setUint16(6, 20, true);
      dv2.setUint16(8, 0x0800, true); dv2.setUint16(10, c.method, true);
      dv2.setUint16(12, 0, true); dv2.setUint16(14, 0x2100, true);
      dv2.setUint32(16, c.crc, true);
      dv2.setUint32(20, c.comp, true);
      dv2.setUint32(24, c.size, true);
      dv2.setUint16(28, c.nameB.length, true);
      dv2.setUint32(42, c.offset, true);
      rec.set(c.nameB, 46);
      cdSize += rec.length;
      return rec;
    });
    var end = new Uint8Array(22);
    var dve = new DataView(end.buffer);
    dve.setUint32(0, 0x06054b50, true);
    dve.setUint16(8, central.length, true);
    dve.setUint16(10, central.length, true);
    dve.setUint32(12, cdSize, true);
    dve.setUint32(16, offset, true);
    return new Blob(parts.concat(cdParts, [end]), { type: 'application/zip' });
  }

  // 把整个归档目录打成一个 zip（md + images + 索引 + manifest + 说明书）
  async function writeZipArchive() {
    if (!state.dirHandle) return;
    var entries = [];
    try {
      for await (var entry of state.dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        if (entry.name.charAt(0) === '_') continue;                       // 内部清单不进包
        if (/\.zip$/i.test(entry.name)) continue;
        try {
          var buf = new Uint8Array(await (await entry.getFile()).arrayBuffer());
          entries.push({ name: entry.name, data: buf });
        } catch (e) {}
      }
      // images 子目录
      try {
        var imgDir = await state.dirHandle.getDirectoryHandle('images');
        for await (var ie of imgDir.values()) {
          if (ie.kind !== 'file') continue;
          try {
            var ib = new Uint8Array(await (await ie.getFile()).arrayBuffer());
            entries.push({ name: 'images/' + ie.name, data: ib });
          } catch (e) {}
        }
      } catch (e) {}
    } catch (e) {}
    if (!entries.length) return;
    var d = new Date();
    var pad = function (n) { return (n < 10 ? '0' : '') + n; };
    var zipName = '归档_' + d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' + pad(d.getHours()) + pad(d.getMinutes()) + '.zip';
    var blob = await makeZipBlob(entries);
    try {
      var fh = await state.dirHandle.getFileHandle(zipName, { create: true });
      var w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      state.zipName = zipName;
      state.zipEntries = entries.length;
    } catch (e) { state.zipError = String((e && e.message) || e); }
  }

  async function writeArchivePack(panelCount) {
    if (!state.dirHandle) return;
    var items = [];
    try {
      for await (var entry of state.dirHandle.values()) {
        if (entry.kind !== 'file') continue;
        if (!/\.md$/i.test(entry.name) || entry.name === '00_索引.md' || entry.name.charAt(0) === '_') continue;
        var f = await entry.getFile();
        var text = await f.text();
        var title = (text.match(/^#\s+(.+)$/m) || [])[1] || entry.name;
        var id = (text.match(/^>\s*会话 ID:\s*(\S+)/m) || [])[1] || '';
        var updated = (text.match(/^>\s*(?:最后更新|面板显示更新):\s*(.+)$/m) || [])[1] || '';
        var users = (text.match(/^## 用户$/gm) || []).length;
        var ais = (text.match(/^## AI$/gm) || []).length;
        var imgMarks = (text.match(/［图片|!\[[^\]]*\]\(images\//g) || []).length;
        items.push({
          file: entry.name, title: title.trim(), id: id.trim(),
          messages: users + ais, userMessages: users, aiMessages: ais,
          chars: text.length, bytes: f.size, images: imgMarks,
          updated: updated.trim()
        });
      }
    } catch (e) {}
    items.sort(function (a, b) { return b.messages - a.messages; });
    var manifest = {
      generatedAt: new Date().toISOString(),
      source: location.host,
      tool: 'Aizex 聊天记录导出 v3.33',
      conversations: items.length,
      hasUpdateTime: !!state.hasApiTime,
      totalMessages: items.reduce(function (s, x) { return s + x.messages; }, 0),
      totalUserMessages: items.reduce(function (s, x) { return s + x.userMessages; }, 0),
      totalChars: items.reduce(function (s, x) { return s + x.chars; }, 0),
      imagesDownloaded: state.imgOk || 0,
      imagesNotDownloaded: state.imgFail || 0,
      emptyConversations: (state.emptyList || []).length,
      files: items
    };
    await writeFile(state.dirHandle, 'manifest.json', JSON.stringify(manifest, null, 1));

    var readme = [
      '# 归档说明（自动生成）',
      '',
      '生成时间: ' + new Date().toLocaleString(),
      '来源面板: ' + location.host,
      '导出工具: Aizex 聊天记录导出 v3.33',
      '',
      '## 这里面有什么',
      '',
      '- `conversations` 之外的单个 `.md`：每个会话一份，含用户与 AI 的完整往返',
      '- `00_索引.md`：按文件名排序的总目录',
      '- `manifest.json`：机器可读清单（标题 / 会话 ID / 消息数 / 字符数 / 图片数）',
      '- `_诊断_导出.md`：完整性体检报告（哪条没抓全、停在哪一步）',
      '- `_同步台账.json`：每条会话在面板上的更新时间 + 上次导出结果，下次增量靠它',
      '- `images/`：下载到的图片（没有就是不适用或未下载成功）',
      '',
      '## 本次统计',
      '',
      '- 会话数：' + items.length,
      '- 消息数：' + manifest.totalMessages + '（用户 ' + manifest.totalUserMessages + ' 条）',
      '- 字符数：' + manifest.totalChars,
      '- 图片：成功下载 ' + manifest.imagesDownloaded + ' 张，未下载 ' + manifest.imagesNotDownloaded + ' 处',
      '- 空会话（面板里本来就没内容）：' + manifest.emptyConversations + ' 个',
      '- 更新时间：' + (manifest.hasUpdateTime ? '来自面板接口 update_time，见每条 md 的「最后更新」' : '接口没返回，本次没记到'),
      '',
      '## 怎么用',
      '',
      '1. 当知识库读：把 `.md` 丢进 Obsidian / Notion / 思源，用 `00_索引.md` 当入口',
      '2. 喂给程序：用 `manifest.json` 筛选，用会话 `.md` 里的 `## 用户` / `## AI` 段落切分',
      '3. 查完整性：看 `_诊断_导出.md` 的「完整」那一列，标 **不完整** 的才需要重抓',
      '',
      '## 注意',
      '',
      '- 数据只在本机文件夹里，不上传任何服务器',
      '- 消息里可能夹带面板注入的历史上下文（`<ns-context-guide>` / `[User is quoting…]`），做统计前建议先切掉',
      '- 「最后更新」优先用面板接口的 update_time；接口没给时退回侧边栏显示的时间文本，那种只有日期精度'
    ];
    await writeFile(state.dirHandle, '归档说明.md', readme.join('\n'));
  }

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
    var timeById8 = {};
    // 台账里记着每条的最后更新时间；没进台账的再从文件头读一次
    try {
      var led = state.ledger || {};
      for (var lid in led) {
        if (!Object.prototype.hasOwnProperty.call(led, lid)) continue;
        var key8 = String(lid).slice(0, 8).toLowerCase();
        timeById8[key8] = led[lid].updatedAt || led[lid].panelTimeText || '';
      }
    } catch (e) {}
    if (state.dirHandle) {
      try {
        for await (var entry of state.dirHandle.values()) {
          if (entry.kind === 'file' && entry.name.toLowerCase().endsWith('.md') && entry.name !== '00_索引.md') {
            names.push(entry.name);
            var m8 = entry.name.match(/_([0-9a-f]{8})\.md$/i);
            var id8 = m8 ? m8[1].toLowerCase() : '';
            if (id8 && !timeById8[id8]) {
              try {
                var f = await entry.getFile();
                var head = (f.slice ? await f.slice(0, 600).text() : await f.text());
                var tu = (head.match(/^>\s*(?:最后更新|面板显示更新):\s*(.+)$/m) || [])[1];
                if (tu) timeById8[id8] = tu.trim();
              } catch (e2) {}
            }
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
      '更新时间: ' + (state.hasApiTime ? '每条标的是该会话在面板上的最后更新时间（文件自己带的优先，没有的取 _同步台账.json 快照）' : '接口没返回，本次无法判断'),
      ''
    ];
    for (var k = 0; k < names.length; k++) {
      var name = names[k];
      var m = name.match(/^(.+)_([0-9a-f]{8})\.md$/i);
      var title = m ? m[1] : name;
      var when = m && timeById8[m[2].toLowerCase()] ? ' 　最后更新 ' + timeById8[m[2].toLowerCase()] : '';
      lines.push((k + 1) + '. [' + title + '](' + name + ')' + when);
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
      tool: 'aizex 聊天记录一键导出 v3.33',
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

    // 如果导出文件夹里有 _重跑清单.txt，就把里面的关键词/ID 前缀并入强制重导列表
    if (state.dirHandle) {
      try {
        var fhList = await state.dirHandle.getFileHandle('_重跑清单.txt');
        var fList = await fhList.getFile();
        var txtList = await fList.text();
        state.listStatus = '读到 _重跑清单.txt（' + txtList.split(/\r?\n/).filter(function (s) { return s.trim() && s.trim().charAt(0) !== '#'; }).length + ' 条有效行）';
        var extraKw = txtList.split(/\r?\n/).map(function (s) { return s.trim(); }).filter(function (s) {
          return s && s.charAt(0) !== '#';
        });
        if (extraKw.length) {
          var wantsAll = false;
          extraKw = extraKw.filter(function (s) {
            var m1 = /^CLICKS\s*=\s*(\d+)$/i.exec(s);
            if (m1) { state.expandCap = parseInt(m1[1], 10) || 400; return false; }
            var m2 = /^BUDGET\s*=\s*(\d+)$/i.exec(s);
            if (m2) { state.budgetSec = parseInt(m2[1], 10) || 300; return false; }
            if (/^all$/i.test(s)) { wantsAll = true; return false; }
            return true;
          });
          if (wantsAll) { state.forceAll = true; }
          if (extraKw.length) state.forceKw = state.forceKw.concat(extraKw);
        }
      } catch (e) {
        state.listStatus = '没读到 _重跑清单.txt（' + ((e && e.name) || e) + '：' + ((e && e.message) || '') + '）';
      }
    } else {
      state.listStatus = '还没选文件夹，没读 _重跑清单.txt';
    }

    // 断点续跑清单：已经用新机制抓过的会话，即使清单写 ALL 也不重复抓
    state.doneNew = {};
    state.doneNewList = [];
    // 同步台账：记着每条会话上次导出时面板标的更新时间
    state.ledger = await readLedger();
    if (state.dirHandle) {
      try {
        var fhDone = await state.dirHandle.getFileHandle('_已完成清单.txt');
        var fDone = await fhDone.getFile();
        var txtDone = await fDone.text();
        txtDone.split(/\r?\n/).forEach(function (s) {
          var v = s.trim();
          if (v && !state.doneNew[v]) { state.doneNew[v] = 1; state.doneNewList.push(v); }
        });
      } catch (e) {}
    }

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
    // 侧边栏自动滚动就能拿全（实测 450+ 条），不需要再点「更多/全部会话」——
    // 那个入口还可能把页面导航走，反而坏事。这个开关已移除。
    var allConvs = await collectConversations(false);
    if (allConvs.length === 0) {
      ui.status('没有找到任何会话。');
      ui.setBusy(false);
      state.running = false;
      return;
    }
    ui.status('共找到 ' + allConvs.length + ' 个会话。\n正在读取文件夹里已有的导出...');
    // 接口给没给更新时间，决定这次能不能判断"哪条在面板上有更新"
    state.hasApiTime = allConvs.some(function (c) { return !!c.update_time; });
    // 台账先记一份"面板当前时间快照"（每一条都记，不只是要抓的）
    snapshotLedger(allConvs);

    // 增量：扫描已有文件 + 读取旧 JSON（旧 JSON 仅用于失败列表合并）
    var scan = await scanExisting();
    state.doneSet = scan.done;
    state.doneNewSet = scan.doneNew || {};
    state.idFileMap = scan.byId || {};
    state.oldJson = await readExistingJson();
    state.convs = buildPending(allConvs);
    // 免费版：只导出前 N 条，且不展开被折叠的历史（专业版才有全量与折叠展开）
    if (!IS_PRO && state.convs.length > FREE_MAX) {
      state.freeTrimmed = state.convs.length - FREE_MAX;
      state.convs = state.convs.slice(0, FREE_MAX);
    }
    var pendingTotal = state.convs.length;

    // 版本与限制放到第一行，避免用户漏看"为什么只有 30 条"
    var msg = '';
    if (IS_PRO) {
      msg += '【' + PLAN_NAME + '】全量导出已开启\n';
    } else {
      msg += '【免费版】单次最多 ' + FREE_MAX + ' 条、不展开折叠历史' +
        (UPGRADE_URL ? '｜升级：' + UPGRADE_URL : '') + '\n';
    }
    msg += '面板共 ' + allConvs.length + ' 个会话；文件夹里已有 ' + scan.count + ' 个文件';
    if (state.listStatus) msg += '；' + state.listStatus;
    if (scan.badCount > 0) {
      msg += '（其中 ' + scan.badCount + ' 个是无效文件，会自动重新导出）';
    }
    if (state.skipExisting) {
      msg += '；已用新机制抓过、将跳过 ' + state.skippedCount + ' 个';
      msg += '；本次要抓 ' + pendingTotal + ' 个';
      if (state.skippedOldCount) msg += '（含 ' + state.skippedOldCount + ' 个旧的残缺文件，会重抓覆盖）';
    } else {
      msg += '；⚠️ 没勾选"跳过已抓过的"，本次全部重抓（共 ' + pendingTotal + ' 个）';
      if (state.pickedInfo && state.pickedInfo.tagged > 0) {
        msg += '\n⚠️ 注意：这个文件夹里已经有 ' + state.pickedInfo.tagged +
          ' 条抓好的了。如果你只是想补漏，请先取消本次运行、勾上"跳过已抓过的"再开始。';
      }
    }
    if (!IS_PRO && state.freeTrimmed) {
      msg += '\n⚠️ 免费版限制：本次只导前 ' + FREE_MAX + ' 条，还有 ' + state.freeTrimmed + ' 条没导。' +
        '输入激活码后可全量导出（面板右上角标题也会显示"专业版"）。';
    }
    if (!state.hasApiTime) {
      msg += '\n⚠️ 这次没从接口拿到"更新时间"，只能按已有文件跳过（下次接口通了才会自动发现更新）。';
    } else if (state.staleCount) {
      msg += '\n面板上有更新、本次会重抓 ' + state.staleCount + ' 条：' +
        (state.staleTitles || []).join('、') + (state.staleCount > (state.staleTitles || []).length ? ' 等' : '');
    } else {
      msg += '\n面板上没有会话更新（更新时间都和上次记的一致）。';
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
        await writeLedger();
        await writeMathSamples();
      }
      ui.status('全部会话都已导出过（累计 ' + payload0.exported + ' / ' + allConvs.length + ' 条），索引和 JSON 已刷新合并。\n如果想强制重新导出某些会话，在"强制重导关键词"里填标题关键词再运行。');
      ui.setBusy(false);
      state.running = false;
      return;
    }

    // 每条会话都"双抓"：后端接口 + 页面展开累积，取内容更全的一份，
    // 另一份里独有的消息附在文件末尾（避免任何一种来源缺内容）
    state.mode = 'both';
    ui.status('开始导出：每条会话都会先请后端接口，再在页面上展开折叠并逐屏累积，取更全的一份（另一份独有内容附在文件末尾）。\n请保持标签页在前台...');
    await domExport();

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
            var res2b = await captureConversation(conv2);
            state.diag.push((res2b && res2b.diag) || { id: conv2.id, title: conv2.title, stop: 'retry-no-diag' });
            if (res2b && res2b.ok) {
              var msgs2 = res2b.msgs;
              if (msgs2.length) {
                state.results.push({ id: conv2.id, title: conv2.title, messages: msgs2 });
                await writeMd(conv2, msgs2);
                continue;
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
    if (state.staleCount) summary += '，其中面板上有更新的 ' + state.staleCount + ' 条已重抓';
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
      await writeLedger();
      await writeMathSamples();
      if (state.doneNewList && state.doneNewList.length) {
        try { await writeFile(state.dirHandle, '_已完成清单.txt', state.doneNewList.join('\n')); } catch (e) {}
      }
      // 把"没抓全"的会话单独列出来，方便第二轮补
      var todo = (state.diag || []).filter(function (x) { return x && x.incomplete; })
        .map(function (x) { return x.id; }).filter(Boolean);
      if (todo.length) {
        try { await writeFile(state.dirHandle, '_待补清单.txt', todo.join('\n')); } catch (e) {}
      }
      if (!state.opts || state.opts.archivePack !== false) {
        try { await writeArchivePack(allConvs.length); } catch (e) {}
        try { await writeZipArchive(); } catch (e) {}
      }
      await flushDiag(allConvs.length, state.mode);
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
        '<div style="font-weight:700;margin-bottom:8px;font-size:15px">Aizex 聊天记录导出 v3.33' +
          (IS_PRO ? ' · 专业版' : ' · 免费版') + '</div>' +
        '<div id="__aizex31_status" style="margin-bottom:8px;white-space:pre-wrap;word-break:break-all;max-height:220px;overflow:auto;font-size:12px"></div>' +
        '<div id="__aizex31_barwrap" style="display:none;height:8px;background:#eee;border-radius:4px;overflow:hidden;margin-bottom:10px"><div id="__aizex31_bar" style="height:100%;width:0%;background:#10a37f"></div></div>' +
        '<label style="display:flex;gap:6px;align-items:center;font-size:12px;margin-bottom:4px"><input type="checkbox" id="__aizex31_skip" checked> 跳过已抓过的会话（格式已最新的才跳过；面板上有更新的照样重抓）</label>' +
        '<input id="__aizex31_force" placeholder="强制重导的标题关键词，逗号分隔（可留空）" style="width:100%;box-sizing:border-box;margin-bottom:8px;padding:4px 6px;font-size:12px;border:1px solid #ccc;border-radius:4px">' +
        '<details id="__aizex_opts_box" style="margin-bottom:8px;font-size:12px">' +
          '<summary style="cursor:pointer;color:#10a37f">⚙️ 设置（自动记住）</summary>' +
          '<div style="padding:8px 6px 2px">' +
            '<label style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><input type="checkbox" id="__aizex_opt_img"> 下载图片到 images/ 子文件夹</label>' +
            '<label style="display:flex;gap:6px;align-items:center;margin-bottom:4px"><input type="checkbox" id="__aizex_opt_pack"> 导出结束后生成 manifest.json + 归档说明.md</label>' +
            '<label style="display:flex;gap:6px;align-items:center;margin-bottom:4px">每条会话间隔 <input type="number" id="__aizex_opt_gap" min="0" max="3000" step="100" style="width:78px;padding:2px 4px"> 毫秒（越小越快，越大越稳）</label>' +
            '<div style="color:#888;font-size:11px;line-height:1.5">间隔太大没必要；面板限流时才需要调大。</div>' +
          '</div>' +
        '</details>' +
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

      // 设置项：读当前值 + 变更即存
      (function bindOpts() {
        var imgBox = document.getElementById('__aizex_opt_img');
        var packBox = document.getElementById('__aizex_opt_pack');
        var gapBox = document.getElementById('__aizex_opt_gap');
        var o = state.opts || DEFAULT_OPTS;
        imgBox.checked = o.downloadImages !== false;
        packBox.checked = o.archivePack !== false;
        gapBox.value = (typeof o.intervalMs === 'number' ? o.intervalMs : 300);
        imgBox.addEventListener('change', function () { state.opts.downloadImages = imgBox.checked; persistOpts(); });
        packBox.addEventListener('change', function () { state.opts.archivePack = packBox.checked; persistOpts(); });
        gapBox.addEventListener('change', function () {
          var v = parseInt(gapBox.value, 10);
          if (isNaN(v) || v < 0) v = 0;
          if (v > 3000) v = 3000;
          state.opts.intervalMs = v;
          gapBox.value = v;
          persistOpts();
        });
      })();

      pickBtn.addEventListener('click', pickFolder);
      startBtn.addEventListener('click', run);
      cancelBtn.addEventListener('click', function () {
        state.cancelled = true;
        cancelBtn.disabled = true;
        status('正在取消（处理完当前这条就停止，已导出的会照常保存，下次运行自动接续）...');
      });

      status('欢迎使用 v3.33（附件就地标注 + 更新时间台账）。正在检测本地桥接（127.0.0.1:8787）...');

      setTimeout(function () {
        bridgeProbe().then(function (info) {
          if (info) {
            state.bridge = true;
            state.bridgeInfo = info;
            state.dirHandle = makeBridgeDirHandle();
            startBtn.disabled = false;
            status('已连接本地桥接。\n导出文件夹：' + (info.folder || '(未知)') +
              '\n文件夹里已有 ' + ((info.names && info.names.length) || 0) + ' 个文件。' +
              '\n点"开始导出"即可，会自动跳过已导出的会话。');
          } else if (!window.showDirectoryPicker) {
            pickBtn.style.display = 'none';
            startBtn.disabled = false;
            status('未连接本地桥接，且当前浏览器不支持选文件夹，无法增量续跑。建议用 Chrome 或 Edge。\n继续运行会导出本次找到的全部会话（结果会下载）。');
          } else {
            status('未连接本地桥接。\n请选择你上次用的同一个导出文件夹。\n脚本会扫描已有文件：有效的自动跳过，无效的自动重新导出。');
          }
        }).catch(function () {});
      }, 120);
    }

    function pickFolder() {
      window.showDirectoryPicker({ mode: 'readwrite' })
        .then(function (h) {
          state.dirHandle = h;
          startBtn.disabled = false;
          // 顺手扫一下这个文件夹里有没有"已用新机制抓过"的文件：
          // 有就自动勾上"跳过已抓过的"，避免手滑变成全量重抓
          (async function () {
            var tagged = 0, total = 0, oldFmt = 0;
            try {
              for await (var entry of h.values()) {
                if (entry.kind === 'file' && /\.md$/i.test(entry.name) && entry.name !== '00_索引.md') {
                  total++;
                  try {
                    var head = (await (await entry.getFile()).text()).slice(0, 300);
                    if (head.indexOf('抓取机制: new') >= 0 && head.indexOf('保真度: md-v7') >= 0) tagged++;
                    else if (head.indexOf('会话 ID:') >= 0) oldFmt++;
                  } catch (e) {}
                }
              }
            } catch (e) {}
            state.pickedInfo = { tagged: tagged, total: total, oldFmt: oldFmt };
            if (tagged > 0) {
              try { ui.skipCheckbox.checked = true; } catch (e) {}
            }
            status('已选择文件夹。\n这个文件夹里有 ' + total + ' 个会话文件，其中 ' + tagged + ' 个是当前格式（md-v7）的，' + oldFmt + ' 个是旧格式。\n' +
              (tagged > 0
                ? '已自动勾选"跳过已抓过的"：旧格式的会自动重导一次（公式去重、换行修正），面板上有更新的也会重抓，其余跳过。'
                : '这个文件夹里没有新机制抓过的文件，本次会全量抓。') +
              (tagged < 50 && total >= 0
                ? '\n\n⚠️ 提醒：这看起来不像你的主归档目录（已抓好的文件很少）。如果只是想补漏，请选回上次那个导了 400+ 条的文件夹。'
                : ''));
          })();
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
  state.opts = loadOpts();
  ui.build();
})();

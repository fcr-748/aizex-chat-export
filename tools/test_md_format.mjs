// Markdown 转换回归测试（离线，不需要浏览器）
//
// 做法：从 aizex_export_v327.js 里把"HTML → Markdown"那段源码抠出来，
// 配一个极小的 DOM 替身跑一遍，验证 v3.27 修的两个问题：
//   1) 公式不再被拼成三份，统一输出 $…$ / $$…$$
//   2) 纯文本消息按 DOM 结构换行，不再受"浏览器自动折行"影响
//
// 跑法：node tools/test_md_format.mjs

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src', 'aizex_export_v342.js');
const src = fs.readFileSync(SRC, 'utf8');

// ---------- 从脚本里抠出转换代码 ----------
const startMark = '  var MD_SKIP_TAGS = {';
const endMark = '  function fp(m) {';
const i0 = src.indexOf(startMark);
const i1 = src.indexOf(endMark);
if (i0 < 0 || i1 < 0 || i1 <= i0) {
  console.error('FAIL 没能从脚本里定位转换代码（v327 结构变了？）');
  process.exit(1);
}
const snippet = src.slice(i0, i1);
// 附件指针常量（ATTR_PTR_SRC 等）在文件更前面，单独抠出来一起喂给被测代码
const c0 = src.indexOf('  // 附件指针（v3.37）');
const c1 = src.indexOf('  var state = {');
const snippetConsts = (c0 >= 0 && c1 > c0) ? src.slice(c0, c1) : '';
if (!snippetConsts) {
  console.error('FAIL 没能从脚本里定位附件指针常量（v337 结构变了？）');
  process.exit(1);
}
// 去重那段单独抠出来（unionExtra / msgKey / proseOf）
const j0 = src.indexOf('  function msgKey(t) {');
const j1 = src.indexOf('  // 两个来源都抓');
if (j0 < 0 || j1 < 0 || j1 <= j0) {
  console.error('FAIL 没能从脚本里定位去重代码（v329 结构变了？）');
  process.exit(1);
}
const snippetKey = src.slice(j0, j1);
// 台账与增量判断那段也抠出来（toEpochMs / fmtLocalTime / snapshotLedger / ledgerTouch / buildPending）
const k0 = src.indexOf('  function toEpochMs(v) {');
const k1 = src.indexOf('  async function writeLedger() {');
const k2 = src.indexOf('  // 从单个 md 文件解析出会话结构');
if (k0 < 0 || k1 < 0 || k2 < 0 || k1 <= k0) {
  console.error('FAIL 没能从脚本里定位台账代码（v332 结构变了？）');
  process.exit(1);
}
const snippetLedger = src.slice(k0, k1) + src.slice(src.indexOf('  function buildPending(convs) {'), k2);
// 页面图片过滤那段（界面图标不能当成会话图片）
const n0 = src.indexOf('  var UI_IMG_RE =');
const n1 = src.indexOf('  // ---------------- HTML → Markdown');
if (n0 < 0 || n1 < 0 || n1 <= n0) {
  console.error('FAIL 没能从脚本里定位图片过滤代码（v336 结构变了？）');
  process.exit(1);
}
const snippetImg = src.slice(n0, n1);
// toMarkdown 单独抠出来（测"没抓全就不冒充已抓全"和"更早的消息补到开头"）
const m0 = src.indexOf('  function toMarkdown(');
const m1 = src.indexOf('  async function writeMd(');
if (m0 < 0 || m1 < 0 || m1 <= m0) {
  console.error('FAIL 没能从脚本里定位 toMarkdown（v338 结构变了？）');
  process.exit(1);
}
const snippetToMd = src.slice(m0, m1);
// 接口消息提取那段（链断了要能按全部节点取）
const p0 = src.indexOf('  function mappingToMessages(');
const p1 = src.indexOf('  function anyToMessages(');
if (p0 < 0 || p1 < 0 || p1 <= p0) {
  console.error('FAIL 没能从脚本里定位 mappingToMessages（v341 结构变了？）');
  process.exit(1);
}
const snippetMap = src.slice(p0, p1);

// ---------- 极小 DOM 替身 ----------
function txt(v) { return { nodeType: 3, nodeValue: v, childNodes: [], parentElement: null }; }
function el(tag, opts = {}, children = []) {
  const node = {
    nodeType: 1,
    tagName: tag.toUpperCase(),
    className: opts.class || '',
    attrs: Object.assign({}, opts.attrs || {}),
    childNodes: [],
    parentElement: null,
    currentSrc: opts.currentSrc || '',
    getAttribute(n) { return Object.prototype.hasOwnProperty.call(this.attrs, n) ? this.attrs[n] : null; },
    setAttribute(n, v) { this.attrs[n] = v; },
    get textContent() {
      return this.childNodes.map((c) => (c.nodeType === 3 ? c.nodeValue : c.textContent)).join('');
    },
    get outerHTML() { return '<' + tag + ' class="' + this.className + '">...</' + tag + '>'; },
    get children() { return this.childNodes.filter((c) => c.nodeType === 1); },
    get nextElementSibling() {
      const sib = this.parentElement ? this.parentElement.childNodes : [];
      const at = sib.indexOf(this);
      for (let i = at + 1; i < sib.length; i++) if (sib[i].nodeType === 1) return sib[i];
      return null;
    },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    querySelectorAll(sel) { const out = []; walk(this, sel, out); return out; },
  };
  for (const c of children) {
    c.parentElement = node;
    node.childNodes.push(c);
  }
  return node;
}
// 极简 HTML 解析器：只够解析 <span class=".." style="..">文字</span> 这种结构，
// 用来把 _数学节点样本.html 里真实的 KaTeX HTML 还原成节点树做回归
function parseHtml(html) {
  const doc = { nodeType: 9, childNodes: [] };
  const stack = [doc];
  const re = /<(\/?)([a-zA-Z][\w-]*)((?:\s+[\w:-]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>|([^<]+)/g;
  let m;
  while ((m = re.exec(html))) {
    const parent = stack[stack.length - 1];
    if (m[5] !== undefined) {
      parent.childNodes.push({ nodeType: 3, nodeValue: m[5], childNodes: [], parentElement: parent });
      continue;
    }
    if (m[1] === '/') { if (stack.length > 1) stack.pop(); continue; }
    const attrs = {};
    const are = /([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
    let a;
    while ((a = are.exec(m[3] || ''))) attrs[a[1]] = a[2] !== undefined ? a[2] : (a[3] !== undefined ? a[3] : a[4]);
    const node = el(m[2], { class: attrs.class || '', attrs });
    node.parentElement = parent;
    parent.childNodes.push(node);
    if (m[4] !== '/') stack.push(node);
  }
  return doc.childNodes.filter((n) => n.nodeType === 1);
}

function walk(root, sel, out) {
  for (const c of root.childNodes) {
    if (c.nodeType !== 1) continue;
    if (matches(c, sel)) out.push(c);
    walk(c, sel, out);
  }
}
function matches(node, sel) {
  return String(sel).split(',').some((one) => matchesOne(node, one.trim()));
}
function matchesOne(node, sel) {
  if (!sel) return false;
  const tag = (sel.match(/^[a-zA-Z][\w-]*/) || [null])[0];
  if (tag && String(node.tagName).toLowerCase() !== tag.toLowerCase()) return false;
  for (const cls of sel.match(/\.[\w-]+/g) || []) {
    if (!String(node.className).split(/\s+/).includes(cls.slice(1))) return false;
  }
  for (const attr of sel.match(/\[[^\]]+\]/g) || []) {
    const star = attr.match(/^\[([\w-]+)\*="([^"]*)"\]$/);
    if (star) {
      const v = node.getAttribute(star[1]);
      if (v == null || String(v).indexOf(star[2]) < 0) return false;
      continue;
    }
    const plain = attr.match(/^\[([\w-]+)\]$/);
    if (plain) {
      if (node.getAttribute(plain[1]) == null) return false;
      continue;
    }
    return false;
  }
  return true;
}

// ---------- 跑测试 ----------
globalThis.state = {};
const factory = new Function('state', snippetConsts + snippet + snippetKey + '\n; return { mdFromElement, normalizeText, tidyMarkdown, collapseRepeats, looksLikePanelJson, stripPanelJson, cleanText, normalizeMathDelims, unionExtra, splitExtra, msgKey, proseOf, katexToLatex, delimsFromPieces, katexCoverageOk, resolveAttachments, nameHintsFromMsgs, attachTokenFromBlob };');
const api = factory(globalThis.state);
const ledgerApi = new Function('state', 'writeFile', 'LEDGER_FILE', snippetLedger + '\n; return { toEpochMs, fmtLocalTime, snapshotLedger, ledgerTouch, buildPending };')(globalThis.state, async () => {}, '_同步台账.json');
const imgApi = new Function(snippetImg + '\n; return { isUiImg, isTinyImg, UI_IMG_RE };')();
const mdApi = new Function('state', 'location', snippetConsts + snippet + snippetKey + snippetToMd +
  '\n; return { toMarkdown };')(globalThis.state, { host: 'test.local' });
const mapApi = new Function('state', snippetConsts + snippet + snippetMap +
  '\n; return { mappingToMessages };')(globalThis.state);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: ' + JSON.stringify(extra)); }
}

const TEX = 'V_{\\lambda_i}=\\{x\\in P^n:Ax=\\lambda_i x\\}';

// 1) KaTeX 三层结构：只应输出一份 $TeX$
const katex = el('span', { class: 'katex' }, [
  el('span', { class: 'katex-mathml' }, [
    el('math', {}, [el('semantics', {}, [el('annotation', { attrs: { encoding: 'application/x-tex' } }, [txt(TEX)])])]),
  ]),
  el('span', { class: 'katex-html', attrs: { 'aria-hidden': 'true' } }, [
    txt('Vλi={x∈Pn:Ax=λix}.'),   // 可见层（以前就是它被重复抓进来）
  ]),
]);
const msgMath = el('div', { class: 'markdown' }, [
  el('p', {}, [txt('设 '), katex, txt(' 是矩阵')]),
]);
const outMath = api.mdFromElement(msgMath);
check('公式只输出一份，且写成 $…$', (outMath.match(/V_\{/g) || []).length === 1 && outMath.includes('$' + TEX + '$'), outMath);
check('公式没有把渲染层当正文抓进来', !outMath.includes('Vλi={x∈Pn'), outMath);
check('公式前后的正文保留', outMath.includes('设 ') && outMath.includes('是矩阵'), outMath);
check('统计到数学节点且取到了原始 TeX', globalThis.state.fmtDiag.mathNodes >= 1 && globalThis.state.fmtDiag.mathTex >= 1, globalThis.state.fmtDiag);

// 2) 独立行公式 → $$…$$
const display = el('div', { class: 'markdown' }, [
  el('div', { class: 'katex-display' }, [el('span', { class: 'katex' }, [el('annotation', { attrs: { encoding: 'application/x-tex' } }, [txt('\\sum a_n')])])]),
]);
const outDisplay = api.mdFromElement(display);
check('独立行公式写成 $$…$$', outDisplay.includes('$$') && outDisplay.includes('\\sum a_n'), outDisplay);

// 3) 纯文本用户消息：按段落换行，长句不被拆断
const cell = '教学方式（理论课/实践课/实验课/理论+实践/理论+实验）';
const msgPlain = el('div', {}, [
  el('div', {}, [txt('课程名称（中/英文） 数学建模')]),
  el('div', {}, [txt(cell)]),
]);
const outPlain = api.mdFromElement(msgPlain);
check('纯文本按块换行', outPlain.split('\n').filter(Boolean).length === 2, outPlain);
check('长句没有被拆成多行', outPlain.includes(cell), outPlain);

// 4) 面板塞的图片 JSON → 占位符
const noisy = el('div', {}, [
  el('div', {}, [txt('{"asset_pointer":"file-service://file-ABC","content_type":"image_asset_pointer","width":1139}这里的由类似性质1')]),
]);
const outNoisy = api.mdFromElement(noisy);
check('图片 JSON 被替换成占位符（带图片身份）', outNoisy.includes('［图片:file-ABC］') && !outNoisy.includes('asset_pointer'), outNoisy);
check('占位后正文还在', outNoisy.includes('这里的由类似性质1'), outNoisy);

// 5) 兜底去重 + 空白规整
check('重复三次的片段被压成一次', api.normalizeText('K=$a_{ij}x_j$.K=$a_{ij}x_j$.K=$a_{ij}x_j$.') === 'K=$a_{ij}x_j$.', api.normalizeText('K=$a_{ij}x_j$.K=$a_{ij}x_j$.K=$a_{ij}x_j$.'));
check('零宽字符 / 替换字符被清掉', api.normalizeText('a\u200bb\uFFFDc') === 'abc', api.normalizeText('a\u200bb\uFFFDc'));
check('制表符不当成换行', api.normalizeText('a\tb') === 'a  b', api.normalizeText('a\tb'));
check('连续空行压成一个', api.normalizeText('a\n\n\n\nb') === 'a\n\nb', JSON.stringify(api.normalizeText('a\n\n\n\nb')));

// 6) 静态检查：转换路径里不能再出现 innerText（它就是"空格变换行"的来源）
const mdFn = snippet.slice(snippet.indexOf('function mdFromElement'));
check('mdFromElement 里不再用 innerText', !/innerText/.test(mdFn), (mdFn.match(/.*innerText.*/) || [''])[0]);

// 7) 标题 / 引用 / 分隔线（以前全变成纯文字）
const heads = el('div', { class: 'markdown' }, [
  el('h3', {}, [txt('一、证明')]),
  el('p', {}, [txt('正文一段')]),
  el('blockquote', {}, [txt('若幂级数收敛')]),
  el('hr', {}),
]);
const outHead = api.mdFromElement(heads);
check('标题保留层级', outHead.includes('### 一、证明'), outHead);
check('引用写成 > ', outHead.includes('> 若幂级数收敛'), outHead);
check('分隔线写成 ---', outHead.includes('---'), outHead);

// 8) 接口正文里被拆散的图片 JSON 残渣（v3.28）
const tail = ',"size_bytes":327298,"width":1005}请解释：为什么元素总数为2n';
check('半截 JSON 残渣被清掉', api.cleanText(tail) === '请解释：为什么元素总数为2n', api.cleanText(tail));
const blob = '{"asset_pointer":"file-service://file-ABC","content_type":"image_asset_pointer","fovea":null,"height":535,"metadata":{"dalle":null,"sanitized":true},"size_bytes":122948,"width":1139}这里的由类似性质1';
const blobOut = api.cleanText(blob);
check('整块 JSON 被清掉、正文留下（并留下图片身份）', blobOut === '［图片:file-ABC］这里的由类似性质1', blobOut);
check('清理是幂等的', api.cleanText(blobOut) === blobOut, api.cleanText(blobOut));
const twoImgs = api.cleanText('{"asset_pointer":"file-service://file-A","width":1}{"asset_pointer":"file-service://file-B","width":2}看图');
check('连着两个 JSON 都清掉', twoImgs === '［图片:file-A］［图片:file-B］看图', twoImgs);

// 9) 去重不能误伤：分隔线、笑声、正常文本
check('不会把 ======== 压短', api.normalizeText('========') === '========', api.normalizeText('========'));
check('不会把连续笑声压短', api.normalizeText('哈哈哈哈哈哈哈哈') === '哈哈哈哈哈哈哈哈', api.normalizeText('哈哈哈哈哈哈哈哈'));
check('公式三连仍然会被压成一次', api.normalizeText('$a_{ij}x_j$.$a_{ij}x_j$.$a_{ij}x_j$.') === '$a_{ij}x_j$.', api.normalizeText('$a_{ij}x_j$.$a_{ij}x_j$.$a_{ij}x_j$.'));

// 10) 代码块缩进不会被制表符转换动到（结构化路径走 tidyMarkdown）
const codeMsg = el('div', { class: 'markdown' }, [
  el('pre', {}, [el('code', {}, [txt('def f():\n\treturn 1')])]),
]);
const outCode = api.mdFromElement(codeMsg);
check('代码块里的制表符保留', outCode.includes('def f():\n\treturn 1'), outCode);

// 11) 公式定界符：\[…\] → $$…$$、\(…\) → $…$（预览器不认前一种）
const realSample = api.cleanText('可以。积分因子法就是专门处理：\n\n\\[\n\\boxed{M(x,y)\\,dx+N(x,y)\\,dy=0}\n\\]\n\n**本身不是恰当方程**，但乘上一个函数后…');
check('\\[…\\] 换成 $$…$$', realSample.includes('$$\n\\boxed{M(x,y)\\,dx+N(x,y)\\,dy=0}\n$$'), realSample);
check('公式体里的 \\, 原样保留', realSample.includes('\\,'), realSample);
check('\\[…\\] 的花括号不再被当成转义', !realSample.includes('\\[') && !realSample.includes('\\]'), realSample);
const inline = api.cleanText('设 \\(\\Omega\\) 是样本空间，\\(\\mathcal F\\) 是 σ 域');
check('\\(…\\) 换成 $…$', inline === '设 $\\Omega$ 是样本空间，$\\mathcal F$ 是 σ 域', inline);
const fenced = api.cleanText('示例代码：\n\n```tex\n\\[ a+b \\]\n```\n\n正文 \\[c+d\\]');
check('代码围栏里的 \\[…\\] 不动', fenced.includes('```tex\n\\[ a+b \\]\n```'), fenced);
check('围栏外夹在句中的 \\[…\\] 按行内换', fenced.includes('正文 $c+d$'), fenced);
const inlineCode = api.cleanText('写法是 `\\[ x \\]`，实际用 \\[y\\]');
check('行内代码里的 \\[…\\] 不动', inlineCode.includes('`\\[ x \\]`'), inlineCode);
check('已经有 $$ 的不会再被改', api.normalizeMathDelims('$$\na=b\n$$') === '$$\na=b\n$$', api.normalizeMathDelims('$$\na=b\n$$'));

// 11b) 判据：只有自己独占一行的 \[…\] 才能变成 $$ 块（v3.29 修的坑）
const midSentence = api.cleanText('但 \\[\n0,1\n\\] 里面的点是**不可列无穷多个**。');
check('句中的 \\[…\\] 按行内处理，不劈出 $$', midSentence === '但 $0,1$ 里面的点是**不可列无穷多个**。', midSentence);
check('句中公式不会留下跨行 $$', !midSentence.includes('$$'), midSentence);
const wrapped = api.cleanText('所以不能把\n\n\\[P([0,1])\\]\n\n理解成“不可列无穷多个 $0$ 相加”。');
check('独占一行的 \\[…\\] 才是 $$ 块', wrapped.includes('$$\nP([0,1])\n$$'), wrapped);
const insideCall = api.cleanText('即 P(\\[0,1\\]) 这点要注意');
check('公式被文字包住时按行内处理', insideCall === '即 P($0,1$) 这点要注意', insideCall);
const realQuote = api.cleanText('但 \\[\n0,1\n\\] 里面的点\n\n所以不能把\n\nP(\\[\n0,1\n\\])\n\n理解成“不可列无穷多个 $0$ 相加”。');
check('真实引文片段里不再出现行内 $$', !/\$\$[^\n]/.test(realQuote) && !/[^\n]\$\$/.test(realQuote), JSON.stringify(realQuote));
check('真实引文片段里 $ 个数是偶数', (realQuote.match(/\$/g) || []).length % 2 === 0, (realQuote.match(/\$/g) || []).length);

// 12) 没有公式原文时不再假装成公式（面板 KaTeX 只输出 HTML）
const renderedOnly = el('div', { class: 'markdown' }, [
  el('div', { class: 'katex-display' }, [
    el('span', { class: 'katex' }, [
      el('span', { class: 'katex-html', attrs: { 'aria-hidden': 'true' } }, [txt('n=1⋃∞An∈F')]),
    ]),
  ]),
]);
const outRendered = api.mdFromElement(renderedOnly);
check('没有 mathml 层时按 HTML 结构还原成公式', outRendered.includes('$$') && outRendered.includes('n=1⋃∞An∈F'), outRendered);
const sqrtOnly = el('div', { class: 'markdown' }, [
  el('div', { class: 'katex-display' }, [
    el('span', { class: 'katex' }, [el('span', { class: 'sqrt' }, [txt('x+1')])]),
  ]),
]);
const outSqrt = api.mdFromElement(sqrtOnly);
check('还原不了的结构当普通文字写', outSqrt.includes('x+1') && !outSqrt.includes('$'), outSqrt);

// 13) 附录去重：公式写法不同也要认成同一条（v3.28 在这里误判过）
const chosenApi = [{ role: 'assistant', text: '这两行非常关键。它们其实不是在讲新的集合运算，而是在证明一件事：\n\n$$\n\\sigma 域既然对“可列并、可列交”封闭\n$$\n\n但书上用了一个很巧的“补位”方法' }];
const domSame = [{ role: 'assistant', text: '这两行非常关键。它们其实不是在讲新的集合运算，而是在证明一件事：\n\n$$\nσ域既然对“可列并、可列交”封闭\n$$\n\n但书上用了一个很巧的“补位”方法' }];
check('公式写法不同仍判为同一条', api.unionExtra(chosenApi, domSame).length === 0, api.unionExtra(chosenApi, domSame));
const chosenShort = [{ role: 'user', text: '概率论基础 复旦大学 李贤平 第三版(1).pdf\n\nPDF\n\n从这里面挑能够覆盖全部知识点的题目清单' }];
const domExtra = [{ role: 'assistant', text: '可以，这次我按你上传的《概率论基础》“习题一”1—50题逐题看过以后再筛。' }];
check('接口真的缺的那条保留下来', api.unionExtra(chosenShort, domExtra).length === 1, api.unionExtra(chosenShort, domExtra));
const shortDup = api.unionExtra([{ role: 'assistant', text: '好的' }], [{ role: 'assistant', text: '好的' }]);
check('极短消息也能识别重复', shortDup.length === 0, shortDup);

// 14) KaTeX HTML → LaTeX 还原（拿 _数学节点样本.html 里的真实结构跑）
const samplePath = 'D:/桌面/ai/ai项目/aizex聊天记录迁移/_数学节点样本.html';
if (fs.existsSync(samplePath)) {
  const samples = fs.readFileSync(samplePath, 'utf8')
    .split(/<!--\s*样本\s*\d+\s*-->/).slice(1)
    // 样本是按 1500 字截断的，末尾可能是半个标签，切到最后一个完整的 '>'
    .map((s) => { const t = s.trim(); const k = t.lastIndexOf('>'); return k >= 0 ? t.slice(0, k + 1) : t; })
    .filter(Boolean);
  const rebuilt = samples.map((html) => api.katexToLatex(parseHtml(html)[0]));
  console.log('  （真实样本还原结果：' + rebuilt.map((r) => JSON.stringify(r.tex)).join(' / ') + '）');
  // 样本每轮会重新采集，所以按"内容特征"找，而不是按下标
  const flat = rebuilt.map((r) => r.tex.replace(/\s/g, ''));
  const has = (fn) => rebuilt.some((r, i) => fn(r, flat[i]));
  check('真实样本里长公式的行顺序没被弄乱', has((r, f) => /100\+90\+81\+72\.9/.test(f)), flat.slice(0, 3));
  check('真实样本有把 \\frac 还原对（分母在前也能对上）', has((r, f) => /\\frac\{1\}\{R\}/.test(f)), flat.filter((x) => x.includes('frac')));
  check('真实样本的 \\text{中文} 保留', has((r, f) => f.includes('\\text{货币乘数}') || /\\text\{[^}]+\}/.test(f)), flat.filter((x) => x.includes('\\text')));
  check('HTML 实体不会写成字面量', !flat.some((x) => x.includes('&nbsp;') || x.includes('&amp;')), flat.filter((x) => x.includes('&')));
  check('真实样本还原结果都不是空串', rebuilt.every((r) => r.tex.length > 0), rebuilt.map((r) => r.tex));
} else {
  console.log('  （跳过：没找到 _数学节点样本.html）');
}

// 15) 分数"先分母后分子"的形状必须还原成 \frac{ΔM}{M}
const fracHtml = '<span class="katex"><span class="katex-html" aria-hidden="true"><span class="base">'
  + '<span class="strut"></span><span class="mord"><span class="mopen nulldelimiter"></span><span class="mfrac">'
  + '<span class="vlist-t vlist-t2"><span class="vlist-r"><span class="vlist">'
  + '<span style="top:-2.314em;"><span class="pstrut"></span><span class="mord"><span class="mord mathnormal">M</span></span></span>'
  + '<span style="top:-3.23em;"><span class="pstrut"></span><span class="frac-line"></span></span>'
  + '<span style="top:-3.677em;"><span class="pstrut"></span><span class="mord">ΔM</span></span>'
  + '</span><span class="vlist-s">​</span></span></span></span>'
  + '<span class="mclose nulldelimiter"></span></span><span class="mrel">=</span>'
  + '<span class="mord">π</span></span></span></span>';
const fracGot = api.katexToLatex(parseHtml(fracHtml)[0]);
check('分母在前也会还原成 \\frac{ΔM}{M}', fracGot.tex.replace(/\s/g, '') === '\\frac{ΔM}{M}=π', fracGot);
const fracMd = api.mdFromElement(el('div', { class: 'markdown' }, [parseHtml(fracHtml)[0]]));
check('还原成功的公式写成 $…$', fracMd.includes('$\\frac{ΔM}{M}=π$'), fracMd);

// 16) 放大括号不能丢：KaTeX 把它们放在 .delimsizing 里，且是"拼片"字符
check('拼片 ⎛⎜⎝ 拼回 (', api.delimsFromPieces('⎛⎜⎝') === '(', api.delimsFromPieces('⎛⎜⎝'));
check('拼片 ⎡⎢⎣ 拼回 [', api.delimsFromPieces('⎡⎢⎣') === '[', api.delimsFromPieces('⎡⎢⎣'));
check('普通连续括号不被压掉', api.delimsFromPieces('))') === '))', api.delimsFromPieces('))'));
const delimHtml = '<span class="katex"><span class="katex-html" aria-hidden="true"><span class="base">'
  + '<span class="strut"></span><span class="mopen"><span class="delimsizing size1">⎛⎜⎝</span></span>'
  + '<span class="mord">0,1</span>'
  + '<span class="mclose"><span class="delimsizing size1">⎞⎟⎠</span></span></span></span></span>';
const delimGot = api.katexToLatex(parseHtml(delimHtml)[0]);
check('括号还原出来', delimGot.tex.replace(/\s/g, '') === '(0,1)' && delimGot.ok, delimGot);

// 17) 括号覆盖检查：页面上有括号、但还原结果里没有 → 判为不可用
const delimRoot = parseHtml(delimHtml)[0];
check('还原漏了右括号会被判为不可用', api.katexCoverageOk(delimRoot, '(0,1') === false, api.katexCoverageOk(delimRoot, '(0,1'));
check('括号齐了就算可用', api.katexCoverageOk(delimRoot, '(0,1)') === true, true);
check('\\left( \\right) 这种命令写法也算括号齐', api.katexCoverageOk(delimRoot, '\\left(0,1\\right)') === true, true);

// 18) 更新时间台账 + "面板上有更新就重抓"
const lstate = {};
const led = new Function('state', 'writeFile', 'LEDGER_FILE', snippetLedger +
  '\n; return { toEpochMs, fmtLocalTime, snapshotLedger, ledgerTouch, buildPending };')(lstate, async () => {}, '_同步台账.json');
const t1 = 1791500000;                    // 面板给的是"秒"
const mk = (id, title, t) => ({ id, title, update_time: t });
const A = 'aaaa1111-1111-1111-1111-111111111111';
const B = 'bbbb2222-2222-2222-2222-222222222222';
const C = 'cccc3333-3333-3333-3333-333333333333';
led.snapshotLedger([mk(A, '会话A', t1), mk(B, '会话B', t1), mk(C, '会话C', t1)]);
check('快照把每条会话都记进台账', Object.keys(lstate.ledger).length === 3 && lstate.ledger[A].updateEpoch === t1, Object.keys(lstate.ledger));
check('台账里同时记了可读时间', /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(lstate.ledger[A].updatedAt), lstate.ledger[A].updatedAt);

// 已经抓全（带新机制 + 当前格式标记）的会话
const taggedAll = { aaaa1111: 1, bbbb2222: 1, cccc3333: 1 };
const doneAll = { aaaa1111: 1, bbbb2222: 1, cccc3333: 1 };
function runPending(convs, ledger, doneSet, doneNewSet) {
  lstate.ledger = ledger; lstate.doneSet = doneSet; lstate.doneNewSet = doneNewSet;
  lstate.forceKw = []; lstate.skipExisting = true; lstate.changedList = [];
  return led.buildPending(convs);
}
// A 没变 → 跳过；B 面板时间变新了 → 重抓；C 台账里没有 → 重抓
const ledger2 = Object.assign({}, lstate.ledger);
ledger2[B] = Object.assign({}, ledger2[B], { updateEpoch: t1 - 3600, updatedAt: '更早的时间' });
delete ledger2[C];
const pending = runPending([mk(A, '会话A', t1), mk(B, '会话B', t1), mk(C, '会话C', t1)], ledger2, doneAll, taggedAll);
const pendIds = pending.map((x) => x.id.slice(0, 4)).sort();
check('没更新的跳过、有更新的重抓、没台账的重抓', pendIds.join(',') === 'bbbb,cccc', pendIds);
check('重抓清单记下了新时间和旧时间', lstate.changedList.length === 2 &&
  lstate.changedList[0].updatedAt === led.fmtLocalTime(led.toEpochMs(t1)) &&
  lstate.changedList[0].was === '更早的时间', lstate.changedList);

// 18b) 分类：新对话 / 面板上有更新 / 旧格式升级 / 关键词强制
const D = 'dddd4444-4444-4444-4444-444444444444';   // 新对话：磁盘上没有
const E = 'eeee5555-5555-5555-5555-555555555555';   // 老格式：有文件但没格式标记
const F = 'ffff6666-6666-6666-6666-666666666666';   // 关键词强制
const ledger3 = Object.assign({}, lstate.ledger);
ledger3[B] = Object.assign({}, ledger3[B], { updateEpoch: t1 - 60 });
const kindsState = { doneSet: { aaaa1111: 1, bbbb2222: 1, eeee5555: 1, ffff6666: 1 }, doneNewSet: { aaaa1111: 1, bbbb2222: 1, ffff6666: 1 },
  ledger: ledger3, forceKw: ['强制'], skipExisting: true, kinds: null };
const newFn = new Function('state', 'writeFile', 'LEDGER_FILE', snippetLedger +
  '\n; return { buildPending };')(kindsState, async () => {}, '_同步台账.json');
const pend2 = newFn.buildPending([mk(A, '会话A', t1), mk(B, '会话B', t1), mk(D, '新对话D', t1), mk(E, '老格式E', t1), mk(F, '强制F', t1)]);
check('分类计数正确', kindsState.kindCounts['new'] === 1 && kindsState.kindCounts.changed === 1 &&
  kindsState.kindCounts.upgrade === 1 && kindsState.kindCounts.force === 1, kindsState.kindCounts);
check('新对话认出来了', kindsState.kinds['new'][0].title === '新对话D', kindsState.kinds['new']);
check('有更新认出来了', kindsState.kinds.changed[0].title === '会话B', kindsState.kinds.changed);
check('新对话即使接口没给时间也会抓', newFn.buildPending([{ id: D, title: '新对话D', update_time: 0 }]).length === 1, 'x');

// 中断语义：这轮没抓到的会话，面板时间变了也不能把台账时间改成新的（否则下次就不抓了）
led.snapshotLedger([mk(B, '会话B', t1 + 999)]);
check('没抓到的更新不会被台账吞掉', lstate.ledger[B].updateEpoch === t1 - 3600, lstate.ledger[B]);
// 抓到了就更新台账
led.ledgerTouch({ id: B, title: '会话B', update_time: t1 + 999 }, { msgs: 3, chars: 100, file: 'B.md' });
check('抓过之后台账更新成新的时间', lstate.ledger[B].updateEpoch === t1 + 999 && lstate.ledger[B].msgs === 3, lstate.ledger[B]);

// 19) 附件就地标注（图片不再一律堆到文末）
const att = { total: 2, map: { 'file-ABC': 'images/file-ABC.png', 'file-XYZ': '' }, used: {}, order: [], lines: [] };
check('有文件名的附件写出文件名', api.cleanText('见附件 ［文件:报告.pdf:file-ABC］') === '见附件 ［文件:报告.pdf:file-ABC］', api.cleanText('见附件 ［文件:报告.pdf:file-ABC］'));
const inlineImg = api.resolveAttachments('这是我的问题 ［图片:file-ABC］ 请解释', att);
check('图片就地换成链接', inlineImg.includes('![图片](images/file-ABC.png)') && inlineImg.startsWith('这是我的问题 '), inlineImg);
check('图片旁边带附件标注', inlineImg.includes('> 附件: `file-ABC`'), inlineImg);
check('用过的附件被记下来（不再进文末附录）', att.used['file-ABC'] === 1, att.used);
const namedFile = api.resolveAttachments('看这个 ［文件:报告.pdf:file-ABC］', att);
check('文件名优先做标注', namedFile.includes('> 附件: `报告.pdf`'), namedFile);
check('图片成块：标注后面不会粘住正文', api.resolveAttachments('［图片:file-ABC］后面的话', { map: { 'file-ABC': 'images/x.png' }, used: {} }).includes('`\n\n后面的话'), api.resolveAttachments('［图片:file-ABC］后面的话', { map: { 'file-ABC': 'images/x.png' }, used: {} }));
const failed = api.resolveAttachments('这张 ［图片:file-XYZ］ 没下下来', att);
check('没下下来的会说明', failed.includes('［图片未取到］') && !failed.includes('!['), failed);
const hints = api.nameHintsFromMsgs([{ text: '［文件:报告.pdf:file-ABC］' }, { text: '［图片:file-QQQ］' }]);
check('从正文收集文件名提示', hints['file-ABC'] === '报告.pdf' && hints['file-QQQ'] === undefined, hints);
const named = api.cleanText('{"asset_pointer":"file-service://file-ZZ","content_type":"file","name":"讲义.pdf"}然后接着说');
check('带名字的附件 JSON 产出文件占位', named === '［文件:讲义.pdf:file-ZZ］然后接着说', named);

// 19b) sediment:// 也是图片指针（以前只认 file-service://，这类图就只剩空占位）
const sed = api.cleanText('{"asset_pointer":"sediment://file-NoQAM7DkBV3DpCzeQDHciK","content_type":"image_asset_pointer","size_bytes":240188,"width":2048}这两行想要表达什么');
check('sediment:// 图片也带 id', sed === '［图片:file-NoQAM7DkBV3DpCzeQDHciK］这两行想要表达什么', sed);
const sedAtt = { total: 1, map: { 'file-NoQAM7DkBV3DpCzeQDHciK': 'images/file-NoQAM7DkBV3DpCzeQDHciK.png' }, used: {}, order: [], lines: [] };
const sedOut = api.resolveAttachments('［图片:file-NoQAM7DkBV3DpCzeQDHciK］请看这张', sedAtt);
check('sediment 图片能就地换成链接', sedOut.includes('![图片](images/file-NoQAM7DkBV3DpCzeQDHciK.png)') && sedAtt.used['file-NoQAM7DkBV3DpCzeQDHciK'] === 1, sedOut);

// 20) 界面图标不能当成会话图片（侧边栏 Logo、按钮图标这些）
function fakeImg(o) {
  return {
    naturalWidth: o.w || 0, naturalHeight: o.h || 0,
    clientWidth: o.cw || 0, clientHeight: o.ch || 0,
    getAttribute(name) { return (o.attrs && o.attrs[name]) || null; },
    closest(sel) { return o.inUi ? { tagName: 'BUTTON' } : null; },
  };
}
const bigImg = fakeImg({ w: 1200, h: 900 });
check('正常大图不算界面图', imgApi.isUiImg(bigImg, 'https://files.example.com/xx/abc123.jpg') === false, 'big');
check('小图标被过滤（真实像素 ≤48）', imgApi.isUiImg(fakeImg({ w: 32, h: 32 }), 'https://files.example.com/xx/y.jpg') === true, 'tiny');
check('尺寸属性很小也被过滤', imgApi.isUiImg(fakeImg({ attrs: { width: '24', height: '24' } }), 'https://files.example.com/xx/y.jpg') === true, 'attr');
check('URL 里带 logo/icon 的被过滤', imgApi.isUiImg(bigImg, 'https://cdn.example.com/assets/app-logo.png') === true, 'logo');
check('在按钮/侧边栏里的图被过滤', imgApi.isUiImg(fakeImg({ w: 1200, h: 900, inUi: true }), 'https://files.example.com/xx/y.jpg') === true, 'inUi');
check('Scholar GPT 那种侧边栏 Logo 会被过滤', imgApi.isUiImg(fakeImg({ w: 96, h: 96, inUi: true }), 'https://files.example.com/xx/z.png') === true, 'scholar');
// v3.42：消息里的图不能因为"包在按钮里"就丢掉（面板的图片就是点开看大图的按钮）
check('消息里的图即使包在按钮里也保留', imgApi.isUiImg(fakeImg({ w: 1200, h: 900, inUi: true }), 'https://files.example.com/xx/photo.jpg', true) === false, 'inMsg');
check('消息里 16px 的小图标仍然过滤', imgApi.isUiImg(fakeImg({ w: 16, h: 16 }), 'https://files.example.com/xx/i.png', true) === true, 'tinyInMsg');
check('消息里名字带 logo 的仍然过滤', imgApi.isUiImg(fakeImg({ w: 1200, h: 900 }), 'https://cdn.example.com/app-logo.png', true) === true, 'logoInMsg');

// 21) 多出来的消息按位置补：更早的补到开头，更晚的接到后面，对不上的才进附录
const older1 = { role: 'user', text: '那我们先从问题说起，这次想研究毕业生就业压力' };
const older2 = { role: 'assistant', text: '好的，先把研究对象拆成三个层次来看' };
const same1 = { role: 'user', text: '还是爬招聘网站的初级岗位吧 真个获取数据的过程是怎么样的？' };
const same2 = { role: 'assistant', text: '抓取流程一般分四步：确定站点、翻页、解析、落库' };
const newer = { role: 'assistant', text: '补充一句：记得给每条记录留下来源链接' };
const chosen = [same1, same2];
const sp1 = api.splitExtra(chosen, [older1, older2, same1, same2]);
check('更早的消息被识别成"补到前面"', sp1.before.length === 2 && sp1.before[0].text === older1.text, sp1.before);
const sp2 = api.splitExtra(chosen, [same1, same2, newer]);
check('更晚的消息被识别成"接到后面"', sp2.after.length === 1 && sp2.after[0].text === newer.text, sp2.after);
const sp3 = api.splitExtra(chosen, [{ role: 'assistant', text: '完全不相干的一段内容，用来验证兜底' }]);
check('位置对不上的进附录', sp3.orphan.length === 1 && !sp3.before.length && !sp3.after.length, sp3);

// 21b) 接口缺"开头一段"、页面版有 → 必须认出来是更早的（v3.40 修的正是这条）
const mid1 = { role: 'user', text: '那你说说看招聘网站上那些岗位到底能不能反映就业压力' };
const mid2 = { role: 'assistant', text: '能反映一部分，但要小心口径：岗位需求是流量，失业是存量' };
const tail1 = { role: 'user', text: '那数据从哪来' };
const tail2 = { role: 'assistant', text: '公开渠道有三类：统计年鉴、部门公报、招聘平台' };
const apiPart = [tail1, tail2];
const domFull = [older1, older2, mid1, mid2, tail1, tail2];   // 页面版是完整的，接口只有尾巴
const sp4 = api.splitExtra(apiPart, domFull);
check('接口缺的开头整段被认出来', sp4.before.length === 4 && sp4.before[0].text === older1.text, sp4.before.map((x) => x.text));
check('开头的补全不重复正文已有的', !sp4.before.some((x) => x.text === tail1.text), sp4.before.map((x) => x.text));

// 22) 没抓全不冒充已抓全；更早的消息写在正文开头
const convMeta = { id: 'aaaa1111-2222-3333-4444-555555555555', title: '测试会话' };
const partialMd = mdApi.toMarkdown(convMeta, chosen, 1, [], null,
  { partial: true, partialNote: '面板标 7 轮，实际只抓到 6 条' }, [older1, older2]);
check('没抓全写 partial（下次会重抓）', partialMd.includes('> 抓取机制: partial'), partialMd.split('\n').slice(0, 10));
check('没抓全写明原因', partialMd.includes('未抓全（面板标 7 轮，实际只抓到 6 条）'), partialMd.split('\n').slice(0, 10));
check('更早的消息补在开头', partialMd.indexOf('## 补：更早的消息') > 0 &&
  partialMd.indexOf('## 补：更早的消息') < partialMd.indexOf('## 用户'), partialMd.indexOf('## 补：更早的消息'));
const fullMd = mdApi.toMarkdown(convMeta, chosen, 1, [], null, null, []);
check('抓全了写 new', fullMd.includes('> 抓取机制: new') && !fullMd.includes('partial'), fullMd.split('\n').slice(0, 9));

// 23) 指针下载失败时，用"这条消息里渲染出来的图片地址"兜底
const msgUrls = ['https://files.example.com/xx/aBcDeF123456XyZ.png?x=1'];
// 页面地址在下载时会被命名成 url-<后缀>，这里按同样的规则算出它的键
const urlKey = 'url-' + msgUrls[0].replace(/[^a-z0-9]+/gi, '').slice(-24);
const failAtt = {
  total: 2, used: {}, usedUrl: {}, order: [], lines: [],
  map: { 'file-jNgKsM6YtMBIHm5BSsVSgx': '', 'url-addr': 'images/url-addr.png' }
};
failAtt.map[msgUrls[0]] = 'images/' + urlKey + '.png';
const fellBack = api.resolveAttachments('［图片:file-jNgKsM6YtMBIHm5BSsVSgx］这是我的问题', failAtt, msgUrls);
check('文件流取不到时用页面地址兜底', fellBack.includes('![图片](images/' + urlKey + '.png)'), fellBack);
check('兜底成功就不写"未下载成功"', !fellBack.includes('未下载成功'), fellBack);
check('兜底用的地址被记下来', Object.keys(failAtt.usedUrl).length === 1, failAtt.usedUrl);
const noFallback = api.resolveAttachments('［图片:file-jNgKsM6YtMBIHm5BSsVSgx］看图', { total: 1, map: { 'file-x': '' }, used: {}, usedUrl: {} }, []);
check('确实没图可用才写明未取到', noFallback.includes('［图片未取到］'), noFallback);

// 24) 接口消息提取：parent 链断了（镜像常见）时要能按"整张图按时间排"取全
function mkNode(id, parent, role, text, t) {
  return { id: id, parent: parent, children: [], message: { id: id, author: { role: role }, create_time: t, content: { content_type: 'text', parts: [text] } } };
}
// 正常：链完整
const mapOk = {
  n1: mkNode('n1', null, 'user', '第一个问题：什么是失业率', 1),
  n2: mkNode('n2', 'n1', 'assistant', '失业率是失业人口占劳动力人口的比例', 2),
  n3: mkNode('n3', 'n2', 'user', '那统计口径呢', 3),
};
const okMsgs = mapApi.mappingToMessages(mapOk, null, 'n3');
check('链完整时按链取（顺序正确）', okMsgs.length === 3 && okMsgs[0].text.indexOf('第一个问题') === 0, okMsgs.map((m) => m.text));
check('链完整时标记为 chain', okMsgs.__apiMode === 'chain', okMsgs.__apiMode);

// 链断：中间某个节点的 parent 指向不存在的 id（镜像的常见情况），链只能取到后半截，
// 但整张节点图里其实全都在
const mapBroken = {
  a1: mkNode('a1', 'MISSING', 'user', '很早的一问：先定研究对象', 1),
  a2: mkNode('a2', 'a1', 'assistant', '很久以前的一答：先把对象拆成三层', 2),
  a3: mkNode('a3', 'a2', 'user', '中间一问：数据从哪来', 3),
  a4: mkNode('a4', 'a3', 'assistant', '中间一答：三类公开渠道', 4),
  a5: mkNode('a5', 'GONE', 'user', '最近一问：怎么落地', 5),
  a6: mkNode('a6', 'a5', 'assistant', '最近一答：先做小样本', 6),
  a7: mkNode('a7', 'a6', 'user', '继续问：样本要多大', 7),
  a8: mkNode('a8', 'a7', 'assistant', '继续答：先三百条起', 8),
  a9: mkNode('a9', 'a8', 'user', '最后问：怎么核对', 9),
  a10: mkNode('a10', 'a9', 'assistant', '最后答：抽十条人工比', 10),
};
const brokenMsgs = mapApi.mappingToMessages(mapBroken, null, 'a10');
check('链断了也能取全（按全部节点+时间）', brokenMsgs.length === 10 && brokenMsgs.__apiMode === 'all-nodes',
  { n: brokenMsgs.length, mode: brokenMsgs.__apiMode, chain: brokenMsgs.__chainLen, all: brokenMsgs.__allLen });
check('链断时按时间正序', brokenMsgs[0].text.indexOf('很早的一问') === 0 && brokenMsgs[9].text.indexOf('最后答') === 0, brokenMsgs.map((m) => m.text));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

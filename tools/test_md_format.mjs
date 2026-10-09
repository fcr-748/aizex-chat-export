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
const SRC = path.join(HERE, '..', 'src', 'aizex_export_v328.js');
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
const factory = new Function('state', snippet + '\n; return { mdFromElement, normalizeText, tidyMarkdown, collapseRepeats, looksLikePanelJson, stripPanelJson, cleanText, normalizeMathDelims };');
const api = factory(globalThis.state);

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
check('图片 JSON 被替换成占位符', outNoisy.includes('［图片］') && !outNoisy.includes('asset_pointer'), outNoisy);
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
check('整块 JSON 被清掉、正文留下', blobOut === '［图片］这里的由类似性质1', blobOut);
check('清理是幂等的', api.cleanText(blobOut) === blobOut, api.cleanText(blobOut));
const twoImgs = api.cleanText('{"asset_pointer":"file-service://file-A","width":1}{"asset_pointer":"file-service://file-B","width":2}看图');
check('连着两个 JSON 都清掉', twoImgs === '［图片］［图片］看图', twoImgs);

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
check('围栏外的 \\[…\\] 照换', fenced.includes('$$\nc+d\n$$'), fenced);
const inlineCode = api.cleanText('写法是 `\\[ x \\]`，实际用 \\[y\\]');
check('行内代码里的 \\[…\\] 不动', inlineCode.includes('`\\[ x \\]`'), inlineCode);
check('已经有 $$ 的不会再被改', api.normalizeMathDelims('$$\na=b\n$$') === '$$\na=b\n$$', api.normalizeMathDelims('$$\na=b\n$$'));

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

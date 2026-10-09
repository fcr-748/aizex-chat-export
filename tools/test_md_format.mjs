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
const SRC = path.join(HERE, '..', 'src', 'aizex_export_v327.js');
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
const factory = new Function('state', snippet + '\n; return { mdFromElement, normalizeText, collapseRepeats, looksLikePanelJson };');
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

console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

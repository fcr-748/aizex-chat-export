// 弹窗：显示授权状态 → 注入导出脚本（带授权配置）
import { loadLicense, saveLicense, clearLicense, deviceId } from './licensing.js';

const BUY_URL = '';          // 填上你的购买链接（面包多/爱发电/小报童），留空则不显示购买按钮
const FREE_MAX = 30;         // 免费版最多导出多少条会话

const statusEl = document.getElementById('status');
const licEl = document.getElementById('lic');
const tagEl = document.getElementById('planTag');
const activateBox = document.getElementById('activateBox');

function setStatus(t) { statusEl.textContent = t; }

function fmtDate(ms) {
  const d = new Date(ms);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

async function renderLicense() {
  const lic = await loadLicense();
  if (lic.pro) {
    tagEl.className = 'tag pro';
    tagEl.textContent = lic.planName || '专业版';
    licEl.textContent = '已激活：' + (lic.planName || '') +
      '\n有效期至：' + fmtDate(lic.expiresAt) +
      '\n权限：全量导出 + 自动展开折叠历史 + 断点续跑';
    activateBox.innerHTML = '<button id="removeKey" class="ghost">解除本机激活</button>';
    document.getElementById('removeKey').addEventListener('click', async () => {
      await clearLicense();
      setStatus('已解除激活，回到免费版。');
      renderLicense();
    });
  } else {
    tagEl.className = 'tag free';
    tagEl.textContent = '免费版';
    licEl.textContent = '当前：免费版' +
      '\n· 最多导出 ' + FREE_MAX + ' 条会话' +
      '\n· 不自动展开被折叠的历史轮次' +
      (lic.reason ? '\n· 上次激活码状态：' + lic.reason : '');
    activateBox.innerHTML =
      '<input id="keyInput" placeholder="粘贴激活码：AIZEX-P-20270630-4F2A-9C1D3E7B5A">' +
      '<button id="activate">激活</button>' +
      (BUY_URL ? '<a href="' + BUY_URL + '" target="_blank">还没有激活码？点这里购买</a>' : '');
    document.getElementById('activate').addEventListener('click', doActivate);
  }
}

async function doActivate() {
  const val = document.getElementById('keyInput').value;
  setStatus('正在校验激活码…');
  const res = await saveLicense(val);
  if (!res.ok) { setStatus('激活失败：' + res.reason); return; }
  setStatus('激活成功 ✅ 现在可以全量导出了。');
  renderLicense();
}

document.getElementById('inject').addEventListener('click', async function () {
  setStatus('正在注入…');
  try {
    const lic = await loadLicense();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab || !tab.id) { setStatus('没找到当前标签页。'); return; }
    if (!/^https?:/i.test(tab.url || '')) { setStatus('当前页不是网页（请先切到面板聊天页）。'); return; }

    const cfg = {
      pro: !!lic.pro,
      planName: lic.planName || '免费版',
      freeMax: FREE_MAX,
      upgradeUrl: BUY_URL || '',
      expiresAt: lic.expiresAt || 0
    };

    // 先注入配置（页面主世界），再注入导出脚本；两者在同一个世界，脚本能读到配置
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: (c) => { window.__AIZEX_LICENSE__ = c; },
      args: [cfg]
    });
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      files: ['src/aizex_export.js']
    });

    setStatus('已注入 ✅（' + cfg.planName + '）\n到页面右上角找绿色面板：选文件夹 → 开始导出。');
  } catch (e) {
    setStatus('注入失败：' + (e && e.message ? e.message : e) +
      '\n如果是权限问题，去扩展详情页允许访问该网站，或刷新页面后重试。');
  }
});

document.getElementById('help').addEventListener('click', function () {
  setStatus(
    '1) 打开面板聊天页（左侧能看到会话列表）\n' +
    '2) 点上面的注入按钮\n' +
    '3) 页面右上角浮窗里点"选择保存文件夹"\n' +
    '4) 点"开始导出"，保持标签页在前台\n\n' +
    '数据只写进你选的文件夹，不上传任何服务器。\n' +
    '中途可取消，下次会自动跳过已导出的会话。'
  );
});

document.getElementById('dev').addEventListener('click', async function () {
  const id = await deviceId();
  setStatus('设备码：' + id + '\n（换机器或重装浏览器会变；需要绑定时把它发给我）');
});

renderLicense();

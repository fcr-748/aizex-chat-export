// 授权（激活码）模块 —— 扩展端
//
// 设计取舍：离线可验，不依赖服务器（卖一次性卡密最省事）。
// 码的格式：AIZEX-<档位 1 位>-<到期日 8 位>-<随机 4 位>-<签名 10 位>
//   例：AIZEX-P-20270630-4F2A-9C1D3E7B5A
// 签名 = HMAC-SHA256(密钥, "档位-到期日-随机段") 的前 10 个十六进制字符（大写）
//
// 说明：密钥内置在扩展里，属于"提高破解成本"级别，不是密码学强度的授权；
//      要防倒卖/吊销，再启用可选的在线校验（见 license_server/）。

const HMAC_SECRET = 'CHANGE_ME_TO_YOUR_OWN_SECRET';   // 自己发布前改成你的密钥，要和 tools/keygen.js 保持一致

export const PLANS = {
  P: { name: '专业版（永久）', pro: true },
  Y: { name: '年费版（一年）', pro: true },
  T: { name: '体验版（30 天）', pro: true }
};

export function normalizeKey(input) {
  const raw = String(input || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  // 用户可能把横杠删了（或复制时带空格）：按固定长度重新拼回来
  if (raw.length === 28 && raw.startsWith('AIZEX')) {
    return 'AIZEX-' + raw.slice(5, 6) + '-' + raw.slice(6, 14) + '-' + raw.slice(14, 18) + '-' + raw.slice(18);
  }
  return String(input || '').toUpperCase().replace(/[^A-Z0-9-]/g, '').replace(/-+/g, '-').replace(/^-|-$/g, '');
}

async function hmacHex(payload) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(HMAC_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

// 返回 { ok, plan, expiresAt, reason }
export async function verifyKey(input) {
  const key = normalizeKey(input);
  const parts = key.split('-');
  if (parts.length !== 5 || parts[0] !== 'AIZEX') {
    return { ok: false, reason: '格式不对，应该像 AIZEX-P-20270630-4F2A-9C1D3E7B5A' };
  }
  const [, planCode, exp, nonce, sig] = parts;
  if (!PLANS[planCode]) return { ok: false, reason: '档位代码不认识（应为 P/Y/T）' };
  const expect = (await hmacHex(planCode + '-' + exp + '-' + nonce)).slice(0, 10);
  if (expect !== sig) return { ok: false, reason: '激活码无效（签名不匹配）' };
  const m = /^(\d{4})(\d{2})(\d{2})$/.exec(exp);
  if (!m) return { ok: false, reason: '到期日格式不对' };
  const expiresAt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59).getTime();
  if (Date.now() > expiresAt) {
    return { ok: false, reason: '激活码已过期（' + m[1] + '-' + m[2] + '-' + m[3] + '）', expired: true };
  }
  return {
    ok: true,
    plan: planCode,
    planName: PLANS[planCode].name,
    pro: true,
    expiresAt: expiresAt,      // 永久版也写一个远期日期，便于统一处理
    key: key
  };
}

export async function loadLicense() {
  const { license } = await chrome.storage.local.get('license');
  if (!license || !license.key) return { pro: false };
  const again = await verifyKey(license.key);
  if (!again.ok) return { pro: false, reason: again.reason, expired: !!again.expired };
  return again;
}

export async function saveLicense(input) {
  const res = await verifyKey(input);
  if (!res.ok) return res;
  await chrome.storage.local.set({ license: { key: res.key, plan: res.plan, expiresAt: res.expiresAt, activatedAt: Date.now() } });
  return res;
}

export async function clearLicense() {
  await chrome.storage.local.remove('license');
}

// 设备码：给"绑定设备数量"用的（服务端或人工核对），不参与离线验签
export async function deviceId() {
  const { device } = await chrome.storage.local.get('device');
  if (device) return device;
  const raw = [navigator.userAgent, screen.width + 'x' + screen.height, navigator.language, Date.now(), Math.random()].join('|');
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  const id = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16).toUpperCase();
  await chrome.storage.local.set({ device: id });
  return id;
}

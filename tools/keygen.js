// 激活码生成器（本地跑，不需要服务器）
// 用法示例：
//   node keygen.js --plan P --count 20                 # 专业版永久，生成 20 个
//   node keygen.js --plan Y --count 20 --out keys.txt  # 年费版（365 天）
//   node keygen.js --plan T --count 50 --out trial.txt # 体验版（30 天）
//
// ⚠️ HMAC_SECRET 必须和扩展里的 licensing.js 完全一致，改一处另一处也要改
'use strict';
const crypto = require('crypto');
const fs = require('fs');

const HMAC_SECRET = 'CHANGE_ME_TO_YOUR_OWN_SECRET';   // 必须和 extension/licensing.js 一致

function arg(name, def) {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const plan = (arg('plan', 'P') || 'P').toUpperCase();
const count = parseInt(arg('count', '10'), 10);
const outFile = arg('out', '');

const PLAN_DAYS = { P: 3650 * 7, Y: 365, T: 30 };   // P 用远期日期表示"永久"
if (!PLAN_DAYS[plan]) {
  console.error('档位只能是 P（永久）/ Y（年费）/ T（体验 30 天）');
  process.exit(1);
}

function expiryStamp(days) {
  const d = new Date(Date.now() + days * 24 * 3600 * 1000);
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function sign(payload) {
  return crypto.createHmac('sha256', HMAC_SECRET).update(payload).digest('hex').slice(0, 10).toUpperCase();
}

function makeKey() {
  const exp = expiryStamp(PLAN_DAYS[plan]);
  const nonce = crypto.randomBytes(2).toString('hex').toUpperCase();
  const payload = plan + '-' + exp + '-' + nonce;
  return 'AIZEX-' + payload + '-' + sign(payload);
}

const keys = [];
for (let i = 0; i < count; i++) keys.push(makeKey());

console.log('档位 ' + plan + '（' + { P: '永久', Y: '一年', T: '30 天' }[plan] + '），到期日 ' + expiryStamp(PLAN_DAYS[plan]) + '，共 ' + count + ' 个：');
keys.forEach(k => console.log('  ' + k));
if (outFile) {
  fs.writeFileSync(outFile, keys.join('\n') + '\n', 'utf8');
  console.log('已写入 ' + outFile);
}

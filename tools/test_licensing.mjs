// 单测：验证"生成的激活码能被扩展端逻辑接受"，以及错误码/过期码会被拒绝
// 跑法：node test_licensing.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const SECRET = 'CHANGE_ME_TO_YOUR_OWN_SECRET';   // 要和 extension/licensing.js 一致
const EXT_DIR = path.resolve(process.argv[2] || '../extension');

// 1) 把扩展的 licensing.js 复制成 .mjs 以便 node 当模块加载
const src = fs.readFileSync(path.join(EXT_DIR, 'licensing.js'), 'utf8');
const tmp = path.join(process.cwd(), '_licensing_for_test.mjs');
fs.writeFileSync(tmp, src, 'utf8');

// 2) 造一个假的 chrome.storage
const store = {};
globalThis.chrome = {
  storage: {
    local: {
      get: async (k) => (typeof k === 'string' ? { [k]: store[k] } : { ...store }),
      set: async (obj) => { Object.assign(store, obj); },
      remove: async (k) => { delete store[k]; }
    }
  }
};

const lic = await import('file://' + tmp.replace(/\\/g, '/'));

function sign(payload) {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('hex').slice(0, 10).toUpperCase();
}
function make(tier, yyyymmdd, nonce) {
  const payload = tier + '-' + yyyymmdd + '-' + nonce;
  return 'AIZEX-' + payload + '-' + sign(payload);
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('PASS ' + name); }
  else { fail++; console.log('FAIL ' + name + ' :: ' + JSON.stringify(extra)); }
}

const good = make('P', '20351231', 'A1B2');
const goodY = make('Y', '20991231', 'C3D4');
const expired = make('T', '20200101', 'E5F6');
const tampered = good.slice(0, -1) + (good.slice(-1) === 'A' ? 'B' : 'A');

const r1 = await lic.verifyKey(good);
check('永久码可激活', r1.ok && r1.pro && r1.plan === 'P', r1);

const r2 = await lic.verifyKey(goodY.toLowerCase().replace(/-/g, ''));   // 也测"用户粘贴时去掉横杠"
check('年费码（去横杠小写）也能识别', r2.ok === true, r2);

const r3 = await lic.verifyKey(expired);
check('过期码被拒绝且提示过期', r3.ok === false && r3.expired === true, r3);

const r4 = await lic.verifyKey(tampered);
check('被改过的码被拒绝', r4.ok === false, r4);

const r5 = await lic.verifyKey('随便乱写');
check('乱写的码被拒绝并给格式提示', r5.ok === false && /格式/.test(r5.reason || ''), r5);

const r6 = await lic.saveLicense(good);
const r7 = await lic.loadLicense();
check('激活后 loadLicense 能读到专业版', r6.ok && r7.pro === true, { r6, r7 });

await lic.clearLicense();
const r8 = await lic.loadLicense();
check('解除激活后回到免费版', r8.pro === false, r8);

fs.unlinkSync(tmp);
console.log('\n通过 ' + pass + ' / 失败 ' + fail);
process.exit(fail ? 1 : 0);

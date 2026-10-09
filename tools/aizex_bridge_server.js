// aizex 导出本地桥接服务
// 用途：让浏览器控制台里的 aizex_export_v32_bridge.js 直接把导出结果写到本机文件夹，
//       不需要手动选文件夹，也不会把数据发到任何外部地址（只监听 127.0.0.1）。
//
// 启动：node aizex_bridge_server.js
// 接口：
//   GET  /status            -> { ok, folder, names: [...] }
//   GET  /file/<name>       -> 文件内容（text）
//   PUT  /file/<name>       -> 写入文件内容（UTF-8 文本）
//   OPTIONS *               -> CORS 预检

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// 导出目标文件夹：命令行第一个参数 > 环境变量 AIZEX_EXPORT_DIR > 本目录下的 exports/
const ROOT = process.argv[2] || process.env.AIZEX_EXPORT_DIR || path.join(__dirname, 'exports');
const PORT = 8787;
const HOST = '127.0.0.1';
const LOG = path.join(__dirname, 'bridge.log');

let writeCount = 0;

function log(line) {
  const text = '[' + new Date().toLocaleString('zh-CN') + '] ' + line;
  console.log(text);
  try { fs.appendFileSync(LOG, text + '\n', 'utf8'); } catch (e) {}
}

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Private-Network': 'true',
    'Access-Control-Max-Age': '86400'
  };
}

function send(res, code, body, type) {
  const headers = Object.assign({ 'content-type': type || 'text/plain; charset=utf-8' }, corsHeaders());
  res.writeHead(code, headers);
  res.end(body);
}

function safeTarget(name) {
  if (!name || name.length > 160) return null;
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(name)) return null;
  if (!/\.(md|json)$/i.test(name)) return null;
  const target = path.resolve(ROOT, name);
  const rootResolved = path.resolve(ROOT);
  if (!target.startsWith(rootResolved + path.sep)) return null;
  return target;
}

function listNames() {
  try {
    return fs.readdirSync(ROOT).filter(function (n) {
      return /\.(md|json)$/i.test(n);
    });
  } catch (e) {
    return [];
  }
}

const server = http.createServer(function (req, res) {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname || '');

  if (req.method === 'OPTIONS') {
    send(res, 204, '');
    return;
  }

  if (req.method === 'GET' && pathname === '/status') {
    const names = listNames();
    send(res, 200, JSON.stringify({ ok: true, folder: ROOT, names: names, count: names.length }), 'application/json; charset=utf-8');
    return;
  }

  if (pathname.indexOf('/file/') === 0) {
    const name = pathname.slice('/file/'.length);
    const target = safeTarget(name);
    if (!target) {
      log('拒绝非法文件名: ' + JSON.stringify(name));
      send(res, 403, 'invalid file name');
      return;
    }

    if (req.method === 'GET') {
      fs.readFile(target, 'utf8', function (err, text) {
        if (err) { send(res, 404, 'not found'); return; }
        send(res, 200, text);
      });
      return;
    }

    if (req.method === 'PUT') {
      const chunks = [];
      req.on('data', function (c) { chunks.push(c); });
      req.on('end', function () {
        const body = Buffer.concat(chunks).toString('utf8');
        fs.writeFile(target, body, 'utf8', function (err) {
          if (err) {
            log('写入失败 ' + name + ' :: ' + err.message);
            send(res, 500, 'write failed');
            return;
          }
          writeCount++;
          if (writeCount % 25 === 0) {
            log('已写入 ' + writeCount + ' 个文件（最近：' + name + '，' + body.length + ' 字符）');
          } else {
            log('写入 ' + name + '（' + body.length + ' 字符）');
          }
          send(res, 200, 'ok');
        });
      });
      return;
    }
  }

  send(res, 404, 'not found');
});

server.listen(PORT, HOST, function () {
  log('桥接服务已启动: http://' + HOST + ':' + PORT + ' -> ' + ROOT);
});

process.on('SIGINT', function () { log('收到中断，退出'); process.exit(0); });

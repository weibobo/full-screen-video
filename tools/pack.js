#!/usr/bin/env node
/**
 * 打包 Chrome Web Store 分发 zip：
 *   node tools/pack.js
 *
 * - 只打包运行时文件（排除 .git / README / LICENSE / tools / store 等）
 * - 商店版 manifest 去掉 file 协议的 host 权限（本地文件访问商店版不支持，
 *   用户侧本就需要手动开启"允许访问文件网址"，去掉更干净）
 * - 输出 dist/full-screen-video-v<version>.zip
 *
 * zip 由脚本自写（deflate + 正斜杠路径分隔符），不依赖第三方库，
 * 避开 PowerShell Compress-Archive 在 zip 条目名中使用反斜杠的兼容问题。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const STAGE = path.join(DIST, 'stage');
const RUNTIME_FILES = [
  'manifest.json',
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'popup.css',
  '_locales',
  'icons',
];

/* ---------- 1. 复制运行时文件到暂存目录 ---------- */

fs.rmSync(STAGE, { recursive: true, force: true });
fs.mkdirSync(STAGE, { recursive: true });
for (const item of RUNTIME_FILES) {
  fs.cpSync(path.join(ROOT, item), path.join(STAGE, item), { recursive: true });
}

/* ---------- 2. 商店版 manifest 去掉 file:// 权限 ---------- */

const mfPath = path.join(STAGE, 'manifest.json');
let raw = fs.readFileSync(mfPath, 'utf8');
raw = raw.replace(/,\s*"file:\/\/\*\/\*"/g, '');
if (raw.includes('file://')) throw new Error('manifest 中仍残留 file:// 权限');
const version = JSON.parse(raw).version;
fs.writeFileSync(mfPath, raw, 'utf8'); // Node 写 UTF-8 无 BOM

/* ---------- 3. 生成 zip（deflate） ---------- */

function crc32(buf) {
  if (!crc32.table) {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      t[n] = c;
    }
    crc32.table = t;
  }
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crc32.table[(c ^ buf[i]) & 0xFF];
  return (c ^ -1) >>> 0;
}

function dosDateTime(d) {
  return {
    time: ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31),
    date: (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31),
  };
}

const files = [];
(function walk(dir, prefix) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? prefix + '/' + e.name : e.name;
    if (e.isDirectory()) walk(path.join(dir, e.name), rel);
    else files.push({ rel, abs: path.join(dir, e.name) });
  }
})(STAGE, '');

const chunks = [];
const central = [];
let offset = 0;
for (const f of files) {
  const data = fs.readFileSync(f.abs);
  const comp = zlib.deflateRawSync(data, { level: 9 });
  const crc = crc32(data);
  const name = Buffer.from(f.rel, 'utf8');
  const { time, date } = dosDateTime(fs.statSync(f.abs).mtime);

  const lfh = Buffer.alloc(30);
  lfh.writeUInt32LE(0x04034b50, 0); // local file header signature
  lfh.writeUInt16LE(20, 4);          // version needed
  lfh.writeUInt16LE(0, 6);           // flags
  lfh.writeUInt16LE(8, 8);           // method: deflate
  lfh.writeUInt16LE(time, 10);
  lfh.writeUInt16LE(date, 12);
  lfh.writeUInt32LE(crc, 14);
  lfh.writeUInt32LE(comp.length, 18);
  lfh.writeUInt32LE(data.length, 22);
  lfh.writeUInt16LE(name.length, 26);
  lfh.writeUInt16LE(0, 28);          // extra length
  chunks.push(lfh, name, comp);

  const cdh = Buffer.alloc(46);
  cdh.writeUInt32LE(0x02014b50, 0); // central directory signature
  cdh.writeUInt16LE(20, 4);          // version made by
  cdh.writeUInt16LE(20, 6);          // version needed
  cdh.writeUInt16LE(0, 8);
  cdh.writeUInt16LE(8, 10);
  cdh.writeUInt16LE(time, 12);
  cdh.writeUInt16LE(date, 14);
  cdh.writeUInt32LE(crc, 16);
  cdh.writeUInt32LE(comp.length, 20);
  cdh.writeUInt32LE(data.length, 24);
  cdh.writeUInt16LE(name.length, 28);
  cdh.writeUInt16LE(0, 30);          // extra
  cdh.writeUInt16LE(0, 32);          // comment
  cdh.writeUInt16LE(0, 34);          // disk number
  cdh.writeUInt16LE(0, 36);          // internal attrs
  cdh.writeUInt32LE(0, 38);          // external attrs
  cdh.writeUInt32LE(offset, 42);     // local header offset
  central.push(cdh, name);

  offset += lfh.length + name.length + comp.length;
}

const cd = Buffer.concat(central);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0); // end of central directory
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(files.length, 8);
eocd.writeUInt16LE(files.length, 10);
eocd.writeUInt32LE(cd.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

fs.rmSync(STAGE, { recursive: true, force: true });
const zipPath = path.join(DIST, 'full-screen-video-v' + version + '.zip');
fs.writeFileSync(zipPath, Buffer.concat(chunks.concat([cd, eocd])));

console.log('packed ' + path.relative(ROOT, zipPath));
for (const f of files) console.log('  ' + f.rel);
console.log('entries: ' + files.length + ', size: ' + fs.statSync(zipPath).size + ' bytes');

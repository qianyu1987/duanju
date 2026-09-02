const fs = require('fs');
const path = require('path');

const dirs = [
  '/Volumes/brainos/CodexMedia/generated/现代短剧/ep01/videos',
  '/Volumes/brainos/CodexMedia/generated/天道摆渡人/ep01/videos'
];

let removed = 0;
let dirsRemoved = 0;
const errors = [];

for (const dir of dirs) {
  if (!fs.existsSync(dir)) { errors.push('不存在: ' + dir); continue; }
  for (const entry of fs.readdirSync(dir)) {
    const p = path.join(dir, entry);
    if (!entry.startsWith('shot')) continue;
    try {
      if (fs.statSync(p).isDirectory()) {
        for (const f of fs.readdirSync(p)) {
          if (f.endsWith('.mp4')) { fs.unlinkSync(path.join(p, f)); removed++; }
        }
        const left = fs.readdirSync(p);
        if (left.length === 0) { fs.rmdirSync(p); dirsRemoved++; }
      }
    } catch (e) { errors.push(p + ': ' + e.message); }
  }
}

console.log('删除 mp4: ' + removed + ' 个');
console.log('删除空目录: ' + dirsRemoved + ' 个');
console.log('错误: ' + (errors.length ? errors.join(' | ') : '无'));

// 最终核验
const c1 = require('child_process').execSync('find "/Volumes/brainos/CodexMedia/generated/现代短剧" -name "*.mp4"').toString().trim().split('\n').filter(Boolean).length;
const c2 = require('child_process').execSync('find "/Volumes/brainos/CodexMedia/generated/天道摆渡人" -name "*.mp4"').toString().trim().split('\n').filter(Boolean).length;
console.log('核验 残留 mp4 => 现代短剧: ' + c1 + ' / 天道摆渡人: ' + c2);

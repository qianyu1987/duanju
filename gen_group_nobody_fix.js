const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const BASE = '/Users/mac/Desktop/美女/refs';
const VID_OUT = '/Users/mac/Desktop/美女/videos';
const LOG = path.join(VID_OUT, 'group_nobody_fix.log');
const FF = '/Users/mac/.workbuddy/binaries/node/workspace/node_modules/ffmpeg-static/ffmpeg';

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(m) { const s = '[' + new Date().toISOString() + '] ' + m; console.log(s); try { fs.appendFileSync(LOG, s + '\n'); } catch (e) {} }

function apiPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({ hostname: 'apihub.agnes-ai.com', port: 443, path: '/v1/images/generations', method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY, 'Content-Length': Buffer.byteLength(body) } }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } }); });
    req.on('error', reject); req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); }); req.write(body); req.end();
  });
}
function apiVideo(endpoint, method, body) {
  return new Promise((resolve, reject) => {
    const b = body ? JSON.stringify(body) : null;
    const req = https.request({ hostname: 'apihub.agnes-ai.com', port: 443, path: endpoint, method, headers: Object.assign({ 'Authorization': 'Bearer ' + API_KEY, 'Content-Type': 'application/json' }, b ? { 'Content-Length': Buffer.byteLength(b) } : {}) }, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } }); });
    req.on('error', reject); req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); }); if (b) req.write(b); req.end();
  });
}
function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = u => https.get(u, res => { if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location); if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode)); const f = fs.createWriteStream(dest); res.pipe(f); f.on('finish', () => f.close(() => resolve(dest))); }).on('error', reject);
    follow(url);
  });
}
function b64(file) { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }

let lastSubmit = 0;
async function throttledSubmit(prompt, refImg) {
  const gap = 12000 - (Date.now() - lastSubmit);
  if (gap > 0) await sleep(gap);
  lastSubmit = Date.now();
  const payload = { model: 'agnes-video-v2.0', prompt, width: 720, height: 1280, num_frames: 241, frame_rate: 24, mode: 'ti2vid', image: refImg };
  const r = await apiVideo('/v1/videos', 'POST', payload);
  if (r.error) throw new Error(r.error.message || JSON.stringify(r));
  return r.task_id || r.id || (r.data && (r.data.task_id || r.data.id));
}
async function pollVideo(taskId) {
  const r = await apiVideo('/v1/videos/' + encodeURIComponent(taskId), 'GET', null);
  if (r.error) throw new Error(r.error.message);
  const d = r.data || r;
  return { status: String(d.status || '').toLowerCase(), videoUrl: d.url || d.video_url || (d.metadata && d.metadata.url) || null };
}
async function getHostedUrl(localPng) {
  let url = null;
  for (let a = 1; a <= 12; a++) {
    try { const r = await apiPost({ model: 'agnes-image-2.1-flash', prompt: 'rehost this exact character reference image, keep everything identical', size: '1K', ratio: '9:16', extra_body: { image: [b64(localPng)], response_format: 'url' } }); url = r.data && r.data[0] && r.data[0].url; if (url) break; } catch (e) { log('host retry ' + a + ': ' + e.message); await sleep(20000); }
  }
  return url;
}

const SEG_PROMPT = {
  1: 'The same person performs the iconic K-pop "Nobody" dance chorus: step-touch in place with left-right U-shaped hip sways, then the signature index-finger point-forward gesture (the "I want nobody nobody but you" pointing move) repeated to the beat. Bright studio, full body shot, rhythmic and cute, retro disco vibe, smooth motion. keep identical face hairstyle body shape and outfit as the reference image',
  2: 'The same person continues the "Nobody" dance: sustained side hip bumps, both hands doing retro wave motions up and down, then hands resting on own shoulders with small left-right body turns. Full body, energetic cute retro style, steady beat. keep identical face hairstyle body shape and outfit as the reference image',
  3: 'The same person finishes the "Nobody" dance: sitting-hip sways side to side, body gently rotating, ending with the signature shy hand-over-mouth pose holding still to camera. Full body, warm lighting, cute and confident. keep identical face hairstyle body shape and outfit as the reference image',
};
// 只需补齐：林霜s3、炽羽s1、书雅s1/2/3
const FIX = [
  { dir: '林霜', segs: [3] },
  { dir: '炽羽', segs: [1] },
  { dir: '书雅', segs: [1, 2, 3] },
];
const ORDER = ['柔光', '安白', '林霜', '炽羽', '书雅'];

async function genSeg(member, segId, refUrl) {
  const tag = member + '_s' + segId;
  let taskId = null;
  for (let a = 1; a <= 4; a++) { try { taskId = await throttledSubmit(SEG_PROMPT[segId], refUrl); if (taskId) break; } catch (e) { log(tag + ' submit retry ' + a + ': ' + e.message); await sleep(15000); } }
  if (!taskId) { log(tag + ' submit FAILED'); return null; }
  log(tag + ' task=' + taskId);
  let videoUrl = null;
  const start = Date.now();
  while (Date.now() - start < 420000) {
    await sleep(10000);
    try { const r = await pollVideo(taskId); if (r.status === 'completed' && r.videoUrl) { videoUrl = r.videoUrl; break; } if (r.status === 'failed' || r.status === 'error') break; } catch (e) { log(tag + ' poll err: ' + e.message); }
  }
  if (videoUrl) { const p = path.join(VID_OUT, member + '_nobody_' + String(segId).padStart(2, '0') + '.mp4'); await download(videoUrl, p); log(tag + ' done ' + (fs.statSync(p).size / 1048576).toFixed(2) + 'MB'); return p; }
  log(tag + ' FAILED'); return null;
}

async function main() {
  fs.mkdirSync(VID_OUT, { recursive: true });
  log('=== fix start ===');
  const refs = {};
  for (const f of FIX) { const url = await getHostedUrl(path.join(BASE, f.dir, 'fullbody.png')); if (!url) { log('!! ' + f.dir + ' host failed'); continue; } refs[f.dir] = url; log('hosted ' + f.dir); await sleep(3000); }

  for (const f of FIX) {
    if (!refs[f.dir]) continue;
    for (const s of f.segs) { await genSeg(f.dir, s, refs[f.dir]); }
  }
  log('=== 补齐完成，开始合成 ===');

  // 每人三段拼 30s（按 s1,s2,s3 顺序）
  const member30 = {};
  for (const m of ORDER) {
    const parts = [1, 2, 3].map(s => path.join(VID_OUT, m + '_nobody_' + String(s).padStart(2, '0') + '.mp4')).filter(p => fs.existsSync(p) && fs.statSync(p).size > 50000);
    if (parts.length === 0) { log('!! ' + m + ' 无片段，跳过'); continue; }
    const list = path.join(VID_OUT, m + '_segs.txt');
    fs.writeFileSync(list, parts.map(s => "file '" + s + "'").join('\n'));
    const out30 = path.join(VID_OUT, m + '_nobody_30s.mp4');
    execSync(`${FF} -y -f concat -safe 0 -i ${list} -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ${out30}`);
    member30[m] = out30; log('member30 ' + m);
  }
  const ordered = ORDER.map(m => member30[m]).filter(Boolean);
  if (ordered.length < 2) { log('成员不足，无法合成'); return; }
  const inputs = ordered.map(f => '-i ' + f).join(' ');
  const hstack = ordered.map((_, i) => '[' + i + ':v]').join('') + 'hstack=inputs=' + ordered.length + '[v]';
  const out = path.join(VID_OUT, '女团_Nobody_团体舞_30s.mp4');
  execSync(`${FF} -y ${inputs} -filter_complex "${hstack}" -map "[v]" -map "0:a" -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ${out}`);
  log('DONE -> ' + out);
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });

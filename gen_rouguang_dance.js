const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const BASE = '/Users/mac/Desktop/美女/refs';
const GROUP = path.join(BASE, 'group_base.jpg');
const ROU = path.join(BASE, '柔光');
const VID_OUT = '/Users/mac/Desktop/美女/videos';
const LOG = path.join(VID_OUT, 'rouguang_dance.log');
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

// 第一步：基于合照 m0 把柔光对齐（覆盖旧图，记录 URL 供视频引用）
async function alignRouguang() {
  const meta = await sharp(GROUP).metadata(); const W = meta.width, H = meta.height; const cw = Math.round(W / 5);
  const m0 = path.join(BASE, '_crops', 'm0.png');
  if (!fs.existsSync(m0)) { let left = Math.max(0, Math.min(Math.round(0 * W / 5 - cw * 0.05), W - cw)); await sharp(GROUP).extract({ left, top: 0, width: cw, height: H }).toFile(m0); }
  const refB64 = b64(m0);
  const shots = [
    { k: 'fullbody', p: 'Generate a single full-body shot of ONLY this person from head to toe, clean solid-color studio background, keep identical facial features hairstyle outfit and body shape as the reference image, short black hair, athletic toned figure wearing green sports bra and high-waisted yoga pants, photorealistic fashion photography, 9:16 vertical, masterpiece' },
    { k: 'pose', p: 'Generate a single medium full-shot of ONLY this person in a natural fitness pose, clean studio background, keep identical face hairstyle and outfit as the reference image, short black hair, green sports bra and yoga pants, photorealistic, 9:16 vertical' },
    { k: 'portrait', p: 'Generate a close-up portrait of ONLY this person face, same facial features hairstyle and makeup as the reference image, short black hair, soft studio lighting, photorealistic, 9:16 vertical, masterpiece' },
  ];
  const urls = {};
  for (const s of shots) {
    let url = null;
    for (let a = 1; a <= 12; a++) { try { const r = await apiPost({ model: 'agnes-image-2.1-flash', prompt: s.p, size: '1K', ratio: '9:16', extra_body: { image: [refB64], response_format: 'url' } }); url = r.data && r.data[0] && r.data[0].url; if (url) break; } catch (e) { log('align ' + s.k + ' retry ' + a + ': ' + e.message); await sleep(20000); } }
    if (url) { await download(url, path.join(ROU, s.k + '.png')); urls[s.k] = url; log('aligned ' + s.k); }
    await sleep(4000);
  }
  fs.writeFileSync(path.join(ROU, 'urls.json'), JSON.stringify(urls, null, 2));
  return urls.fullbody;
}

// 第二步：基于对齐图生成 3 段舞蹈视频
async function submitVideo(prompt, refImg) {
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
const SEGMENTS = [
  { id: 1, prompt: 'The same woman performs a graceful standing yoga flow, slowly raising both arms overhead, gentle side bend and waist twist, hair swaying softly, full body shot, bright modern yoga studio, soft natural sunlight, smooth cinematic camera movement, elegant fitness dance, keep identical face hairstyle body shape and outfit as the reference image' },
  { id: 2, prompt: 'The same woman does rhythmic hip and leg movements with side-to-side body sway, hair flowing with motion, energetic yet graceful fitness dance, dynamic camera, full body, yoga studio background, keep identical face hairstyle body shape and outfit as the reference image' },
  { id: 3, prompt: 'The same woman moves into a floor yoga pose variation then turns her head back to camera with a confident gentle smile, ending with a soft pose hold, warm morning light, full body, cinematic, keep identical face hairstyle body shape and outfit as the reference image' },
];
async function genSeg(seg, refUrl) {
  let taskId = null;
  for (let a = 1; a <= 3; a++) { try { taskId = await submitVideo(seg.prompt, refUrl); if (taskId) break; } catch (e) { log('seg' + seg.id + ' submit retry ' + a + ': ' + e.message); await sleep(15000); } }
  if (!taskId) { log('seg' + seg.id + ' submit FAILED'); return null; }
  log('seg' + seg.id + ' task=' + taskId);
  let videoUrl = null;
  const start = Date.now();
  while (Date.now() - start < 420000) {
    await sleep(10000);
    try {
      const r = await pollVideo(taskId);
      if (r.status === 'completed' && r.videoUrl) { videoUrl = r.videoUrl; break; }
      if (r.status === 'failed' || r.status === 'error') break;
    } catch (e) { log('seg' + seg.id + ' poll err: ' + e.message); }
  }
  if (videoUrl) {
    const p = path.join(VID_OUT, 'seg' + String(seg.id).padStart(2, '0') + '_10s.mp4');
    await download(videoUrl, p);
    log('seg' + seg.id + ' done ' + (fs.statSync(p).size / 1048576).toFixed(2) + 'MB');
    return p;
  }
  log('seg' + seg.id + ' FAILED');
  return null;
}

async function main() {
  fs.mkdirSync(VID_OUT, { recursive: true });
  log('=== 柔光舞蹈生成 start ===');
  const refUrl = await alignRouguang();
  log('refUrl=' + refUrl);
  const segs = await Promise.all(SEGMENTS.map(s => genSeg(s, refUrl)));
  const valid = segs.filter(Boolean);
  if (valid.length === 0) { log('无可用片段'); return; }
  const list = '/tmp/seglist_rg.txt';
  fs.writeFileSync(list, valid.map(s => "file '" + s + "'").join('\n'));
  const out = path.join(VID_OUT, '柔光_舞蹈_30s.mp4');
  const { execSync } = require('child_process');
  execSync(`${FF} -y -f concat -safe 0 -i ${list} -c:v libx264 -preset medium -crf 20 -pix_fmt yuv420p -c:a aac -b:a 128k -movflags +faststart ${out}`);
  log('DONE -> ' + out + ' (' + valid.length + ' segs)');
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });

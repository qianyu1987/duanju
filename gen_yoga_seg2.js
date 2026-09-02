const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const BASE_URL = 'apihub.agnes-ai.com';
const REF_DIR = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/refs';
const OUT = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/videos/seg02_10s.mp4';
const LOG = '/Volumes/brainos/website/xiaoshuo/workbuddy/短剧空间/drama_logs/yoga_seg2.log';

const REF_IMG = JSON.parse(fs.readFileSync(REF_DIR + '/urls.json', 'utf8')).FULL_BODY;
const PROMPT = "The woman does rhythmic hip and leg movements with side-to-side body sway, hair flowing with motion, energetic yet graceful fitness dance, dynamic camera, full body, yoga studio background, keep face and outfit consistent";

function log(m) { const t = `[${new Date().toISOString()}] ${m}`; console.log(t); try { fs.appendFileSync(LOG, t + '\n'); } catch (e) {} }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function apiRequest(endpoint, method, headers, body) {
  return new Promise((resolve, reject) => {
    const req = https.request({ hostname: BASE_URL, port: 443, path: endpoint, method, headers }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { resolve({ raw: d }); } });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

function extractTaskId(r) {
  if (!r || typeof r !== 'object') return null;
  return r.task_id || r.id || r.video_id ||
    (r.data && (r.data.task_id || r.data.id || r.data.video_id)) || null;
}

async function submit() {
  for (let i = 0; i < 6; i++) {
    try {
      const payload = { model: 'agnes-video-v2.0', prompt: PROMPT, width: 720, height: 1280, num_frames: 241, frame_rate: 24, mode: 'ti2vid', image: REF_IMG };
      const body = JSON.stringify(payload);
      const r = await apiRequest('/v1/videos', 'POST', { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY, 'Content-Length': Buffer.byteLength(body) }, body);
      const tid = extractTaskId(r);
      if (tid) { log('提交成功 task=' + tid); return tid; }
      log('提交响应无 taskId (重试 ' + (i + 1) + '/6): ' + JSON.stringify(r).slice(0, 200));
    } catch (e) { log('提交异常 (重试 ' + (i + 1) + '/6): ' + e.message); }
    await sleep(15000);
  }
  throw new Error('提交 seg2 失败：多次无 taskId');
}

async function poll(taskId) {
  const r = await apiRequest(`/v1/videos/${encodeURIComponent(taskId)}`, 'GET', { 'Authorization': 'Bearer ' + API_KEY }, null);
  const d = r.data || r;
  return { status: String(d.status || '').toLowerCase(), videoUrl: d.url || d.video_url || (d.metadata && d.metadata.url) || null };
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = u => https.get(u, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
    follow(url);
  });
}

(async () => {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  if (fs.existsSync(OUT) && fs.statSync(OUT).size > 10000) { log('seg2 已存在，跳过'); return; }
  const taskId = await submit();
  const start = Date.now();
  let url = null;
  while (Date.now() - start < 480000) {
    await sleep(10000);
    try {
      const r = await poll(taskId);
      if (r.status === 'completed' && r.videoUrl) { url = r.videoUrl; break; }
      if (r.status === 'failed' || r.status === 'error') { log('任务失败'); break; }
    } catch (e) { log('poll err: ' + e.message); }
  }
  if (!url) { log('seg2 轮询超时'); process.exit(1); }
  await download(url, OUT);
  log('seg2 下载完成 ' + (fs.statSync(OUT).size / 1024 / 1024).toFixed(2) + 'MB -> ' + OUT);
})().catch(e => { console.error('Fatal:', e.message); process.exit(1); });

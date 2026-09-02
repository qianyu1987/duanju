const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const BASE_URL = 'apihub.agnes-ai.com';
const REF_DIR = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/refs';
const OUT_DIR = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/videos';
const TASKS_FILE = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/tasks.json';
const LOG_FILE = '/Volumes/brainos/website/xiaoshuo/workbuddy/短剧空间/drama_logs/yoga_goddess.log';

const urls = JSON.parse(fs.readFileSync(REF_DIR + '/urls.json', 'utf8'));
const REF_IMG = urls.FULL_BODY; // 全身图锁人物一致性

// 3 段 × 10秒，竖版 9:16，共用同一参考图
const SEGMENTS = [
  { id: 1, prompt: "The woman performs a graceful standing yoga flow, slowly raising both arms overhead, gentle side bend and waist twist, long hair swaying softly, full body shot, bright modern yoga studio, soft natural sunlight, smooth cinematic camera movement, elegant fitness dance, keep face and outfit consistent" },
  { id: 2, prompt: "The woman does rhythmic hip and leg movements with side-to-side body sway, hair flowing with motion, energetic yet graceful fitness dance, dynamic camera, full body, yoga studio background, keep face and outfit consistent" },
  { id: 3, prompt: "The woman moves into a floor yoga pose variation then turns her head back to camera with a confident gentle smile, ending with a soft pose hold, warm morning light, full body, cinematic, keep face and outfit consistent" },
];

let tasks = {};
try { tasks = JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')); } catch (e) {}

function log(msg) {
  const t = `[${new Date().toISOString()}] ${msg}`;
  console.log(t);
  try { fs.appendFileSync(LOG_FILE, t + '\n'); } catch (e) {}
}
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

async function submitVideo(prompt, refImg) {
  const payload = {
    model: 'agnes-video-v2.0',
    prompt,
    width: 720, height: 1280,
    num_frames: 241, frame_rate: 24,
    mode: 'ti2vid',
    image: refImg,
  };
  const body = JSON.stringify(payload);
  const r = await apiRequest('/v1/videos', 'POST', {
    'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY,
    'Content-Length': Buffer.byteLength(body)
  }, body);
  if (r.error) throw new Error(r.error.message || JSON.stringify(r));
  return r.task_id || r.id || (r.data && (r.data.task_id || r.data.id));
}

async function pollVideo(taskId) {
  const r = await apiRequest(`/v1/videos/${encodeURIComponent(taskId)}`, 'GET', { 'Authorization': 'Bearer ' + API_KEY }, null);
  if (r.error) throw new Error(r.error.message);
  const d = r.data || r;
  const status = String(d.status || '').toLowerCase();
  const videoUrl = d.url || d.video_url || (d.metadata && d.metadata.url) || null;
  return { status, videoUrl };
}

function downloadVideo(url, dest) {
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

async function processSeg(seg, retry = 0) {
  const videoPath = path.join(OUT_DIR, `seg${String(seg.id).padStart(2, '0')}_10s.mp4`);
  if (fs.existsSync(videoPath) && fs.statSync(videoPath).size > 10000) {
    log(`seg${seg.id} 已存在，跳过`);
    return { id: seg.id, status: 'done' };
  }
  let taskId = tasks['seg' + seg.id];
  if (!taskId) {
    taskId = await submitVideo(seg.prompt, REF_IMG);
    tasks['seg' + seg.id] = taskId;
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
    log(`seg${seg.id} 提交 task=${taskId}`);
  } else {
    log(`seg${seg.id} 续跑 task=${taskId}`);
  }
  const start = Date.now();
  let videoUrl = null;
  while (Date.now() - start < 420000) {
    await sleep(10000);
    try {
      const r = await pollVideo(taskId);
      if (r.status === 'completed' && r.videoUrl) { videoUrl = r.videoUrl; log(`seg${seg.id} 完成`); break; }
      if (r.status === 'failed' || r.status === 'error') { log(`seg${seg.id} 失败`); break; }
    } catch (e) { log(`seg${seg.id} poll err: ${e.message}`); }
  }
  if (videoUrl) {
    await downloadVideo(videoUrl, videoPath);
    log(`seg${seg.id} 下载 ${(fs.statSync(videoPath).size / 1024 / 1024).toFixed(2)}MB -> ${videoPath}`);
    return { id: seg.id, status: 'done' };
  }
  if (retry < 2) { log(`seg${seg.id} 重试 ${retry + 1}`); await sleep(5000); return processSeg(seg, retry + 1); }
  return { id: seg.id, status: 'error' };
}

async function main() {
  fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
  fs.mkdirSync(OUT_DIR, { recursive: true });
  log('=== 柔光瑜伽视频生成 start, ref=' + REF_IMG + ' ===');
  // 并发提交3段（Agnes 5次/分，3<5 安全），各自轮询下载
  const results = await Promise.all(SEGMENTS.map(s => processSeg(s)));
  log('=== 完成 ===');
  log(JSON.stringify(results));
  const done = results.filter(r => r.status === 'done').length;
  log(`成功 ${done}/3`);
}
main().catch(e => { console.error('Fatal:', e); process.exit(1); });

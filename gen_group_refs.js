const https = require('https');
const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const BASE = '/Users/mac/Desktop/美女/refs';
const GROUP = path.join(BASE, 'group_base.jpg');
const LOG = path.join(BASE, '_crops', 'gen.log');

// 合照从左到右 0..4；0=柔光(已有)，1=安白,2=林霜,3=炽羽,4=书雅
const MEMBERS = [
  null,
  { dir: '安白', trait: 'gentle Chinese nurse woman, white nurse uniform with light blue trim, curly hair, warm tender smile' },
  { dir: '林霜', trait: 'confident Chinese businesswoman, black blazer suit set, white blouse, high heels, strong executive aura, arms crossed' },
  { dir: '炽羽', trait: 'cool Chinese warrior woman, blue and red armored battle outfit, long boots, white hair with colored streaks, fierce confident' },
  { dir: '书雅', trait: 'refined Chinese intellectual woman, beige long dress, glasses, low ponytail, gentle elegant' },
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
function log(m) { const s = '[' + new Date().toISOString() + '] ' + m; console.log(s); fs.appendFileSync(LOG, s + '\n'); }

function apiPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({
      hostname: 'apihub.agnes-ai.com', port: 443, path: '/v1/images/generations', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY, 'Content-Length': Buffer.byteLength(body) }
    }, res => {
      let d = ''; res.on('data', c => d += c);
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch (e) { reject(new Error(d.slice(0, 300))); } });
    });
    req.on('error', reject);
    req.setTimeout(180000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
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

function b64(file) { return 'data:image/png;base64,' + fs.readFileSync(file).toString('base64'); }

async function genImage(refB64, prompt, dest) {
  for (let attempt = 1; attempt <= 12; attempt++) {
    try {
      const result = await apiPost({
        model: 'agnes-image-2.1-flash',
        prompt,
        size: '1K',
        ratio: '9:16',
        extra_body: { image: [refB64], response_format: 'url' }
      });
      const url = result.data && result.data[0] && result.data[0].url;
      if (!url) throw new Error('no url: ' + JSON.stringify(result).slice(0, 200));
      await download(url, dest);
      return true;
    } catch (e) {
      log('  RETRY [' + attempt + '/12]: ' + e.message);
      await sleep(20000);
    }
  }
  return false;
}

const SHOTS = [
  { k: 'fullbody', p: 'Generate a single full-body shot of ONLY this person from head to toe, clean solid-color studio background, keep identical facial features, hairstyle, outfit and body shape as the reference image, {TRAIT}, photorealistic fashion photography, 9:16 vertical composition, masterpiece' },
  { k: 'pose', p: 'Generate a single medium full-shot of ONLY this person in a natural characteristic pose, clean studio background, keep identical face, hairstyle and outfit as the reference image, {TRAIT}, photorealistic, 9:16 vertical' },
  { k: 'portrait', p: 'Generate a close-up portrait of ONLY this person face, same facial features, hairstyle and makeup as the reference image, {TRAIT}, soft studio lighting, photorealistic, 9:16 vertical, masterpiece' },
];

(async () => {
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  log('START gen_group_refs');

  const meta = await sharp(GROUP).metadata();
  const W = meta.width, H = meta.height;
  log('group size ' + W + 'x' + H);

  const crops = [];
  const cw = Math.round(W / 5);
  for (let i = 0; i < 5; i++) {
    let left = Math.round(i * W / 5 - cw * 0.05);
    left = Math.max(0, Math.min(left, W - cw));
    const out = path.join(BASE, '_crops', 'm' + i + '.png');
    await sharp(GROUP).extract({ left, top: 0, width: cw, height: H }).toFile(out);
    crops.push(out);
    log('crop m' + i + ' -> ' + out);
  }

  for (let i = 1; i <= 4; i++) {
    const m = MEMBERS[i];
    const refB64 = b64(crops[i]);
    log('=== Member ' + m.dir + ' (ref ' + crops[i] + ') ===');
    for (const s of SHOTS) {
      const prompt = s.p.replace('{TRAIT}', m.trait);
      const dest = path.join(BASE, m.dir, s.k + '.png');
      log('gen ' + m.dir + '/' + s.k);
      const ok = await genImage(refB64, prompt, dest);
      log((ok ? 'OK ' : 'FAIL ') + m.dir + '/' + s.k);
      await sleep(4000);
    }
  }
  log('DONE');
})();

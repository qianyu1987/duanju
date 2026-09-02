const https = require('https');
const fs = require('fs');
const path = require('path');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const DIR = '/Volumes/brainos/CodexMedia/generated/ai_yoga_goddess/refs';

// 健康运动性感风：瑜伽裤+运动上衣，长发，不裸露不低俗
const REFS = [
  {
    key: 'FULL_BODY',
    file: 'yoga_fullbody.png',
    prompt: "A tall slender Chinese woman with long flowing black hair, wearing tight high-waisted yoga pants and a fitted cropped sports top showing a toned athletic figure with graceful curves, confident elegant posture, full body shot from head to toe, standing in a bright modern yoga studio with large windows, soft natural sunlight, healthy glowing skin, fitness influencer aesthetic, photorealistic fashion photography, 9:16 vertical composition, masterpiece"
  },
  {
    key: 'PORTRAIT',
    file: 'yoga_portrait.png',
    prompt: "Close-up portrait of a stunning Chinese woman with long wavy black hair, wearing a stylish sports top, gentle confident smile, radiant healthy skin, soft studio lighting, fitness influencer aesthetic, photorealistic, 9:16 vertical composition, masterpiece"
  },
];

const NEG = 'nude, naked, explicit, vulgar, low-quality, deformed, extra limbs, bad anatomy, watermark, text';

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
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
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

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const urls = {};
  try { Object.assign(urls, JSON.parse(fs.readFileSync(DIR + '/urls.json', 'utf8'))); } catch (e) {}
  console.log('已存在 URLs: ' + Object.keys(urls).join(', '));
  for (const r of REFS) {
    let ok = false;
    for (let attempt = 1; attempt <= 12 && !ok; attempt++) {
      try {
        const result = await apiPost({ model: 'agnes-image-2.1-flash', prompt: r.prompt, size: '768x1344' });
        const url = result.data && result.data[0] && result.data[0].url;
        if (!url) throw new Error('no url: ' + JSON.stringify(result).slice(0, 300));
        await download(url, DIR + '/' + r.file);
        urls[r.key] = url;
        console.log('OK ' + r.key + ' -> ' + url);
        ok = true;
      } catch (e) {
        console.log('RETRY ' + r.key + ' [' + attempt + '/12]: ' + e.message);
        await new Promise(res => setTimeout(res, 20000));
      }
    }
    if (!ok) console.log('FAIL ' + r.key + ': 放弃');
    await new Promise(res => setTimeout(res, 5000));
  }
  fs.writeFileSync(DIR + '/urls.json', JSON.stringify(urls, null, 2));
  console.log('saved ' + Object.keys(urls).length + ' urls to urls.json');
  console.log('URLS=' + JSON.stringify(urls));
})();

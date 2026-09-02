const https = require('https');
const fs = require('fs');

const API_KEY = 'cpk-jE3QzzqNRg5U8mNjABgRiu5i1Ha59bOTuRqvIALl4jqN2LUN';
const DIR = '/Volumes/brainos/CodexMedia/generated/现代短剧/ep01/refs';

const REFS = [
  { key: 'LINXIA_WORK', file: 'linxia_work.png', prompt: "A 28-year-old Chinese woman, short black hair bob cut, elegant independent designer, wearing simple white blouse, professional headshot facing camera, soft studio lighting, natural makeup, slight melancholy in her eyes, clean background, photorealistic portrait, cinematic lighting, 4K" },
  { key: 'LINXIA_CASUAL', file: 'linxia_casual.png', prompt: "A 28-year-old Chinese woman, short black hair bob cut, gentle sweet smile, wearing beige knit sweater, three-quarter view, warm sunlight, natural makeup, cozy atmosphere, photorealistic portrait, cinematic lighting, 4K" },
  { key: 'LINXIA_RAIN', file: 'linxia_rain.png', prompt: "A 28-year-old Chinese woman, short black hair slightly wet, standing in rain without umbrella, melancholic expression, raindrops on face, white blouse, moody cinematic close-up, dramatic lighting, photorealistic, 4K" },
  { key: 'CHENMO_FORMAL', file: 'chenmo_formal.png', prompt: "A 30-year-old Chinese man, neat dark hair, wearing thin glasses, professional architect, dark suit with white shirt, calm confident expression facing camera, office background, soft professional lighting, photorealistic portrait, 4K" },
  { key: 'CHENMO_CASUAL', file: 'chenmo_casual.png', prompt: "A 30-year-old Chinese man, short dark hair, wearing thin glasses, simple white t-shirt, relaxed gentle smile, outdoor cafe setting, warm afternoon sunlight, photorealistic portrait, 4K" },
  { key: 'SUXIAO_FASHION', file: 'suxiao_fashion.png', prompt: "A 27-year-old Chinese woman, long wavy black hair, fashionable energetic vlogger, colorful trendy outfit, bright cheerful smile holding phone, vibrant lifestyle photography, photorealistic portrait, 4K" },
  { key: 'SUXIAO_CAFE', file: 'suxiao_cafe.png', prompt: "A 27-year-old Chinese woman, long black hair ponytail, casual comfortable clothing, sitting at cafe table with coffee, warm friendly expression, soft indoor lighting, photorealistic lifestyle photo, 4K" },
];

function apiPost(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req = https.request({ hostname: 'apihub.agnes-ai.com', port: 443, path: '/v1/images/generations', method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + API_KEY, 'Content-Length': Buffer.byteLength(body) } },
      res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d)); } catch(e) { reject(new Error(d.slice(0,200))); } }); });
    req.on('error', reject);
    req.setTimeout(120000, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body); req.end();
  });
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const follow = u => https.get(u, res => {
      if (res.statusCode === 301 || res.statusCode === 302) return follow(res.headers.location);
      if (res.statusCode !== 200) return reject(new Error('HTTP ' + res.statusCode + ' for ' + u));
      const file = fs.createWriteStream(dest);
      res.pipe(file);
      file.on('finish', () => file.close(() => resolve(dest)));
    }).on('error', reject);
    follow(url);
  });
}

(async () => {
  const urls = {};
  for (const r of REFS) {
    try {
      const result = await apiPost({ model: 'agnes-image-2.1-flash', prompt: r.prompt, size: '1024x1024' });
      const url = result.data && result.data[0] && result.data[0].url;
      if (!url) throw new Error('no url: ' + JSON.stringify(result).slice(0, 200));
      await download(url, DIR + '/' + r.file);
      urls[r.key] = url;
      console.log('OK ' + r.key + ' -> ' + url);
    } catch (e) {
      console.log('FAIL ' + r.key + ': ' + e.message);
    }
    await new Promise(res => setTimeout(res, 3000));
  }
  fs.writeFileSync(DIR + '/urls.json', JSON.stringify(urls, null, 2));
  console.log('saved ' + Object.keys(urls).length + ' urls to urls.json');
})();

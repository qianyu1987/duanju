/**
 * AI 创作台 - 多用户后端服务（零依赖，Node 18+）
 * 职责：静态文件服务 + JSON 文件存储 + 用户注册登录 + Agnes API 代理 + 广场/留言 + 管理后台 API
 * 启动：node server.js  （PORT 环境变量优先，默认 3000）
 */
"use strict";
const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const dns = require("dns").promises;
let sharp;
try { sharp = require("sharp"); } catch (e) { sharp = null; }

const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, "data");
const PORT = process.env.PORT || 3000;
const SESSION_TTL = 7 * 86400000; // 7 天

/* ---------------- 数据层 ---------------- */
function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}
function loadJSON(name, fallback) {
  try { return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), "utf8")); }
  catch (e) { return fallback; }
}
function saveJSON(name, data) {
  ensureDataDir();
  const f = path.join(DATA_DIR, name);
  const tmp = f + ".tmp." + Date.now();
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf8");
  fs.renameSync(tmp, f);
}

function defaultConfig() {
  return {
    agnesApiKey: "",
    base: "https://apihub.agnes-ai.com/v1",
    textModel: "agnes-2.5-flash",
    imageModel: "agnes-image-2.1-flash",
    videoModel: "agnes-video-2.5-flash",
    adminUsers: [],
    version: "1.0.1",
    changelog: [
      "多渠道体系：14 个主流渠道预设（OpenAI/DeepSeek/Kimi/智谱/通义等）+ 管理后台渠道管理 + 用户自定义渠道开关"
    ]
  };
}
function loadConfig() {
  const c = loadJSON("config.json", {});
  return Object.assign(defaultConfig(), c);
}
function saveConfig(c) { saveJSON("config.json", c); }

/* 环境变量优先（部署时注入） */
function getConfig() {
  const c = loadConfig();
  if (process.env.AGNES_API_KEY) c.agnesApiKey = process.env.AGNES_API_KEY;
  if (process.env.AGNES_BASE) c.base = process.env.AGNES_BASE;
  if (process.env.AGNES_TEXT_MODEL) c.textModel = process.env.AGNES_TEXT_MODEL;
  if (process.env.AGNES_IMAGE_MODEL) c.imageModel = process.env.AGNES_IMAGE_MODEL;
  if (process.env.AGNES_VIDEO_MODEL) c.videoModel = process.env.AGNES_VIDEO_MODEL;
  if (process.env.ADMIN_USER) c.adminUsers = process.env.ADMIN_USER.split(",").map(s => s.trim()).filter(Boolean);
  if (c.allowUserChannels === undefined) c.allowUserChannels = true;
  return c;
}

/* ---------------- 渠道体系 ---------------- */
/* 预设主流渠道模板（填 Key 后启用即可用） */
const CHANNEL_SEED = [
  // ===== 文本（OpenAI 兼容 chat/completions）=====
  { id: "c_agnes_text",   name: "Agnes AI 文本",     kind: "text",  adapter: "chat-compat",   baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-2.5-flash", note: "官方免费，默认已启用" },
  { id: "c_openai_text",  name: "OpenAI",            kind: "text",  adapter: "chat-compat",   baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini", note: "填入 OpenAI Key 后启用" },
  { id: "c_deepseek_text", name: "DeepSeek 深度求索", kind: "text",  adapter: "chat-compat",   baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat", note: "填入 DeepSeek Key 后启用" },
  { id: "c_kimi_text",    name: "Kimi 月之暗面",      kind: "text",  adapter: "chat-compat",   baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k", note: "填入 Moonshot Key 后启用" },
  { id: "c_glm_text",     name: "智谱 GLM",          kind: "text",  adapter: "chat-compat",   baseUrl: "https://open.bigmodel.cn/api/paas/v4", model: "glm-4-flash", note: "填入智谱 Key 后启用" },
  { id: "c_qwen_text",    name: "通义千问",           kind: "text",  adapter: "chat-compat",   baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", note: "填入阿里云 DashScope Key 后启用" },
  { id: "c_silicon_text", name: "硅基流动 SiliconFlow", kind: "text", adapter: "chat-compat",  baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-7B-Instruct", note: "填入硅基流动 Key 后启用" },
  { id: "c_doubao_text",  name: "豆包 火山方舟",      kind: "text",  adapter: "chat-compat",   baseUrl: "https://ark.cn-beijing.volces.com/api/v3", model: "doubao-seed-1.6-flash", note: "填入火山方舟 Key 后启用" },
  { id: "c_hunyuan_text", name: "腾讯混元",           kind: "text",  adapter: "chat-compat",   baseUrl: "https://api.hunyuan.cloud.tencent.com/v1", model: "hunyuan-turbos", note: "填入混元 Key 后启用" },
  // ===== 图片（OpenAI 兼容 images/generations）=====
  { id: "c_agnes_image",  name: "Agnes AI 图片",     kind: "image", adapter: "image-compat",  baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-image-2.1-flash", note: "官方免费，默认已启用，支持 1K-4K 档位" },
  { id: "c_openai_image", name: "OpenAI DALL·E",     kind: "image", adapter: "image-compat",  baseUrl: "https://api.openai.com/v1", model: "dall-e-3", note: "填入 OpenAI Key 后启用，固定 1024x1024" },
  { id: "c_silicon_image", name: "硅基流动 FLUX",    kind: "image", adapter: "image-compat",  baseUrl: "https://api.siliconflow.cn/v1", model: "black-forest-labs/FLUX.1-schnell", note: "填入硅基流动 Key 后启用" },
  { id: "c_qwen_image",   name: "通义万相",          kind: "image", adapter: "image-compat",  baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "wanx2.1-t2i-turbo", note: "填入阿里云 DashScope Key 后启用" },
  // ===== 视频（Agnes 异步任务）=====
  { id: "c_agnes_video",  name: "Agnes AI 视频",     kind: "video", adapter: "video-agnes",   baseUrl: "https://apihub.agnes-ai.com/v1", model: "agnes-video-v2.0", note: "官方免费，默认已启用（更多视频渠道适配中）" }
];
function ensureChannels() {
  const f = path.join(DATA_DIR, "channels.json");
  if (fs.existsSync(f)) return;
  const cfg = getConfig();
  const channels = CHANNEL_SEED.map(c => Object.assign({}, c, {
    apiKey: "", isPreset: true, enabled: c.id === "c_agnes_text" || c.id === "c_agnes_image" || c.id === "c_agnes_video",
    createdBy: "system", sort: 0
  }));
  // Agnes 渠道的 Key 从既有 config 继承（兼容旧配置）
  channels.forEach(c => {
    if (c.id === "c_agnes_text" && cfg.agnesApiKey) c.apiKey = cfg.agnesApiKey;
    if (c.id === "c_agnes_image" && cfg.agnesApiKey) c.apiKey = cfg.agnesApiKey;
    if (c.id === "c_agnes_video" && cfg.agnesApiKey) c.apiKey = cfg.agnesApiKey;
  });
  saveJSON("channels.json", channels);
}
function loadChannels() { return loadJSON("channels.json", []); }
function channelKey(ch) {
  // 预设 Agnes 渠道 Key 为空时从 config 兜底（兼容旧的 agnesApiKey 配置）
  if (!ch.apiKey && ch.id && ch.id.startsWith("c_agnes_")) {
    const cfg = getConfig();
    if (cfg.agnesApiKey) return cfg.agnesApiKey;
  }
  return ch.apiKey || "";
}
function pickChannel(kind, user) {
  const channels = loadChannels();
  // 1. 该用户自己创建的、启用的渠道优先
  if (user) {
    const own = channels.find(c => !c.isPreset && c.createdBy === user.id && c.kind === kind && c.enabled);
    if (own) return own;
  }
  // 2. 预设/全局启用的渠道
  const cfg = getConfig();
  const defKey = "default" + kind.charAt(0).toUpperCase() + kind.slice(1) + "Channel";
  const def = cfg[defKey];
  if (def) {
    const c = channels.find(x => x.id === def && x.kind === kind && x.enabled);
    if (c) return c;
  }
  return channels.find(c => c.kind === kind && c.enabled) || null;
}
function sanitizeChannel(c) {
  // 对外隐藏 Key
  return { id: c.id, name: c.name, kind: c.kind, adapter: c.adapter, baseUrl: c.baseUrl, model: c.model, note: c.note || "", isPreset: !!c.isPreset, enabled: !!c.enabled, createdBy: c.createdBy, hasKey: !!c.apiKey, sort: c.sort || 0 };
}

/* ---------------- 认证 ---------------- */
function hashPassword(pw, salt) {
  salt = salt || crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(pw, salt, 64).toString("hex");
  return { salt, hash };
}
function verifyPassword(pw, salt, expected) {
  try {
    const h = crypto.scryptSync(pw, salt, 64);
    return crypto.timingSafeEqual(h, Buffer.from(expected, "hex"));
  } catch (e) { return false; }
}
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("hex");
  const sessions = loadJSON("sessions.json", {});
  sessions[token] = { userId, createdAt: Date.now(), expiresAt: Date.now() + SESSION_TTL };
  saveJSON("sessions.json", sessions);
  return token;
}
function getUserByToken(req) {
  const auth = req.headers.authorization || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (!token) return null;
  const sessions = loadJSON("sessions.json", {});
  const s = sessions[token];
  if (!s || s.expiresAt < Date.now()) return null;
  const users = loadJSON("users.json", []);
  return users.find(u => u.id === s.userId) || null;
}

/* ---------------- 工具 ---------------- */
function localDate(ts) {
  const d = new Date(ts || Date.now());
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function genId(prefix) { return prefix + "_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
function sanitizeResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out = {};
  for (const key of ["text", "url", "videoUrl", "b64", "taskId", "channel"]) {
    if (typeof value[key] !== "string") continue;
    const max = key === "text" ? 100000 : key === "b64" ? 12e6 : 2048;
    const v = value[key].slice(0, max);
    if (["url", "videoUrl"].includes(key) && !/^https?:\/\/[^\s"'<>]+$/i.test(v)) continue;
    if (key === "b64" && !/^data:image\/(?:png|jpe?g|webp);base64,[a-z0-9+/=]+$/i.test(v)) continue;
    out[key] = v;
  }
  return out;
}
function sendJSON(res, status, obj) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(obj));
}
function ok(res, data) { sendJSON(res, 200, { ok: true, data }); }
function fail(res, status, msg) { sendJSON(res, status, { ok: false, error: msg }); }
function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", c => { data += c; if (data.length > 8e6) { req.destroy(); reject(new Error("请求体过大")); } });
    req.on("end", () => { try { resolve(data ? JSON.parse(data) : {}); } catch (e) { reject(new Error("JSON 解析失败")); } });
    req.on("error", reject);
  });
}
function requireUser(req, res) {
  const u = getUserByToken(req);
  if (!u) { fail(res, 401, "未登录或登录已过期"); return null; }
  return u;
}
function requireAdmin(req, res) {
  const u = requireUser(req, res);
  if (!u) return null;
  if (!u.isAdmin) { fail(res, 403, "无管理员权限"); return null; }
  return u;
}
function localIp() {
  const nets = require("os").networkInterfaces();
  for (const k of Object.keys(nets)) {
    for (const n of nets[k]) {
      if (n.family === "IPv4" && !n.internal) return n.address;
    }
  }
  return "127.0.0.1";
}

// Remote URLs are user-controlled (image references and custom channels). Keep
// the server from reaching loopback, link-local, or private network services.
async function assertSafeRemoteUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch (e) { throw new Error("URL 格式不正确"); }
  if (!/^https?:$/.test(u.protocol) || u.username || u.password) throw new Error("仅支持无认证的 HTTP(S) URL");
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new Error("禁止访问内部主机");
  }
  const isPrivate = ip => {
    const v = String(ip).toLowerCase();
    if (v.startsWith("::ffff:")) return isPrivate(v.slice(7));
    if (v === "::1" || v === "0:0:0:0:0:0:0:1" || v.startsWith("fc") || v.startsWith("fd") || v.startsWith("fe80:")) return true;
    const m = v.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
    if (!m) return false;
    const a = Number(m[1]), b = Number(m[2]);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  };
  if (isPrivate(host)) throw new Error("禁止访问内网地址");
  try {
    const records = await dns.lookup(host, { all: true, verbatim: true });
    if (!records.length || records.some(r => isPrivate(r.address))) throw new Error("禁止访问内网地址");
  } catch (e) {
    if (e.message === "禁止访问内网地址") throw e;
    throw new Error("无法解析远程主机");
  }
  return u.toString();
}

const UPSTREAM_TIMEOUT_MS = 60000;
const CHANNELS = { text: 14400, image: 4000, video: 500 }; // Agnes 官方每日配额（免费）
function recordUsage(type, durationSec) {
  const d = localDate();
  const data = loadJSON("usage.json", {});
  if (!data[d]) data[d] = { text: 0, image: 0, video: 0 };
  if (type === "video") { data[d].video = Math.round((data[d].video || 0) + durationSec); }
  else { data[d][type] = (data[d][type] || 0) + 1; }
  saveJSON("usage.json", data);
}
function upstreamSignal() { return AbortSignal.timeout(UPSTREAM_TIMEOUT_MS); }

/* ---------------- 渠道代理（按渠道分发） ---------------- */
async function forwardChat(ch, body) {
  const key = channelKey(ch);
  const res = await fetch(ch.baseUrl + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    // agnes-2.5-flash 为推理模型：输出前会消耗一部分推理 token，max_tokens 建议设大（官方最佳实践）
    body: JSON.stringify({ model: ch.model, messages: body.messages, max_tokens: Math.min(Math.max(body.max_tokens || 0, 4000), 16000), stream: false }),
    signal: upstreamSignal()
  });
  if (!res.ok) throw new Error("上游 HTTP " + res.status + "：" + (await res.text()).slice(0, 400));
  const data = await res.json();
  const msg = data.choices && data.choices[0] && data.choices[0].message;
  if (!msg) throw new Error("上游响应格式异常：" + JSON.stringify(data).slice(0, 300));
  const content = msg.content;
  const text = typeof content === "string" ? content : (Array.isArray(content) ? content.map(x => x.text || "").join("") : JSON.stringify(content));
  // 推理模型兜底：content 为空但存在 reasoning 时返回推理内容，避免空输出
  if (!text && msg.reasoning_content) return String(msg.reasoning_content);
  return text;
}
async function forwardImage(ch, body) {
  const key = channelKey(ch);
  // Agnes 渠道支持 size 档位 + ratio；其他 OpenAI 兼容图片渠道固定 1024x1024（通用）
  const payload = { model: ch.model, prompt: body.prompt, n: 1 };
  if (ch.id === "c_agnes_image") {
    payload.size = body.size || "2K";
    payload.ratio = body.ratio || "1:1";
  } else {
    payload.size = "1024x1024";
  }
  const res = await fetch(ch.baseUrl + "/images/generations", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(payload), signal: upstreamSignal()
  });
  if (!res.ok) throw new Error("上游 HTTP " + res.status + "：" + (await res.text()).slice(0, 400));
  const data = await res.json();
  const d = (data.data && data.data[0]) || data;
  if (d.url) return { url: d.url };
  if (d.b64_json) return { b64: "data:image/png;base64," + d.b64_json };
  throw new Error("上游未返回图片：" + JSON.stringify(data).slice(0, 300));
}
function vidDims(ratio) {
  // v2.0 按预设档位映射：720p 标准尺寸（对应文档 720P 档位）
  if (ratio === "9:16") return { width: 720, height: 1280 };
  if (ratio === "1:1") return { width: 720, height: 720 };
  return { width: 1280, height: 720 };
}
function vidFrames(len) { return len === "18" ? 441 : len === "10" ? 241 : 121; }
async function forwardVideoCreate(ch, body) {
  const key = channelKey(ch);
  const dims = vidDims(body.ratio);
  const images = Array.isArray(body.images) ? body.images.filter(u => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 4) : [];
  const payload = { model: ch.model, prompt: body.prompt, width: dims.width, height: dims.height, num_frames: vidFrames(body.len), frame_rate: 24 };
  if (images.length >= 2) {
    // 图生视频：multi_reference 至少 2 张，最后一张作为背景
    payload.mode = "multi_reference";
    payload.image = images;
  } else {
    payload.mode = "ti2vid";
  }
  const res = await fetch(ch.baseUrl + "/videos", {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": "Bearer " + key },
    body: JSON.stringify(payload), signal: upstreamSignal()
  });
  if (!res.ok) throw new Error("上游 HTTP " + res.status + "：" + (await res.text()).slice(0, 400));
  const data = await res.json();
  const taskId = data.task_id || data.id || (data.data && (data.data.task_id || data.data.id));
  if (!taskId) throw new Error("上游未返回任务ID：" + JSON.stringify(data).slice(0, 300));
  return taskId;
}
async function forwardVideoPoll(ch, taskId) {
  const key = channelKey(ch);
  const res = await fetch(ch.baseUrl + "/videos/" + encodeURIComponent(taskId), {
    headers: { "Authorization": "Bearer " + key }, signal: upstreamSignal()
  });
  if (!res.ok) throw new Error("上游 HTTP " + res.status + "：" + (await res.text()).slice(0, 300));
  const data = await res.json();
  const d = data.data || data;
  const status = String(d.status || "").toLowerCase();
  // 实测字段为 url；兼容 video_url / remixed_from_video_id
  const videoUrl = d.video_url || d.url || d.remixed_from_video_id || d.video || null;
  return { status, videoUrl, raw: data };
}
async function forwardByChannel(ch, action, body, taskId) {
  // Validate at use time too, so channels created before this check cannot be
  // used as a server-side request forgery primitive.
  await assertSafeRemoteUrl(ch.baseUrl);
  if (ch.adapter === "chat-compat") return forwardChat(ch, body);
  if (ch.adapter === "image-compat") return forwardImage(ch, body);
  if (ch.adapter === "video-agnes") {
    if (action === "create") return forwardVideoCreate(ch, body);
    if (action === "poll") return forwardVideoPoll(ch, taskId);
  }
  throw new Error("渠道「" + ch.name + "」的适配器暂未实现：" + (ch.adapter || "unknown"));
}

/* ---------------- 内容 / 统计 ---------------- */
function addPost(user, body) {
  const posts = loadJSON("posts.json", []);
  const post = {
    id: genId("p"),
    userId: user.id,
    username: user.username,
    type: body.type,
    prompt: String(body.prompt || "").trim().slice(0, 2000),
    params: body.params && typeof body.params === "object" ? body.params : {},
    result: sanitizeResult(body.result),
    status: body.status === "pending" ? "pending" : "done",
    createdAt: Date.now()
  };
  posts.push(post);
  saveJSON("posts.json", posts);
  return post;
}
function computeStats() {
  const posts = loadJSON("posts.json", []);
  const users = loadJSON("users.json", []);
  const today = localDate();
  const byType = { text: 0, image: 0, video: 0, drama: 0, post: 0 };
  const byUser = {};
  const trendMap = {};
  let todayCount = 0, doneCount = 0, failCount = 0, pendingCount = 0;
  posts.forEach(p => {
    byType[p.type] = (byType[p.type] || 0) + 1;
    if (!byUser[p.userId]) byUser[p.userId] = { username: p.username, total: 0, image: 0, video: 0, text: 0, drama: 0, post: 0 };
    const u = byUser[p.userId];
    u.total++;
    u[p.type] = (u[p.type] || 0) + 1;
    const d = localDate(p.createdAt);
    trendMap[d] = (trendMap[d] || 0) + 1;
    if (d === today) todayCount++;
    if (p.status === "done") doneCount++;
    if (p.status === "failed") failCount++;
    if (p.status === "pending") pendingCount++;
  });
  const trend = [];
  for (let i = 29; i >= 0; i--) {
    const d = localDate(Date.now() - i * 86400000);
    trend.push({ date: d, count: trendMap[d] || 0 });
  }
  return {
    userCount: users.length,
    postCount: posts.length,
    todayCount,
    doneCount,
    failCount,
    pendingCount,
    byType,
    byUser: Object.values(byUser).sort((a, b) => b.total - a.total),
    trend
  };
}

/* ---------------- 路由 ---------------- */
async function handleAPI(req, res, method, p, url) {
  /* ---- 公共：版本 ---- */
  if (p === "/api/version" && method === "GET") {
    const cfg = getConfig();
    return ok(res, { version: cfg.version || "1.0.0", changelog: cfg.changelog || [] });
  }
  /* ---- 认证 ---- */
  if (p === "/api/register" && method === "POST") {
    const b = await readBody(req);
    const username = String(b.username || "").trim();
    const password = String(b.password || "");
    if (username.length < 3 || username.length > 20) return fail(res, 400, "用户名需 3-20 位");
    if (!/^[\w\u4e00-\u9fa5-]+$/.test(username)) return fail(res, 400, "用户名仅支持中文、字母、数字、下划线、连字符");
    if (password.length < 6) return fail(res, 400, "密码至少 6 位");
    const users = loadJSON("users.json", []);
    if (users.some(u => u.username === username)) return fail(res, 409, "用户名已被注册");
    const cfg = getConfig();
    const isAdmin = (cfg.adminUsers || []).includes(username) || users.length === 0;
    const { salt, hash } = hashPassword(password);
    const user = { id: genId("u"), username, passSalt: salt, passHash: hash, isAdmin, createdAt: Date.now() };
    users.push(user);
    saveJSON("users.json", users);
    if (isAdmin && users.length === 1) { // 首个注册兜底为 admin
      cfg.adminUsers = cfg.adminUsers || [];
      if (!cfg.adminUsers.includes(username)) { cfg.adminUsers.push(username); saveConfig(cfg); }
    }
    const token = createSession(user.id);
    return ok(res, { token, user: { username, isAdmin } });
  }
  if (p === "/api/login" && method === "POST") {
    const b = await readBody(req);
    const users = loadJSON("users.json", []);
    const u = users.find(x => x.username === String(b.username || "").trim());
    if (!u || !verifyPassword(String(b.password || ""), u.passSalt, u.passHash)) return fail(res, 401, "用户名或密码错误");
    const token = createSession(u.id);
    return ok(res, { token, user: { username: u.username, isAdmin: u.isAdmin } });
  }
  if (p === "/api/me" && method === "GET") {
    const u = requireUser(req, res); if (!u) return;
    return ok(res, { username: u.username, isAdmin: u.isAdmin, createdAt: u.createdAt });
  }
  if (p === "/api/logout" && method === "POST") {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
    if (token) { const sessions = loadJSON("sessions.json", {}); delete sessions[token]; saveJSON("sessions.json", sessions); }
    return ok(res, { loggedOut: true });
  }

  /* ---- 代理（需登录，按渠道分发） ---- */
  if (p.startsWith("/api/proxy/")) {
    const u = requireUser(req, res); if (!u) return;
    if (p === "/api/proxy/chat" && method === "POST") {
      const b = await readBody(req);
      if (!b.messages || !Array.isArray(b.messages)) return fail(res, 400, "messages 参数缺失");
      const ch = pickChannel("text", u);
      if (!ch) return fail(res, 500, "没有可用的文本渠道，请管理员在后台启用，或添加自定义渠道");
      if (!channelKey(ch)) return fail(res, 500, "文本渠道「" + ch.name + "」未配置 API Key");
      const text = await forwardByChannel(ch, "chat", b);
      recordUsage("text");
      return ok(res, { text, channel: ch.name });
    }
    if (p === "/api/proxy/image" && method === "POST") {
      const b = await readBody(req);
      if (!b.prompt) return fail(res, 400, "prompt 参数缺失");
      const ch = pickChannel("image", u);
      if (!ch) return fail(res, 500, "没有可用的图片渠道，请管理员在后台启用，或添加自定义渠道");
      if (!channelKey(ch)) return fail(res, 500, "图片渠道「" + ch.name + "」未配置 API Key");
      const r = await forwardByChannel(ch, "image", b);
      recordUsage("image");
      return ok(res, Object.assign(r, { channel: ch.name }));
    }
    if (p === "/api/proxy/video" && method === "POST") {
      const b = await readBody(req);
      if (!b.prompt) return fail(res, 400, "prompt 参数缺失");
      const ch = pickChannel("video", u);
      if (!ch) return fail(res, 500, "没有可用的视频渠道，请管理员在后台启用，或添加自定义渠道");
      if (!channelKey(ch)) return fail(res, 500, "视频渠道「" + ch.name + "」未配置 API Key");
      const taskId = await forwardByChannel(ch, "create", b);
      recordUsage("video", Number(b.len) || 6);
      return ok(res, { taskId, channel: ch.name });
    }
    if (p.startsWith("/api/proxy/video/") && method === "GET") {
      const taskId = decodeURIComponent(p.slice("/api/proxy/video/".length));
      if (!taskId) return fail(res, 400, "缺少任务ID");
      const ch = pickChannel("video", u);
      if (!ch) return fail(res, 500, "没有可用的视频渠道");
      const r = await forwardByChannel(ch, "poll", null, taskId);
      return ok(res, r);
    }
    return fail(res, 404, "代理端点不存在");
  }

  /* ---- 渠道（需登录） ---- */
  if (p === "/api/channels" && method === "GET") {
    const u = requireUser(req, res); if (!u) return;
    const cfg = getConfig();
    const channels = loadChannels();
    const list = channels
      .filter(c => (c.enabled && !c.isPreset) || c.enabled || c.createdBy === u.id || c.isPreset)
      .map(c => { const s = sanitizeChannel(c); s.owned = c.createdBy === u.id; return s; });
    return ok(res, { allowUserChannels: cfg.allowUserChannels, list });
  }
  if (p === "/api/channels" && method === "POST") {
    const u = requireUser(req, res); if (!u) return;
    const cfg = getConfig();
    if (!cfg.allowUserChannels && !u.isAdmin) return fail(res, 403, "管理员已关闭自定义渠道功能");
    const b = await readBody(req);
    const name = String(b.name || "").trim().slice(0, 30);
    const kind = String(b.kind || "");
    const baseUrl = String(b.baseUrl || "").trim().replace(/\/+$/, "");
    const model = String(b.model || "").trim().slice(0, 80);
    const apiKey = String(b.apiKey || "").trim().slice(0, 300);
    if (!name) return fail(res, 400, "渠道名称不能为空");
    if (!["text", "image", "video"].includes(kind)) return fail(res, 400, "type 必须为 text/image/video");
    if (!/^https?:\/\//.test(baseUrl)) return fail(res, 400, "Base URL 必须以 http(s):// 开头");
    try { await assertSafeRemoteUrl(baseUrl); } catch (e) { return fail(res, 400, e.message); }
    if (!model) return fail(res, 400, "模型名不能为空");
    if (!apiKey) return fail(res, 400, "API Key 不能为空");
    const adapter = kind === "text" ? "chat-compat" : kind === "image" ? "image-compat" : "video-agnes";
    const ch = { id: genId("c"), name, kind, adapter, baseUrl, model, apiKey, note: "用户自定义", isPreset: false, enabled: true, createdBy: u.id, sort: 0 };
    const channels = loadChannels();
    channels.push(ch);
    saveJSON("channels.json", channels);
    return ok(res, sanitizeChannel(ch));
  }
  if (p.startsWith("/api/channels/") && method === "PATCH") {
    const u = requireUser(req, res); if (!u) return;
    const id = p.slice("/api/channels/".length);
    const channels = loadChannels();
    const ch = channels.find(x => x.id === id);
    if (!ch) return fail(res, 404, "渠道不存在");
    if (!u.isAdmin && ch.createdBy !== u.id) return fail(res, 403, "只能管理自己的渠道");
    const b = await readBody(req);
    if (b.name !== undefined) ch.name = String(b.name).trim().slice(0, 30) || ch.name;
    if (b.baseUrl !== undefined) {
      const nextBase = String(b.baseUrl).trim().replace(/\/+$/, "");
      if (nextBase) {
        try { await assertSafeRemoteUrl(nextBase); } catch (e) { return fail(res, 400, e.message); }
        ch.baseUrl = nextBase;
      }
    }
    if (b.model !== undefined) ch.model = String(b.model).trim().slice(0, 80) || ch.model;
    if (b.apiKey !== undefined && String(b.apiKey).trim()) ch.apiKey = String(b.apiKey).trim().slice(0, 300);
    if (b.enabled !== undefined && (u.isAdmin || !ch.isPreset)) ch.enabled = !!b.enabled;
    saveJSON("channels.json", channels);
    return ok(res, sanitizeChannel(ch));
  }
  if (p.startsWith("/api/channels/") && method === "DELETE") {
    const u = requireUser(req, res); if (!u) return;
    const id = p.slice("/api/channels/".length);
    const channels = loadChannels();
    const idx = channels.findIndex(x => x.id === id);
    if (idx < 0) return fail(res, 404, "渠道不存在");
    if (!u.isAdmin && channels[idx].createdBy !== u.id) return fail(res, 403, "只能删除自己的渠道");
    if (channels[idx].isPreset && !u.isAdmin) return fail(res, 403, "预设渠道仅管理员可删除");
    channels.splice(idx, 1);
    saveJSON("channels.json", channels);
    return ok(res, { deleted: true });
  }

  /* ---- 内容 / 留言 ---- */
  if (p === "/api/posts" && method === "POST") {
    const u = requireUser(req, res); if (!u) return;
    const b = await readBody(req);
    if (!["text", "image", "video", "drama", "post"].includes(b.type)) return fail(res, 400, "type 不合法");
    if (!b.prompt) return fail(res, 400, "prompt 缺失");
    const post = addPost(u, b);
    return ok(res, post);
  }
  if (p.startsWith("/api/posts/") && method === "PATCH") {
    const u = requireUser(req, res); if (!u) return;
    const id = p.slice("/api/posts/".length);
    const posts = loadJSON("posts.json", []);
    const post = posts.find(x => x.id === id);
    if (!post) return fail(res, 404, "记录不存在");
    if (post.userId !== u.id && !u.isAdmin) return fail(res, 403, "只能修改自己的记录");
    const b = await readBody(req);
    if (b.result && typeof b.result === "object") post.result = Object.assign(post.result, sanitizeResult(b.result));
    if (b.status && ["pending", "done", "failed"].includes(b.status)) post.status = b.status;
    if (b.error) post.error = String(b.error).slice(0, 500);
    saveJSON("posts.json", posts);
    return ok(res, post);
  }
  if (p.startsWith("/api/posts/") && method === "DELETE") {
    const u = requireUser(req, res); if (!u) return;
    const id = p.slice("/api/posts/".length);
    const posts = loadJSON("posts.json", []);
    const idx = posts.findIndex(x => x.id === id);
    if (idx < 0) return fail(res, 404, "记录不存在");
    if (posts[idx].userId !== u.id && !u.isAdmin) return fail(res, 403, "只能删除自己的记录");
    posts.splice(idx, 1);
    saveJSON("posts.json", posts);
    return ok(res, { deleted: true });
  }
  if (p === "/api/posts" && method === "GET") {
    // 广场：?type=image|video&page&limit
    const type = url.searchParams.get("type");
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    let posts = loadJSON("posts.json", []);
    if (type) posts = posts.filter(x => x.type === type);
    posts = posts.filter(x => x.status === "done");
    posts.sort((a, b) => b.createdAt - a.createdAt);
    const total = posts.length;
    const list = posts.slice((page - 1) * limit, page * limit).map(x => ({
      id: x.id, username: x.username, type: x.type, prompt: x.prompt, params: x.params,
      result: x.result, createdAt: x.createdAt
    }));
    return ok(res, { total, page, limit, list });
  }
  if (p === "/api/posts/mine" && method === "GET") {
    const u = requireUser(req, res); if (!u) return;
    const posts = loadJSON("posts.json", []).filter(x => x.userId === u.id).sort((a, b) => b.createdAt - a.createdAt);
    return ok(res, posts);
  }

  // 每日额度统计
  if (p === "/api/quota" && method === "GET") {
    const posts = loadJSON("posts.json", []);
    const now = new Date();
    // 使用本地时间（CST）而非UTC
    const today = now.getFullYear() + '-' +
      String(now.getMonth() + 1).padStart(2, '0') + '-' +
      String(now.getDate()).padStart(2, '0');
    const yesterday = new Date(now - 86400000);
    const yesterdayStr = yesterday.getFullYear() + '-' +
      String(yesterday.getMonth() + 1).padStart(2, '0') + '-' +
      String(yesterday.getDate()).padStart(2, '0');
    const last7days = new Date(now - 604800000);
    const last7daysStr = last7days.getFullYear() + '-' +
      String(last7days.getMonth() + 1).padStart(2, '0') + '-' +
      String(last7days.getDate()).padStart(2, '0');

    let todayCount = 0, yesterdayCount = 0, weekCount = 0;
    let imageCount = 0, videoCount = 0, textCount = 0, dramaCount = 0;

    for (const post of posts) {
      const dt = new Date(post.createdAt);
      const dtStr = dt.getFullYear() + '-' +
        String(dt.getMonth() + 1).padStart(2, '0') + '-' +
        String(dt.getDate()).padStart(2, '0');
      const type = post.type || 'text';
      if (type === 'image') imageCount++;
      else if (type === 'video') videoCount++;
      else if (type === 'text') textCount++;
      else if (type === 'drama') dramaCount++;
      if (dtStr === today) todayCount++;
      if (dtStr === yesterdayStr) yesterdayCount++;
      if (dtStr >= last7daysStr) weekCount++;
    }

    return ok(res, {
      today: todayCount,
      yesterday: yesterdayCount,
      week: weekCount,
      total: posts.length,
      byType: { image: imageCount, video: videoCount, text: textCount, drama: dramaCount },
      limits: CHANNELS,
      usageToday: (() => {
        const u = loadJSON("usage.json", {})[today] || {};
        return { text: u.text || 0, image: u.image || 0, video: u.video || 0 };
      })()
    });
  }

  // 过期检查 - 返回即将过期的内容
  if (p === "/api/expiry-check" && method === "GET") {
    const posts = loadJSON("posts.json", []);
    const now = Date.now();
    const videoThreshold = 7 * 24 * 60 * 60 * 1000; // 7天
    const imageThreshold = 60 * 24 * 60 * 60 * 1000; // 60天
    
    let videoExpiring = 0, imageExpiring = 0;
    
    for (const p of posts) {
      const age = now - p.createdAt;
      if (p.type === 'video' && age > videoThreshold && age < videoThreshold + 7*24*60*60*1000) {
        videoExpiring++;
      }
      if (p.type === 'image' && age > imageThreshold && age < imageThreshold + 30*24*60*60*1000) {
        imageExpiring++;
      }
    }
    
    return ok(res, {
      videoExpiring,
      imageExpiring,
      videoThresholdDays: 7,
      imageThresholdDays: 60
    });
  }

  // 清理过期内容 (管理员接口)
  if (p === "/api/admin/cleanup" && method === "POST") {
    const u = requireUser(req, res); 
    if (!u || !u.isAdmin) return fail(res, 403, "需要管理员权限");
    
    const posts = loadJSON("posts.json", []);
    const now = Date.now();
    const videoThreshold = 7 * 24 * 60 * 60 * 1000;
    const imageThreshold = 60 * 24 * 60 * 60 * 1000;
    
    const before = posts.length;
    const cleaned = posts.filter(p => {
      const age = now - p.createdAt;
      if (p.type === 'video' && age > videoThreshold) return false;
      if (p.type === 'image' && age > imageThreshold) return false;
      return true;
    });
    
    saveJSON("posts.json", cleaned);
    console.log(`[Cleanup] Removed ${before - cleaned.length} expired posts`);
    
    return ok(res, {
      removed: before - cleaned.length,
      remaining: cleaned.length
    });
  }

  if (p === "/api/messages" && method === "GET") {
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);
    let msgs = loadJSON("messages.json", []);
    msgs.sort((a, b) => b.createdAt - a.createdAt);
    const total = msgs.length;
    return ok(res, { total, page, limit, list: msgs.slice((page - 1) * limit, page * limit) });
  }
  if (p === "/api/messages" && method === "POST") {
    const u = requireUser(req, res); if (!u) return;
    const b = await readBody(req);
    const content = String(b.content || "").trim().slice(0, 500);
    if (!content) return fail(res, 400, "留言内容不能为空");
    const msgs = loadJSON("messages.json", []);
    const msg = { id: genId("m"), userId: u.id, username: u.username, content, createdAt: Date.now() };
    msgs.push(msg);
    saveJSON("messages.json", msgs);
    return ok(res, msg);
  }
  if (p.startsWith("/api/messages/") && method === "DELETE") {
    const u = requireUser(req, res); if (!u) return;
    const id = p.slice("/api/messages/".length);
    const msgs = loadJSON("messages.json", []);
    const idx = msgs.findIndex(x => x.id === id);
    if (idx < 0) return fail(res, 404, "留言不存在");
    if (msgs[idx].userId !== u.id && !u.isAdmin) return fail(res, 403, "只能删除自己的留言");
    msgs.splice(idx, 1);
    saveJSON("messages.json", msgs);
    return ok(res, { deleted: true });
  }

  /* ---- 管理 ---- */
  if (p === "/api/admin/stats" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    return ok(res, computeStats());
  }
  if (p === "/api/admin/users" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    const users = loadJSON("users.json", []).map(x => ({ id: x.id, username: x.username, isAdmin: x.isAdmin, createdAt: x.createdAt }));
    return ok(res, users);
  }
  if (p === "/api/admin/posts" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    const type = url.searchParams.get("type");
    const page = parseInt(url.searchParams.get("page") || "1", 10) || 1;
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "30", 10), 100);
    let posts = loadJSON("posts.json", []);
    if (type && type !== "all") posts = posts.filter(x => x.type === type);
    posts.sort((a, b) => b.createdAt - a.createdAt);
    const total = posts.length;
    return ok(res, { total, page, limit, list: posts.slice((page - 1) * limit, page * limit) });
  }
  if (p.startsWith("/api/admin/posts/") && method === "DELETE") {
    const u = requireAdmin(req, res); if (!u) return;
    const id = p.slice("/api/admin/posts/".length);
    const posts = loadJSON("posts.json", []);
    const idx = posts.findIndex(x => x.id === id);
    if (idx < 0) return fail(res, 404, "内容不存在");
    posts.splice(idx, 1);
    saveJSON("posts.json", posts);
    return ok(res, { deleted: true });
  }
  if (p.startsWith("/api/admin/messages/") && method === "DELETE") {
    const u = requireAdmin(req, res); if (!u) return;
    const id = p.slice("/api/admin/messages/".length);
    const msgs = loadJSON("messages.json", []);
    const idx = msgs.findIndex(x => x.id === id);
    if (idx < 0) return fail(res, 404, "留言不存在");
    msgs.splice(idx, 1);
    saveJSON("messages.json", msgs);
    return ok(res, { deleted: true });
  }
  /* ---- 管理：渠道 & 设置 ---- */
  if (p === "/api/admin/channels" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    return ok(res, loadChannels());
  }
  if (p === "/api/admin/channels" && method === "POST") {
    const u = requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const name = String(b.name || "").trim().slice(0, 30);
    const kind = String(b.kind || "");
    const baseUrl = String(b.baseUrl || "").trim().replace(/\/+$/, "");
    const model = String(b.model || "").trim().slice(0, 80);
    const apiKey = String(b.apiKey || "").trim().slice(0, 300);
    const adapter = String(b.adapter || "") || (kind === "text" ? "chat-compat" : kind === "image" ? "image-compat" : "video-agnes");
    if (!name || !baseUrl || !model) return fail(res, 400, "名称/Base URL/模型名 不能为空");
    if (!["text", "image", "video"].includes(kind)) return fail(res, 400, "type 必须为 text/image/video");
    if (!/^https?:\/\//.test(baseUrl)) return fail(res, 400, "Base URL 必须以 http(s):// 开头");
    try { await assertSafeRemoteUrl(baseUrl); } catch (e) { return fail(res, 400, e.message); }
    const ch = { id: genId("c"), name, kind, adapter, baseUrl, model, apiKey, note: String(b.note || "").slice(0, 100), isPreset: !!b.isPreset, enabled: b.enabled !== false, createdBy: "admin", sort: Number(b.sort) || 0 };
    const channels = loadChannels();
    channels.push(ch);
    saveJSON("channels.json", channels);
    return ok(res, ch);
  }
  if (p.startsWith("/api/admin/channels/") && method === "PATCH") {
    const u = requireAdmin(req, res); if (!u) return;
    const id = p.slice("/api/admin/channels/".length);
    const channels = loadChannels();
    const ch = channels.find(x => x.id === id);
    if (!ch) return fail(res, 404, "渠道不存在");
    const b = await readBody(req);
    if (b.name !== undefined && String(b.name).trim()) ch.name = String(b.name).trim().slice(0, 30);
    if (b.baseUrl !== undefined && String(b.baseUrl).trim()) {
      const nextBase = String(b.baseUrl).trim().replace(/\/+$/, "");
      try { await assertSafeRemoteUrl(nextBase); } catch (e) { return fail(res, 400, e.message); }
      ch.baseUrl = nextBase;
    }
    if (b.model !== undefined && String(b.model).trim()) ch.model = String(b.model).trim().slice(0, 80);
    if (b.apiKey !== undefined && String(b.apiKey).trim()) ch.apiKey = String(b.apiKey).trim().slice(0, 300);
    if (b.adapter !== undefined && String(b.adapter).trim()) ch.adapter = String(b.adapter).trim();
    if (b.note !== undefined) ch.note = String(b.note).slice(0, 100);
    if (b.enabled !== undefined) ch.enabled = !!b.enabled;
    if (b.sort !== undefined) ch.sort = Number(b.sort) || 0;
    saveJSON("channels.json", channels);
    return ok(res, ch);
  }
  if (p === "/api/admin/channels/reset-presets" && method === "POST") {
    const u = requireAdmin(req, res); if (!u) return;
    const channels = loadChannels();
    // 重置：保留用户自定义渠道，预设渠道恢复模板（保留已填 Key 的 agnes 渠道）
    const customs = channels.filter(c => !c.isPreset);
    const seed = CHANNEL_SEED.map(c => Object.assign({}, c, {
      apiKey: "", isPreset: true, enabled: c.id === "c_agnes_text" || c.id === "c_agnes_image" || c.id === "c_agnes_video",
      createdBy: "system", sort: 0
    }));
    const cfg = getConfig();
    seed.forEach(c => { if (c.id.startsWith("c_agnes_") && cfg.agnesApiKey) c.apiKey = cfg.agnesApiKey; });
    saveJSON("channels.json", customs.concat(seed));
    return ok(res, { reset: true, count: seed.length });
  }
  if (p === "/api/admin/settings" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    const cfg = getConfig();
    return ok(res, { allowUserChannels: !!cfg.allowUserChannels });
  }
  if (p === "/api/admin/settings" && method === "PATCH") {
    const u = requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const cfg = loadConfig();
    if (b.allowUserChannels !== undefined) cfg.allowUserChannels = !!b.allowUserChannels;
    saveConfig(cfg);
    return ok(res, { allowUserChannels: !!cfg.allowUserChannels });
  }
  if (p === "/api/admin/export" && method === "GET") {
    const u = requireAdmin(req, res); if (!u) return;
    const cfg = getConfig();
    const data = {
      app: "wb_aistudio_server",
      version: 1,
      exportedAt: new Date().toISOString(),
      config: { base: cfg.base, textModel: cfg.textModel, imageModel: cfg.imageModel, videoModel: cfg.videoModel, adminUsers: cfg.adminUsers },
      users: loadJSON("users.json", []),
      posts: loadJSON("posts.json", []),
      messages: loadJSON("messages.json", []),
      sessions: loadJSON("sessions.json", {})
    };
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": 'attachment; filename="backup.json"' });
    return res.end(JSON.stringify(data, null, 2));
  }

  /* ---- 管理：批量图片生成 ---- */
  if (p === "/api/admin/batch-generate" && method === "POST") {
    const u = requireAdmin(req, res); if (!u) return;
    const b = await readBody(req);
    const { theme, count, size } = b;
    
    if (!theme || !count) return fail(res, 400, "主题和数量必填");
    if (count < 1 || count > 100) return fail(res, 400, "数量应为1-100");
    
    const ch = pickChannel("image", u);
    if (!ch) return fail(res, 500, "没有可用的图片渠道");
    if (!channelKey(ch)) return fail(res, 500, "图片渠道未配置 API Key");
    
    const results = [];
    const prompts = generateBatchPrompts(theme, count);
    
    for (let i = 0; i < prompts.length; i++) {
      try {
        const r = await forwardByChannel(ch, "image", {
          prompt: prompts[i],
          size: size || "2K",
          n: 1
        });
        results.push({ index: i + 1, success: true, url: r?.data?.[0]?.url || null });
        recordUsage("image");
        await sleep(1500);
      } catch (e) {
        results.push({ index: i + 1, success: false, error: e.message });
        await sleep(3000);
      }
    }
    
    return ok(res, { total: count, success: results.filter(x => x.success).length, results });
  }

  function generateBatchPrompts(theme, count) {
    const themes = {
      daily: [
        "Beautiful Asian woman in yoga outfit, practicing yoga pose, serene studio, soft lighting, professional photography, high quality",
        "Graceful female yoga instructor doing downward dog pose, flexible body, athletic wear, gym background, fitness lifestyle, 4K",
        "Beautiful Asian woman in stylish bikini on tropical beach, turquoise ocean background, sunny day, vacation vibes, fashion photography",
        "Glamorous woman in elegant black bikini posing by infinity pool, resort background, sunset lighting, professional shoot",
        "Professional businesswoman in sleek black suit, confident pose in modern office, corporate fashion, sharp lighting",
        "Elegant female executive in white blouse and pencil skirt, boardroom setting, leadership presence, polished look",
        "Beautiful cosplayer as magical girl anime character, colorful outfit with ribbons, fantasy accessories, vibrant backdrop",
        "Elegant cosplayer in fairy costume with wings, enchanted forest setting, ethereal lighting, detailed costume, fantasy art",
        "Beautiful Chinese woman in elaborate Hanfu traditional dress, cherry blossom garden, classical elegance, flowing silk",
        "Elegant lady in Tang Dynasty style robes with intricate embroidery, palace setting, traditional makeup, cultural heritage",
        "Casual stylish woman in denim jacket and white t-shirt, urban street setting, natural sunlight, candid photography",
        "Charming woman in summer dress at flower garden, bohemian style, golden hour, free spirit vibes",
        "Fitness woman in athletic wear doing workout, gym background, healthy lifestyle, motivated expression, high energy",
        "Active woman in sports bra and leggings running on track, athletic physique, determination, outdoor setting",
        "Glamorous woman in elegant red evening gown, red carpet event, formal occasion, sophisticated beauty, luxury lifestyle",
        "Beautiful lady in black cocktail dress at upscale restaurant, candlelight, romantic atmosphere, high fashion"
      ],
      tiangong: [
        "Super wide angle view of Chinese Tiangong space station with beautiful fairy goddesses in flowing silk robes floating around, magical ethereal lighting, celestial beings with golden halos, ancient Chinese mythology meets futuristic space, ultra detailed, cinematic, 8K",
        "Majestic Tiangong space station surrounded by dozens of immortal fairies in traditional Hanfu, crystal palace in space, starry galaxy background, divine light rays, fantasy art masterpiece, ultra wide angle perspective",
        "Chinese fairy queens hovering around Tiangong station, ethereal beauty with flowing white and gold garments, mystical energy aura, cosmic backdrop with nebula colors, cinematic composition, ultra HD",
        "Powerful Chinese gods and deities guarding Tiangong space station, majestic warriors in ornate armor with flying weapons, supernatural energy fields, epic composition, wide angle shot, mythical fantasy",
        "Jade Emperor and celestial generals surrounding the Chinese space station, divine aura, golden phoenix birds flying around, majestic clouds, traditional Chinese mythology reimagined in space",
        "Beautiful Moon Goddess Chang-e standing on Tiangong space station platform, gazing at Earth, ethereal glow, flowing silk robes, jade rabbit companion, magical aura, celestial palace in background",
        "Majestic Chinese Dragon King circling Tiangong space station, serpentine dragon body wrapped around station modules, rainbow scales gleaming, divine power aura, mythological fantasy",
        "Sun Wukong (Monkey King) performing acrobatic poses around Tiangong space station, golden cudgel weapon, cloud somersault, fiery eyes, heroic stance, mythological fantasy, ultra wide angle",
        "Nezha (Child God) riding Wind Fire Wheels around Tiangong station, three heads six arms displaying powers, cosmic ocean below, heroic warrior in space, dynamic wide angle",
        "Divine lovers NiuLang and Zhinv reuniting on Tiangong space station bridge, magpie bridge made of stars, romantic cosmic setting, Chinese valentines mythology, ethereal beauty",
        "Guanyin (Goddess of Mercy) with compassionate aura floating around Tiangong station, surrounded by lotus petals and divine light, traditional Chinese deity",
        "Taishang Laojun (Grand Pure One) in celestial robes, alchemical furnace floating nearby, Daoist immortal energy, ancient Chinese wisdom deity, cosmic backdrop"
      ]
    };
    
    const pool = themes[theme] || themes.daily;
    return Array.from({ length: count }, (_, i) => pool[i % pool.length]);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // 图片缩略图：?url=xxx&w=400（带本地缓存）
  if (p === "/api/image/thumb" && method === "GET") {
    const imgUrl = url.searchParams.get("url");
    const w = Math.min(parseInt(url.searchParams.get("w") || "400", 10), 1200) || 400;
    if (!imgUrl) return fail(res, 400, "url 参数缺失");
    try {
      const safeUrl = await assertSafeRemoteUrl(imgUrl);
      // 生成缓存 key（URL + 宽度）
      const cacheKey = crypto.createHash('md5').update(imgUrl + '_' + w).digest('hex');
      const cacheDir = path.join(ROOT, 'data', 'cache', 'thumbs');
      const cachePath = path.join(cacheDir, cacheKey + '.jpg');

      // 检查缓存
      let outBuf = null;
      let metadata = null;

      if (fs.existsSync(cachePath)) {
        const stat = fs.statSync(cachePath);
        const age = Date.now() - stat.mtimeMs;
        if (age < 86400000) { // 24小时缓存
          outBuf = fs.readFileSync(cachePath);
          // 从文件大小估算宽高比（简化处理）
          metadata = { width: w, height: Math.round(w * stat.size / (stat.size + 100)) };
        }
      }

      if (!outBuf) {
        // 下载原图
        const imgRes = await fetch(safeUrl, { redirect: "manual", signal: AbortSignal.timeout(15000) });
        if (imgRes.status >= 300 && imgRes.status < 400) return fail(res, 400, "不支持重定向图片地址");
        if (!imgRes.ok) return fail(res, 400, "无法获取原图");
        const contentLength = Number(imgRes.headers.get("content-length") || 0);
        if (contentLength > 15 * 1024 * 1024) return fail(res, 413, "原图过大");
        const imgBuf = Buffer.from(await imgRes.arrayBuffer());
        if (imgBuf.length > 15 * 1024 * 1024) return fail(res, 413, "原图过大");

        if (!sharp) return fail(res, 500, "sharp 未安装");
        metadata = await sharp(imgBuf).metadata();
        const outputW = Math.min(w, metadata.width || w);
        const outputH = metadata.height ? Math.round(metadata.height * outputW / metadata.width) : outputW;

        outBuf = await sharp(imgBuf)
          .resize(outputW, outputH, { fit: "fill" })
          .jpeg({ quality: 75, mozjpeg: true })
          .toBuffer();

        // 写入缓存
        try {
          fs.mkdirSync(cacheDir, { recursive: true });
          fs.writeFileSync(cachePath, outBuf);
        } catch (e) {
          // 缓存失败不影响主流程
        }
      }

      res.writeHead(200, {
        "Content-Type": "image/jpeg",
        "Cache-Control": "public, max-age=86400",
        "X-Original-Width": String(metadata?.width || ""),
        "X-Original-Height": String(metadata?.height || "")
      });
      return res.end(outBuf);
    } catch (e) {
      if (/禁止访问|URL 格式|无法解析/.test(e.message || "")) return fail(res, 400, e.message);
      return fail(res, 500, "缩略图生成失败：" + (e.message || "unknown"));
    }
  }

  return fail(res, 404, "接口不存在");
}

/* ---------------- 静态文件 ---------------- */
function serveStatic(res, p) {
  let rel = p === "/" ? "/index.html" : p;
  const deny = ["/data/", "/server.js", "/package.json", "/plan", "/.git"];
  if (deny.some(d => rel.startsWith(d))) return fail(res, 403, "禁止访问");
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) return fail(res, 403, "禁止访问");
  fs.readFile(full, (err, buf) => {
    if (err) return fail(res, 404, "页面不存在");
    const ext = path.extname(full).toLowerCase();
    const mime = {
      ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
      ".css": "text/css; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg", ".svg": "image/svg+xml", ".json": "application/json; charset=utf-8",
      ".ico": "image/x-icon", ".webp": "image/webp", ".mp4": "video/mp4"
    };
    res.writeHead(200, { "Content-Type": mime[ext] || "application/octet-stream" });
    res.end(buf);
  });
}

/* ---------------- 启动 ---------------- */
ensureDataDir();
ensureChannels();
const server = http.createServer(async (req, res) => {
  try {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "same-origin");
    const url = new URL(req.url, "http://localhost");
    const p = url.pathname;
    const method = req.method;
    if (method === "GET" && (p === "/" || p === "/index.html" || p === "/admin.html")) return serveStatic(res, p);
    if (p.startsWith("/api/")) return await handleAPI(req, res, method, p, url);
    if (method === "GET" && !p.includes("..")) return serveStatic(res, p);
    return fail(res, 404, "not found");
  } catch (e) {
    fail(res, 500, "服务器错误：" + (e && e.message ? e.message : "unknown"));
  }
});
server.listen(PORT, () => {
  console.log("AI 创作台服务已启动");
  console.log("  本机访问  : http://localhost:" + PORT);
  console.log("  局域网访问: http://" + localIp() + ":" + PORT + "  （管理后台: /admin.html）");
  const cfg = getConfig();
  if (!cfg.agnesApiKey) {
    console.log("  ⚠ 尚未配置 Agnes API Key：请编辑 data/config.json 填入 agnesApiKey，或设置环境变量 AGNES_API_KEY 后重启");
  }
});

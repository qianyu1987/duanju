/**
 * 批量生成脚本（admin 账号）：100 图片 + 50 剧本 + 10 视频
 * 用法：node seed.js   （需在服务器 /root/duanju-app 下运行）
 * 全部走正式 API 链路：代理生成 → posts 入库 → 广场可见
 */
"use strict";
const B = "http://127.0.0.1:3000";
const sleep = ms => new Promise(r => setTimeout(r, ms));
const log = m => console.log(new Date().toISOString().slice(11, 19), m);

async function main() {
  // 登录 admin
  let r = await fetch(B + "/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "admin", password: "315136339" }) }).then(x => x.json());
  if (!r.ok) throw new Error("登录失败：" + r.error);
  const token = r.data.token;
  const H = { "Content-Type": "application/json", "Authorization": "Bearer " + token };
  const api = async (path, opt) => {
    const res = await fetch(B + path, opt);
    const d = await res.json();
    if (!res.ok) throw new Error(d.error || ("HTTP " + res.status));
    return d.data;
  };

  // 并发池
  async function pool(jobs, limit) {
    let i = 0;
    const workers = Array.from({ length: Math.min(limit, jobs.length) }, async () => {
      while (i < jobs.length) { const j = jobs[i++]; if (j) await j(); }
    });
    await Promise.all(workers);
  }

  /* ========== 图片池：20 个高质量 prompt × 5 轮 = 100 张 ========== */
  const IMG = [
    "未来城市夜景，霓虹灯倒映在湿润街道，赛博朋克风格，电影级光影，高细节",
    "樱花树下的小狐狸回眸，柔和春日阳光，梦幻童话风格，浅景深",
    "雪山脚下的湖泊如镜，倒映日照金山，超高清风光摄影，恢弘构图",
    "复古机车停在旧城街道，黄昏金色光线，胶片质感，颗粒感",
    "宇航员漂浮在星际星云前，壮丽宇宙，科幻插画，电影感",
    "森林里发光的蘑菇与萤火虫，夜晚魔法森林，奇幻风格，梦幻光效",
    "新中式茶室一角，竹影、茶具、暖光，东方美学静物摄影",
    "海边日落，金色浪花，情侣剪影，唯美浪漫氛围",
    "国潮插画：锦鲤与祥云，红金配色，新年海报风格，装饰感",
    "赛博机械猫咪，金属质感与霓虹细节，科技概念设计，高精度渲染",
    "极简北欧客厅，原木与白墙，落地窗阳光洒入，室内设计效果图，空间感",
    "星际空间站俯瞰地球，太空站舷窗视角，硬核科幻，细节丰富",
    "古镇烟雨，青石板路与红灯笼，水墨江南意境，烟雨朦胧",
    "热带雨林巨树与瀑布，丁达尔光效，冒险电影场景，生机盎然",
    "梦幻星球与银河，太空甜甜圈星球，治愈系宇宙插画",
    "老式黑胶唱片机特写，暖黄灯光，复古怀旧，质感细腻",
    "悬崖上的奇幻港口城市，千帆与城堡，电影级概念设计，宏大",
    "夏日泳池与西瓜，清新日系摄影，阳光灿烂，治愈",
    "机械战甲特写，金属光泽与能源纹路，工业设计渲染，硬核质感",
    "星空下的露营帐篷与篝火，银河背景，治愈系夜景，温暖"
  ];
  const RATIOS = ["1:1", "16:9", "9:16", "3:4"];

  /* ========== 剧本池：10 主题 × 5 变体 = 50 个 ========== */
  const DRAMA_BASE = [
    "甜宠短剧：高冷甜品师女主 vs 霸道总裁，靠祖传甜品配方翻身创业",
    "逆袭爽剧：赘婿觉醒龙王身份，开局被岳母羞辱后强势打脸",
    "悬疑短剧：整栋楼的人一夜之间都失忆了，只有女主记得昨天",
    "都市情感：离婚冷静期的夫妻，重新认识彼此，破镜重圆",
    "重生虐渣：女主重生回到订婚夜，手撕渣男凤凰男，事业逆袭",
    "甜宠短剧：顶流明星隐婚，与经纪人契约恋爱假戏真做",
    "逆袭爽剧：被开除的实习生掌握核心技术，创立公司反杀前东家",
    "悬疑短剧：失忆女孩找回记忆，发现自己就是案件的目击者",
    "都市情感：单亲妈妈创业开面馆，逆袭成连锁品牌，收获爱情",
    "重生短剧：重生回高考前，改变命运，逆袭考上名校抓住商机"
  ];

  /* ========== 视频池：10 条 ========== */
  const VIDS = [
    "中国夜市小吃摊，厨师翻炒火焰升起，暖色灯光，热气腾腾，电影感",
    "海豚跃出碧蓝海面，水花四溅，慢动作，阳光闪耀",
    "樱花林里女孩撑伞走过，粉色花瓣飘落，唯美浪漫",
    "未来城市飞行汽车穿梭高楼之间，科幻霓虹，高速镜头",
    "咖啡拉花过程特写，奶泡缓缓成型，精致细节",
    "山顶云海日出，太阳缓缓升起，金光洒满云层，延时摄影",
    "橘猫打翻牛奶的搞笑瞬间，牛奶飞溅，慢动作",
    "舞蹈室剪影，舞者随着音乐舞动，灯光氛围感",
    "雨天车窗外的城市霓虹，雨滴滑落，赛博朋克氛围",
    "篝火旁吉他弹唱，火星飞溅，温暖氛围，慢镜头"
  ];

  let okImg = 0, okDrama = 0, okVideo = 0;

  log("开始生成 100 张图片…");
  const imgJobs = [];
  for (let round = 0; round < 5; round++) {
    for (const p of IMG) {
      imgJobs.push(async () => {
        for (let t = 0; t < 3; t++) {
          try {
            const ratio = RATIOS[Math.floor(Math.random() * RATIOS.length)];
            const img = await api("/api/proxy/image", { method: "POST", headers: H, body: JSON.stringify({ prompt: p, size: "2K", ratio }) });
            await api("/api/posts", { method: "POST", headers: H, body: JSON.stringify({ type: "image", prompt: p, params: { size: "2K", ratio }, result: { url: img.url || "", b64: img.b64 || "" }, status: "done" }) });
            okImg++; log("图片 " + okImg + "/100 ✓ " + p.slice(0, 16));
            return;
          } catch (e) {
            if (t === 2) log("图片 ✗ " + p.slice(0, 16) + " " + String(e.message).slice(0, 70));
            else await sleep(4000 * (t + 1));
          }
        }
      });
    }
  }
  await pool(imgJobs, 3);
  log("图片完成：" + okImg + "/100");

  log("开始生成 50 个剧本…");
  const dramaJobs = [];
  for (let i = 0; i < 50; i++) {
    const base = DRAMA_BASE[i % DRAMA_BASE.length];
    const variant = (i % 5) + 1;
    const topic = base + "（第" + variant + "版：调整人物身份细节与冲突切入点，情节与前几版不同）";
    dramaJobs.push(async () => {
      for (let t = 0; t < 3; t++) {
        try {
          const d = await api("/api/proxy/chat", {
            method: "POST", headers: H,
            body: JSON.stringify({
              messages: [
                { role: "system", content: "你是金牌短剧编剧。输出结构化剧本：【剧名】【一句话卖点】【人物设定】【故事梗概】【分集大纲（前3集）】【第1集完整剧本】。直接输出正文，不要客套。" },
                { role: "user", content: topic }
              ], max_tokens: 4000
            })
          });
          await api("/api/posts", { method: "POST", headers: H, body: JSON.stringify({ type: "drama", prompt: topic, params: {}, result: { text: d.text }, status: "done" }) });
          okDrama++; log("剧本 " + okDrama + "/50 ✓ " + topic.slice(0, 16));
          return;
        } catch (e) {
          if (t === 2) log("剧本 ✗ " + topic.slice(0, 16) + " " + String(e.message).slice(0, 70));
          else await sleep(4000 * (t + 1));
        }
      }
    });
  }
  await pool(dramaJobs, 3);
  log("剧本完成：" + okDrama + "/50");

  log("开始生成 10 条视频…");
  const vidJobs = VIDS.map(v => async () => {
    for (let t = 0; t < 2; t++) {
      try {
        const ratio = Math.random() > 0.5 ? "16:9" : "9:16";
        const d = await api("/api/proxy/video", { method: "POST", headers: H, body: JSON.stringify({ prompt: v, ratio, len: "5" }) });
        const post = await api("/api/posts", { method: "POST", headers: H, body: JSON.stringify({ type: "video", prompt: v, params: { ratio, len: "5" }, result: { taskId: d.taskId, videoUrl: "" }, status: "pending" }) });
        let done = false;
        for (let i = 0; i < 60; i++) {
          await sleep(6000);
          try {
            const r = await api("/api/proxy/video/" + d.taskId, { headers: H });
            if (r.status === "completed" || r.videoUrl) {
              await api("/api/posts/" + post.id, { method: "PATCH", headers: H, body: JSON.stringify({ result: { taskId: d.taskId, videoUrl: r.videoUrl }, status: "done" }) });
              okVideo++; log("视频 " + okVideo + "/10 ✓ " + v.slice(0, 16));
              done = true; break;
            }
            if (r.status === "failed" || r.status === "error") { log("视频 ✗ " + v.slice(0, 16)); done = true; break; }
          } catch (e) { if (i % 5 === 0) log("视频轮询重试 " + v.slice(0, 16) + " " + String(e.message).slice(0, 50)); }
        }
        if (!done) log("视频 ⏳ 超时 " + v.slice(0, 16));
        return;
      } catch (e) {
        if (t === 1) log("视频 ✗ " + v.slice(0, 16) + " " + String(e.message).slice(0, 70));
        else await sleep(6000);
      }
    }
  });
  await pool(vidJobs, 2);
  log("视频完成：" + okVideo + "/10");

  log("========== 全部完成 ==========");
  log("图片 " + okImg + "/100 | 剧本 " + okDrama + "/50 | 视频 " + okVideo + "/10");
  process.exit(0);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });

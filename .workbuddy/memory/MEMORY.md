# 短剧空间 · 项目长期记忆

## 项目定位
duanju.hhtc.top（AI 创作台短剧网站）的正式工作目录。2026-08-27 由 `workbuddy/2026-08-25-08-13-09/` 迁移合并至此。

## 技术架构
- 单文件 HTML 前端：index.html（主站）、admin.html（管理后台）、ai-creation-studio.html（AI创作台）
- 后端：Node 原生 server.js + SQLite/JSON data（无框架），唯一 npm 依赖 sharp
- API：Agnes AI（OpenAI 兼容格式）
- 部署：deploy.sh → root@lostmusic.top:/root/duanju-app，PM2 进程名 duanju-app，Nginx 反代，线上 https://duanju.hhtc.top
- 版本管理：git 本地仓库，版本号写进 data/config.json

## 本地启动
```bash
cd /Volumes/brainos/website/xiaoshuo/workbuddy/短剧空间/
env -u NODE_OPTIONS node server.js   # PORT 3000；NODE_OPTIONS 的 --use-system-ca 与 node 冲突，必须 -u
```

## 部署
```bash
./deploy.sh <版本号> "<更新说明>"    # 如 ./deploy.sh 1.0.42 "服务端 ETag + 前端字体优化"
```

## 已知问题
- Agnes AI API Key（cpk-jE3Qzzq...）已失效，需在 https://platform.agnes-ai.com/settings/apiKeys 换新，更新服务器上 /root/duanju-app/{tiangong_gen,daily_gen}.js 第6行
- 服务器 cron：06:00 daily_gen.js（日常美女图）、07:00 tiangong_gen.js（天宫神话图）
- git status 里的 .workbuddy/、index.html.bak 删除记录是迁移时排除所致，属预期
- MEMORY.md 中部署规范有重复条目，待清理

## v1.0.42 优化记录
- 服务端：静态文件 ETag + 304 缓存；HEAD 请求支持
- 前端：Google Fonts 从 @import 改 preconnect + link；视频轮询从固定 8s 改为动态退避（4s→上限16s）

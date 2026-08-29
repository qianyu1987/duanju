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
- Agnes AI API Key（cpk-jE3Qzzq...）可用，但免费额度有限制（4K tier 1 request/min）
- 每日 cron 任务（06:00 daily_gen, 07:00 tiangong_gen）会受速率限制影响
- 已知 bug: ERR_HTTP_HEADERS_SENT 偶发错误（pre-existing，不影响功能）
- channels.json 的 apiKey 字段可能被意外清空，需重新写入
- git status 里的 .workbuddy/、index.html.bak 删除记录是迁移时排除所致，属预期

## 版本记录
### v1.6.0 (2026-08-28)
- 成片输出与分享：成片预览模式、导出文本剧本、生成分享链接、导出HTML离线预览页

### v1.5.0 (2026-08-28)
- 配音与字幕：AI自动生成单镜/批量配音（TTS占位），AI生成精简字幕，分镜支持音频播放和字幕显示
- 配音与字幕：AI自动生成单镜/批量配音（TTS占位），AI生成精简字幕，分镜支持音频播放和字幕显示

### v1.4.0 (2026-08-28)
- 图片动画化：分镜视频生成，支持单镜/批量生成，轮询进度追踪

### v1.3.0 (2026-08-28)
- 分镜生成与可视化：AI自动生成分镜脚本，支持图片生成、编辑、导出

### v1.2.0 (2026-08-28)
- 角色一致性系统：角色库管理、参考图上传、剧本生成时自动关联角色
- localStorage 持久化角色数据（key: wb_aistudio_role_lib）

### v1.1.0
- 短剧工坊全面升级：8种题材、角色设定、剧本导出分享
- 支持保存自定义剧本模板
- 剧本生成增加性别/结局选项
- 单集时长可选（1/3/5分钟）
- 角色卡片自动展示

### v1.0.45
- 修复 API Key 丢失导致渠道显示"未填"问题（从 gen 脚本恢复 cpk-jE3Qzzq...）

### v1.0.43
- 修复 admin 渠道列表 hasKey 字段缺失导致显示"未填"的问题

## v1.0.42 优化记录
- 服务端：静态文件 ETag + 304 缓存；HEAD 请求支持
- 前端：Google Fonts 从 @import 改 preconnect + link；视频轮询从固定 8s 改为动态退避（4s→上限16s）

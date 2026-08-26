#!/bin/bash
# ============================================
# AI 创作台 · 一键推送部署脚本
# 用法: ./deploy.sh <版本号> <更新说明>
# 例:   ./deploy.sh 1.0.40 "展示剩余额度"
# ============================================
set -e
cd "$(dirname "$0")"

VERSION="${1:?用法: ./deploy.sh <版本号> <更新说明>}"
NOTE="${2:-更新}"
SERVER="root@43.138.165.190"
APP="/root/duanju-app"

echo "== [1/4] 生成版本写入脚本 =="
cat > /tmp/setver.js <<JSEOF
const fs=require('fs');
const f="$APP/data/config.json";
const c=JSON.parse(fs.readFileSync(f));
c.version="$VERSION";
c.changelog=["$NOTE".slice(0,120)].concat(c.changelog||[]).slice(0,5);
fs.writeFileSync(f,JSON.stringify(c,null,2));
JSEOF

echo "== [2/4] 上传代码 =="
scp -q server.js index.html admin.html "$SERVER:$APP/"
scp -q data/config.json data/channels.json data/usage.json "$SERVER:$APP/data/"
scp -q /tmp/setver.js "$SERVER:/tmp/"

echo "== [3/4] 写入版本 + 重启服务 =="
ssh "$SERVER" "env -u NODE_OPTIONS /usr/bin/node /tmp/setver.js && rm /tmp/setver.js && cd $APP && pm2 restart duanju-app"

echo "== [4/4] 验证版本接口 =="
curl -s https://duanju.hhtc.top/api/version
echo ""
echo "✅ 已推送 v$VERSION"

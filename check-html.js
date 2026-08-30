#!/usr/bin/env node
/**
 * 单文件 HTML 结构安全校验（部署前强制闸门）
 *
 * 背景：v1.7.2 修改 CSS 时把 </style> 误写成 }，导致解析器从第13行 <style>
 * 进入 RAWTEXT 状态，吞掉 body + 两个 <script>，全站 CSS 失效、JS 源码当文本
 * 显示。此后 v1.7.3 / v1.8.0 / v1.8.1 都在救火。本脚本用于部署前自动拦截。
 *
 * 用法: node check-html.js [文件...]   （默认检查 index.html admin.html）
 * 退出码: 0=全部通过  1=存在问题（应中止部署）
 */
"use strict";
const fs = require("fs");
const path = require("path");

const files = process.argv.slice(2).length ? process.argv.slice(2) : ["index.html", "admin.html"];
let failed = false;

function check(name, ok, detail) {
  const tag = ok ? "  [PASS]" : "  [FAIL]";
  console.log(`${tag} ${name}${detail ? " — " + detail : ""}`);
  if (!ok) failed = true;
}

for (const rel of files) {
  const file = path.resolve(__dirname, rel);
  if (!fs.existsSync(file)) {
    console.log(`\n=== ${rel} ===\n  [SKIP] 文件不存在`);
    continue;
  }
  const html = fs.readFileSync(file, "utf8");
  console.log(`\n=== ${rel} === (${html.length} 字节)`);

  // ---- 1. script 标签配对 ----
  const sOpen = (html.match(/<script[\s>]/g) || []).length;
  const sClose = (html.match(/<\/script>/g) || []).length;
  check("script 标签配对", sOpen === sClose, `<script>=${sOpen} </script>=${sClose}`);

  // ---- 2. 移除 script 块后统计结构性标签（避免模板字符串干扰）----
  const noScript = html.replace(/<script[\s>][\s\S]*?<\/script>/g, "");

  const stOpen = (noScript.match(/<style[\s>]/g) || []).length;
  const stClose = (noScript.match(/<\/style>/g) || []).length;
  check("style 标签配对", stOpen === stClose, `<style>=${stOpen} </style>=${stClose}`);

  // ---- 3. head CSS 是否被 RAWTEXT 吞掉后续内容（核心防复发检测）----
  const headStyle = html.match(/<style>([\s\S]*?)<\/style>/);
  if (!headStyle) {
    check("head style 存在", false, "未找到 <style> 块");
  } else {
    const css = headStyle[1];
    const swallowed = css.includes("<script") || css.includes("<body");
    check("head style 未被吞", !swallowed,
      swallowed ? "CSS 块内含 <script>/<body>，说明 </style> 缺失，解析器已进入 RAWTEXT" : `${css.length} 字符纯 CSS`);

    const o = (css.match(/{/g) || []).length;
    const c = (css.match(/}/g) || []).length;
    check("head CSS 大括号平衡", o === c, `open=${o} close=${c}`);
  }

  // ---- 4. 各 script 块 JS 语法 ----
  const scripts = [...html.matchAll(/<script[\s>]([\s\S]*?)<\/script>/g)];
  scripts.forEach((m, i) => {
    const src = m[1];
    if (/^\s*src\s*=/i.test(m[0].slice(0, 60))) return; // 外链脚本跳过
    try {
      new Function(src);
      check(`script[${i}] JS 语法`, true, `${src.split("\n").length} 行`);
    } catch (e) {
      check(`script[${i}] JS 语法`, false, e.message);
    }
  });

  // ---- 5. 文档结构标签（移除 script/style 后应各 1 次）----
  const bare = noScript.replace(/<style[\s>][\s\S]*?<\/style>/g, "");
  ["</body>", "</html>"].forEach(t => {
    const n = bare.split(t).length - 1;
    check(`${t} 唯一`, n === 1, `出现 ${n} 次`);
  });
}

console.log("");
if (failed) {
  console.log("❌ 校验未通过，禁止部署。请修复上述问题后重试。");
  process.exit(1);
}
console.log("✅ 全部校验通过，可以部署。");

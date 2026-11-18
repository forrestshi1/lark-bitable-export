// ==UserScript==
// @name         飞书多维表格 策划案导出器
// @namespace    https://github.com/forrestshi1/lark-bitable-export
// @version      2.0
// @description  一键把飞书/Lark 多维表格(策划案)导出成 Markdown。文档式表全自动滚动采集；canvas 网格表走「引导模式」自动切表，只需 ⌘A/⌘C。
// @match        *://*.larksuite.com/base/*
// @match        *://*.feishu.cn/base/*
// @grant        none
// @run-at       document-idle
// ==/UserScript==

/*
 * 用法：
 *   ① 自动抓取文档表：脚本逐个切到文档式表、滚动采集正文（空文档/画板标「◻️空」）。
 *   ② 引导抓网格表：脚本自动切到每个网格表，你只需在表里「点一下 → ⌘A → ⌘C」，
 *      再点面板「读取并下一张」——自动收录并跳到下一张网格表。
 *      （首次会弹浏览器剪贴板权限，点一次 Allow 即可；若读不到会自动给出粘贴框兜底。）
 *   ③ 导出 .md：合并下载。
 *
 * 不装油猴也行：把本文件整段粘进 DevTools 控制台运行。
 * 表类型按 ID 前缀判定：ldx...=文档、tbl...=网格。
 */
(function () {
  'use strict';
  if (window.__planExporter) { window.__planExporter.show(); return; }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const store = {};        // tableName -> text
  const typeMap = {};      // tableName -> 'docx' | 'grid' | 'empty'
  let guideList = [];      // 引导模式待抓的网格表
  let guideIdx = 0;

  const clean = (t) => {
    ['​', '‌', '‍', '⁠', '﻿', ' '].forEach((c) => { t = t.split(c).join(''); });
    return t.replace(/\n[ \t]*\n[ \t]*\n+/g, '\n\n');
  };

  // ---------- 表枚举与类型 ----------
  function tabNameEls() { return [...document.querySelectorAll('.bitable-new-table-tab__item-name')]; }
  function tableNames() { return tabNameEls().map((e) => (e.textContent || '').trim()).filter(Boolean); }
  function switchTab(name) { const el = tabNameEls().find((e) => (e.textContent || '').trim() === name); if (el) { el.click(); return true; } return false; }
  function tableId(name) {
    const nameEl = tabNameEls().find((e) => (e.textContent || '').trim() === name);
    if (!nameEl) return '';
    const item = nameEl.closest('.bitable-new-table-tab__item') || nameEl.parentElement;
    let id = '';
    const scan = (el) => { if (!el || id) return; const m = String(el.className || '').match(/\b(tbl|ldx)[A-Za-z0-9]{10,}\b/); if (m) id = m[0]; };
    if (item) { scan(item); item.querySelectorAll('*').forEach(scan); let p = item; for (let i = 0; i < 4 && p; i++) { scan(p); p = p.parentElement; } }
    return id;
  }
  function tableType(name) { return tableId(name).startsWith('tbl') ? 'grid' : 'docx'; }

  // ---------- 文档式采集 ----------
  function pickFrame() {
    let best = null, bs = -1;
    [...document.querySelectorAll('iframe')].forEach((f) => {
      try {
        const vis = f.checkVisibility ? f.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }) : (f.offsetParent !== null);
        if (!vis) return;
        const r = f.getBoundingClientRect(); if (r.width < 100 || r.height < 100) return;
        const d = f.contentDocument; if (!d) return;
        const sc = d.querySelectorAll('[data-block-id]').length * 1000 + d.body.innerText.length;
        if (sc > bs) { bs = sc; best = f; }
      } catch (e) {}
    });
    return best;
  }
  async function scrapeDocx() {
    let f = null, prev = -1, stable = 0;
    for (let i = 0; i < 40; i++) {
      f = pickFrame();
      const L = f ? f.contentDocument.body.innerText.length : 0;
      if (f && L > 80 && L === prev) { if (++stable >= 2) break; } else stable = 0;
      prev = L; await sleep(300);
    }
    if (!f) return { type: 'empty', text: '' };
    const doc = f.contentDocument;
    let sc = null, best = 0;
    doc.querySelectorAll('*').forEach((el) => { const d = el.scrollHeight - el.clientHeight; if (d > best && el.clientHeight > 150) { best = d; sc = el; } });
    const blocks = new Map();
    const collect = () => {
      doc.querySelectorAll('[data-block-id]').forEach((el) => {
        if (el.querySelector('[data-block-id]')) return;
        const id = el.getAttribute('data-block-id');
        const t = (el.innerText || '').replace(/\s+$/, '');
        if (!t.trim()) return;
        const y = sc ? el.getBoundingClientRect().top + sc.scrollTop : el.getBoundingClientRect().top;
        const p = blocks.get(id);
        if (!p || t.length > p.text.length) blocks.set(id, { y, text: t });
      });
    };
    if (sc) {
      sc.scrollTop = 0; await sleep(500); collect(); await sleep(250); collect();
      const step = Math.floor(sc.clientHeight * 0.55);
      for (let y = 0; y <= sc.scrollHeight + step; y += step) { sc.scrollTop = y; await sleep(360); collect(); }
      sc.scrollTop = 0; await sleep(250); collect();
    } else { collect(); }
    const arr = [...blocks.values()].sort((a, b) => a.y - b.y);
    let txt = clean(arr.length ? arr.map((b) => b.text).join('\n') : (doc.body.innerText || '').trim());
    const type = txt.replace(/\s/g, '').length < 20 ? 'empty' : 'docx';
    return { type, text: txt };
  }
  async function runAuto(log, refresh) {
    const names = tableNames();
    if (!names.length) { log('未找到表标签'); return; }
    for (const name of names) {
      if (tableType(name) === 'grid') { typeMap[name] = 'grid'; refresh(); continue; }
      log('切到：' + name); switchTab(name); await sleep(300);
      log('  采集…');
      const res = await scrapeDocx();
      typeMap[name] = res.type;
      if (res.type === 'empty') { store[name] = store[name] || '[本表为空/画板]'; log('  → 空/画板'); }
      else { store[name] = res.text; log('  → ' + res.text.length + ' 字'); }
      refresh();
    }
    log('文档表完成。点「② 引导抓网格表」。');
  }

  // ---------- 网格表引导模式 ----------
  function gridHeaders() {
    // 尝试从表头读列名（失败则空）
    const hs = [];
    document.querySelectorAll('[class*="field-title"],[class*="header-title"],[role="columnheader"]').forEach((el) => {
      const t = (el.textContent || '').trim();
      if (t && t.length < 30 && !hs.includes(t)) hs.push(t);
    });
    return hs;
  }
  function startGuide(log, refresh) {
    guideList = tableNames().filter((n) => tableType(n) === 'grid' && !store[n]);
    if (!guideList.length) { log('没有待抓的网格表（都抓完了）'); return; }
    guideIdx = 0;
    document.getElementById('__pe_guide').style.display = 'block';
    gotoGuide(log, refresh);
  }
  function gotoGuide(log, refresh) {
    const name = guideList[guideIdx];
    switchTab(name);
    const prog = document.getElementById('__pe_gprog');
    const title = document.getElementById('__pe_gtitle');
    if (prog) prog.textContent = '网格表 ' + (guideIdx + 1) + ' / ' + guideList.length;
    if (title) title.textContent = name;
    const fb = document.getElementById('__pe_gpaste'); if (fb) { fb.style.display = 'block'; fb.value = ''; }
    log('引导：已切到「' + name + '」，在表里 ⌘A → ⌘C，再到框里 ⌘V');
  }
  function captureGuide(text, log, refresh) {
    const name = guideList[guideIdx];
    if (!text || text.length < 5) { log('没读到内容，确认已 ⌘C'); return false; }
    store[name] = clean(text);
    typeMap[name] = 'grid';
    log('✅ 收录「' + name + '」：' + text.split('\n').length + ' 行');
    refresh();
    // 下一张
    const remain = guideList.filter((n) => !store[n]);
    if (!remain.length) { document.getElementById('__pe_guide').style.display = 'none'; log('🎉 网格表全部完成，可「③ 导出 .md」'); return true; }
    guideIdx = guideList.indexOf(remain[0]);
    gotoGuide(log, refresh);
    return true;
  }
  async function guideReadClipboard(log, refresh) {
    // readText 首次会弹权限且可能一直 pending，用超时竞速，超时就回退到粘贴框
    let text = null;
    try {
      text = await Promise.race([
        navigator.clipboard.readText(),
        new Promise((res) => setTimeout(() => res(null), 1200)),
      ]);
    } catch (e) { text = null; }
    if (text && text.length >= 5) { captureGuide(text, log, refresh); return; }
    const fb = document.getElementById('__pe_gpaste');
    fb.style.display = 'block'; fb.value = ''; fb.focus();
    log('读不到剪贴板（或需授权），请在下方框里 ⌘V 粘贴');
  }

  // ---------- 导出 ----------
  function buildMd() {
    const names = tableNames();
    let md = '# 飞书多维表格导出（策划案）\n\n> 抓取时间：' + new Date().toISOString() + '\n\n---\n\n';
    names.forEach((name) => { md += '## ' + name + '\n\n' + (store[name] || '[未抓取]') + '\n\n---\n\n'; });
    return md;
  }
  function download() {
    const blob = new Blob([buildMd()], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = (document.title || 'bitable').replace(/[\\/:*?"<>|\s-]+/g, '_').slice(0, 40) + '_导出.md';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  // ---------- UI ----------
  function buildUI() {
    const box = document.createElement('div');
    box.id = '__plan_exporter';
    box.style.cssText = 'position:fixed;top:60px;right:16px;width:300px;max-height:84vh;overflow:auto;z-index:2147483647;background:#fff;border:1px solid #d0d0d0;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.18);font:13px/1.5 -apple-system,PingFang SC,sans-serif;color:#1f2329;';
    box.innerHTML = `
      <div style="padding:10px 12px;background:#3370ff;color:#fff;border-radius:10px 10px 0 0;display:flex;justify-content:space-between;align-items:center;">
        <b>📑 策划案导出</b><span id="__pe_close" style="cursor:pointer;">✕</span>
      </div>
      <div style="padding:10px 12px;">
        <button id="__pe_auto" style="width:100%;padding:8px;background:#3370ff;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600;">① 自动抓取文档表</button>
        <button id="__pe_guide" style="width:100%;padding:8px;margin-top:8px;background:#ff7d00;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600;">② 引导抓网格表</button>
        <div style="margin:10px 0 4px;color:#646a73;">各表状态：</div>
        <div id="__pe_list" style="font-size:12px;"></div>
        <button id="__pe_dl" style="width:100%;padding:8px;margin-top:10px;background:#00b42a;color:#fff;border:0;border-radius:6px;cursor:pointer;font-weight:600;">③ 导出 .md</button>
        <div id="__pe_log" style="margin-top:8px;max-height:120px;overflow:auto;font-size:11px;color:#8a9099;white-space:pre-wrap;"></div>
      </div>
      <div id="__pe_gbar" style="display:none;"></div>`;
    document.body.appendChild(box);

    // 引导浮层（底部横条）
    const guide = document.createElement('div');
    guide.id = '__pe_guide_bar';
    guide.innerHTML = `
      <div id="__pe_guide" style="display:none;position:fixed;left:24px;bottom:24px;z-index:2147483647;background:#1f2329;color:#fff;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.35);padding:14px 18px;width:420px;max-width:92vw;font:13px/1.5 -apple-system,PingFang SC,sans-serif;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
          <b id="__pe_gprog" style="color:#ff9a3c;">网格表</b>
          <span id="__pe_gclose2" style="cursor:pointer;opacity:.7;">收起</span>
        </div>
        <div style="font-size:15px;font-weight:700;margin-bottom:6px;" id="__pe_gtitle">—</div>
        <div style="color:#c9cdd4;margin-bottom:8px;">在左侧表格：<b style="color:#fff;">点一下 → ⌘A 全选 → ⌘C 复制</b>，再到下框 <b style="color:#fff;">⌘V 粘贴</b>（自动收录并跳下一张）。</div>
        <textarea id="__pe_gpaste" placeholder="在此 ⌘V 粘贴" style="display:block;width:100%;height:46px;margin-bottom:8px;box-sizing:border-box;border-radius:6px;border:0;padding:6px;"></textarea>
        <div style="display:flex;gap:8px;">
          <button id="__pe_gread" style="flex:1;padding:9px;background:#ff7d00;color:#fff;border:0;border-radius:7px;cursor:pointer;font-weight:700;">⚡ 免粘贴读取（需授权）</button>
          <button id="__pe_gskip" style="padding:9px 12px;background:#484c53;color:#fff;border:0;border-radius:7px;cursor:pointer;">跳过</button>
        </div>
      </div>`;
    document.body.appendChild(guide);

    const logEl = box.querySelector('#__pe_log');
    const log = (m) => { logEl.textContent += m + '\n'; logEl.scrollTop = logEl.scrollHeight; };
    const listEl = box.querySelector('#__pe_list');
    const refresh = () => {
      listEl.innerHTML = '';
      tableNames().forEach((name) => {
        const done = !!store[name];
        const ty = typeMap[name] || tableType(name);
        const badge = done ? '✅' : (ty === 'grid' ? '📋待抓' : (ty === 'empty' ? '◻️空' : '…'));
        const row = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;padding:3px 0;border-bottom:1px solid #f0f0f0;';
        row.innerHTML = '<span>' + name + '</span><span>' + badge + '</span>';
        listEl.appendChild(row);
      });
    };

    box.querySelector('#__pe_close').onclick = () => { box.style.display = 'none'; };
    box.querySelector('#__pe_auto').onclick = async () => { log('开始自动抓文档表…'); await runAuto(log, refresh); };
    box.querySelector('#__pe_guide').onclick = () => startGuide(log, refresh);
    box.querySelector('#__pe_dl').onclick = () => { download(); log('已下载 .md'); };

    guide.querySelector('#__pe_gclose2').onclick = () => { document.getElementById('__pe_guide').style.display = 'none'; };
    guide.querySelector('#__pe_gread').onclick = () => guideReadClipboard(log, refresh);
    guide.querySelector('#__pe_gskip').onclick = () => {
      const remain = guideList.filter((n) => !store[n] && guideList.indexOf(n) > guideIdx);
      if (!remain.length) { document.getElementById('__pe_guide').style.display = 'none'; log('引导结束'); return; }
      guideIdx = guideList.indexOf(remain[0]); gotoGuide(log, refresh);
    };
    const gp = guide.querySelector('#__pe_gpaste');
    gp.addEventListener('paste', () => { setTimeout(() => { captureGuide(gp.value, log, refresh); gp.value = ''; }, 30); });

    refresh();
    window.__planExporter = { show: () => { box.style.display = 'block'; } };
  }

  (async () => { for (let i = 0; i < 40 && !tableNames().length; i++) await sleep(500); buildUI(); })();
})();

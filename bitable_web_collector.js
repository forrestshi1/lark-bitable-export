/*
 * 飞书/Lark 多维表格 页面内采集脚本 (无需 API 权限)
 * 用法:
 *   1. 在本机浏览器打开目标多维表格页面(已登录)
 *   2. F12 打开控制台, 把本文件全部内容粘进去回车
 *   3. 执行  bitableAuto()   自动滚动加载所有行 (或手动从头滚到尾/翻页)
 *   4. 执行  bitableDump('text')  下载纯文本;  bitableDump('json') 下载 JSON
 *
 * 若 bitableDump 导出 0 条, 说明自动识别没匹配到飞书的内部结构:
 *   执行  bitableSample()  打印抓到的最大响应的结构, 据此调整解析逻辑。
 */
(function () {
  if (window.__bitableCollectorInstalled) {
    console.log('%c[bitable] 采集器已在运行, 当前已收集 ' + window.__bitableStore.size + ' 条', 'color:green');
    return;
  }
  window.__bitableCollectorInstalled = true;

  var store = (window.__bitableStore = new Map()); // id -> fields
  var raw = (window.__bitableRaw = []);            // 原始响应样本(调试用)

  function recId(o) { return o.record_id || o.recordId || o.id || o._id; }
  function looksLikeRecord(o) {
    if (!o || typeof o !== 'object') return false;
    // 开放API形态: {record_id, fields:{...}}
    if (o.fields && typeof o.fields === 'object' && recId(o)) return true;
    return false;
  }

  function scan(node, depth) {
    if (depth > 12 || !node || typeof node !== 'object') return;
    if (Array.isArray(node)) { for (var i = 0; i < node.length; i++) scan(node[i], depth + 1); return; }
    if (looksLikeRecord(node)) { store.set(recId(node), node.fields); }
    for (var k in node) { try { scan(node[k], depth + 1); } catch (e) {} }
  }

  function ingest(url, text) {
    if (!text || text.length < 2) return;
    var j;
    try { j = JSON.parse(text); } catch (e) { return; }
    // 保留疑似表格相关的原始响应, 供调试
    if (/bitable|base|record|sheet|grid|field/i.test(url || '')) {
      raw.push({ url: url, json: j });
      if (raw.length > 40) raw.shift();
    }
    var before = store.size;
    scan(j, 0);
    if (store.size > before) console.log('[bitable] 已收集 ' + store.size + ' 条');
  }

  // --- hook fetch ---
  var _fetch = window.fetch;
  window.fetch = function () {
    var args = arguments;
    var url = (args[0] && args[0].url) || args[0];
    return _fetch.apply(this, args).then(function (res) {
      try { res.clone().text().then(function (t) { ingest(url, t); }); } catch (e) {}
      return res;
    });
  };

  // --- hook XHR ---
  var _open = XMLHttpRequest.prototype.open;
  var _send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (m, u) { this.__url = u; return _open.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    this.addEventListener('load', function () {
      try {
        var t = self.responseType === '' || self.responseType === 'text' ? self.responseText
              : (typeof self.response === 'string' ? self.response : null);
        if (t) ingest(self.__url, t);
      } catch (e) {}
    });
    return _send.apply(this, arguments);
  };

  function flat(v) {
    if (v == null) return '';
    if (Array.isArray(v)) return v.map(function (x) {
      return x && typeof x === 'object' ? (x.text || x.name || JSON.stringify(x)) : x;
    }).join(' ');
    if (typeof v === 'object') return v.text || v.name || JSON.stringify(v);
    return v;
  }

  function download(name, text) {
    var blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url; a.download = name; document.body.appendChild(a); a.click();
    a.remove(); URL.revokeObjectURL(url);
  }

  window.bitableDump = function (fmt) {
    fmt = fmt || 'json';
    var recs = [];
    store.forEach(function (fields, id) { recs.push({ record_id: id, fields: fields }); });
    if (recs.length === 0) {
      console.warn('[bitable] 还没收集到记录。先 bitableAuto() 滚动, 仍为 0 就 bitableSample() 发我样本。');
      return 0;
    }
    var out;
    if (fmt === 'text') {
      out = recs.map(function (r, i) {
        var lines = ['===== 记录 ' + (i + 1) + ' (id=' + r.record_id + ') ====='];
        for (var k in r.fields) lines.push(k + ': ' + flat(r.fields[k]));
        return lines.join('\n');
      }).join('\n\n');
      download('bitable.txt', out);
    } else {
      out = JSON.stringify(recs, null, 2);
      download('bitable.json', out);
    }
    console.log('[bitable] 已导出 ' + recs.length + ' 条');
    return recs.length;
  };

  // 自动滚动加载所有虚拟行
  window.bitableAuto = function (step) {
    step = step || 500;
    return new Promise(function (resolve) {
      var cands = Array.prototype.slice.call(document.querySelectorAll('*')).filter(function (el) {
        return (el.scrollHeight - el.clientHeight) > 200 && el.clientHeight > 100;
      }).sort(function (a, b) { return (b.scrollHeight - b.clientHeight) - (a.scrollHeight - a.clientHeight); });
      var el = cands[0];
      if (!el) { console.warn('[bitable] 没找到可滚动容器, 请手动从头滚到尾'); return resolve(0); }
      console.log('[bitable] 滚动容器:', el.className || el.tagName);
      var last = -1, stable = 0, n = 0;
      var t = setInterval(function () {
        el.scrollTop += step;
        if (el.scrollTop === last) { if (++stable >= 3) { clearInterval(t);
          console.log('[bitable] 滚动完成, 共 ' + store.size + ' 条。执行 bitableDump("text") 导出'); return resolve(store.size); } }
        else stable = 0;
        last = el.scrollTop;
        if (++n > 5000) { clearInterval(t); resolve(store.size); }
      }, 220);
    });
  };

  // 调试: 打印最大的原始响应结构
  window.bitableSample = function () {
    if (!raw.length) { console.warn('还没抓到相关响应, 先滚动/翻页'); return; }
    var big = raw.slice().sort(function (a, b) {
      return JSON.stringify(b.json).length - JSON.stringify(a.json).length;
    })[0];
    console.log('[bitable] 最大响应 url:', big.url);
    console.log('[bitable] 顶层 keys:', Object.keys(big.json));
    console.log('[bitable] 完整对象(复制发我):', big.json);
    return big.json;
  };

  console.log('%c[bitable] 采集器已装好', 'color:green;font-weight:bold');
  console.log('下一步: 执行  bitableAuto()  自动滚动加载, 然后  bitableDump("text")  下载');
})();

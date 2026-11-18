# lark-bitable-export

把飞书 / Lark 多维表格（Bitable）里的内容导出成 Markdown、纯文本或 JSON。三个工具任选一个：

| 文件 | 方式 | 需要 API 权限 | 适合 |
|---|---|---|---|
| `lark-bitable-exporter.user.js` | 油猴脚本 / 粘进控制台 | 不需要 | 一个 base 里有多张表，文档式表和网格表混在一起 |
| `bitable_web_collector.js` | 粘进控制台 | 不需要 | 单张网格表，按页面接口响应收集记录 |
| `lark_bitable_dump.py` | 命令行，调开放平台 API | 需要 | 有自建应用权限，想脚本化批量拉取 |

## 1. lark-bitable-exporter.user.js（推荐）

安装到 Tampermonkey，或者把整个文件粘进 DevTools 控制台运行。打开 base 页面后右下角会出现面板：

1. **自动抓取文档表**：逐个切到文档式表（ID 前缀 `ldx`），滚动采集正文。
2. **引导抓网格表**：网格表（ID 前缀 `tbl`）是 canvas 渲染，DOM 里读不到文字。脚本会自动切到每一张网格表，你在表里点一下 → `⌘A` → `⌘C`，再在面板输入框里 `⌘V`，它会自动收录并跳到下一张。
3. **导出 .md**：合并下载。

注意：

- 浏览器剪贴板读取权限第一次会弹窗；读不到时会自动退回粘贴框。
- `⌘V` 前确认焦点在面板的输入框里，否则会粘进表格单元格，可以 `⌘Z` 撤销。
- 网格表复制出来没有表头，需要自己补列名。
- 画板 / 流程图没有可提取的文字。

## 2. bitable_web_collector.js

```js
// 粘进控制台后：
bitableAuto()          // 自动滚动加载所有行
bitableDump('text')    // 下载纯文本；bitableDump('json') 下载 JSON
bitableSample()        // 导出 0 条时，打印抓到的响应结构，方便调解析
```

## 3. lark_bitable_dump.py

一次性配置：

1. 在 open.larksuite.com/app（国内版 open.feishu.cn/app）建自建应用，开通 `bitable:app:readonly`，发布版本。
2. 把应用加为目标 base 的协作者（可阅读）。

```bash
export LARK_APP_ID=cli_xxx
export LARK_APP_SECRET=xxx
python3 lark_bitable_dump.py --app-token <base 的 app_token> --table-id <table_id> --format text --out bitable.txt
```

国内飞书把脚本里的 `BASE` 改成 `https://open.feishu.cn`。只用 Python 标准库，无需安装依赖。

## 说明

- 网页端脚本只读取你当前登录账号能看到的内容，不会修改表格。
- 飞书前端结构变化可能导致网页端脚本失效。

## License

MIT

#!/usr/bin/env python3
"""
拉取飞书/Lark 多维表格(Bitable)全部记录，不需要浏览器。

一次性配置:
  1. open.larksuite.com/app 建自建应用，开 bitable:app:readonly 权限
  2. 把该应用加为目标 base 的协作者(可阅读)
  3. 记下 App ID / App Secret

用法:
  export LARK_APP_ID=cli_xxx
  export LARK_APP_SECRET=xxx
  python3 lark_bitable_dump.py \
      --app-token <base 的 app_token> \
      --table-id  <table_id> \
      --out bitable.json        # 可选, 不给就打印到 stdout

  # 想要纯文本(方便喂给模型/阅读):
  python3 lark_bitable_dump.py ... --format text
"""
import argparse
import json
import os
import sys
import urllib.request
import urllib.error

# 国际版 Larksuite; 如果是国内飞书(feishu.cn)把下面域名改成 open.feishu.cn
BASE = "https://open.larksuite.com"


def _post_json(url, payload):
    data = json.dumps(payload).encode()
    req = urllib.request.Request(url, data=data,
                                 headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def _get_json(url, token):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {token}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        return json.loads(e.read())


def get_tenant_token(app_id, app_secret):
    url = f"{BASE}/open-apis/auth/v3/tenant_access_token/internal"
    resp = _post_json(url, {"app_id": app_id, "app_secret": app_secret})
    if resp.get("code") != 0:
        sys.exit(f"获取 token 失败: {resp}")
    return resp["tenant_access_token"]


def fetch_records(token, app_token, table_id):
    records, page_token = [], None
    while True:
        url = (f"{BASE}/open-apis/bitable/v1/apps/{app_token}"
               f"/tables/{table_id}/records?page_size=500")
        if page_token:
            url += f"&page_token={page_token}"
        resp = _get_json(url, token)
        if resp.get("code") != 0:
            # 常见: 1254043 应用无权限 -> 没把应用加为 base 协作者
            sys.exit(f"拉记录失败: {resp}")
        data = resp["data"]
        records.extend(data.get("items", []))
        if not data.get("has_more"):
            break
        page_token = data.get("page_token")
    return records


def _flatten(value):
    """把 Bitable 单元格值简化成人类可读文本。"""
    if isinstance(value, list):
        parts = []
        for v in value:
            if isinstance(v, dict):
                parts.append(v.get("text") or v.get("name") or json.dumps(v, ensure_ascii=False))
            else:
                parts.append(str(v))
        return " ".join(parts)
    if isinstance(value, dict):
        return value.get("text") or value.get("name") or json.dumps(value, ensure_ascii=False)
    return value


def to_text(records):
    lines = []
    for i, rec in enumerate(records, 1):
        lines.append(f"===== 记录 {i} (id={rec.get('record_id')}) =====")
        for field, val in rec.get("fields", {}).items():
            lines.append(f"{field}: {_flatten(val)}")
        lines.append("")
    return "\n".join(lines)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--app-token", required=True, help="base 的 app_token(URL /base/XXXX)")
    ap.add_argument("--table-id", required=True, help="table_id(URL ?table=XXXX)")
    ap.add_argument("--out", help="输出文件; 不给则打印到 stdout")
    ap.add_argument("--format", choices=["json", "text"], default="json")
    args = ap.parse_args()

    app_id = os.environ.get("LARK_APP_ID")
    app_secret = os.environ.get("LARK_APP_SECRET")
    if not (app_id and app_secret):
        sys.exit("请先 export LARK_APP_ID 和 LARK_APP_SECRET")

    token = get_tenant_token(app_id, app_secret)
    records = fetch_records(token, args.app_token, args.table_id)

    if args.format == "text":
        output = to_text(records)
    else:
        output = json.dumps(records, ensure_ascii=False, indent=2)

    if args.out:
        with open(args.out, "w", encoding="utf-8") as f:
            f.write(output)
        print(f"已写入 {args.out} ({len(records)} 条记录)", file=sys.stderr)
    else:
        print(output)


if __name__ == "__main__":
    main()

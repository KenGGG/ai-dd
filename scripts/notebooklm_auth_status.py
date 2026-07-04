"""
NotebookLM 登录状态检查。

供 Express 设置中心调用，输出 JSON。
"""
import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.notebooklm_upload import check_notebooklm_auth


def main() -> None:
    ok = asyncio.run(check_notebooklm_auth())
    print(json.dumps({
        "status": "ok" if ok else "auth_failed",
        "authenticated": ok,
        "message": "NotebookLM 登录正常" if ok else "NotebookLM 未登录或登录失效，请执行 notebooklm login",
    }, ensure_ascii=False))
    if not ok:
        sys.exit(1)


if __name__ == "__main__":
    main()

"""
AIDDA NotebookLM 项目创建入口。

输入股票代码和项目名称，检查 NotebookLM 登录态，并创建或复用同名笔记。
输出 JSON，供 Express API 调用。
"""
import argparse
import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.astock_download_announcements import generate_project_id
from scripts.astock_utils import normalize_stock_code
from scripts.notebooklm_upload import check_notebooklm_auth, get_or_create_notebook
from scripts.run_aidda_project import get_stock_name

logging.basicConfig(level=logging.INFO, format="%(levelname)s:%(name)s:%(message)s")
logger = logging.getLogger(__name__)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="创建 AIDDA 项目并同步创建 NotebookLM 笔记")
    parser.add_argument("--stock-code", required=True)
    parser.add_argument("--project-name", default="")
    parser.add_argument("--project-id", default="")
    parser.add_argument("--stock-name", default="")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    raw_code = normalize_stock_code(args.stock_code)
    stock_name = args.stock_name or get_stock_name(raw_code) or raw_code
    project_id = args.project_id or generate_project_id(raw_code)
    project_name = args.project_name or f"AIDDA-{raw_code}-{stock_name}"
    notebook_title = f"AIDDA-{raw_code}-{stock_name}"

    if not asyncio.run(check_notebooklm_auth()):
        print(json.dumps({
            "status": "auth_failed",
            "error_message": "NotebookLM 未登录或登录失效。请先执行 notebooklm login",
            "project_id": project_id,
            "stock_code": raw_code,
            "stock_name": stock_name,
            "project_name": project_name,
            "notebook_id": "",
            "notebook_title": notebook_title,
            "notebook_source_count": 0,
        }, ensure_ascii=False))
        sys.exit(1)

    nb_result = asyncio.run(get_or_create_notebook(notebook_title=notebook_title, mode="create"))
    if nb_result.get("status") == "failed":
        print(json.dumps({
            "status": "failed",
            "error_message": nb_result.get("error_message", "NotebookLM 笔记创建失败"),
            "project_id": project_id,
            "stock_code": raw_code,
            "stock_name": stock_name,
            "project_name": project_name,
            "notebook_id": "",
            "notebook_title": notebook_title,
            "notebook_source_count": 0,
        }, ensure_ascii=False))
        sys.exit(1)

    print(json.dumps({
        "status": "created",
        "project_id": project_id,
        "stock_code": raw_code,
        "stock_name": stock_name,
        "project_name": project_name,
        "notebook_id": nb_result.get("notebook_id", ""),
        "notebook_title": nb_result.get("notebook_title", notebook_title),
        "notebook_source_count": nb_result.get("source_count", 0),
        "error_message": "",
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()

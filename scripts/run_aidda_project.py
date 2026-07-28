#!/usr/bin/env python3
"""
AIDDA Workbench — CLI 主流程编排

全流程：创建项目 → 下载公告 → 上传 NotebookLM → 逐轮提问 → 拼接报告

用法:
    python scripts/run_aidda_project.py \\
        --project-name "宁德时代公告尽调" \\
        --stock-code 300750.SZ \\
        --periodic-years 3 \\
        --recent-limit 200 \\
        --notebook-mode create \\
        --wait-ready
"""
import argparse
import json
import logging
import os
import sys
import time
from datetime import datetime
from pathlib import Path

# 确保项目根目录在 Python 路径中
_SCRIPTS_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = _SCRIPTS_DIR.parent
if str(_PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(_PROJECT_ROOT))

# 尝试导入脚本模块（支持 conda run -n openclaw 调用）
try:
    from scripts.astock_download_announcements import (
        download_announcements,
        generate_project_id,
    )
    from scripts.notebooklm_upload import run_upload
    from scripts.notebooklm_run_questions import run_questions
    from scripts.compose_dd_report import compose_report
except ImportError:
    # 作为模块直接运行时
    from astock_download_announcements import (
        download_announcements,
        generate_project_id,
    )
    from notebooklm_upload import run_upload
    from notebooklm_run_questions import run_questions
    from compose_dd_report import compose_report

# ── 日志配置 ───────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
logger = logging.getLogger("aidda")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="AIDDA Workbench — AI 驱动的自动化尽职调查工作台 CLI",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
示例:
    # 全流程运行
    python scripts/run_aidda_project.py \\
        --project-name "宁德时代公告尽调" \\
        --stock-code 300750.SZ \\
        --periodic-years 3 \\
        --recent-limit 200 \\
        --notebook-mode create \\
        --wait-ready

    # 复用已有 Notebook，跳过下载和上传
    python scripts/run_aidda_project.py \\
        --project-name "仅提问" \\
        --stock-code 300750.SZ \\
        --notebook-mode reuse \\
        --notebook-id "abc123" \\
        --skip-download \\
        --skip-upload
        """,
    )

    # 项目参数
    parser.add_argument(
        "--project-name",
        type=str,
        required=True,
        help="项目名称，如 '宁德时代公告尽调'",
    )
    parser.add_argument(
        "--stock-code",
        type=str,
        required=True,
        help="股票代码，支持 300750 / 300750.SZ / SZ300750 格式",
    )

    # 下载参数
    parser.add_argument(
        "--periodic-years",
        type=int,
        default=3,
        help="近三年定期报告（默认 3 年）",
    )
    parser.add_argument(
        "--recent-limit",
        type=int,
        default=200,
        help="最近 N 个公告补充（默认 200）",
    )

    # NotebookLM 参数
    parser.add_argument(
        "--notebook-mode",
        type=str,
        choices=["create", "reuse"],
        default="create",
        help="NotebookLM 笔记模式：create（创建新笔记）或 reuse（复用已有笔记）",
    )
    parser.add_argument(
        "--notebook-id",
        type=str,
        default=None,
        help="reuse 模式时传入已有 NotebookLM 笔记 ID",
    )
    parser.add_argument(
        "--wait-ready",
        action="store_true",
        default=True,
        help="等待 PDF 在 NotebookLM 中处理完成（默认开启）",
    )

    # 跳过参数
    parser.add_argument(
        "--skip-download",
        action="store_true",
        help="跳过公告下载，复用已有 PDF 和 manifest",
    )
    parser.add_argument(
        "--skip-upload",
        action="store_true",
        help="跳过 NotebookLM 上传，复用已有 notebook_id",
    )
    parser.add_argument(
        "--skip-questions",
        action="store_true",
        help="跳过提问，仅下载和上传",
    )
    parser.add_argument(
        "--skip-report",
        action="store_true",
        help="跳过报告拼接",
    )
    parser.add_argument(
        "--max-question-rounds",
        type=int,
        default=0,
        help="最多执行多少轮 NotebookLM 提问；0 表示不限制",
    )
    parser.add_argument(
        "--max-question-sources",
        type=int,
        default=0,
        help="每轮最多限定多少个 NotebookLM source；0 表示不限制",
    )
    parser.add_argument(
        "--force-questions",
        action="store_true",
        help="重新提问已存在答案的问题",
    )
    parser.add_argument(
        "--question-method",
        type=str,
        choices=["chat", "report"],
        default="chat",
        help="NotebookLM 问答方式：chat 使用对话回复；report 使用 generate report 自定义报告",
    )
    parser.add_argument(
        "--report-prompt-prefix",
        type=str,
        default="请根据当前的资料，特别是2025、2026年近期这些报告，回答以下问题：",
        help="report 问答方式下拼接在问题前的自定义报告提示词前缀",
    )
    parser.add_argument(
        "--round-ids",
        type=str,
        default="",
        help="只执行指定问题 round_id，多个 ID 可用逗号或换行分隔",
    )

    # 输出参数
    parser.add_argument(
        "--out-dir",
        type=str,
        default=None,
        help="输出目录（默认 data/ 目录）",
    )

    # 股票简称（可选，自动查询）
    parser.add_argument(
        "--stock-name",
        type=str,
        default="",
        help="股票简称，不传则尝试自动获取",
    )

    # 已有项目 ID（用于跳过下载后复用已有 manifest 和 answers）
    parser.add_argument(
        "--project-id",
        type=str,
        default=None,
        help="已有项目 ID，用于复用之前下载的 manifest 和答案",
    )
    parser.add_argument(
        "--data-dir",
        type=str,
        default=None,
        help="输出根目录 (由服务端传入)",
    )

    return parser.parse_args()


def get_stock_name(code: str) -> str:
    """通过腾讯财经获取股票简称"""
    import urllib.request
    from scripts.astock_utils import normalize_stock_code

    raw = normalize_stock_code(code)
    prefix = "sh" if raw.startswith("6") else ("bj" if raw.startswith("8") else "sz")
    try:
        url = f"https://qt.gtimg.cn/q={prefix}{raw}"
        req = urllib.request.Request(url)
        req.add_header("User-Agent", "Mozilla/5.0")
        resp = urllib.request.urlopen(req, timeout=10)
        data = resp.read().decode("gbk")
        vals = data.split('"')[1].split("~")
        return vals[1] if len(vals) > 1 else ""
    except Exception as e:
        logger.warning(f"获取股票简称失败: {e}")
        return ""


def print_summary(summary: dict) -> None:
    """打印摘要输出"""
    print()
    print("=" * 60)
    print("  AIDDA Workbench — 运行摘要")
    print("=" * 60)
    print(f"  项目名称：{summary.get('project_name', '')}")
    print(f"  股票代码：{summary.get('stock_code', '')}")
    print(f"  项目 ID：{summary.get('project_id', '')}")
    print()
    print(f"  近三年定期报告检索数量：{summary.get('periodic_count', 'N/A')}")
    print(f"  最近200个公告检索数量：{summary.get('recent_count', 'N/A')}")
    print(f"  去重后 PDF 数量：{summary.get('after_dedup', 'N/A')}")
    print(f"  下载成功：{summary.get('download_success', 'N/A')}")
    print(f"  下载失败：{summary.get('download_failed', 'N/A')}")
    print()
    print(f"  Notebook ID：{summary.get('notebook_id', 'N/A')}")
    print(f"  上传成功：{summary.get('upload_success', 'N/A')}")
    print(f"  上传失败：{summary.get('upload_failed', 'N/A')}")
    print()
    print(f"  问题轮次数：{summary.get('rounds_total', 'N/A')}")
    print(f"  成功回答轮次：{summary.get('rounds_success', 'N/A')}")
    print(f"  失败轮次：{summary.get('rounds_failed', 'N/A')}")
    print(f"  问答方式：{summary.get('question_method', 'chat')}")
    print()
    print(f"  报告路径：{summary.get('report_path', 'N/A')}")
    print(f"  manifest 路径：{summary.get('manifest_path', 'N/A')}")
    print()
    if summary.get("unfilled_count", 0) > 0:
        print(f"  未填列事项数：{summary.get('unfilled_count', 0)}")
    print("=" * 60)
    print()


def main() -> None:
    args = parse_args()

    # ── 初始化 ──────────────────────────────────────────────────────
    data_dir = args.data_dir or str(Path(__file__).resolve().parent.parent / "data")
    project_id = args.project_id or generate_project_id(args.stock_code)
    stock_name = args.stock_name or get_stock_name(args.stock_code)

    logger.info(f"项目名称: {args.project_name}")
    logger.info(f"股票代码: {args.stock_code} → 简称: {stock_name}")
    logger.info(f"项目 ID: {project_id}")
    logger.info(f"NotebookLM 模式: {args.notebook_mode}")

    summary: dict = {
        "project_name": args.project_name,
        "stock_code": args.stock_code,
        "project_id": project_id,
        "stock_name": stock_name,
        "periodic_count": 0,
        "recent_count": 0,
        "after_dedup": 0,
        "download_success": 0,
        "download_failed": 0,
        "notebook_id": "",
        "upload_success": 0,
        "upload_failed": 0,
        "rounds_total": 0,
        "rounds_success": 0,
        "rounds_failed": 0,
        "report_path": "",
        "manifest_path": "",
    }

    start_time = time.time()

    # ── Step 1: 公告下载 ──────────────────────────────────────────
    logger.info("=" * 50)
    logger.info("Step 1/4: 公告下载")
    logger.info("=" * 50)

    download_result = download_announcements(
        stock_code=args.stock_code,
        project_id=project_id,
        periodic_years=args.periodic_years,
        recent_limit=args.recent_limit,
        out_dir=args.out_dir,
        skip_download=args.skip_download,
        data_dir=data_dir,
    )
    summary.update(download_result)
    manifest_records = None  # 稍后加载

    # ── Step 2: NotebookLM 上传 ──────────────────────────────────
    logger.info("=" * 50)
    logger.info("Step 2/4: NotebookLM 上传")
    logger.info("=" * 50)

    manifest_path = download_result.get("manifest_path", "")
    if manifest_path and os.path.exists(manifest_path):
        with open(manifest_path, "r", encoding="utf-8") as f:
            manifest_records = [json.loads(line) for line in f if line.strip()]

    upload_result = {"status": "skipped"}
    if not args.skip_upload and manifest_records:
        upload_result = run_upload(
            manifest_records=manifest_records,
            mode=args.notebook_mode,
            notebook_id=args.notebook_id,
            stock_code=args.stock_code,
            stock_name=stock_name,
            wait_ready=args.wait_ready,
            project_id=project_id,
        )

        if upload_result.get("status") == "auth_failed":
            logger.error(f"NotebookLM 认证失败: {upload_result.get('error_message', '')}")
            logger.error("请执行以下命令后重试：")
            logger.error("  notebooklm login")
            logger.error("  notebooklm auth check --test")
            summary.update(upload_result)
            print_summary(summary)
            sys.exit(1)

        summary["notebook_id"] = upload_result.get("notebook_id", "")
        summary["notebook_title"] = upload_result.get("notebook_title", "")
        summary["upload_success"] = upload_result.get("upload_success", 0)
        summary["upload_failed"] = upload_result.get("upload_failed", 0)

        # 更新 manifest records（含上传状态）
        if upload_result.get("manifest_records"):
            manifest_records = upload_result["manifest_records"]

    elif args.skip_upload:
        logger.info("已跳过 NotebookLM 上传")

    # ── Step 3: 逐轮提问 ──────────────────────────────────────────
    logger.info("=" * 50)
    logger.info("Step 3/4: 逐轮提问")
    logger.info("=" * 50)

    notebook_id = upload_result.get("notebook_id", "") or args.notebook_id or ""
    question_result = {"status": "skipped"}
    round_ids = [
        part.strip()
        for part in args.round_ids.replace("，", ",").replace("\n", ",").split(",")
        if part.strip()
    ]

    if not args.skip_questions and notebook_id:
        question_result = run_questions(
            notebook_id=notebook_id,
            project_id=project_id,
            manifest_records=manifest_records,
            skip_questions=False,
            max_rounds=args.max_question_rounds or None,
            max_source_ids=args.max_question_sources or None,
            round_ids=round_ids or None,
            force=args.force_questions,
            question_method=args.question_method,
            report_prompt_prefix=args.report_prompt_prefix,
            data_dir=data_dir,
        )
        summary["rounds_total"] = question_result.get("rounds_total", 0)
        summary["rounds_success"] = question_result.get("rounds_success", 0)
        summary["rounds_failed"] = question_result.get("rounds_failed", 0)
        summary["answers_dir"] = question_result.get("answers_dir", "")
        summary["question_method"] = question_result.get("question_method", args.question_method)
        if question_result.get("status") in {"auth_failed", "partial"} or summary["rounds_failed"] > 0:
            summary.update(question_result)
            print_summary(summary)
            logger.error("提问阶段存在失败，已保留进度，可从断点继续。")
            sys.exit(1)
    elif args.skip_questions:
        logger.info("已跳过提问阶段")
    elif not notebook_id:
        logger.warning("没有 notebook_id，跳过提问")

    # ── Step 4: 报告拼接 ──────────────────────────────────────────
    logger.info("=" * 50)
    logger.info("Step 4/4: 报告拼接")
    logger.info("=" * 50)

    if not args.skip_report:
        report_result = compose_report(
            project_id=project_id,
            project_name=args.project_name,
            stock_code=args.stock_code,
            stock_name=stock_name,
            skip_report=False,
            data_dir=data_dir,
        )
        summary["report_path"] = report_result.get("report_path", "")
        summary["unfilled_count"] = report_result.get("unfilled_count", 0)
        summary["total_chars"] = report_result.get("total_chars", 0)
    else:
        logger.info("已跳过报告拼接")

    # ── 摘要输出 ──────────────────────────────────────────────────
    elapsed = time.time() - start_time
    summary["elapsed_seconds"] = round(elapsed, 1)
    print_summary(summary)
    logger.info(f"总耗时: {elapsed:.1f} 秒")

    # 保存运行摘要
    summary_path = Path(data_dir) / "projects" / f"{project_id}_summary.json"
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    logger.info(f"运行摘要已保存: {summary_path}")


if __name__ == "__main__":
    main()

"""
NotebookLM 上传模块 — 使用 notebooklm-py 上传 PDF 到 NotebookLM

功能：
1. 检查 NotebookLM 登录状态
2. 创建或复用 NotebookLM 笔记
3. 上传 PDF 文件
4. 等待 source 处理完成
5. 记录上传和处理状态到 manifest
"""
import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


async def check_notebooklm_auth() -> bool:
    """
    检查 NotebookLM 登录状态。
    返回 True 表示已登录可用，False 表示未登录或失效。
    """
    try:
        from notebooklm import NotebookLMClient

        async with NotebookLMClient.from_storage() as client:
            notebooks = await client.notebooks.list()
            logger.info(f"NotebookLM 登录正常，可访问 {len(notebooks)} 个笔记")
            return True
    except Exception as e:
        logger.error(f"NotebookLM 登录检查失败: {e}")
        return False


async def get_or_create_notebook(
    notebook_title: str,
    mode: str = "create",
    notebook_id: str | None = None,
) -> dict[str, Any]:
    """
    创建或复用 NotebookLM 笔记。

    Args:
        notebook_title: 笔记标题
        mode: "create" 或 "reuse"
        notebook_id: reuse 模式时的笔记 ID

    Returns:
        {status, notebook_id, notebook_title, error_message}
    """
    from notebooklm import NotebookLMClient

    async with NotebookLMClient.from_storage() as client:
        # 列出已有笔记
        notebooks = await client.notebooks.list()
        notebook_map = {n.id: n.title for n in notebooks}

        if mode == "reuse":
            if not notebook_id:
                return {
                    "status": "failed",
                    "notebook_id": "",
                    "notebook_title": "",
                    "error_message": "reuse 模式必须提供 notebook_id",
                }
            # 检查 notebook_id 是否存在
            if notebook_id in notebook_map:
                logger.info(f"复用已有笔记: {notebook_id} ({notebook_map[notebook_id]})")
                return {
                    "status": "reused",
                    "notebook_id": notebook_id,
                    "notebook_title": notebook_map[notebook_id],
                    "error_message": "",
                }
            else:
                logger.warning(f"笔记 {notebook_id} 不存在，将创建新笔记")
                # fallthrough 创建新笔记

        # 检查是否已有同名笔记
        existing_id = None
        for nid, title in notebook_map.items():
            if title == notebook_title:
                existing_id = nid
                break

        if existing_id:
            logger.info(f"发现同名笔记: {existing_id}，直接复用")
            return {
                "status": "reused",
                "notebook_id": existing_id,
                "notebook_title": notebook_title,
                "error_message": "",
            }

        # 创建新笔记
        try:
            notebook = await client.notebooks.create(title=notebook_title)
            logger.info(f"创建新笔记成功: {notebook.id} ({notebook.title})")
            return {
                "status": "created",
                "notebook_id": notebook.id,
                "notebook_title": notebook.title,
                "error_message": "",
            }
        except Exception as e:
            logger.error(f"创建笔记失败: {e}")
            return {
                "status": "failed",
                "notebook_id": "",
                "notebook_title": "",
                "error_message": str(e),
            }


async def upload_pdf_to_notebook(
    notebook_id: str,
    pdf_path: str | Path,
    wait_ready: bool = True,
    wait_timeout: float = 120.0,
) -> dict[str, Any]:
    """
    上传单个 PDF 到 NotebookLM 笔记。

    Returns:
        {status, source_id, source_title, error_message}
    """
    from notebooklm import NotebookLMClient

    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        return {
            "status": "failed",
            "source_id": "",
            "source_title": pdf_path.name,
            "error_message": f"文件不存在: {pdf_path}",
        }

    async with NotebookLMClient.from_storage() as client:
        try:
            source = await client.sources.add_file(
                notebook_id=notebook_id,
                file_path=pdf_path,
                wait=wait_ready,
                wait_timeout=wait_timeout,
            )
            return {
                "status": "uploaded",
                "source_id": source.id,
                "source_title": pdf_path.name,
                "error_message": "",
            }
        except Exception as e:
            logger.error(f"上传失败 {pdf_path.name}: {e}")
            return {
                "status": "upload_failed",
                "source_id": "",
                "source_title": pdf_path.name,
                "error_message": str(e),
            }


async def upload_all_pdfs(
    notebook_id: str,
    manifest_records: list[dict],
    wait_ready: bool = True,
    wait_timeout: float = 120.0,
    notebook_title: str = "",
) -> list[dict]:
    """
    上传 manifest 中所有已下载的 PDF 到 NotebookLM。

    返回更新后的 manifest records（含 upload_status, source_id, ready_status）
    """
    from notebooklm import NotebookLMClient

    # 过滤出已下载的 PDF
    to_upload = [
        r for r in manifest_records
        if r.get("download_status") == "downloaded"
        and r.get("local_path")
    ]
    logger.info(f"待上传 PDF 数量: {len(to_upload)}")

    if not to_upload:
        logger.warning("没有已下载的 PDF 需要上传")
        return manifest_records

    async with NotebookLMClient.from_storage() as client:
        for idx, rec in enumerate(to_upload):
            pdf_path = Path(rec["local_path"])
            if not pdf_path.exists():
                rec["upload_status"] = "upload_failed"
                rec["error_message"] = f"本地文件不存在: {pdf_path}"
                logger.warning(f"  [{idx+1}/{len(to_upload)}] 文件不存在: {pdf_path}")
                continue

            try:
                source = await client.sources.add_file(
                    notebook_id=notebook_id,
                    file_path=pdf_path,
                    wait=wait_ready,
                    wait_timeout=wait_timeout,
                )
                rec["upload_status"] = "uploaded"
                rec["source_id"] = source.id
                rec["ready_status"] = "ready"
                rec["notebook_id"] = notebook_id
                rec["error_message"] = ""
                logger.info(f"  [{idx+1}/{len(to_upload)}] ✓ {pdf_path.name}")
            except Exception as e:
                rec["upload_status"] = "upload_failed"
                rec["source_id"] = ""
                rec["ready_status"] = ""
                rec["notebook_id"] = notebook_id
                rec["error_message"] = str(e)
                logger.warning(f"  [{idx+1}/{len(to_upload)}] ✗ {pdf_path.name}: {e}")

            # 上传间隔控制
            await asyncio.sleep(0.5)

    # 统计
    upload_statuses = [r.get("upload_status", "") for r in to_upload]
    success = sum(1 for s in upload_statuses if s == "uploaded")
    failed = sum(1 for s in upload_statuses if s == "upload_failed")
    logger.info(f"上传完成: 成功 {success}, 失败 {failed}")

    return manifest_records


# ── 同步入口 ──────────────────────────────────────────────────────────


def run_upload(
    manifest_records: list[dict],
    mode: str = "create",
    notebook_id: str | None = None,
    stock_code: str = "",
    stock_name: str = "",
    wait_ready: bool = True,
) -> dict[str, Any]:
    """
    同步执行的 NotebookLM 上传入口。

    Returns:
        {status, notebook_id, notebook_title, upload_success, upload_failed, ...}
    """
    # 1. 检查登录状态
    auth_ok = asyncio.run(check_notebooklm_auth())
    if not auth_ok:
        return {
            "status": "auth_failed",
            "error_message": "NotebookLM 未登录或登录失效。请执行: notebooklm login",
            "notebook_id": "",
            "notebook_title": "",
            "upload_success": 0,
            "upload_failed": 0,
        }

    # 2. 创建或复用笔记
    notebook_title = f"AIDDA-{stock_code}-{stock_name}-近三年定期报告+最近200公告"
    nb_result = asyncio.run(
        get_or_create_notebook(
            notebook_title=notebook_title,
            mode=mode,
            notebook_id=notebook_id,
        )
    )

    if nb_result.get("status") == "failed":
        return {
            "status": "failed",
            "error_message": nb_result.get("error_message", "创建笔记失败"),
            "notebook_id": "",
            "notebook_title": "",
            "upload_success": 0,
            "upload_failed": 0,
        }

    nb_id = nb_result["notebook_id"]
    nb_title = nb_result["notebook_title"]
    logger.info(f"Notebook: {nb_id} ({nb_title})")

    # 3. 上传 PDF
    updated_records = asyncio.run(
        upload_all_pdfs(
            notebook_id=nb_id,
            manifest_records=manifest_records,
            wait_ready=wait_ready,
        )
    )

    # 统计
    upload_statuses = [r.get("upload_status", "") for r in updated_records]
    success = sum(1 for s in upload_statuses if s == "uploaded")
    failed = sum(1 for s in upload_statuses if s == "upload_failed")

    return {
        "status": "completed",
        "notebook_id": nb_id,
        "notebook_title": nb_title,
        "manifest_records": updated_records,
        "upload_success": success,
        "upload_failed": failed,
        "error_message": "",
    }

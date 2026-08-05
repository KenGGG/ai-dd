"""
路径安全工具 — 防止路径穿越（path traversal）。
供下载/上传脚本共用，避免重复定义。
"""
from pathlib import Path


def _validate_safe_path(base_dir: Path, requested: Path) -> Path:
    """确保解析后的绝对路径仍在 base_dir 下"""
    resolved = requested.resolve()
    if not resolved.is_relative_to(base_dir.resolve()):
        raise ValueError(f"路径穿越风险: {resolved} 不在 {base_dir} 下")
    return resolved

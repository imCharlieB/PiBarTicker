from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True)
class RuntimePaths:
    root: Path
    config_file: Path
    runtime_cache: Path
    team_meta: Path
    logos: Path


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def get_runtime_paths() -> RuntimePaths:
    root = project_root()
    return RuntimePaths(
        root=root,
        config_file=root / "config.json",
        runtime_cache=root / "runtime-cache",
        team_meta=root / "team-meta",
        logos=root / "logos",
    )


def bootstrap_runtime_dirs(paths: RuntimePaths | None = None) -> RuntimePaths:
    resolved = paths or get_runtime_paths()
    resolved.runtime_cache.mkdir(parents=True, exist_ok=True)
    resolved.team_meta.mkdir(parents=True, exist_ok=True)
    resolved.logos.mkdir(parents=True, exist_ok=True)
    return resolved

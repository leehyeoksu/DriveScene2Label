"""Resolve original or managed-upload media without accepting absolute paths."""
import os
from pathlib import Path, PurePosixPath
from uuid import UUID

def upload_root(upload_id):
    if str(UUID(upload_id)) != upload_id:
        raise ValueError("Invalid upload ID")
    root = Path(os.environ.get("UPLOAD_ROOT", "/data/uploads")).resolve()
    path = (root / upload_id).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Upload outside storage root")
    return path

def media_path(default_root, relative):
    if not relative or relative.startswith(("/", "\\")) or "\\" in relative or ":" in relative or ".." in PurePosixPath(relative).parts:
        raise ValueError("Unsafe relative media path")
    if relative.startswith("__uploads__/"):
        parts = relative.split("/", 2)
        if len(parts) != 3:
            raise ValueError("Missing upload media path")
        root, relative = upload_root(parts[1]), parts[2]
    else:
        root = Path(default_root).resolve()
    path = (root / relative).resolve()
    if not path.is_relative_to(root):
        raise ValueError("Media outside storage root")
    if not path.is_file():
        raise FileNotFoundError(relative)
    return path

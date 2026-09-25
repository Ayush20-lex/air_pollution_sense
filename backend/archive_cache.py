"""
Disk cache for the archive's expensive derived state.

Loading the archive and running the observation QC over it is the whole cost of
a cold start: on the Oracle box (951 MB RAM, deep in swap) the first requests
after a restart took 41-58 s, all of it this work. The inputs only change when
someone commits new data, so the finished result is written to disk and read
back on the next start.

The key is what makes this safe. It fingerprints every input file (path, size,
modification time), the parameters, and the source of the modules that shape
the result - so new data, a changed window, or an edit to the QC thresholds each
miss and rebuild on their own. A stale cache cannot be served silently, and
nobody has to remember to clear it.

Nothing here is allowed to fail a request. A missing, corrupt, or unwritable
cache is a slow start, never an error.

Pickle is used because the state includes numpy arrays, DataFrames and
DatetimeIndexes, and these files are only ever written and read by this
process, in a directory it owns. Never point CACHE_DIR at anything writable by
someone else.
"""
from __future__ import annotations

import hashlib
import logging
import os
import pickle
import tempfile
from pathlib import Path
from typing import Any, Iterable

log = logging.getLogger(__name__)

REPO_ROOT = Path(__file__).resolve().parents[1]
CACHE_DIR = Path(os.environ.get("ARCHIVE_CACHE_DIR", REPO_ROOT / ".cache" / "archive"))

#: Bumped by hand only if the pickle layout itself changes in a way the source
#: hash would not see (a new Python, a pandas major that cannot unpickle).
FORMAT = 1

_BACKEND = Path(__file__).resolve().parent


def _source_hash(modules: Iterable[str]) -> str:
    h = hashlib.sha256()
    for m in sorted(modules):
        p = _BACKEND / f"{m}.py"
        try:
            h.update(m.encode())
            h.update(p.read_bytes())
        except OSError:
            h.update(b"<missing>")
    return h.hexdigest()


def key(files: Iterable[Path], code: Iterable[str], **params: Any) -> str:
    """A fingerprint of everything the cached value depends on."""
    h = hashlib.sha256(f"format={FORMAT}".encode())
    for f in sorted(Path(x) for x in files):
        try:
            st = f.stat()
            h.update(f"{f.as_posix()}|{st.st_size}|{st.st_mtime_ns}".encode())
        except OSError:
            h.update(f"{f.as_posix()}|missing".encode())
    h.update(_source_hash(code).encode())
    for k in sorted(params):
        h.update(f"{k}={params[k]!r}".encode())
    return h.hexdigest()


def _path(name: str) -> Path:
    return CACHE_DIR / f"{name}.pkl"


def load(name: str, k: str) -> Any | None:
    """The cached value for `name` if it was built from exactly these inputs."""
    p = _path(name)
    try:
        with p.open("rb") as fh:
            stored_key, value = pickle.load(fh)
    except FileNotFoundError:
        return None
    except Exception as exc:  # noqa: BLE001 - a bad cache is a rebuild, not an error
        log.warning("archive cache %s unreadable (%s); rebuilding", name, exc)
        return None
    if stored_key != k:
        log.info("archive cache %s is for different inputs; rebuilding", name)
        return None
    return value


def save(name: str, k: str, value: Any) -> None:
    """Write atomically: a crash mid-write leaves the old file, never half a new one."""
    try:
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=CACHE_DIR, prefix=f".{name}.", suffix=".tmp")
        try:
            with os.fdopen(fd, "wb") as fh:
                pickle.dump((k, value), fh, protocol=pickle.HIGHEST_PROTOCOL)
            os.replace(tmp, _path(name))
        finally:
            if os.path.exists(tmp):
                os.unlink(tmp)
    except Exception as exc:  # noqa: BLE001 - the value is still served from memory
        log.warning("could not write archive cache %s (%s)", name, exc)

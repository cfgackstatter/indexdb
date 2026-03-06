import os
import polars as pl
from pathlib import Path
from datetime import date

# ── Storage config ────────────────────────────────────────────────────────────
_BACKEND  = os.getenv("STORAGE_BACKEND", "local")
_S3_ROOT  = f"s3://{os.getenv('S3_BUCKET', '')}"
_DATA_DIR = Path(__file__).parent.parent / "data"

CATALOG_REL = "catalog.parquet"

def _is_s3() -> bool:
    return _BACKEND == "s3"

def _path(relative: str) -> str | Path:
    """Resolve a relative path to either a local Path or an s3:// URI."""
    return f"{_S3_ROOT}/{relative}" if _is_s3() else _DATA_DIR / relative

def _s3_exists(relative: str) -> bool:
    import s3fs
    return s3fs.S3FileSystem().exists(f"{_S3_ROOT.removeprefix('s3://')}/{relative}")

# ── Low-level read / write ────────────────────────────────────────────────────
def read_parquet(relative: str) -> pl.DataFrame:
    if _is_s3():
        return pl.read_parquet(_path(relative)) if _s3_exists(relative) else pl.DataFrame()
    p = _DATA_DIR / relative
    return pl.read_parquet(p) if p.exists() else pl.DataFrame()

def write_parquet(df: pl.DataFrame, relative: str, *, timeseries: bool = False) -> None:
    """Write parquet with zstd compression (level 6 for timeseries, default otherwise)."""
    path = _path(relative)
    if not _is_s3():
        Path(path).parent.mkdir(parents=True, exist_ok=True)  # type: ignore[arg-type]
    if timeseries:
        df.write_parquet(path, compression="zstd", compression_level=6)
    else:
        df.write_parquet(path, compression="zstd")

def path_exists(relative: str) -> bool:
    return _s3_exists(relative) if _is_s3() else (_DATA_DIR / relative).exists()

def list_files(prefix: str) -> list[str]:
    """List all parquet files under a relative prefix."""
    if _is_s3():
        import s3fs
        fs      = s3fs.S3FileSystem()
        root    = f"{_S3_ROOT.removeprefix('s3://')}/{prefix}"
        bucket_prefix = f"{_S3_ROOT.removeprefix('s3://')}/"
        matches: list[str] = fs.glob(f"{root}/**/*.parquet")  # type: ignore[assignment]
        return [f.replace(bucket_prefix, "") for f in matches]
    base = _DATA_DIR / prefix
    return [str(p.relative_to(_DATA_DIR)) for p in base.rglob("*.parquet")] if base.exists() else []

# ── Catalog helpers ───────────────────────────────────────────────────────────
def _read_catalog() -> pl.DataFrame:
    return read_parquet(CATALOG_REL)

def _write_catalog(df: pl.DataFrame) -> None:
    write_parquet(df, CATALOG_REL)

def _norm(provider: str, symbol: str) -> tuple[str, str]:
    return provider.lower().strip(), symbol.upper().strip()

def _price_rel(provider: str, symbol: str) -> str:
    return f"{provider}/{symbol}.parquet"

# ── Price data ────────────────────────────────────────────────────────────────
def write_prices(provider: str, symbol: str, df: pl.DataFrame) -> None:
    provider, symbol = _norm(provider, symbol)
    rel = _price_rel(provider, symbol)
    existing = read_parquet(rel)
    if not existing.is_empty():
        df = pl.concat([existing, df]).unique("date").sort("date")
    write_parquet(df, rel, timeseries=True)
    _upsert_catalog(provider, symbol)

def read_prices(
    provider: str, symbol: str,
    start: str | None = None,
    end: str | None = None,
) -> pl.DataFrame:
    provider, symbol = _norm(provider, symbol)
    rel = _price_rel(provider, symbol)
    if not path_exists(rel):
        return pl.DataFrame()
    lf = pl.scan_parquet(_path(rel))
    if start:
        lf = lf.filter(pl.col("date") >= pl.lit(start).str.to_date())
    if end:
        lf = lf.filter(pl.col("date") <= pl.lit(end).str.to_date())
    return lf.collect()

def last_date(provider: str, symbol: str) -> date | None:
    provider, symbol = _norm(provider, symbol)
    rel = _price_rel(provider, symbol)
    if not path_exists(rel):
        return None
    return pl.scan_parquet(_path(rel)).select("date").max().collect()["date"][0]

# ── Catalog CRUD ──────────────────────────────────────────────────────────────
def _upsert_catalog(provider: str, symbol: str, **meta: str) -> None:
    new_row = {"provider": provider, "symbol": symbol, **meta}
    df      = _read_catalog()
    if df.is_empty():
        return _write_catalog(pl.DataFrame([new_row]))

    mask     = (pl.col("provider") == provider) & (pl.col("symbol") == symbol)
    existing = df.filter(mask)
    rest     = df.filter(~mask)
    merged   = {**(existing.row(0, named=True) if not existing.is_empty() else {}), **new_row}
    _write_catalog(pl.concat([rest, pl.DataFrame([merged])], how="diagonal"))

def upsert_metadata(provider: str, symbol: str, **kwargs: str) -> None:
    _upsert_catalog(*_norm(provider, symbol), **kwargs)

def list_indices() -> pl.DataFrame:
    df = _read_catalog()
    return df.sort(["provider", "symbol"]) if not df.is_empty() else df

def delete_index(provider: str, symbol: str) -> None:
    provider, symbol = _norm(provider, symbol)
    rel = _price_rel(provider, symbol)
    if _is_s3():
        import s3fs
        fs = s3fs.S3FileSystem()
        full = f"{_S3_ROOT.removeprefix('s3://')}/{rel}"
        if fs.exists(full):
            fs.rm(full)
    else:
        p = _DATA_DIR / rel
        if p.exists():
            p.unlink()
    df = _read_catalog()
    if not df.is_empty():
        _write_catalog(df.filter((pl.col("provider") != provider) | (pl.col("symbol") != symbol)))

def search_indices(query: str) -> list[dict]:
    df = _read_catalog()
    if df.is_empty():
        return []
    q        = query.lower()
    str_cols = [c for c in df.columns if df[c].dtype == pl.Utf8]
    mask     = pl.lit(False)
    for col in str_cols:
        mask = mask | pl.col(col).fill_null("").str.to_lowercase().str.contains(q)
    return df.filter(mask).to_dicts()

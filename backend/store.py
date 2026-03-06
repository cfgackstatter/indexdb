from pathlib import Path
from datetime import date
import polars as pl

DATA_ROOT = Path("data")
CATALOG = DATA_ROOT / "catalog.parquet"


def _norm(provider: str, symbol: str) -> tuple[str, str]:
    return provider.lower().strip(), symbol.upper().strip()


def _path(provider: str, symbol: str) -> Path:
    provider, symbol = _norm(provider, symbol)
    p = DATA_ROOT / provider
    p.mkdir(parents=True, exist_ok=True)
    return p / f"{symbol}.parquet"


def _read_catalog() -> pl.DataFrame:
    return pl.read_parquet(CATALOG) if CATALOG.exists() else pl.DataFrame()


def _write_catalog(df: pl.DataFrame) -> None:
    DATA_ROOT.mkdir(parents=True, exist_ok=True)
    df.write_parquet(CATALOG, compression="zstd")


def write_prices(provider: str, symbol: str, df: pl.DataFrame) -> None:
    provider, symbol = _norm(provider, symbol)
    path = _path(provider, symbol)
    if path.exists():
        df = pl.concat([pl.read_parquet(path), df]).unique("date").sort("date")
    df.write_parquet(path, compression="zstd")
    _upsert_catalog(provider, symbol)


def read_prices(
    provider: str, symbol: str,
    start: str | None = None,
    end: str | None = None,
) -> pl.DataFrame:
    provider, symbol = _norm(provider, symbol)
    path = _path(provider, symbol)
    if not path.exists():
        return pl.DataFrame()
    lf = pl.scan_parquet(path, low_memory=False)
    if start:
        lf = lf.filter(pl.col("date") >= pl.lit(start).str.to_date())
    if end:
        lf = lf.filter(pl.col("date") <= pl.lit(end).str.to_date())
    return lf.collect()


def last_date(provider: str, symbol: str) -> date | None:
    """Return the most recent date stored for this index, or None."""
    path = _path(provider, symbol)
    if not path.exists():
        return None
    df = pl.scan_parquet(path).select("date").max().collect()
    return df["date"][0]


def _upsert_catalog(provider: str, symbol: str, **meta: str) -> None:
    new_fields = {"provider": provider, "symbol": symbol, **meta}
    df = _read_catalog()
    if df.is_empty():
        _write_catalog(pl.DataFrame([new_fields]))
        return

    # find existing row and merge — new fields overwrite, existing fields preserved
    mask = (pl.col("provider") == provider) & (pl.col("symbol") == symbol)
    existing = df.filter(mask)
    rest = df.filter(~mask)

    if not existing.is_empty():
        existing_dict = existing.row(0, named=True)
        merged = {**existing_dict, **new_fields}  # new_fields wins on conflict
    else:
        merged = new_fields

    _write_catalog(pl.concat([rest, pl.DataFrame([merged])], how="diagonal"))


def upsert_metadata(provider: str, symbol: str, **kwargs: str) -> None:
    provider, symbol = _norm(provider, symbol)
    _upsert_catalog(provider, symbol, **kwargs)


def list_indices() -> pl.DataFrame:
    df = _read_catalog()
    return df.sort(["provider", "symbol"]) if not df.is_empty() else df


def delete_index(provider: str, symbol: str) -> None:
    provider, symbol = _norm(provider, symbol)
    p = _path(provider, symbol)
    if p.exists():
        p.unlink()
    df = _read_catalog()
    if not df.is_empty():
        _write_catalog(
            df.filter(
                (pl.col("provider") != provider) | (pl.col("symbol") != symbol)
            )
        )


def search_indices(query: str) -> list[dict]:
    df = _read_catalog()
    if df.is_empty():
        return []
    q = query.lower()
    str_cols = [c for c in df.columns if df[c].dtype == pl.Utf8]
    mask = pl.lit(False)
    for col in str_cols:
        mask = mask | pl.col(col).fill_null("").str.to_lowercase().str.contains(q)
    return df.filter(mask).to_dicts()
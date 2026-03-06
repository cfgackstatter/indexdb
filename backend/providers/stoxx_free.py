import polars as pl
import requests
from datetime import date, datetime
from pathlib import Path
from backend.providers.base import IndexProvider

CACHE_PATH = Path("data/_cache/stoxx_vendor_codes.parquet")
CACHE_TTL_DAYS = 7
VENDOR_CODES_URL = "https://www.stoxx.com/documents/stoxxnet/Documents/Resources/Data_Vendor_Codes/vendor_codes_sheet.csv"
DATA_URL = "https://www.stoxx.com/document/Indices/Current/HistoricalData/{filename}.txt"
PREFIXES = ["h_3m", "h_"]


def _fetch_vendor_codes() -> pl.DataFrame:
    if CACHE_PATH.exists():
        age = (datetime.now() - datetime.fromtimestamp(CACHE_PATH.stat().st_mtime)).days
        if age < CACHE_TTL_DAYS:
            return pl.read_parquet(CACHE_PATH)
    CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    df = pl.read_csv(VENDOR_CODES_URL, separator=";", infer_schema_length=1000)
    df.write_parquet(CACHE_PATH, compression="zstd")
    return df


def _symbol_to_url(symbol: str) -> str:
    for prefix in PREFIXES:
        url = DATA_URL.format(filename=f"{prefix}{symbol.lower()}")
        if requests.head(url, timeout=5).status_code == 200:
            return url
    raise ValueError(f"No STOXX data file found for symbol: {symbol}")


class StoxxFreeProvider(IndexProvider):

    META_MAP = {
        "Index Full Name":  "name",
        "Curr":             "currency",
        "Classification":   "classification",
        "Region":           "region",
    }

    def fetch_prices(
        self, symbol: str,
        start: date | None = None,
        end: date | None = None,
    ) -> pl.DataFrame:
        url = _symbol_to_url(symbol)
        raw = pl.read_csv(
            url, separator=";", infer_schema_length=0,
            truncate_ragged_lines=True,
        )
        raw = raw[[c for c in raw.columns if c.strip()]]
        df = (
            raw.rename({raw.columns[0]: "date", raw.columns[1]: "symbol", raw.columns[2]: "close"})
            .with_columns(
                pl.col("date").str.strptime(pl.Date, "%d.%m.%Y"),
                pl.col("close").cast(pl.Float64),
            )
            .select(["date", "close"])
            .sort("date")
        )
        if start:
            df = df.filter(pl.col("date") >= pl.lit(start))
        if end:
            df = df.filter(pl.col("date") <= pl.lit(end))
        return df

    def fetch_raw_meta(self, symbol: str) -> dict:
        try:
            df = _fetch_vendor_codes()
        except Exception:
            return {}
        sym = symbol.upper()
        for col in df.columns:
            matches = df.filter(pl.col(col).cast(pl.Utf8).str.to_uppercase() == sym)
            if not matches.is_empty():
                return matches.row(0, named=True)
        return {}


provider = StoxxFreeProvider()

import yfinance as yf
import polars as pl
from datetime import date
from backend.providers.base import IndexProvider


class YahooProvider(IndexProvider):

    META_MAP = {
        "longName":  "name",
        "currency":  "currency",
        "region":    "region",
    }

    def fetch_prices(
        self, symbol: str,
        start: date | None = None,
        end: date | None = None,
    ) -> pl.DataFrame:
        raw = yf.Ticker(symbol).history(
            start=str(start) if start else "1970-01-01",
            end=str(end) if end else None,
            auto_adjust=True,
        )
        if raw.empty:
            return pl.DataFrame()
        df = (
            pl.from_pandas(raw.reset_index())
            .rename({
                "Date": "date", "Open": "open", "High": "high",
                "Low": "low", "Close": "close", "Volume": "volume",
            })
            .with_columns(pl.col("date").cast(pl.Date))
            .sort("date")
        )
        standard_cols = [c for c in self.PRICE_SCHEMA if c in df.columns]
        return self.normalize_prices(df.select(standard_cols))

    def fetch_raw_meta(self, symbol: str) -> dict:
        return yf.Ticker(symbol).info


provider = YahooProvider()

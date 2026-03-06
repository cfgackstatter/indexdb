from abc import ABC, abstractmethod
from datetime import date
import polars as pl


# Standard catalog fields — all providers map to these
STANDARD_META = {
    "name", "currency", "exchange", "region",
    "asset_class", "isin", "bloomberg", "ric", "tags",
}


class IndexProvider(ABC):

    PRICE_SCHEMA = {
        "date": pl.Date,
        "close": pl.Float64,
        "open": pl.Float64,
        "high": pl.Float64,
        "low": pl.Float64,
        "volume": pl.Float64,
    }

    # Override in each provider: {"source field": "standard field"}
    META_MAP: dict[str, str] = {}

    @abstractmethod
    def fetch_prices(
        self, symbol: str,
        start: date | None = None,
        end: date | None = None,
    ) -> pl.DataFrame: ...

    def fetch_raw_meta(self, symbol: str) -> dict:
        """Return raw metadata dict from the source. Override per provider."""
        return {}

    def fetch_meta(self, symbol: str) -> dict[str, str]:
        """Normalize raw metadata to standard fields via META_MAP."""
        raw = self.fetch_raw_meta(symbol)
        return {
            std: str(raw[src]).strip()
            for src, std in self.META_MAP.items()
            if raw.get(src) and str(raw.get(src, "")).strip()
        }

    def normalize_prices(self, df: pl.DataFrame) -> pl.DataFrame:
        return df.cast(
            {k: v for k, v in self.PRICE_SCHEMA.items() if k in df.columns}
        )

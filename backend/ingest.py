from datetime import date
from backend.providers import get_provider
from backend.store import write_prices, upsert_metadata


def ingest(
    provider: str, symbol: str,
    start: date | None = None,
    end: date | None = None,
    fetch_meta: bool = True,
) -> int:
    p = get_provider(provider)

    df = p.fetch_prices(symbol, start=start, end=end)
    if df.is_empty():
        return 0

    write_prices(provider, symbol, df)

    if fetch_meta:
        meta = p.fetch_meta(symbol)
        if meta:
            upsert_metadata(provider, symbol, **meta)

    return len(df)

from pydantic import BaseModel
from datetime import date

class PriceRecord(BaseModel):
    date: date
    close: float
    open: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None

class IndexMeta(BaseModel):
    provider: str
    symbol: str
    name: str | None = None

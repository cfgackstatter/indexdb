from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import os
from datetime import date
import polars as pl

from backend.store import (
    read_prices, search_indices,
    list_indices, delete_index,
    upsert_metadata, last_date,
)
from backend.ingest import ingest
from backend.tagger import generate_tags
from backend.config import DEFAULT_TAGGER_BACKEND

app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


if os.path.exists("frontend/dist"):
    app.mount("/assets", StaticFiles(directory="frontend/dist/assets"), name="assets")

    @app.get("/")
    def root():
        return FileResponse("frontend/dist/index.html")

    @app.get("/{full_path:path}")
    def spa_fallback(full_path: str):
        # API routes are handled above this — only unmatched paths reach here
        return FileResponse("frontend/dist/index.html")


@app.get("/search")
def search(q: str = Query(..., min_length=1)) -> list[dict]:
    return search_indices(q)


@app.get("/prices/{provider}/{symbol}")
def prices(
    provider: str, symbol: str,
    start: str | None = None,
    end: str | None = None,
) -> list[dict]:
    df = read_prices(provider, symbol, start, end)
    if df.is_empty():
        raise HTTPException(404, "No data found")
    return df.to_dicts()


@app.get("/admin/indices")
def admin_list_indices() -> list[dict]:
    return list_indices().to_dicts()


@app.get("/admin/providers")
def admin_list_providers() -> list[str]:
    from backend.providers import REGISTRY
    return sorted(REGISTRY.keys())


@app.post("/admin/ingest/{provider}/{symbol}", status_code=201)
def admin_ingest(
    provider: str, symbol: str,
    start: date | None = None,
    end: date | None = None,
) -> dict:
    try:
        n = ingest(provider, symbol, start=start, end=end)
    except ModuleNotFoundError:
        raise HTTPException(400, f"Unknown provider: {provider}")
    if n == 0:
        raise HTTPException(404, "No data returned from provider")
    return {"provider": provider, "symbol": symbol, "rows": n}


@app.post("/admin/indices/{provider}/{symbol}/refresh")
def admin_refresh(provider: str, symbol: str) -> dict:
    from datetime import timedelta
    start = last_date(provider, symbol)
    # start from day after last stored date to avoid duplicates
    if start:
        start = start + timedelta(days=1)
    n = ingest(provider, symbol, start=start, fetch_meta=False)
    if n == 0:
        return {"provider": provider, "symbol": symbol, "rows": 0, "msg": "Already up to date"}
    return {"provider": provider, "symbol": symbol, "rows": n}


@app.delete("/admin/indices/{provider}/{symbol}")
def admin_delete(provider: str, symbol: str) -> dict:
    delete_index(provider, symbol)
    return {"ok": True}


@app.patch("/admin/indices/{provider}/{symbol}/meta")
def admin_update_meta(
    provider: str, symbol: str,
    name: str | None = None,
    tags: str | None = None,
) -> dict:
    kwargs = {k: v for k, v in {"name": name, "tags": tags}.items() if v is not None}
    upsert_metadata(provider, symbol, **kwargs)
    return {"ok": True}


@app.post("/admin/indices/{provider}/{symbol}/tag")
def admin_tag_index(
    provider: str,
    symbol: str,
    backend: str = DEFAULT_TAGGER_BACKEND,
    context: str | None = None,
) -> dict:
    df = list_indices()
    if df.is_empty():
        raise HTTPException(404, "Index not found in catalog")
    rows = df.filter(
        (pl.col("provider") == provider.lower()) &
        (pl.col("symbol") == symbol.upper())
    )
    if rows.is_empty():
        raise HTTPException(404, "Index not found in catalog")
    meta = rows.row(0, named=True)
    try:
        tags = generate_tags(meta, backend=backend, context=context)
    except Exception as e:
        raise HTTPException(500, str(e))
    tag_str = ", ".join(tags)
    upsert_metadata(provider, symbol, tags=tag_str)
    return {"provider": provider, "symbol": symbol, "tags": tags}

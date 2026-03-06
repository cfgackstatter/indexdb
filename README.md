# IndexDB

An index analytics platform for investment professionals. Search, visualize, and manage financial index data from multiple providers with a clean dark UI and a fast Python backend.

![IndexDB](https://img.shields.io/badge/stack-FastAPI%20%2B%20React-blue)
![License](https://img.shields.io/badge/license-MIT-green)

---

## Features

- **Multi-provider support** — Yahoo Finance and STOXX Free out of the box, easily extensible
- **Cumulative return chart** — compare indices normalized to 0%, with 1M–All time range buttons
- **Persistent chart state** — selected indices and time range encoded in URL, shareable with colleagues
- **AI-powered tagging** — generate investor-perspective tags using the Perplexity API
- **Smart search** — search across all metadata fields (name, region, tags, ISIN, etc.)
- **Admin panel** — ingest, refresh, tag and delete indices with a paginated table
- **Incremental refresh** — only fetches new data since the last stored date
- **Automatic metadata** — pulls index name, currency, exchange from provider APIs on ingest

---

## Tech Stack

**Backend**
- [FastAPI](https://fastapi.tiangolo.com/) — REST API
- [Polars](https://pola.rs/) — fast DataFrame operations and Parquet storage
- [yfinance](https://github.com/ranaroussi/yfinance) — Yahoo Finance provider
- [python-dotenv](https://github.com/theskumar/python-dotenv) — environment config

**Frontend**
- [React](https://react.dev/) + [Vite](https://vitejs.dev/)
- [Recharts](https://recharts.org/) — chart library
- [React Router](https://reactrouter.com/) — navigation and URL state

---

## Project Structure

```text
indexdb/
├── backend/
│ ├── main.py       # FastAPI app and all endpoints
│ ├── store.py      # Parquet read/write, catalog management
│ ├── ingest.py     # Orchestrates price + metadata fetch
│ ├── tagger.py     # LLM-based tag generation
│ ├── config.py     # Provider list, tagger backend config
│ ├── .env          # API keys (not committed)
│ └── providers/
│ ├── base.py       # Abstract base class + META_MAP standard
│ ├── yahoo.py      # Yahoo Finance provider
│ └── stoxx_free.py # STOXX free 3-month history provider
├── frontend/
│ ├── src/
│ │ ├── App.jsx     # Shell, routing, nav
│ │ ├── App.css     # Global styles and design tokens
│ │ ├── api.js      # Centralized API base URL
│ │ ├── MainPage.jsx # Analytics page with search and chart
│ │ ├── Admin.jsx   # Admin page for index management
│ │ ├── Chart.jsx   # Recharts performance chart
│ │ └── hooks/
│ │ └── useFetch.js # Shared fetch hook
│ └── .env          # Frontend env (VITE_API_URL)
└── data/
├── catalog.parquet # Index metadata catalog
├── yahoo/          # Price data per provider
├── stoxx-free/
└── _cache/         # Provider-specific caches (vendor codes etc.)
```

---

## Getting Started

### Prerequisites

- Python 3.11+
- Node.js 18+

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install fastapi uvicorn polars yfinance requests python-dotenv
```

Create backend/.env:

```text
PERPLEXITY_API_KEY=your_key_here   # optional, only needed for AI tagging
```

Start the server:

```bash
uvicorn backend.main:app --reload
```

API docs available at http://localhost:8000/docs.

### Frontend

```bash
cd frontend
npm install
npm run dev
```

App available at http://localhost:5173.

Optionally create frontend/.env:

```text
VITE_API_URL=http://localhost:8000
```

---

## Adding an Index

1. Open the **Admin** tab
2. Select a provider and enter a symbol (e.g. `^GSPC`, `SX5E`)
3. Click **Download** — prices and metadata are fetched and stored
4. Click **Tag** to generate AI tags for the index
5. Switch to **Analytics** and search for your index

---

## Adding a New Provider

1. Create `backend/providers/myprovider.py`:

```python
from backend.providers.base import IndexProvider

class MyProvider(IndexProvider):
    META_MAP = {
        "IndexName": "name",
        "ISO_CCY":   "currency",
    }

    def fetch_prices(self, symbol, start=None, end=None):
        # return a Polars DataFrame with [date, close, ...]
        ...

    def fetch_raw_meta(self, symbol) -> dict:
        # return raw metadata dict from source
        ...

provider = MyProvider()
```

2. Register in `backend/config.py`:

```python
PROVIDERS = ["yahoo", "stoxx-free", "myprovider"]
```

That's it — all endpoints, admin UI, and ingest logic work automatically.

---

## AI Tagging

IndexDB uses an LLM to generate investor-perspective tags (asset class, geography, style, sector, return type) for each index. It reuses existing tags from the catalog for consistency while freely adding new specific tags.

### Supported backends:

| Backend      | Model    | Requires                       |
| ------------ | -------- | ------------------------------ |
| `perplexity` | `sonar`  | `PERPLEXITY_API_KEY` in `.env` |

Change the default in `backend/config.py`:

```python
DEFAULT_TAGGER_BACKEND = "perplexity"  # or "ollama"
```

---

## Data Storage

All data is stored locally as [Parquet](https://parquet.apache.org/) files with `zstd` compression:

- `data/catalog.parquet` — index metadata (all providers, dynamic columns)
- `data/{provider}/{SYMBOL}.parquet` — daily OHLCV price data per index

No database required.

---

## Environment Variables

| Variable             | Location        | Description                                         |
| -------------------- | --------------- | --------------------------------------------------- |
| `PERPLEXITY_API_KEY` | `backend/.env`  | Perplexity API key for AI tagging                   |
| `VITE_API_URL`       | `frontend/.env` | Backend base URL (default: `http://localhost:8000`) |

---

## License
MIT
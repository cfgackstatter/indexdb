from pathlib import Path
import json
import os
import re
import httpx
from functools import lru_cache
from backend.store import _read_catalog

from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")


# ── LLM backend abstraction ───────────────────────────────

def _call_llm(prompt: str, model: str, api_key: str, base_url: str) -> str:
    """Generic OpenAI-compatible chat completion call."""
    resp = httpx.post(
        f"{base_url}/chat/completions",
        headers={"Authorization": f"Bearer {api_key}", "Content-Type": "application/json"},
        json={"model": model, "messages": [{"role": "user", "content": prompt}]},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()["choices"][0]["message"]["content"]


LLM_BACKENDS = {
    "perplexity": {
        "base_url": "https://api.perplexity.ai",
        "model":    "sonar",
        "api_key":  lambda: os.environ["PERPLEXITY_API_KEY"],
    },
}


def _get_backend(name: str) -> dict:
    if name not in LLM_BACKENDS:
        raise ValueError(f"Unknown LLM backend: '{name}'. Available: {list(LLM_BACKENDS)}")
    cfg = LLM_BACKENDS[name]
    return {
        "base_url": cfg["base_url"],
        "model":    cfg["model"],
        "api_key":  cfg["api_key"](),
    }


# ── Tag frequency seed ────────────────────────────────────

@lru_cache(maxsize=1)
def _existing_tags(top_n: int = 40) -> tuple[str, ...]:
    """Return most frequent existing tags from catalog as seed context."""
    df = _read_catalog()
    if df.is_empty() or "tags" not in df.columns:
        return tuple()
    from collections import Counter
    counts = Counter(
        tag.strip()
        for row in df["tags"].drop_nulls().to_list()
        for tag in row.split(",")
        if tag.strip()
    )
    return tuple(tag for tag, _ in counts.most_common(top_n))


# ── Prompt ────────────────────────────────────────────────

def _build_prompt(meta: dict, context: str | None) -> str:
    known = {k: v for k, v in meta.items()
             if k not in ("provider", "symbol", "tags") and v}
    seed_tags = _existing_tags()

    prompt = f"""Tag a financial index for a professional investment database.
Only tag what is a PRIMARY, DELIBERATE exposure — not incidental holdings.
E.g. for a broad market index do NOT list individual sectors it contains implicitly.

Index: {meta.get('symbol', '')} ({meta.get('provider', '')})
Metadata (do not repeat as tags): {json.dumps(known, separators=(',', ':'))}
"""
    if context:
        prompt += f"Context: {context}\n"

    if seed_tags:
        prompt += f"Reuse existing tags where accurate (add new tags freely when needed.): {', '.join(seed_tags)}\n"

    prompt += """
Generate 4–15 tags covering only deliberate exposures, for example:

Focus on:
- Asset class (Equity, Fixed Income, Commodity, Multi-Asset)
- Geography (e.g. Germany, Eurozone, Emerging Markets)
- Market cap (Large Cap, Mid Cap, Small Cap)
- Style/factor (Market, Value, Growth, Momentum, Quality, Low Volatility)
- Sector/industry/theme ONLY if the index specifically targets it (e.g. Technology, Clean Energy, Financials, Robotics, Digital Payments, Cloud Computing, Space)
- Granular theme only if narrow-focused (Semiconductor, Cybersecurity, Solar)
- Risk modifiers (Leveraged, Short, Currency Hedged, Risk Controlled)
Multiple tags from the same category are allowed (e.g. "europe, eurozone").

Avoid: index construction rules, rebalancing frequency, listing requirements,
selection criteria details, corporate governance rules.

Return ONLY a JSON array of strings, 1–4 words each, lowercase, no explanation.
"""
    return prompt


# ── Public API ────────────────────────────────────────────

def generate_tags(
    meta: dict,
    backend: str = "perplexity",
    context: str | None = None,
) -> list[str]:
    """
    Generate tags for an index given its metadata dict.
    meta: catalog row dict (provider, symbol, name, currency, etc.)
    context: optional free-text context (index guide excerpt, URL, description)
    backend: "perplexity"
    Returns a list of tag strings.
    """
    cfg = _get_backend(backend)
    prompt = _build_prompt(meta, context)
    raw = _call_llm(prompt, cfg["model"], cfg["api_key"], cfg["base_url"])

    # extract JSON array robustly — handles markdown code fences
    match = re.search(r"\[.*\]", raw, re.DOTALL)
    if not match:
        raise ValueError(f"LLM did not return a JSON array. Raw: {raw[:200]}")
    tags = json.loads(match.group())
    if not isinstance(tags, list) or not all(isinstance(t, str) for t in tags):
        raise ValueError(f"Unexpected LLM response shape: {tags}")
    return [t.strip().lower() for t in tags]

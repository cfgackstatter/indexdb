from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

import json
import os
import re
import requests

from backend.store import _read_catalog


# ── LLM backend abstraction ───────────────────────────────

def _call_llm(prompt: str, model: str, api_key: str, base_url: str) -> str:
    """Generic OpenAI-compatible chat completion call."""
    resp = requests.post(
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

def _existing_tags(top_n: int = 40) -> list[str]:
    """Return most frequent existing tags from catalog as seed context."""
    df = _read_catalog()
    if df.is_empty() or "tags" not in df.columns:
        return []
    from collections import Counter
    counts = Counter(
        tag.strip()
        for row in df["tags"].drop_nulls().to_list()
        for tag in row.split(",")
        if tag.strip()
    )
    return [tag for tag, _ in counts.most_common(top_n)]


# ── Prompt ────────────────────────────────────────────────

def _build_prompt(meta: dict, context: str | None) -> str:
    known = {k: v for k, v in meta.items()
             if k not in ("provider", "symbol", "tags") and v}
    seed_tags = _existing_tags()

    prompt = f"""You are tagging a financial index for a professional investment database.

Index: {meta.get('symbol', '')} ({meta.get('provider', '')})
Known metadata: {json.dumps(known, indent=2)}
"""
    if context:
        prompt += f"\nAdditional context:\n{context}\n"

    if seed_tags:
        prompt += f"\nExisting tags in the database (reuse where accurate):\n{', '.join(seed_tags)}\n"

    prompt += """
Generate 6–10 tags describing what this index offers an investor.

Focus on:
- Asset class (e.g. Equity, Fixed Income, Commodity)
- Geography / region (e.g. Germany, Eurozone, Emerging Markets)
- Market cap (e.g. Large Cap, Small Cap, Mid Cap)
- Style / factor (e.g. Value, Growth, Momentum, Low Volatility, Quality)
- Sector / industry (e.g. Technology, Financials, Energy)
- Return type (e.g. Total Return, Price Return, Net Return)
- Risk profile modifiers (e.g. Leveraged, Short, Long/Short, Currency Hedged)

Avoid: index construction rules, rebalancing frequency, listing requirements,
selection criteria details, corporate governance rules.

Reuse existing tags where accurate. Add new tags freely when needed.
Each tag: 1–4 words, title case.
Return ONLY a JSON array of strings, no explanation.
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
    backend: "perplexity" | "ollama"
    Returns a list of tag strings.
    """
    cfg = _get_backend(backend)
    prompt = _build_prompt(meta, context)
    raw = _call_llm(prompt, cfg["model"], cfg["api_key"], cfg["base_url"])

    # extract JSON array robustly — handles markdown code fences
    match = re.search(r"\[.*?\]", raw, re.DOTALL)
    if not match:
        raise ValueError(f"LLM did not return a JSON array. Raw: {raw[:200]}")
    return json.loads(match.group())

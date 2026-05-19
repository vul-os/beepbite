"""Fetch live LLM pricing from BerriAI/litellm — the community-maintained
JSON of model prices across Anthropic, OpenAI, Google, Mistral, Cohere,
Moonshot, DeepSeek, Together, Groq, and more.

Source: https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json

This is what the Go backend's `internal/jobs/llmpricesync/` will sync nightly.
Here we run it locally so the Python pricing exploration sees real numbers.

Usage:
    python3 sync_llm_prices.py            # fetch + cache to .litellm_prices.json
    python3 sync_llm_prices.py --offline  # use existing cache only
"""

import json
import os
import sys
import urllib.request
from pathlib import Path

CACHE = Path(__file__).parent / ".litellm_prices.json"
URL = "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"


def fetch() -> dict:
    try:
        with urllib.request.urlopen(URL, timeout=20) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        CACHE.write_text(json.dumps(data, indent=2))
        print(f"Fetched {len(data)} entries; cached to {CACHE.name}")
        return data
    except Exception as e:
        print(f"Fetch failed ({e}); falling back to cache", file=sys.stderr)
        if not CACHE.exists():
            print("No cache available — exiting", file=sys.stderr)
            sys.exit(1)
        return json.loads(CACHE.read_text())


def load_cached() -> dict:
    if not CACHE.exists():
        print(f"No cache at {CACHE}. Run without --offline first.", file=sys.stderr)
        sys.exit(1)
    return json.loads(CACHE.read_text())


def best_per_task(data: dict) -> dict:
    """Pick cheapest viable model per task category we use.

    Returns dict keyed by task → (model_id, input_$/MTok, output_$/MTok).
    """
    candidates = []
    for model_id, info in data.items():
        if not isinstance(info, dict):
            continue
        ipm = info.get("input_cost_per_token")
        opm = info.get("output_cost_per_token")
        if ipm is None or opm is None:
            continue
        # Normalise to $/MTok
        ipm_mtok = ipm * 1_000_000
        opm_mtok = opm * 1_000_000
        provider = info.get("litellm_provider", "?")
        supports_vision = info.get("supports_vision", False)
        supports_tools = info.get("supports_function_calling", False) or info.get("supports_tool_choice", False)
        max_ctx = info.get("max_input_tokens") or info.get("max_tokens") or 0
        candidates.append({
            "id": model_id,
            "provider": provider,
            "input_mtok": ipm_mtok,
            "output_mtok": opm_mtok,
            "vision": supports_vision,
            "tools": supports_tools,
            "max_ctx": max_ctx,
        })

    # Cost score: 1k input + 500 output (typical chat turn)
    def cost_score(c):
        return c["input_mtok"] * 0.001 + c["output_mtok"] * 0.0005

    # Filter to providers we support
    targets = {"anthropic", "openai", "vertex_ai-anthropic_models",
               "vertex_ai-language-models", "gemini", "moonshot",
               "deepseek", "groq"}
    candidates = [c for c in candidates if any(t in c["provider"] for t in targets)]

    customer_chat = sorted(
        [c for c in candidates if c["tools"] and c["max_ctx"] >= 32_000],
        key=cost_score,
    )[:5]

    owner_chat = sorted(
        [c for c in candidates if c["tools"] and c["max_ctx"] >= 128_000],
        key=cost_score,
    )[:5]

    bulk_vision = sorted(
        [c for c in candidates if c["vision"] and c["tools"]],
        key=cost_score,
    )[:5]

    return {
        "customer_chat (tool-use, ≥32k ctx)": customer_chat,
        "owner_chat (tool-use, ≥128k ctx)": owner_chat,
        "bulk_vision (vision + tool-use)": bulk_vision,
    }


def print_summary(buckets: dict) -> None:
    for bucket, models in buckets.items():
        print(f"\n  {bucket}")
        print(f"    {'model':<60}{'provider':<22}{'in $/MTok':>12}{'out $/MTok':>12}")
        print("    " + "-" * 106)
        for m in models:
            print(f"    {m['id'][:60]:<60}{m['provider'][:22]:<22}{m['input_mtok']:>12.3f}{m['output_mtok']:>12.3f}")


def main():
    offline = "--offline" in sys.argv
    data = load_cached() if offline else fetch()
    print(f"\nLoaded {len(data)} model entries from LiteLLM.\n")
    print("Cheapest viable models per task (across providers we support):")
    buckets = best_per_task(data)
    print_summary(buckets)
    print()


if __name__ == "__main__":
    main()

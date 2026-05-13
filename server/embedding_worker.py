#!/usr/bin/env python3
"""Small stdin/stdout worker for local text embeddings.

Input JSON:
  {"texts": ["..."], "modelName": "BAAI/bge-small-zh-v1.5", "cacheDir": "..."}

Output JSON:
  {"ok": true, "backend": "fastembed", "modelName": "...", "dimensions": 384, "embeddings": [[...]]}
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path


def main() -> int:
    payload = json.load(sys.stdin)
    texts = [str(item) for item in payload.get("texts", [])]
    model_name = payload.get("modelName") or os.environ.get("EMBEDDING_MODEL_NAME") or "BAAI/bge-small-zh-v1.5"
    cache_dir = payload.get("cacheDir") or os.environ.get("EMBEDDING_CACHE_DIR")
    os.environ.setdefault("HF_ENDPOINT", "https://hf-mirror.com")
    if cache_dir:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)

    try:
        from fastembed import TextEmbedding

        kwargs = {"model_name": model_name}
        if cache_dir:
            kwargs["cache_dir"] = cache_dir
        model = TextEmbedding(**kwargs)
        embeddings = [vector.tolist() for vector in model.embed(texts)] if texts else []
        dimensions = len(embeddings[0]) if embeddings else 0
        json.dump(
            {
                "ok": True,
                "backend": "fastembed",
                "modelName": model_name,
                "dimensions": dimensions,
                "embeddings": embeddings,
            },
            sys.stdout,
            ensure_ascii=False,
        )
        return 0
    except Exception as exc:  # noqa: BLE001 - this worker reports failures to Node.
        json.dump(
            {
                "ok": False,
                "backend": "unavailable",
                "modelName": model_name,
                "error": str(exc),
            },
            sys.stdout,
            ensure_ascii=False,
        )
        return 0


if __name__ == "__main__":
    raise SystemExit(main())

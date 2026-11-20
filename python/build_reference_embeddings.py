#!/usr/bin/env python3
"""
HERITAGE VISION — OpenCLIP Reference Embedding Index & Top-5 Retrieval Engine
Model: OpenCLIP ViT-B-32 (laion2b_s34b_b79k)

Strict anti-leakage rules:
- Loads ONLY rows where image_split == 'reference' from dataset/split_manifest.csv
- Stores normalized embeddings & index metadata inside embeddings/ (separate from raw images)
- Automatically skips recomputation when reference manifest SHA-256 fingerprint is unchanged
  unless --force is specified.
- Reports scores strictly as cosine similarity (never calibrated probabilities or accuracy).
"""

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

import numpy as np
import open_clip
import torch
from PIL import Image

MODEL_NAME = "ViT-B-32"
PRETRAINED = "laion2b_s34b_b79k"

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DATASET_DIR = PROJECT_ROOT / "dataset"
EMBEDDINGS_DIR = PROJECT_ROOT / "embeddings"
MANIFEST_CSV = DATASET_DIR / "dataset_manifest.csv"
INDEX_JSON = EMBEDDINGS_DIR / "reference_index.json"
EMBEDDINGS_NPZ = EMBEDDINGS_DIR / "reference_embeddings.npz"


def compute_reference_fingerprint(rows: List[Dict[str, str]]) -> str:
    h = hashlib.sha256()
    for row in sorted(rows, key=lambda r: r["image_id"]):
        h.update(f"{row['image_id']}:{row['sha256_hash']}:{row['relative_path']}\n".encode("utf-8"))
    return h.hexdigest()


def load_reference_rows(manifest_path: Path = MANIFEST_CSV) -> List[Dict[str, str]]:
    if not manifest_path.exists():
        raise FileNotFoundError(f"Manifest not found: {manifest_path}")
    rows: List[Dict[str, str]] = []
    with manifest_path.open("r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("image_split") == "reference" and row.get("site_id") != "unknown":
                img_path = DATASET_DIR / row["relative_path"]
                if img_path.exists():
                    rows.append(row)
    return rows


def build_reference_index(force: bool = False, batch_size: int = 32) -> Dict[str, Any]:
    EMBEDDINGS_DIR.mkdir(parents=True, exist_ok=True)
    ref_rows = load_reference_rows()
    if not ref_rows:
        raise RuntimeError("No verified reference-split images found on disk under dataset/.")

    fingerprint = compute_reference_fingerprint(ref_rows)
    if not force and INDEX_JSON.exists() and EMBEDDINGS_NPZ.exists():
        try:
            existing = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
            if existing.get("reference_manifest_sha256") == fingerprint:
                print(
                    f"[build_reference_embeddings] Cache hit: reference manifest fingerprint unchanged "
                    f"({len(ref_rows)} images across {existing.get('monument_count')} monuments)."
                )
                return existing
        except Exception:
            pass

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    model = model.to(device).eval()

    embeddings: List[np.ndarray] = []
    valid_records: List[Dict[str, Any]] = []

    for start in range(0, len(ref_rows), batch_size):
        batch = ref_rows[start : start + batch_size]
        tensors = []
        kept_rows = []
        for row in batch:
            img_path = DATASET_DIR / row["relative_path"]
            try:
                with Image.open(img_path) as im:
                    tensors.append(preprocess(im.convert("RGB")))
                    kept_rows.append(row)
            except Exception as exc:
                print(f"[warn] Skipping unreadable image {row['relative_path']}: {exc}")

        if not tensors:
            continue

        batch_tensor = torch.stack(tensors).to(device)
        with torch.no_grad():
            feats = model.encode_image(batch_tensor)
            feats = feats / feats.norm(dim=-1, keepdim=True)
            embeddings.append(feats.cpu().numpy().astype(np.float32))

        for row in kept_rows:
            valid_records.append(
                {
                    "image_id": row["image_id"],
                    "site_id": row["site_id"],
                    "monument_name": row["monument_name"],
                    "monument_folder": row["monument_folder"],
                    "relative_path": row["relative_path"],
                    "source_page_url": row["source_page_url"],
                    "attribution_text": row.get("attribution_text") or row.get("creator") or "",
                    "licence": row["licence"],
                }
            )

    matrix = np.concatenate(embeddings, axis=0)
    np.savez_compressed(EMBEDDINGS_NPZ, embeddings=matrix)

    unique_monuments = sorted({r["site_id"] for r in valid_records})
    index_payload = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_name": f"OpenCLIP {MODEL_NAME}",
        "pretrained": PRETRAINED,
        "embedding_dim": int(matrix.shape[1]),
        "reference_image_count": len(valid_records),
        "monument_count": len(unique_monuments),
        "reference_manifest_sha256": fingerprint,
        "records": valid_records,
    }
    INDEX_JSON.write_text(json.dumps(index_payload, indent=2), encoding="utf-8")
    print(
        f"[build_reference_embeddings] Saved {len(valid_records)} normalized embeddings "
        f"({matrix.shape}) across {len(unique_monuments)} monuments to {EMBEDDINGS_DIR}/"
    )
    return index_payload


def rank_top5_distinct_monuments(query_embedding: np.ndarray, matrix: np.ndarray, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Aggregates per-reference-image cosine similarities by monument (ensuring 5 DISTINCT monuments)
    returning: monument_name, max_cosine_similarity, avg_cosine_similarity,
    reference_image_count, best_matching_reference_image, reference_image_source.
    """
    sims = matrix @ query_embedding.astype(np.float32)
    grouped: Dict[str, List[int]] = {}
    for idx, rec in enumerate(records):
        grouped.setdefault(rec["site_id"], []).append(idx)

    candidates: List[Dict[str, Any]] = []
    for site_id, idxs in grouped.items():
        site_sims = sims[idxs]
        best_local = int(np.argmax(site_sims))
        best_idx = idxs[best_local]
        best_rec = records[best_idx]
        candidates.append(
            {
                "site_id": site_id,
                "monument_name": best_rec["monument_name"],
                "max_cosine_similarity": float(site_sims[best_local]),
                "avg_cosine_similarity": float(np.mean(site_sims)),
                "reference_image_count": len(idxs),
                "best_matching_reference_image": best_rec["relative_path"],
                "reference_image_source": best_rec["source_page_url"],
            }
        )

    candidates.sort(key=lambda item: (item["max_cosine_similarity"], item["avg_cosine_similarity"]), reverse=True)
    return candidates[:5]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build OpenCLIP ViT-B-32 reference embeddings.")
    parser.add_argument("--force", action="store_true", help="Force full recomputation.")
    parser.add_argument("--batch-size", type=int, default=32, help="Batch size for encoding.")
    args = parser.parse_args()
    build_reference_index(force=args.force, batch_size=args.batch_size)

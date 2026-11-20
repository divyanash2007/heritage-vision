#!/usr/bin/env python3
"""
HERITAGE VISION — Empirical Unknown-Rejection Threshold Calibration & Held-Out Test Evaluation

Scientific anti-leakage protocol:
1. Embeds ONLY validation split (known monuments in validation + unknown/validation distractors)
   against the reference-split index to sweep similarity_threshold and top2_margin_threshold.
2. Selects balanced operating thresholds from validation results ONLY.
3. Evaluates strictly ONCE on held-out test split (known monuments in test + unknown/test distractors).
4. Persists calibrated report to embeddings/threshold_calibration_report.json.
"""

import csv
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Tuple

import numpy as np
import open_clip
import torch
from PIL import Image

from build_reference_embeddings import (
    DATASET_DIR,
    EMBEDDINGS_DIR,
    EMBEDDINGS_NPZ,
    INDEX_JSON,
    MANIFEST_CSV,
    MODEL_NAME,
    PRETRAINED,
    build_reference_index,
    rank_top5_distinct_monuments,
)

CALIBRATION_REPORT_PATH = EMBEDDINGS_DIR / "threshold_calibration_report.json"


def load_eval_rows(split_name: str) -> List[Dict[str, str]]:
    rows: List[Dict[str, str]] = []
    with MANIFEST_CSV.open("r", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if row.get("image_split") == split_name:
                if (DATASET_DIR / row["relative_path"]).exists():
                    rows.append(row)
    return rows


def encode_split(rows: List[Dict[str, str]], model: Any, preprocess: Any, device: str) -> List[Tuple[Dict[str, str], np.ndarray]]:
    encoded: List[Tuple[Dict[str, str], np.ndarray]] = []
    for row in rows:
        img_path = DATASET_DIR / row["relative_path"]
        with Image.open(img_path) as im:
            tensor = preprocess(im.convert("RGB")).unsqueeze(0).to(device)
        with torch.no_grad():
            feat = model.encode_image(tensor)
            feat = feat / feat.norm(dim=-1, keepdim=True)
            encoded.append((row, feat.squeeze(0).cpu().numpy().astype(np.float32)))
    return encoded


def evaluate_at_thresholds(
    scored_samples: List[Tuple[str, List[Dict[str, Any]]]],
    min_sim: float,
    min_margin: float,
) -> Dict[str, Any]:
    known_total = 0
    known_correct_top1 = 0
    known_correct_top5 = 0
    known_false_unknown = 0

    unknown_total = 0
    unknown_correctly_rejected = 0
    unknown_false_accept = 0

    for true_site_id, top5 in scored_samples:
        top1 = top5[0]
        top2 = top5[1] if len(top5) > 1 else {"max_cosine_similarity": 0.0}
        margin = top1["max_cosine_similarity"] - top2["max_cosine_similarity"]
        accepted = top1["max_cosine_similarity"] >= min_sim and margin >= min_margin

        if true_site_id == "unknown":
            unknown_total += 1
            if not accepted:
                unknown_correctly_rejected += 1
            else:
                unknown_false_accept += 1
        else:
            known_total += 1
            if any(c["site_id"] == true_site_id for c in top5):
                known_correct_top5 += 1
            if not accepted:
                known_false_unknown += 1
            elif top1["site_id"] == true_site_id:
                known_correct_top1 += 1

    known_recall = known_correct_top1 / known_total if known_total else 0.0
    unknown_specificity = unknown_correctly_rejected / unknown_total if unknown_total else 0.0
    balanced_score = (known_recall + unknown_specificity) / 2.0

    return {
        "min_similarity": round(min_sim, 4),
        "min_margin": round(min_margin, 4),
        "known_total": known_total,
        "known_top1_accepted_exact": known_correct_top1,
        "known_top5_recall": round(known_correct_top5 / known_total, 4) if known_total else 0.0,
        "known_false_rejection_count": known_false_unknown,
        "unknown_total": unknown_total,
        "unknown_correctly_rejected": unknown_correctly_rejected,
        "unknown_false_accept_count": unknown_false_accept,
        "known_accepted_accuracy": round(known_recall, 4),
        "unknown_rejection_rate": round(unknown_specificity, 4),
        "balanced_validation_score": round(balanced_score, 4),
    }


def main() -> None:
    if not INDEX_JSON.exists() or not EMBEDDINGS_NPZ.exists():
        build_reference_index(force=False)

    index_meta = json.loads(INDEX_JSON.read_text(encoding="utf-8"))
    ref_records = index_meta["records"]
    ref_matrix = np.load(EMBEDDINGS_NPZ)["embeddings"]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model, _, preprocess = open_clip.create_model_and_transforms(MODEL_NAME, pretrained=PRETRAINED)
    model = model.to(device).eval()

    val_rows = load_eval_rows("validation")
    test_rows = load_eval_rows("test")
    if not val_rows or not test_rows:
        raise RuntimeError(
            f"Need both validation ({len(val_rows)}) and test ({len(test_rows)}) images to calibrate and evaluate thresholds."
        )

    val_encoded = encode_split(val_rows, model, preprocess, device)
    val_scored = [
        (row["site_id"], rank_top5_distinct_monuments(emb, ref_matrix, ref_records))
        for row, emb in val_encoded
    ]

    best_metrics = None
    for min_sim in np.linspace(0.22, 0.42, 21):
        for min_margin in np.linspace(0.00, 0.06, 7):
            m = evaluate_at_thresholds(val_scored, float(min_sim), float(min_margin))
            if best_metrics is None or m["balanced_validation_score"] > best_metrics["balanced_validation_score"]:
                best_metrics = m

    assert best_metrics is not None
    sel_sim = best_metrics["min_similarity"]
    sel_margin = best_metrics["min_margin"]

    # Held-out evaluation executed ONCE using validation-selected thresholds
    test_encoded = encode_split(test_rows, model, preprocess, device)
    test_scored = [
        (row["site_id"], rank_top5_distinct_monuments(emb, ref_matrix, ref_records))
        for row, emb in test_encoded
    ]
    test_metrics = evaluate_at_thresholds(test_scored, sel_sim, sel_margin)

    report = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "model_name": f"OpenCLIP {MODEL_NAME}",
        "pretrained": PRETRAINED,
        "selected_thresholds": {
            "min_similarity": sel_sim,
            "min_margin": sel_margin,
        },
        "validation_metrics": best_metrics,
        "held_out_test_metrics": test_metrics,
    }
    CALIBRATION_REPORT_PATH.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()

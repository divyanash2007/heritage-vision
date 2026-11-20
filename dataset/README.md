# HERITAGE VISION — Curated Heritage Image Dataset

**Last Generated:** 2026-11-15T18:05:57.154Z  
**Total Verified Photographs On Disk:** 157 (485.55 MB)  
**Quality Audit Status:** PASSED (0 issues)

> **Verification Policy:** All photographs are authentic Wikimedia Commons MediaWiki API retrievals preserved with creator/photographer credit, Creative Commons or Public Domain licence metadata, cryptographic SHA-256 checksums, and 64-bit perceptual dHash anti-leakage verification. No synthetic or AI-generated monument photographs are included.

## Folder Structure

```
dataset/
├── <Monument_Folder>/
│   ├── reference/          # Gallery reference photographs embedded for OpenCLIP ViT-B-32 matching
│   ├── validation/         # Held-out split for similarity & margin threshold calibration
│   └── test/               # Held-out final evaluation split (single evaluation pass)
├── unknown/
│   ├── validation/         # Non-monument distractors for open-set rejection calibration
│   └── test/               # Held-out non-monument distractors for final open-set evaluation
├── dataset_metadata.json   # Complete JSON manifest
├── dataset_manifest.csv    # Spreadsheet manifest of all verified images
├── image_attributions.csv  # Full attribution & open-licence ledger
├── split_manifest.csv      # Reference / validation / test split assignment index
├── rejected_images.csv     # Automated QC & human rejection log with reasons
├── download_failures.csv   # Retryable network / HTTP failure log
└── dataset_summary.json    # Real-time verified dataset statistics
```

## Split Distribution Summary

| Split | Verified Images |
| --- | ---: |
| `reference` | 87 |
| `validation` | 29 |
| `test` | 41 |
| `unknown` (legacy) | 0 |
| **Total** | **157** |

## Per-Monument Coverage (Target: 50+ photos per monument)

| Folder | Monument | Reference | Validation | Test | Total | Review Required | Rejected |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Taj_Mahal | Taj Mahal | 17 | 7 | 7 | 31 | 4 | 23 |
| Agra_Fort | Agra Fort | 1 | 0 | 0 | 1 | 0 | 23 |
| Fatehpur_Sikri | Fatehpur Sikri | 1 | 0 | 0 | 1 | 0 | 21 |
| Red_Fort | Red Fort | 1 | 1 | 1 | 3 | 0 | 51 |
| Qutub_Minar | Qutub Minar | 33 | 11 | 11 | 55 | 2 | 21 |
| Humayuns_Tomb | Humayun's Tomb | 20 | 7 | 19 | 46 | 3 | 38 |
| Ajanta_Caves | Ajanta Caves | 1 | 0 | 0 | 1 | 0 | 0 |
| Ellora_Caves | Ellora Caves | 1 | 0 | 0 | 1 | 0 | 0 |
| Gateway_of_India | Gateway of India | 1 | 0 | 0 | 1 | 0 | 0 |
| Sanchi_Stupa | Sanchi Stupa | 1 | 0 | 0 | 1 | 0 | 0 |
| Khajuraho_Temples | Khajuraho Temples | 1 | 0 | 0 | 1 | 0 | 0 |
| Hampi | Hampi | 1 | 1 | 0 | 2 | 0 | 0 |
| Gol_Gumbaz | Gol Gumbaz | 1 | 0 | 0 | 1 | 0 | 0 |
| Konark_Sun_Temple | Konark Sun Temple | 1 | 0 | 1 | 2 | 0 | 0 |
| Mahabalipuram | Mahabalipuram | 1 | 0 | 0 | 1 | 0 | 0 |
| Amer_Fort | Amer Fort | 1 | 0 | 1 | 2 | 0 | 0 |
| Chittorgarh_Fort | Chittorgarh Fort | 1 | 0 | 0 | 1 | 0 | 0 |
| Charminar | Charminar | 1 | 0 | 0 | 1 | 0 | 0 |
| Rani_ki_Vav | Rani Ki Vav | 1 | 0 | 0 | 1 | 0 | 0 |
| Jantar_Mantar_Jaipur | Jantar Mantar Jaipur | 1 | 0 | 0 | 1 | 0 | 0 |

## OpenCLIP Embedding & Open-Set Rejection Pipeline

- Model: `ViT-B-32` (`laion2b_s34b_b79k`)
- Scripts:
  - `python/build_reference_embeddings.py` — builds L2-normalized reference index strictly from `reference` split
  - `python/evaluate_unknown_rejection.py` — calibrates similarity & margin thresholds on `validation` + `unknown/validation`, then evaluates once on `test` + `unknown/test`
- Scores are reported strictly as cosine similarities (never calibrated probabilities or accuracy).

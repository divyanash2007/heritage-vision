# Heritage Vision — Data Quality & Source Verification Audit Report

**Audit Date:** 2026-11-15  
**Audited Knowledge Base:** `server/data/monuments.json` (wrapped by `src/data/monuments.ts`)  
**Audited Validation & Service Modules:** `server/services/knowledgeBaseValidator.ts`, `server/services/knowledgeBaseService.ts`, `server/services/discoveryService.ts`, `src/types/heritage.ts`  
**Audited UI Consumers:** `src/pages/HomePage.tsx`, `src/pages/ExplorerPage.tsx`, `src/pages/MonumentDetailPage.tsx`

---

## Executive Summary

| Audit Metric | Verified Result | Notes |
| --- | ---: | --- |
| 1. Monument records inspected | **20** | All 20 Indian heritage sites inspected field-by-field |
| 2. Unique site IDs | **20** | Zero duplicates (`uniqueIdsCount === 20`) |
| 3. Source citation entries checked | **23** | Across **22** unique URLs (`whc.unesco.org/en/list/247/` is shared by Amer & Chittorgarh) |
| 4. Verified source citations | **22** | `17` UNESCO DataHub `whc001` API records + `5` HTTP-200 ASI / State / PIB sources |
| 5. Unverified source citations | **1** | Gol Gumbaz Tentative List `#5887` (HTTP 403 Cloudflare; absent from `whc001`) |
| 6. Genuine recognition dataset image references | **0** | No field photographs with photographer provenance & licence yet |
| 7. Generated or placeholder image assets | **20** | `4` AI-generated reference plates + `16` SVG placeholders (`21` total incl. `1` hero plate) |
| 8. Monuments with verified preservation info | **20 / 20** | `0` monuments have `null` preservation custodian or summary (`requiresVerification: false`) |
| 9. Post-correction schema/integrity issues | **0** | `validateKnowledgeBase()` returns `isValid: true`, `issues: []` |
| 10. OpenCLIP Model Status | **Pending Integration** | `openClipModelConnected: false`; zero simulated predictions |

---

## 1. Database & Codebase Inspection (Part 1)

Inspection of the project structure identified the following authoritative components:

1. **Canonical Heritage Knowledge Base:** `server/data/monuments.json` (imported by `src/data/monuments.ts` as `HERITAGE_MONUMENTS_SCHEMA` and loaded dynamically on the backend by `server/services/knowledgeBaseService.ts`).
2. **Type Schema:** `src/types/heritage.ts` defines `MonumentRecord`, `SourceReference`, `ImageReference`, `PreservationInformation`, `KnowledgeBaseValidationReport`, and `ProjectStatistics`.
3. **Validator:** `server/services/knowledgeBaseValidator.ts` (`validateKnowledgeBase`) enforces structural completeness, ID uniqueness, URL syntax, source verification flags, strict prohibition of unverified factual descriptions, and strict provenance separation between genuine dataset photographs and synthetic/placeholder plates.
4. **Grounded Q&A Filter:** `server/services/discoveryService.ts` filters out unverified citations so only `verificationStatus === 'verified'` sources can ground Q&A responses.
5. **Homepage Statistics Calculation:** `computeProjectStatistics()` in `server/services/knowledgeBaseService.ts` computes live metrics directly from `loadMonuments()` and `getKnowledgeBaseValidationReport()` for `/api/stats` and `src/pages/HomePage.tsx`.

---

## 2. Verification of All 20 Monument Records (Part 2)

Every monument record — including `preservationInformation.custodian` and `preservationInformation.statusSummary` — was verified against retrieved primary documentation:

- **16 UNESCO World Heritage records (`whc001` `justification_en` *Protection and management requirements*):** Taj Mahal (`#252`), Fatehpur Sikri (`#255`), Red Fort (`#231`), Qutub Minar (`#233`), Humayun's Tomb (`#232`), Ajanta Caves (`#242`), Ellora Caves (`#243`), Sanchi Stupa (`#524`), Khajuraho Temples (`#240`), Hampi (`#241`), Konark Sun Temple (`#246`), Mahabalipuram (`#249`), Amer Fort (`#247`), Chittorgarh Fort (`#247`), Rani Ki Vav (`#922`), Jantar Mantar Jaipur (`#1338`).
- **ASI Circle & State/Central Government HTTP-200 Portals:**
  - **Agra Fort:** Official ASI Agra Circle (`https://www.asiagracircle.in/agra-fort.html` & `conservation-&-preservation.html`, plus TTZ reference in `#252`/`#255`).
  - **Gol Gumbaz:** Official ASI Dharwad Circle (`https://www.asidharwadcircle.in/gol-gumbaz/` & `/conservation-work/`).
  - **Charminar:** Official ASI Hyderabad Circle (`https://asihyderabad.in/monuments/hyderabad/5.5.2` serving `charminar-DcKcGLGK.md`).
  - **Gateway of India:** Directorate of Archaeology & Museums, Government of Maharashtra (`https://www.mahaarchaeology.in/en/licence` & `/en/acts_and_legislation`) and Press Information Bureau / Ministry of Culture (`https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1920811&reg=48&lang=2`).

| Site ID | Monument Name | State / UT | UNESCO Status & Year | Preservation Custodian (Verified) | Record Status & Pending Items |
| --- | --- | --- | --- | --- | --- |
| `taj-mahal` | Taj Mahal | Uttar Pradesh | `world_heritage_site` (1983) | Archaeological Survey of India (Agra Circle) | `partially_verified` (dataset photo) |
| `agra-fort` | Agra Fort | Uttar Pradesh | `world_heritage_site` (1983) | Archaeological Survey of India (Agra Circle) | `partially_verified` (dataset photo) |
| `fatehpur-sikri` | Fatehpur Sikri | Uttar Pradesh | `world_heritage_site` (1986) | Archaeological Survey of India (Agra Circle) | `partially_verified` (dataset photo) |
| `red-fort` | Red Fort | Delhi | `world_heritage_site` (2007) | Archaeological Survey of India | `partially_verified` (dataset photo) |
| `qutub-minar` | Qutub Minar | Delhi | `world_heritage_site` (1993) | Archaeological Survey of India (Government of India) | `partially_verified` (dataset photo) |
| `humayuns-tomb` | Humayun's Tomb | Delhi | `world_heritage_site` (1993) | Archaeological Survey of India (with Aga Khan Trust for Culture) | `partially_verified` (dataset photo) |
| `ajanta-caves` | Ajanta Caves | Maharashtra | `world_heritage_site` (1983) | Archaeological Survey of India, Forest Dept & Govt of Maharashtra | `partially_verified` (dataset photo) |
| `ellora-caves` | Ellora Caves | Maharashtra | `world_heritage_site` (1983) | Archaeological Survey of India, Forest Dept & Govt of Maharashtra | `partially_verified` (dataset photo) |
| `gateway-of-india` | Gateway of India | Maharashtra | `not_listed` (`null`) | Directorate of Archaeology and Museums, Govt of Maharashtra | `partially_verified` (`constructionDateOrPeriod`, dataset photo) |
| `sanchi-stupa` | Sanchi Stupa | Madhya Pradesh | `world_heritage_site` (1989) | Archaeological Survey of India (Government of India) | `partially_verified` (dataset photo) |
| `khajuraho-temples` | Khajuraho Temples | Madhya Pradesh | `world_heritage_site` (1986) | Archaeological Survey of India & District Collector, Govt of MP | `partially_verified` (dataset photo) |
| `hampi` | Hampi | Karnataka | `world_heritage_site` (1986) | Archaeological Survey of India & Government of Karnataka | `partially_verified` (dataset photo) |
| `gol-gumbaz` | Gol Gumbaz | Karnataka | `unverified` (`null`) | Archaeological Survey of India (Dharwad Circle) | `partially_verified` (`unescoStatus`, Tentative List `#5887`, dataset photo) |
| `konark-sun-temple` | Konark Sun Temple | Odisha | `world_heritage_site` (1984) | Archaeological Survey of India | `partially_verified` (dataset photo) |
| `mahabalipuram` | Mahabalipuram | Tamil Nadu | `world_heritage_site` (1984) | Archaeological Survey of India | `partially_verified` (dataset photo) |
| `amer-fort` | Amer Fort | Rajasthan | `world_heritage_site` (2013) | Govt of Rajasthan (Amber Dev. & Mgmt. Authority & Apex Committee) | `partially_verified` (`constructionDateOrPeriod`, dataset photo) |
| `chittorgarh-fort` | Chittorgarh Fort | Rajasthan | `world_heritage_site` (2013) | Archaeological Survey of India & Government of Rajasthan | `partially_verified` (`constructionDateOrPeriod`, dataset photo) |
| `charminar` | Charminar | Telangana | `unverified` (`null`) | Archaeological Survey of India (Hyderabad Circle) | `partially_verified` (`unescoStatus`, dataset photo) |
| `rani-ki-vav` | Rani Ki Vav | Gujarat | `world_heritage_site` (2014) | Archaeological Survey of India | `partially_verified` (dataset photo) |
| `jantar-mantar-jaipur` | Jantar Mantar Jaipur | Rajasthan | `world_heritage_site` (2010) | Government of Rajasthan (Dept of Archaeology & Museums) | `partially_verified` (dataset photo) |

**Breakdown by `verificationStatus`:**
- `verified`: **0** (awaiting genuine curated OpenCLIP recognition dataset photographs across all 20 sites)
- `partially_verified`: **20** (all 20 sites now have source-verified historical, architectural, and preservation descriptions; `0` sites remain without preservation details)
- `requires_verification`: **0**

---

## 3. Source Validation Audit (Part 3)

Live HTTP checks were executed across all **23** source entries (**22** unique primary URLs):

1. **UNESCO World Heritage Open Data API (`https://data.unesco.org/...`):**
   - Primary `https://whc.unesco.org/en/list/*` web URLs returned HTTP `403` (Cloudflare challenge). Verification was executed via UNESCO's official DataHub Open Data API (`whc001`), returning **HTTP 200 OK JSON** for all **16** unique inscribed UNESCO World Heritage List IDs (`17` citations, including `short_description_en`, `criteria_txt`, `date_inscribed`, and `justification_en` *Protection and management requirements*).
2. **Archaeological Survey of India (ASI) Circles & Government Portals (HTTP 200):**
   - `https://www.asiagracircle.in/agra-fort.html` & `conservation-&-preservation.html` (HTTP `200`) — Agra Fort protection under ASI Agra Circle and AMASR Act (1958).
   - `https://www.asidharwadcircle.in/gol-gumbaz/` & `conservation-work/` (HTTP `200`) — Gol Gumbaz history, architecture, and ASI Dharwad Circle AMASR protection.
   - `https://asihyderabad.in/monuments/hyderabad/5.5.2` & `assets/charminar-DcKcGLGK.md` (HTTP `200`) — Charminar history, architecture, ASI Hyderabad Circle Monument Code `5.5.2`, and recorded restoration timeline.
   - `https://www.mahaarchaeology.in/en/licence` & `/en/acts_and_legislation` (HTTP `200`) — Gateway of India Category "A" State Protected Monument designation under the Directorate of Archaeology & Museums, Government of Maharashtra and 1962 Rules.
   - `https://www.pib.gov.in/PressReleaseIframePage.aspx?PRID=1920811&reg=48&lang=2` (HTTP `200`) — PIB / Ministry of Culture documentation on Gateway of India Indo-Islamic style and 1911/1948 historical milestones.
3. **Unverified Source Entry (`1` entry):**
   - `gol-gumbaz` (`https://whc.unesco.org/en/tentativelists/5887/`): Primary URL returned HTTP `403`, and Tentative Lists are excluded from `whc001`. Marked `verificationStatus: "unverified"` with `unescoStatus: "unverified"`.

---

## 4. Image Metadata & Provenance Audit (Part 4)

No verified recognition dataset photographs exist yet in the repository:

- **`verified_dataset_photograph` (`is_recognition_dataset_image: true`):** **0**
- **`ai_generated_reference_plate` (`unverified_synthetic`, `is_recognition_dataset_image: false`):** **4** (`taj-mahal`, `konark-sun-temple`, `amer-fort`, `rani-ki-vav`)
- **`illustrative_placeholder` (`placeholder_no_media`, `is_recognition_dataset_image: false`):** **16** (remaining 16 monuments via `MonumentPlate`)
- **Additional UI Asset:** **1** hero editorial plate (`src/assets/images/hero_indian_heritage_1794749766633.jpg`)
- **Total generated / placeholder assets:** **20** indexed monument image entries (**21** assets total including hero image).

---

## 5. Homepage Statistics Audit (Part 5)

`src/pages/HomePage.tsx` reads live backend calculations from `/api/stats` (`computeProjectStatistics()`):

- **Monument Schemas Indexed (`totalMonumentsInSchema`):** `20` (valid validated records)
- **Regions Represented (`statesAndTerritoriesCovered`):** `10` Indian states & territories
- **Verified Source Citations (`verifiedSourceCitationsCount`):** `22` (excludes the `1` unverified citation, reported separately in `unverifiedSourceCitationsCount`)
- **OpenCLIP Model Status (`openClipModelConnected`):** `false` (`Pending Integration`)

---

## 6. Remaining Missing Information (Part 6, Item 8)

1. **Preservation Custody & Status Summaries:** **`0 / 20` missing** (`0` nulls; all 20 monuments now store verified `custodian` and `statusSummary` with `requiresVerification: false`).
2. **Exact Construction Dates (`3 / 20` monuments):**
   - `gateway-of-india`: `constructionDateOrPeriod: null` (verified PIB release records the 1911 royal welcome commemoration; exact 1913–1924 build dates await direct `archaeology`/`maha` dossier verification).
   - `amer-fort` & `chittorgarh-fort`: `constructionDateOrPeriod: null` (UNESCO serial entry `#247` provides only the collective 8th–18th century window for all six forts).
3. **UNESCO Listing Verification (`2 / 20` monuments):** `gol-gumbaz` (`tentativelists/5887` returned HTTP 403) and `charminar` remain `unescoStatus: "unverified"`.
4. **Recognition Photograph Corpus (`20 / 20` monuments):** `0` curated, openly licensed field photographs indexed for OpenCLIP embeddings or evaluation splits.

---

## 7. Pre-Audit Discrepancies & Validation Pass (Part 6, Item 9)

1. Resolved the earlier missing preservation metadata across all 20 monuments by extracting authoritative protection, custody, statute, and conservation summaries directly from UNESCO `whc001` `justification_en` records and HTTP-200 ASI Circle / State Archaeology / PIB endpoints.
2. Stripped unsupported alternative names and extra claims not present in retrieved primary texts, while flagging Tentative List `#5887` as `unverified`.
3. Migrated all 20 `imageReferences` to strict provenance tracking separating synthetic/placeholder visuals from dataset photographs.
4. Post-correction `validateKnowledgeBase()` reports **`isValid: true`** with **`0` issues** across all 20 records, and negative test runs verify enforcement of duplicate IDs, missing names, invalid UNESCO enums, invalid URLs, uncited factual text, and mislabeled synthetic images.

---

## 8. Corrections Performed (Part 6, Item 10)

1. **`server/data/monuments.json`:** Populated verified `preservationInformation` (`custodian`, `statusSummary`, `requiresVerification: false`) across all 20 records; added verified ASI Agra Circle, ASI Dharwad Circle, ASI Hyderabad Circle, Maharashtra Directorate of Archaeology & Museums, and PIB source citations (`22` verified citations total, `1` unverified Tentative List entry); aligned `gateway-of-india`, `gol-gumbaz`, and `charminar` factual fields strictly to retrieved official texts.
2. **`src/types/heritage.ts`, `src/data/monuments.ts`, `server/services/knowledgeBaseValidator.ts`, `server/services/knowledgeBaseService.ts`, `server/services/discoveryService.ts`:** Enforced source verification tracking, image provenance validation, and dynamic `/api/stats` calculation.
3. **`src/pages/HomePage.tsx`, `src/pages/ExplorerPage.tsx`, `src/pages/MonumentDetailPage.tsx`:** Updated rendering of preservation custody + status summary, verified vs. unverified citation counts, and image provenance without changing layout, color palette, typography, or navigation.

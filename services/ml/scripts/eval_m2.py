"""Ewaluacja wariantów Modułu 2 na etykietach (precyzja, pełność, F1 przy progu).

    uv run python scripts/eval_m2.py labels.json raport.md NAZWA=katalog [...] [--equal-weights]

labels.json: {"rules": [...], "out_of_scope": {id: powód}, "default_unlisted": 0,
              "labels": [{"id", "rule", "label"}]}
Para (strona, reguła) bez etykiety dostaje `default_unlisted` (brak naruszenia).
Wariant „regex” bierzemy z kolumn regex pierwszego katalogu.

Dwa poziomy:
- para (strona, reguła): naruszenie, gdy P(naruszenie) >= próg,
- strona: naruszenie, gdy risk_score (max waga * P po regułach z etykietami) >= próg.
"""

import json
import sys
from pathlib import Path

from ml.risk import RULE_WEIGHTS

THRESHOLDS = (0.3, 0.5, 0.7)


def p_violation(finding: dict | None) -> float:
    if not finding:
        return 0.0
    if finding.get("probabilities"):
        return finding["probabilities"]["violation"]
    if finding["result"] == "violation":
        return finding["confidence"]
    if finding["result"] == "ok":
        return 1 - finding["confidence"]
    return 0.0


def metrics(gold: list[int], scores: list[float], threshold: float) -> dict[str, float]:
    tp = sum(g == 1 and s >= threshold for g, s in zip(gold, scores, strict=True))
    fp = sum(g == 0 and s >= threshold for g, s in zip(gold, scores, strict=True))
    fn = sum(g == 1 and s < threshold for g, s in zip(gold, scores, strict=True))
    tn = len(gold) - tp - fp - fn
    precision = tp / (tp + fp) if tp + fp else float("nan")
    recall = tp / (tp + fn) if tp + fn else float("nan")
    f1 = 2 * precision * recall / (precision + recall) if tp else 0.0
    return {"tp": tp, "fp": fp, "fn": fn, "tn": tn, "p": precision, "r": recall, "f1": f1}


def average_precision(gold: list[int], scores: list[float]) -> float:
    """Pole pod krzywą precyzja-pełność (niezależne od progu)."""
    ranked = sorted(zip(scores, gold, strict=True), key=lambda x: -x[0])
    positives = sum(gold)
    hits, total = 0, 0.0
    for rank, (_, g) in enumerate(ranked, 1):
        if g:
            hits += 1
            total += hits / rank
    return total / positives if positives else float("nan")


def main() -> None:
    args = [a for a in sys.argv[1:] if a != "--equal-weights"]
    # --equal-weights: każda reguła waży 1.0, risk_score = max P(naruszenie) po regułach.
    weights = {} if "--equal-weights" in sys.argv else RULE_WEIGHTS
    default_weight = 1.0 if "--equal-weights" in sys.argv else 0.5
    labels = json.loads(Path(args[0]).read_text())
    out = Path(args[1])
    variants = [arg.split("=", 1) for arg in args[2:]]
    rules: list[str] = labels["rules"]
    excluded = set(labels["out_of_scope"])
    gold_map = {(x["id"], x["rule"]): x["label"] for x in labels["labels"]}

    runs: dict[str, dict[str, dict]] = {}
    first_dir = variants[0][1]
    first_rows = [json.loads(line) for line in (Path(first_dir) / "results.jsonl").open()]
    first = {row["id"]: row for row in first_rows}
    runs["regex"] = {i: r["regex"] for i, r in first.items()}
    for name, directory in variants:
        rows = [json.loads(line) for line in (Path(directory) / "results.jsonl").open()]
        runs[name] = {r["id"]: r["llm"] for r in rows}

    ids = sorted(i for i in first if i not in excluded)
    pairs = [(i, r) for i in ids for r in rules]
    gold = [gold_map.get(p, labels["default_unlisted"]) for p in pairs]
    page_gold = [int(any(gold_map.get((i, r), 0) for r in rules)) for i in ids]

    lines = [
        "# Moduł 2: ewaluacja na etykietach",
        "",
        f"Strony w zakresie: {len(ids)} (wyłączone: {', '.join(sorted(excluded))}). "
        f"Pary (strona, reguła): {len(pairs)}, naruszeń: {sum(gold)}. "
        f"Strony z naruszeniem: {sum(page_gold)}.",
        "",
        "## Para (strona, reguła)",
        "",
        "| wariant | próg | TP | FP | FN | precyzja | pełność | F1 | AP |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, by_id in runs.items():
        scores = [p_violation(by_id.get(i, {}).get(r)) for i, r in pairs]
        ap = average_precision(gold, scores)
        for t in THRESHOLDS:
            m = metrics(gold, scores, t)
            lines.append(
                f"| {name} | {t} | {m['tp']} | {m['fp']} | {m['fn']} | {m['p']:.2f} | "
                f"{m['r']:.2f} | {m['f1']:.2f} | {ap:.2f} |"
            )

    lines += [
        "",
        "## Strona (risk_score, wagi: " + ("równe 1.0" if not weights else "RULE_WEIGHTS") + ")",
        "",
        "| wariant | próg | TP | FP | FN | TN | precyzja | pełność | F1 |",
        "|---|---|---|---|---|---|---|---|---|",
    ]
    for name, by_id in runs.items():
        page_scores = [
            max(
                weights.get(r, default_weight) * p_violation(by_id.get(i, {}).get(r)) for r in rules
            )
            for i in ids
        ]
        for t in THRESHOLDS:
            m = metrics(page_gold, page_scores, t)
            lines.append(
                f"| {name} | {t} | {m['tp']} | {m['fp']} | {m['fn']} | {m['tn']} | "
                f"{m['p']:.2f} | {m['r']:.2f} | {m['f1']:.2f} |"
            )

    lines += ["", "## Per reguła przy progu 0.5 (TP / FP / FN)", "",
              "| reguła | naruszeń | " + " | ".join(runs) + " |",
              "|---|---|" + "---|" * len(runs)]  # fmt: skip
    for rule in rules:
        sub = [(k, p) for k, p in enumerate(pairs) if p[1] == rule]
        g = [gold[k] for k, _ in sub]
        cells = []
        for by_id in runs.values():
            s = [p_violation(by_id.get(i, {}).get(r)) for _, (i, r) in sub]
            m = metrics(g, s, 0.5)
            cells.append(f"{m['tp']} / {m['fp']} / {m['fn']}")
        lines.append(f"| {rule} | {sum(g)} | " + " | ".join(cells) + " |")

    out.write_text("\n".join(lines) + "\n")
    print(out.read_text())


if __name__ == "__main__":
    main()

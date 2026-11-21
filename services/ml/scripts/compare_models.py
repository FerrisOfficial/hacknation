"""Zestawienie wariantów Modułu 2 z kilku przebiegów compare_m2.py (ten sam zbiór materiałów).

    uv run python scripts/compare_models.py out_report.md NAZWA=katalog [NAZWA=katalog ...]

Pierwszy wariant jest punktem odniesienia dla zgodności i korelacji. Regex bierzemy z pierwszego
katalogu (kolumny `regex_*`), więc jest zawsze w zestawieniu.
"""

import json
import statistics as st
import sys
from pathlib import Path

THRESHOLDS = (0.3, 0.5, 0.7)


def load(directory: str) -> dict[str, dict]:
    path = Path(directory) / "results.jsonl"
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return {row["id"]: row for row in rows}


def pearson(xs: list[float], ys: list[float]) -> float:
    if len(xs) < 2 or st.pstdev(xs) == 0 or st.pstdev(ys) == 0:
        return float("nan")
    return st.correlation(xs, ys)


def main() -> None:
    out = Path(sys.argv[1])
    variants = [arg.split("=", 1) for arg in sys.argv[2:]]
    runs = {name: load(directory) for name, directory in variants}
    first = next(iter(runs.values()))
    ids = sorted(set.intersection(*(set(r) for r in runs.values())))

    # Wariant „regex” = kolumny regex z pierwszego przebiegu.
    scores = {"regex": {i: first[i]["regex_score"] for i in ids}}
    findings = {"regex": {i: first[i]["regex"] for i in ids}}
    seconds: dict[str, list[float]] = {"regex": [0.0]}
    for name, rows in runs.items():
        scores[name] = {i: rows[i]["llm_score"] or 0.0 for i in ids}
        findings[name] = {i: rows[i]["llm"] for i in ids}
        seconds[name] = [rows[i]["llm_seconds"] or 0.0 for i in ids]

    reference = variants[0][0]
    lines = [
        "# Moduł 2: porównanie modeli (wariant łączony)",
        "",
        f"Materiałów: {len(ids)}. Punkt odniesienia dla zgodności: {reference}.",
        "",
        "| wariant | średni score | "
        + " | ".join(f"score ≥ {t}" for t in THRESHOLDS)
        + f" | korelacja z {reference} | s / stronę |",
        "|---|---|" + "---|" * len(THRESHOLDS) + "---|---|",
    ]
    ref_scores = [scores[reference][i] for i in ids]
    for name, by_id in scores.items():
        values = [by_id[i] for i in ids]
        counts = " | ".join(str(sum(v >= t for v in values)) for t in THRESHOLDS)
        corr = pearson(values, ref_scores)
        lines.append(
            f"| {name} | {st.mean(values):.2f} | {counts} | {corr:.2f} | "
            f"{st.mean(seconds[name]):.1f} |"
        )

    rules = sorted({r for rows in findings[reference].values() for r in rows}, key=_rule_key)
    lines += [
        "",
        f"## Naruszenia per reguła (liczba stron) i zgodność wyniku z {reference}",
        "",
        "| reguła | " + " | ".join(scores) + " |",
        "|---|" + "---|" * len(scores),
    ]
    for rule in rules:
        cells = []
        for name in scores:
            violations = sum(
                findings[name][i].get(rule, {}).get("result") == "violation" for i in ids
            )
            agree = sum(
                findings[name][i].get(rule, {}).get("result")
                == findings[reference][i].get(rule, {}).get("result")
                for i in ids
            )
            cells.append(f"{violations} ({agree / len(ids):.0%})")
        lines.append(f"| {rule} | " + " | ".join(cells) + " |")

    lines += ["", "## Risk score per materiał", "", "| id | URL | " + " | ".join(scores) + " |",
              "|---|---|" + "---|" * len(scores)]  # fmt: skip
    for i in sorted(ids, key=lambda i: -scores[reference][i]):
        cells = " | ".join(f"{scores[name][i]:.2f}" for name in scores)
        lines.append(f"| {i} | {first[i]['url']} | {cells} |")

    out.write_text("\n".join(lines) + "\n")
    print(out.read_text())


def _rule_key(rule: str) -> tuple[int, str]:
    digits = "".join(c for c in rule if c.isdigit())
    return int(digits or 0), rule


if __name__ == "__main__":
    main()

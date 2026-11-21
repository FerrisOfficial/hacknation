"""Porównanie silników Modułu 2: reguły regex vs LLM (Ollama) na zbiorze materiałów.

    uv run python scripts/compare_m2.py dataset.jsonl out_dir [--model NAZWA] [--limit N]

dataset.jsonl: jeden materiał na linię, {"id", "url", "title", "text"}.
Wyniki LLM są cache'owane w out_dir/llm.jsonl, więc przerwany przebieg można wznowić.
Raport: out_dir/report.md + out_dir/results.jsonl.
"""

import argparse
import json
import time
from collections import Counter
from dataclasses import asdict
from pathlib import Path

from ml.risk import TEXT_RULES, Finding, analyze_risk_disclosure, risk_score, rule_scores
from ml.risk_llm import LlmError, analyze_risk_disclosure_hybrid, analyze_risk_disclosure_llm


def load_cache(path: Path) -> dict[str, dict]:
    if not path.exists():
        return {}
    rows = [json.loads(line) for line in path.read_text().splitlines() if line.strip()]
    return {row["id"]: row for row in rows}


def findings_from(raw: list[dict]) -> list[Finding]:
    return [Finding(**f) for f in raw]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("out", type=Path)
    parser.add_argument("--model", default=None)
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--engine", choices=["llm", "hybrid"], default="llm")
    args = parser.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    materials = [json.loads(line) for line in args.dataset.read_text().splitlines() if line]
    materials = materials[: args.limit] if args.limit else materials
    cache_path = args.out / f"{args.engine}.jsonl"
    analyze_llm = (
        analyze_risk_disclosure_hybrid if args.engine == "hybrid" else analyze_risk_disclosure_llm
    )
    cache = load_cache(cache_path)

    with cache_path.open("a") as cache_file:
        for i, m in enumerate(materials, 1):
            if m["id"] in cache:
                continue
            started = time.monotonic()
            try:
                analysis = analyze_llm(m["text"], model=args.model)
                row = {
                    "id": m["id"],
                    "findings": [asdict(f) for f in analysis.findings],
                    "summary": analysis.summary,
                    "error": None,
                }
            except LlmError as exc:
                row = {"id": m["id"], "findings": [], "summary": "", "error": str(exc)}
            row["seconds"] = round(time.monotonic() - started, 1)
            cache[m["id"]] = row
            cache_file.write(json.dumps(row, ensure_ascii=False) + "\n")
            cache_file.flush()
            status = row["error"] or ""
            print(f"[{i}/{len(materials)}] {m['id']} {row['seconds']}s {status}", flush=True)

    results = []
    for m in materials:
        regex = [f for f in analyze_risk_disclosure(m["text"]).findings if f.rule_id in TEXT_RULES]
        llm_row = cache.get(m["id"], {})
        llm = findings_from(llm_row.get("findings", []))
        results.append(
            {
                "id": m["id"],
                "url": m["url"],
                "regex_score": risk_score(regex),
                "llm_score": risk_score(llm) if llm else None,
                "regex_rule_scores": {k: asdict(v) for k, v in rule_scores(regex).items()},
                "llm_rule_scores": {k: asdict(v) for k, v in rule_scores(llm).items()},
                "regex": {f.rule_id: asdict(f) for f in regex},
                "llm": {f.rule_id: asdict(f) for f in llm},
                "llm_error": llm_row.get("error"),
                "llm_seconds": llm_row.get("seconds"),
            }
        )
    with (args.out / "results.jsonl").open("w") as f:
        for r in results:
            f.write(json.dumps(r, ensure_ascii=False) + "\n")
    (args.out / "report.md").write_text(report(results))
    print(f"Raport: {args.out / 'report.md'}")


def report(results: list[dict]) -> str:
    done = [r for r in results if r["llm"]]
    lines = [
        "# Moduł 2: reguły vs LLM",
        "",
        f"Materiałów: {len(results)}, ocenionych przez LLM: {len(done)}.",
        "",
    ]
    if done:
        secs = [r["llm_seconds"] for r in done if r["llm_seconds"]]
        lines += [
            f"Czas LLM na materiał: średnio {sum(secs) / len(secs):.0f} s, max {max(secs):.0f} s.",
            "",
        ]

    lines += [
        "## Zgodność wyników per reguła",
        "",
        "| reguła | zgodne | violation: regex / LLM / oba | n/a: regex / LLM |",
        "|---|---|---|---|",
    ]
    for rule in TEXT_RULES:
        pairs = [
            (r["regex"][rule]["result"], r["llm"][rule]["result"]) for r in done if rule in r["llm"]
        ]
        if not pairs:
            continue
        agree = sum(a == b for a, b in pairs)
        rv = sum(a == "violation" for a, _ in pairs)
        lv = sum(b == "violation" for _, b in pairs)
        both = sum(a == b == "violation" for a, b in pairs)
        rn = sum(a == "n/a" for a, _ in pairs)
        ln = sum(b == "n/a" for _, b in pairs)
        lines.append(
            f"| {rule} | {agree}/{len(pairs)} ({agree / len(pairs):.0%}) | "
            f"{rv} / {lv} / {both} | {rn} / {ln} |"
        )

    lines += [
        "",
        "## Risk score per materiał",
        "",
        "Score = max po regułach z (waga reguły * P(naruszenie)).",
        "",
        "| id | URL | regex | LLM | naruszenia regex | naruszenia LLM |",
        "|---|---|---|---|---|---|",
    ]
    for r in sorted(results, key=lambda r: -(r["llm_score"] or 0)):
        rv = ",".join(k for k, f in r["regex"].items() if f["result"] == "violation")
        lv = ",".join(k for k, f in r["llm"].items() if f["result"] == "violation")
        llm = "—" if r["llm_score"] is None else f"{r['llm_score']:.2f}"
        llm = "błąd" if r["llm_error"] else llm
        lines.append(f"| {r['id']} | {r['url']} | {r['regex_score']:.2f} | {llm} | {rv} | {lv} |")

    if done:
        both = [(r["regex_score"], r["llm_score"]) for r in done]
        n = len(both)
        mx = sum(a for a, _ in both) / n
        my = sum(b for _, b in both) / n
        cov = sum((a - mx) * (b - my) for a, b in both)
        sx = sum((a - mx) ** 2 for a, _ in both) ** 0.5
        sy = sum((b - my) ** 2 for _, b in both) ** 0.5
        corr = cov / (sx * sy) if sx and sy else float("nan")
        flagged = Counter((a >= 0.5, b >= 0.5) for a, b in both)
        lines += [
            "",
            "## Podsumowanie",
            "",
            f"- Korelacja Pearsona score'ów regex vs LLM: {corr:.2f}",
            f"- Średni score: regex {mx:.2f}, LLM {my:.2f}",
            f"- Przy progu 0,5: oba flagują {flagged[(True, True)]}, tylko regex "
            f"{flagged[(True, False)]}, tylko LLM {flagged[(False, True)]}, "
            f"żaden {flagged[(False, False)]}",
        ]
    return "\n".join(lines) + "\n"


if __name__ == "__main__":
    main()

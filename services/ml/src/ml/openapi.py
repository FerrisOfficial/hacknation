"""Zapisuje specyfikację OpenAPI do pliku (z niej generujemy typy dla TypeScriptu)."""

import json
import sys
from pathlib import Path

from ml.main import app


def main() -> None:
    out = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("openapi.json")
    spec = json.dumps(app.openapi(), indent=2, ensure_ascii=False)
    out.write_text(spec + "\n", encoding="utf-8", newline="\n")
    print(f"OpenAPI zapisane do {out}")


if __name__ == "__main__":
    main()

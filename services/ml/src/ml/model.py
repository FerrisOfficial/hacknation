"""Logika modelu. Na razie atrapa oparta o słowa kluczowe — podmień na prawdziwy model.

Ciężkie rzeczy (ładowanie wag, tokenizer) trzymaj tutaj, a nie w main.py.
Endpointy w main.py mają tylko walidować wejście i wołać funkcje z tego modułu.
"""

import re
from typing import Literal

Label = Literal["positive", "negative", "neutral"]

_POSITIVE = {"świetny", "świetne", "dobry", "dobre", "super", "fajny", "great", "good", "love"}
_NEGATIVE = {"zły", "złe", "słaby", "słabe", "fatalny", "fatalne", "bad", "awful", "hate"}


def predict_sentiment(text: str) -> tuple[Label, float]:
    words = set(re.findall(r"\w+", text.lower()))
    pos = len(words & _POSITIVE)
    neg = len(words & _NEGATIVE)
    if pos == neg:
        return "neutral", 0.5
    label: Label = "positive" if pos > neg else "negative"
    score = 0.5 + 0.5 * abs(pos - neg) / (pos + neg)
    return label, round(score, 2)

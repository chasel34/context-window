"""Display token -> pronunciation spelling for CTC alignment (Context Window)."""
import re

PRON = {"C": "see", "K,": "kay", "K": "kay", "O": "oh", "TOKEN": "token",
        "Two": "two", "Error:": "error"}


def tokens(text):
    """Split a lyric line into display tokens: spaces, hyphen stutters, dashes."""
    text = text.replace("—", " ").replace("–", " ")
    out = []
    for w in text.split():
        parts = [p for p in w.split("-") if p]
        for k, p in enumerate(parts):
            out.append(p + ("-" if k < len(parts) - 1 else ""))
    return out


def pron(token):
    key = token.rstrip("-")
    if key in PRON:
        return PRON[key].split()
    w = key.lower().replace("’", "'")
    w = re.sub(r"[^a-z' ]", " ", w).strip("' ")
    return [p.strip("'") for p in w.split() if p.strip("'")]

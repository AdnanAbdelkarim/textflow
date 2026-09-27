"""
Tokenization utilities - single source of truth for text -> tokens conversion.

Used by visualizations endpoints (word_frequency, coverage, zipf, cooccurrence)
and indirectly by other modules through `_tok` / `_tokenize_rows`.
"""
import re

# Token regex: alphanumeric runs of any length (length filtering happens later)
TOKEN_RE = re.compile(r"[A-Za-z0-9]+")

# Bound per-line token work for performance (used in cooccurrence/zipf)
MAX_TOKENS_PER_LINE = 80

# English stopwords, shared by tokenization, topic modeling and preprocessing.
STOPWORDS = set([
    'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
    'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
    'between', 'both', 'but', 'by', 'can', 'did', 'do', 'does', 'doing', 'down',
    'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has', 'have',
    'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
    'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me',
    'more', 'most', 'my', 'myself', 'no', 'nor', 'not', 'of', 'off', 'on', 'once',
    'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own', 'same',
    'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their', 'theirs',
    'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those', 'through',
    'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what', 'when',
    'where', 'which', 'while', 'who', 'whom', 'why', 'with', 'would', 'you', 'your',
    'yours', 'yourself', 'yourselves', 'been', 'being', 'because', 'before', 'after',
    'during', 'until', 'above', 'below', 'between', 'from', 'into', 'through', 'each',
    'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor', 'not',
    'only', 'own', 'same', 'so', 'than', 'too', 'very', 'can', 'will', 'just', 'don',
    'should', 'now'
])

# Frozen set for fast membership testing in hot paths
_STOPWORDS_FROZEN = frozenset(STOPWORDS)


def tokenize(text, include_stopwords=False):
    """
    Tokenize text into lowercase alphanumeric tokens of length > 2.
    Optionally filters stopwords.

    Hot path - called once per document across multiple endpoints.

    Args:
        text: str input
        include_stopwords: if False (default), strip stopwords from output

    Returns:
        list of lowercase token strings
    """
    if not text:
        return []
    raw = TOKEN_RE.findall(text)
    if not raw:
        return []
    lowered = [t.lower() for t in raw if len(t) > 2]
    if include_stopwords:
        return lowered
    return [t for t in lowered if t not in _STOPWORDS_FROZEN]


def _row_text(row):
    """Return the text of a row, which may be a plain string or a record.

    The corpus is held as row objects once a labeled dataset is uploaded, so a
    caller can pass either shape. The other endpoints normalize this the same
    way before tokenizing.
    """
    if isinstance(row, str):
        return row
    if isinstance(row, dict):
        return str(row.get("text") or row.get("Message") or "")
    return str(row or "")


def tokenize_rows(rows, include_stopwords=False):
    """
    Tokenize a list of rows into a flat list of tokens.
    Each row is capped at MAX_TOKENS_PER_LINE.

    Used by /api/coverage.
    """
    toks_all = []
    for line in rows:
        toks = tokenize(_row_text(line), include_stopwords)
        if len(toks) > MAX_TOKENS_PER_LINE:
            toks = toks[:MAX_TOKENS_PER_LINE]
        toks_all.extend(toks)
    return toks_all


# Backward-compat aliases (old code uses _tok / _tokenize_rows / TOKEN_RE / STOPWORDS)
_tok = tokenize
_tokenize_rows = tokenize_rows
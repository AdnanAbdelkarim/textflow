"""
Dataset loaders for the TextFlow evaluation.

Canonical sources are used in preference to third-party mirrors, and the exact
sampled document indices are recorded so a subsample can be reproduced or
audited:

  IMDb - Maas et al. (2011), via the `stanfordnlp/imdb` Hugging Face mirror
             of the official aclImdb release (25k train / 25k test).
  AG News - Zhang et al. (2015), via `fancyzhx/ag_news` (120k train / 7.6k test).
  CODE-ACCORD - Zenodo record 10210022 / github.com/Accord-Project/CODE-ACCORD.

Subsampling is stratified and seeded. `load_*` returns (texts, labels, meta)
where meta records the source, the split, the seed and the selected indices.
"""
import hashlib
import json
import os

import numpy as np

DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
DEFAULT_SEED = 42


def _stratified_subsample(texts, labels, n_per_class, seed):
    """Take exactly n_per_class documents from each class. Returns (idx, texts, labels)."""
    rng = np.random.RandomState(seed)
    labels_arr = np.asarray(labels)
    selected = []
    for cls in sorted(set(labels_arr.tolist())):
        cls_idx = np.flatnonzero(labels_arr == cls)
        if len(cls_idx) < n_per_class:
            raise ValueError(
                f"class {cls!r} has {len(cls_idx)} documents, "
                f"fewer than the requested {n_per_class}"
            )
        selected.append(rng.choice(cls_idx, size=n_per_class, replace=False))
    idx = np.sort(np.concatenate(selected))
    return idx, [texts[i] for i in idx], [labels[i] for i in idx]


def _fingerprint(texts):
    """Stable hash of the selected corpus, so a rerun can be proven identical."""
    h = hashlib.sha256()
    for t in texts:
        h.update(t.encode("utf8", "replace"))
        h.update(b"\x00")
    return h.hexdigest()[:16]


def _meta(name, source, split, n_per_class, seed, idx, texts, labels):
    from collections import Counter
    return {
        "dataset": name,
        "source": source,
        "split": split,
        "n_documents": len(texts),
        "n_per_class": n_per_class,
        "seed": seed,
        "class_counts": {str(k): int(v) for k, v in Counter(labels).items()},
        "corpus_sha256_16": _fingerprint(texts),
        "selected_indices": [int(i) for i in idx],
    }


def load_imdb(n_per_class=5000, seed=DEFAULT_SEED, split="train"):
    """IMDb binary sentiment. Default: 10,000 documents, 5,000 per class."""
    from datasets import load_dataset

    ds = load_dataset("stanfordnlp/imdb", split=split)
    texts = list(ds["text"])
    names = ds.features["label"].names          # ['neg', 'pos']
    labels = [names[i] for i in ds["label"]]

    idx, texts, labels = _stratified_subsample(texts, labels, n_per_class, seed)
    return texts, labels, _meta(
        "IMDb", "stanfordnlp/imdb (Maas et al. 2011)", split,
        n_per_class, seed, idx, texts, labels
    )


def load_ag_news(n_per_class=2500, seed=DEFAULT_SEED, split="train"):
    """AG News 4-class topic classification. Default: 10,000 documents."""
    from datasets import load_dataset

    ds = load_dataset("fancyzhx/ag_news", split=split)
    texts = list(ds["text"])
    names = ds.features["label"].names          # World / Sports / Business / Sci-Tech
    labels = [names[i] for i in ds["label"]]

    idx, texts, labels = _stratified_subsample(texts, labels, n_per_class, seed)
    return texts, labels, _meta(
        "AG News", "fancyzhx/ag_news (Zhang et al. 2015)", split,
        n_per_class, seed, idx, texts, labels
    )


def load_code_accord(seed=DEFAULT_SEED):
    """
    CODE-ACCORD multi-label building-regulation sentences.

    Expects the entity/relation CSV from the Zenodo record to be present at
    experiments/data/code_accord.csv. Returns (texts, Y, meta) where Y is an
    (n_documents, n_labels) binary indicator matrix.
    """
    import csv
    from collections import Counter

    path = os.path.join(DATA_DIR, "code_accord.csv")
    if not os.path.exists(path):
        raise FileNotFoundError(
            f"CODE-ACCORD not found at {path}.\n"
            "Download it from https://zenodo.org/records/10210022 "
            "(or https://github.com/Accord-Project/CODE-ACCORD) and save the "
            "sentence-level CSV there. The expected schema is a text column "
            "plus one binary column per regulatory label."
        )

    with open(path, newline="", encoding="utf8") as fh:
        reader = csv.DictReader(fh)
        rows = list(reader)

    fieldnames = reader.fieldnames or []
    text_col = next(
        (c for c in fieldnames if c.lower() in ("text", "sentence", "content")),
        fieldnames[-1],
    )
    label_cols = [
        c for c in fieldnames
        if c != text_col
        and all((r.get(c, "").strip() in ("0", "1", "")) for r in rows)
    ]
    if not label_cols:
        raise ValueError(
            f"No binary label columns found in {path}. Columns: {fieldnames}"
        )

    texts = [r[text_col] for r in rows]
    Y = np.array(
        [[int(r.get(c, "0") or 0) for c in label_cols] for r in rows], dtype=int
    )

    meta = {
        "dataset": "CODE-ACCORD",
        "source": "Zenodo 10210022 / Accord-Project/CODE-ACCORD",
        "split": "full (no subsampling)",
        "n_documents": len(texts),
        "labels": label_cols,
        "seed": seed,
        "corpus_sha256_16": _fingerprint(texts),
        # Multi-label descriptive statistics: prevalence, cardinality, density.
        "label_prevalence": {
            c: float(Y[:, i].mean()) for i, c in enumerate(label_cols)
        },
        "label_positive_counts": {
            c: int(Y[:, i].sum()) for i, c in enumerate(label_cols)
        },
        "label_cardinality": float(Y.sum(axis=1).mean()),
        "label_density": float(Y.sum(axis=1).mean() / Y.shape[1]),
        "labelset_counts": {
            str(k): int(v)
            for k, v in Counter(map(tuple, Y.tolist())).most_common(20)
        },
    }
    return texts, Y, meta


def save_meta(meta, path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w") as fh:
        json.dump(meta, fh, indent=2)

"""
Transformer benchmark.

Fine-tunes each of the four BERT variants TextFlow exposes and reports both
classification performance and computational cost: training time, inference
time, seconds per optimizer step and peak memory.

Design: a single stratified 80/20 split rather than 10-fold cross-validation.
Measured on an Apple M2 CPU, 10-fold cross-validation over all four variants on
both datasets needs roughly 70 hours; the single split needs roughly 6. The
split is seeded and the indices are recorded, so the run is reproducible.

The hyperparameters below are the platform's own defaults, so the numbers
describe what a TextFlow user actually gets.

Standalone: needs only torch, transformers, datasets, scikit-learn and
accelerate.

Run locally:
    python transformer_benchmark.py

Run on Google Colab (Runtime > Change runtime type > GPU):
    1. Install the extra packages in a cell:
           !pip install -q datasets accelerate
    2. Either upload this file and run it:
           !python transformer_benchmark.py
       or paste the whole file into a cell and run the cell, then call:
           main()
    3. Download the results:
           from google.colab import files
           files.download('results/transformer_benchmark.json')

Options: --models bert-tiny,bert-small,distilbert,bert  --datasets imdb,agnews
         --epochs 3  --batch-size 8  --max-length 128  --learning-rate 5e-5
"""
import argparse
import hashlib
import json
import os
import platform
import sys
import time

import numpy as np
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, classification_report
)
from sklearn.model_selection import train_test_split

DEFAULT_SEED = 42


# Dataset loaders, identical to experiments/datasets.py in the TextFlow
# repository, so the sampled documents match the other experiments.

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


# __file__ is undefined when this is pasted into a notebook cell, so fall
# back to the working directory.
_HERE = os.path.dirname(os.path.abspath(
    globals().get("__file__", os.path.join(os.getcwd(), "benchmark"))))
RESULTS_DIR = os.path.join(_HERE, "results")
SEED = 42

# Exactly the identifiers routes/predictive.py loads.
MODEL_MAP = {
    "bert-tiny": "prajjwal1/bert-tiny",
    "bert-small": "prajjwal1/bert-small",
    "distilbert": "distilbert-base-uncased",
    "bert": "bert-base-uncased",
}
DISPLAY = {
    "bert-tiny": "BERT-Tiny", "bert-small": "BERT-Small",
    "distilbert": "DistilBERT", "bert": "BERT",
}

# The platform's defaults (routes/predictive.py).
DEFAULTS = {
    "learning_rate": 5e-5,
    "num_train_epochs": 3,
    "batch_size": 8,
    "max_length": 128,
    "weight_decay": 0.01,
    "warmup_ratio": 0.1,
    "optimizer": "adamw_torch",
}


def hardware_profile():
    import torch
    prof = {
        "platform": platform.platform(),
        "processor": platform.processor() or platform.machine(),
        "python": platform.python_version(),
        "torch": torch.__version__,
        "cpu_count": os.cpu_count(),
    }
    if torch.cuda.is_available():
        prof["accelerator"] = f"CUDA: {torch.cuda.get_device_name(0)}"
        prof["accelerator_memory_gb"] = round(
            torch.cuda.get_device_properties(0).total_memory / 1024**3, 1)
    elif torch.backends.mps.is_available():
        prof["accelerator"] = "Apple MPS"
    else:
        prof["accelerator"] = "CPU only"
    return prof


def peak_memory_mb(device_type):
    """Peak resident memory for the process, or peak allocated on CUDA."""
    import torch
    if device_type == "cuda":
        return round(torch.cuda.max_memory_allocated() / 1024**2, 1)
    try:
        import resource
        peak = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        # Linux reports kilobytes, macOS reports bytes.
        divisor = 1024 if sys.platform.startswith("linux") else 1024 * 1024
        return round(peak / divisor, 1)
    except Exception:
        return None


def build_dataset_class():
    import torch
    from torch.utils.data import Dataset

    class TextDataset(Dataset):
        def __init__(self, texts, labels, tokenizer, max_length):
            self.encodings = tokenizer(
                texts, truncation=True, padding=True,
                max_length=max_length, return_tensors="pt"
            )
            self.labels = torch.tensor(labels)

        def __getitem__(self, idx):
            item = {k: v[idx] for k, v in self.encodings.items()}
            item["labels"] = self.labels[idx]
            return item

        def __len__(self):
            return len(self.labels)

    return TextDataset


def run_one(model_key, texts, labels, hp, test_size=0.2):
    import math
    import torch
    from transformers import Trainer, TrainingArguments
    # The same explicit tokenizer and model classes routes/predictive.py uses.
    # AutoTokenizer resolves these checkpoints to a fast tokenizer that needs a
    # converter (sentencepiece or tiktoken) which the platform does not install.
    from transformers import (
        BertTokenizer, BertForSequenceClassification,
        DistilBertTokenizer, DistilBertForSequenceClassification,
    )

    model_name = MODEL_MAP[model_key]
    unique_labels = sorted(set(labels))
    label2id = {l: i for i, l in enumerate(unique_labels)}
    id2label = {i: l for l, i in label2id.items()}
    y = [label2id[l] for l in labels]

    texts_train, texts_test, y_train, y_test = train_test_split(
        texts, y, test_size=test_size, random_state=SEED, stratify=y
    )

    if model_key == "distilbert":
        tokenizer = DistilBertTokenizer.from_pretrained(model_name)
        model = DistilBertForSequenceClassification.from_pretrained(
            model_name, num_labels=len(unique_labels),
            id2label=id2label, label2id=label2id
        )
    else:
        tokenizer = BertTokenizer.from_pretrained(model_name)
        model = BertForSequenceClassification.from_pretrained(
            model_name, num_labels=len(unique_labels),
            id2label=id2label, label2id=label2id
        )
    n_params = sum(p.numel() for p in model.parameters())

    TextDataset = build_dataset_class()
    train_ds = TextDataset(texts_train, y_train, tokenizer, hp["max_length"])
    test_ds = TextDataset(texts_test, y_test, tokenizer, hp["max_length"])

    steps_per_epoch = max(1, math.ceil(len(train_ds) / hp["batch_size"]))
    total_steps = steps_per_epoch * hp["num_train_epochs"]
    warmup_steps = max(1, int(hp["warmup_ratio"] * total_steps))

    device_type = ("cuda" if torch.cuda.is_available()
                   else "mps" if torch.backends.mps.is_available() else "cpu")
    if device_type == "cuda":
        torch.cuda.reset_peak_memory_stats()

    args = TrainingArguments(
        output_dir=os.path.join(RESULTS_DIR, "_hf", model_key),
        num_train_epochs=hp["num_train_epochs"],
        learning_rate=hp["learning_rate"],
        per_device_train_batch_size=hp["batch_size"],
        per_device_eval_batch_size=hp["batch_size"],
        warmup_steps=warmup_steps,
        weight_decay=hp["weight_decay"],
        optim=hp["optimizer"],
        seed=SEED,
        logging_steps=50,
        eval_strategy="no",
        save_strategy="no",
        report_to="none",
    )
    trainer = Trainer(model=model, args=args, train_dataset=train_ds)

    t0 = time.time()
    trainer.train()
    train_seconds = time.time() - t0

    t1 = time.time()
    preds = trainer.predict(test_ds)
    inference_seconds = time.time() - t1
    y_pred = np.argmax(preds.predictions, axis=1)

    accuracy = accuracy_score(y_test, y_pred)
    p_w, r_w, f1_w, _ = precision_recall_fscore_support(
        y_test, y_pred, average="weighted", zero_division=0)
    _, _, f1_macro, _ = precision_recall_fscore_support(
        y_test, y_pred, average="macro", zero_division=0)

    return {
        "model": DISPLAY[model_key],
        "hf_model_id": model_name,
        "n_parameters": int(n_params),
        "n_train": len(texts_train),
        "n_test": len(texts_test),
        "metrics": {
            "accuracy": round(float(accuracy), 4),
            "precision_weighted": round(float(p_w), 4),
            "recall_weighted": round(float(r_w), 4),
            "f1_weighted": round(float(f1_w), 4),
            "f1_macro": round(float(f1_macro), 4),
        },
        "cost": {
            "train_seconds": round(train_seconds, 1),
            "inference_seconds": round(inference_seconds, 1),
            "seconds_per_optimizer_step": round(train_seconds / total_steps, 4),
            "total_optimizer_steps": total_steps,
            "peak_memory_mb": peak_memory_mb(device_type),
            "device": device_type,
        },
        "hyperparameters": {**hp, "warmup_steps": warmup_steps, "seed": SEED},
        "classification_report": classification_report(
            [id2label[i] for i in y_test], [id2label[i] for i in y_pred],
            zero_division=0),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default="all",
                    help="comma-separated subset of "
                         "bert-tiny,bert-small,distilbert,bert")
    ap.add_argument("--datasets", default="all", help="imdb,agnews or all")
    ap.add_argument("--imdb-per-class", type=int, default=5000)
    ap.add_argument("--agnews-per-class", type=int, default=2500)
    ap.add_argument("--epochs", type=int, default=DEFAULTS["num_train_epochs"])
    ap.add_argument("--batch-size", type=int, default=DEFAULTS["batch_size"])
    ap.add_argument("--max-length", type=int, default=DEFAULTS["max_length"])
    ap.add_argument("--learning-rate", type=float, default=DEFAULTS["learning_rate"])
    # parse_known_args so the script also runs when pasted into a notebook
    # cell, where sys.argv carries the kernel's own arguments.
    args, _ = ap.parse_known_args()

    models = (list(MODEL_MAP) if args.models == "all"
              else [m.strip() for m in args.models.split(",")])
    datasets = (["imdb", "agnews"] if args.datasets == "all"
                else [d.strip() for d in args.datasets.split(",")])

    hp = dict(DEFAULTS)
    hp.update({
        "num_train_epochs": args.epochs,
        "batch_size": args.batch_size,
        "max_length": args.max_length,
        "learning_rate": args.learning_rate,
    })

    hw = hardware_profile()
    if hw.get("accelerator") == "CPU only":
        print("\n  WARNING: no GPU detected. On CPU a single model takes hours.")
        print("  In Colab: Runtime > Change runtime type > GPU, then rerun.\n")
    print("=" * 78)
    print("TRANSFORMER BENCHMARK")
    print("=" * 78)
    for k, v in hw.items():
        print(f"  {k:24} {v}")
    print(f"  {'hyperparameters':24} {hp}")

    out = {"hardware": hw, "hyperparameters": hp, "seed": SEED,
           "validation": "single stratified 80/20 split", "datasets": {}}

    for ds in datasets:
        if ds == "imdb":
            texts, labels, meta = load_imdb(
                n_per_class=args.imdb_per_class, seed=SEED)
        elif ds == "agnews":
            texts, labels, meta = load_ag_news(
                n_per_class=args.agnews_per_class, seed=SEED)
        else:
            raise ValueError(f"unknown dataset {ds!r}")

        print(f"\n{'=' * 78}\n{meta['dataset']}: {meta['n_documents']} documents, "
              f"fingerprint {meta['corpus_sha256_16']}\n{'=' * 78}")
        print(f"{'model':<14}{'acc':>9}{'F1-w':>9}{'F1-macro':>11}"
              f"{'train_s':>10}{'peak_MB':>10}")
        print("-" * 78)

        runs = []

        def save():
            # Written after every model so that a disconnected session loses at
            # most the model currently training.
            os.makedirs(RESULTS_DIR, exist_ok=True)
            path = os.path.join(RESULTS_DIR, "transformer_benchmark.json")
            with open(path, "w") as fh:
                json.dump(out, fh, indent=2)
            return path

        for m in models:
            try:
                r = run_one(m, texts, labels, hp)
            except Exception as e:
                print(f"{DISPLAY[m]:<14}FAILED: {type(e).__name__}: {e}")
                runs.append({"model": DISPLAY[m], "error": f"{type(e).__name__}: {e}"})
                out["datasets"][ds] = {"dataset_meta": meta, "runs": runs}
                save()
                continue
            met, cost = r["metrics"], r["cost"]
            print(f"{r['model']:<14}{met['accuracy']:>9.4f}"
                  f"{met['f1_weighted']:>9.4f}{met['f1_macro']:>11.4f}"
                  f"{cost['train_seconds']:>10.1f}"
                  f"{(cost['peak_memory_mb'] or 0):>10.1f}")
            runs.append(r)
            out["datasets"][ds] = {"dataset_meta": meta, "runs": runs}
            path = save()

        print(f"\n  written to {path}")


if __name__ == "__main__":
    main()

"""
Multi-label benchmark on the CODE-ACCORD corpus.

Uses the platform's own binary relevance implementation, so the table reports
what the released code produces.

Validation design follows Sechidis, Tsoumakas and Vlahavas (2011): folds are
built by iterative stratification, which balances the prevalence of every label
across folds. Ordinary k-fold leaves rare labels absent from some folds
entirely, which makes per-label scores unstable and macro averages hard to
interpret.

Labels come from the relation annotations of the public release: one binary
indicator per relation type, excluding "none", keeping sentences that carry at
least one. The derivation is recorded in the result file so the dataset can be
rebuilt exactly.

Decision threshold: each per-label classifier predicts with its own default
decision rule (0.5 on the predicted probability, or the sign of the decision
function for the SVM). No threshold tuning is applied.

Reference baseline: predict every label whose prevalence in the training fold
exceeds 0.5. This is the constant predictor a model must beat.

Usage:
    python -m experiments.run_multilabel
"""
import argparse
import csv
import json
import os
import sys
import time
import warnings
from itertools import combinations

import numpy as np
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.metrics import (
    accuracy_score, f1_score, hamming_loss, precision_recall_fscore_support
)

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.stats import (                                   # noqa: E402
    corrected_resampled_ttest, cohens_dz, holm_bonferroni
)
from routes.predictive import BinaryRelevance, _build_model       # noqa: E402
from services.preprocessing import normalize_corpus               # noqa: E402

warnings.filterwarnings("ignore")

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
DATA = os.path.join(os.path.dirname(__file__), "data",
                    "code_accord_multilabel.csv")
SEED = 42
N_FOLDS = 10
MODELS = ("NB", "LR", "KNN", "SVM")
FEATURES = ("tfidf", "tf")


def load_dataset(path):
    with open(path, encoding="utf8") as fh:
        rows = list(csv.DictReader(fh))
    label_names = [c for c in rows[0] if c != "text"]
    texts = [r["text"] for r in rows]
    Y = np.array([[int(r[c]) for c in label_names] for r in rows], dtype=int)
    return texts, Y, label_names


def fold_features(kind, train_texts, test_texts, max_features):
    if kind == "tfidf":
        v = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=max_features)
    else:
        v = CountVectorizer(ngram_range=(1, 2), min_df=2, max_features=max_features)
    return v.fit_transform(train_texts), v.transform(test_texts)


def metrics(Y_true, Y_pred):
    return {
        "hamming_loss": float(hamming_loss(Y_true, Y_pred)),
        "f1_macro": float(f1_score(Y_true, Y_pred, average="macro", zero_division=0)),
        "f1_micro": float(f1_score(Y_true, Y_pred, average="micro", zero_division=0)),
        "subset_accuracy": float(accuracy_score(Y_true, Y_pred)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--folds", type=int, default=N_FOLDS)
    ap.add_argument("--max-features", type=int, default=10000)
    ap.add_argument("--no-lemmatization", action="store_true")
    args, _ = ap.parse_known_args()
    lemmatize = not args.no_lemmatization

    texts, Y, label_names = load_dataset(DATA)
    print(f"\n{'=' * 78}\nCODE-ACCORD multi-label\n{'=' * 78}")
    print(f"sentences: {len(texts)} | labels: {len(label_names)}")
    print(f"label cardinality: {Y.sum(axis=1).mean():.3f} | "
          f"density: {Y.sum(axis=1).mean() / Y.shape[1]:.3f} | "
          f"max labels on a sentence: {Y.sum(axis=1).max()}")
    prevalence = {label_names[j]: int(Y[:, j].sum()) for j in range(len(label_names))}
    print(f"positives per label: {prevalence}")

    t0 = time.time()
    corpus = normalize_corpus(texts, {"useLemmatization": lemmatize})
    print(f"normalization (lemmatization={lemmatize}): {time.time() - t0:.0f}s")

    try:
        from iterstrat.ml_stratifiers import MultilabelStratifiedKFold
        splitter = MultilabelStratifiedKFold(n_splits=args.folds, shuffle=True,
                                             random_state=SEED)
        design = "iterative stratification (Sechidis et al. 2011)"
    except ImportError:
        from sklearn.model_selection import KFold
        splitter = KFold(n_splits=args.folds, shuffle=True, random_state=SEED)
        design = "ordinary k-fold (iterative stratification unavailable)"
    print(f"validation: {design}\n")

    folds = list(splitter.split(np.zeros(len(corpus)), Y))
    n_train, n_test = len(folds[0][0]), len(folds[0][1])

    per_fold, per_label_f1, fold_label_positives = {}, {}, []
    for fi, (tr, te) in enumerate(folds, 1):
        tr_texts = [corpus[i] for i in tr]
        te_texts = [corpus[i] for i in te]
        fold_label_positives.append(
            {label_names[j]: int(Y[te][:, j].sum()) for j in range(len(label_names))})

        # Reference baseline: the constant prediction from training prevalence.
        base_pred = np.tile((Y[tr].mean(axis=0) > 0.5).astype(int), (len(te), 1))
        per_fold.setdefault(("baseline", "-"), []).append(metrics(Y[te], base_pred))

        for feat in FEATURES:
            X_tr, X_te = fold_features(feat, tr_texts, te_texts, args.max_features)
            for name in MODELS:
                clf = BinaryRelevance(_build_model(name.lower(), SEED))
                clf.fit(X_tr, Y[tr])
                pred = clf.predict(X_te)
                per_fold.setdefault((name, feat), []).append(metrics(Y[te], pred))
                _, _, f1s, _ = precision_recall_fscore_support(
                    Y[te], pred, average=None, zero_division=0)
                per_label_f1.setdefault((name, feat), []).append(f1s)
        print(f"  fold {fi:2d} done", flush=True)

    summary = {}
    for key, runs in per_fold.items():
        name = f"{key[0]}+{key[1]}" if key[1] != "-" else key[0]
        summary[name] = {m: {"mean": float(np.mean([r[m] for r in runs])),
                             "std": float(np.std([r[m] for r in runs], ddof=1)),
                             "per_fold": [float(r[m]) for r in runs]}
                         for m in runs[0]}

    print(f"\n{'configuration':<14}{'Hamming loss':>22}{'F1-macro':>12}"
          f"{'F1-micro':>12}{'exact match':>13}")
    print("-" * 78)
    for name in sorted(summary):
        s = summary[name]
        print(f"{name:<14}{s['hamming_loss']['mean']:>14.4f} +/- "
              f"{s['hamming_loss']['std']:.4f}{s['f1_macro']['mean']:>12.4f}"
              f"{s['f1_micro']['mean']:>12.4f}{s['subset_accuracy']['mean']:>13.4f}")

    print(f"\nper-label F1, averaged over folds")
    print("-" * 78)
    header = "configuration " + "".join(f"{l[:11]:>12}" for l in label_names)
    print(header)
    per_label_out = {}
    for key, arrs in sorted(per_label_f1.items()):
        name = f"{key[0]}+{key[1]}"
        mean_f1 = np.mean(np.vstack(arrs), axis=0)
        per_label_out[name] = {label_names[j]: float(mean_f1[j])
                               for j in range(len(label_names))}
        print(f"{name:<14}" + "".join(f"{v:>12.3f}" for v in mean_f1))

    # Planned contrasts on F1-macro, same procedure as the single-label tables.
    tests = []
    for name in MODELS:
        tests.append((f"{name}+tf", f"{name}+tfidf"))
    for feat in FEATURES:
        for a, b in combinations(MODELS, 2):
            tests.append((f"{a}+{feat}", f"{b}+{feat}"))
    for name in MODELS:
        for feat in FEATURES:
            tests.append((f"{name}+{feat}", "baseline"))

    contrasts = []
    for a, b in tests:
        va, vb = summary[a]["f1_macro"]["per_fold"], summary[b]["f1_macro"]["per_fold"]
        t = corrected_resampled_ttest(va, vb, n_train, n_test)
        contrasts.append({"a": a, "b": b, "mean_a": summary[a]["f1_macro"]["mean"],
                          "mean_b": summary[b]["f1_macro"]["mean"],
                          "mean_difference": t["mean_difference"], "t": t["t"],
                          "p_uncorrected": t["p"], "cohens_dz": cohens_dz(va, vb)})
    holm = holm_bonferroni([c["p_uncorrected"] for c in contrasts])
    for c, adj, rej in zip(contrasts, holm["adjusted_p"], holm["reject"]):
        c["p_holm"], c["significant_after_holm"] = adj, bool(rej)

    print(f"\nplanned contrasts on F1-macro ({len(contrasts)} tests, Holm corrected)")
    print("-" * 78)
    for c in sorted(contrasts, key=lambda x: x["p_holm"]):
        mark = "*" if c["significant_after_holm"] else " "
        print(f" {mark} {c['a']:<12} vs {c['b']:<12} diff={c['mean_difference']:+.4f} "
              f"dz={c['cohens_dz']:+.2f} p={c['p_uncorrected']:.4f} "
              f"p_holm={c['p_holm']:.4f}")

    out = {
        "dataset": {
            "name": "CODE-ACCORD",
            "source": "https://github.com/Accord-Project/CODE-ACCORD, "
                      "Zenodo 10.5281/zenodo.10210022",
            "derivation": "relations/all.csv: one binary indicator per relation "
                          "type excluding 'none', keeping sentences with at "
                          "least one label",
            "n_sentences": len(texts), "labels": label_names,
            "label_positives": prevalence,
            "label_cardinality": float(Y.sum(axis=1).mean()),
            "label_density": float(Y.sum(axis=1).mean() / Y.shape[1]),
            "max_labels_per_sentence": int(Y.sum(axis=1).max()),
            "positives_per_label_per_fold": fold_label_positives,
        },
        "configuration": {
            "validation": design, "n_folds": args.folds, "seed": SEED,
            "n_train_per_fold": int(n_train), "n_test_per_fold": int(n_test),
            "max_features": args.max_features, "lemmatization": lemmatize,
            "classifier": "binary relevance, one independent classifier per "
                          "label (routes.predictive.BinaryRelevance)",
            "decision_threshold": "each per-label classifier's default rule; "
                                  "no threshold tuning",
            "resampling": "not applied; undefined for multi-label targets",
            "baseline": "predict every label with training prevalence above 0.5",
        },
        "summary": summary,
        "per_label_f1": per_label_out,
        "planned_contrasts": contrasts,
    }
    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = os.path.join(RESULTS_DIR, "benchmark_code_accord.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nwritten to {path}")


if __name__ == "__main__":
    main()

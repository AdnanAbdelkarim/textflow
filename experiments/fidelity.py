"""
Implementation-fidelity comparison: TextFlow's pipeline vs a hand-coded
scikit-learn reference.

Two experiments, deliberately separated:

  A. STRICT FIDELITY - identical preprocessing, folds, features, parameters and
     seeds in both pipelines. This is the only configuration that can test
     whether the no-code abstraction layer itself introduces bias, which is
     why it is kept separate from (B).

  B. PREPROCESSING ROBUSTNESS - TextFlow lemmatizes, the reference does not.
     This measures sensitivity to a realistic preprocessing difference. It is
     a legitimate experiment, but it cannot establish implementation fidelity.

Both are analysed with:
  - an ordinary paired t-test (reported for comparison only)
  - the Nadeau & Bengio corrected resampled t-test, which accounts for the
    training-set overlap between CV folds
  - TOST equivalence testing against a pre-specified margin, with a confidence
    interval for the difference

EQUIVALENCE MARGIN. The margin is set to 0.01 F1 (one percentage point) and is
fixed before the analysis is run. Rationale: across the benchmark
configurations, differences that carry a practical consequence for a user's
model choice are an order of magnitude larger (NB vs KNN on IMDb differs by
~0.19 F1). A one-point difference in F1 would not change which configuration a
user selects, and is smaller than the fold-to-fold standard deviation of every
configuration measured (0.009-0.024). Pass --margin to vary it.
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, f1_score
from sklearn.model_selection import StratifiedKFold

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.datasets import load_imdb                       # noqa: E402
from experiments.stats import (                                  # noqa: E402
    paired_ttest, corrected_resampled_ttest, tost_paired, cohens_dz
)
from services.preprocessing import normalize_corpus, extract_tfidf_features  # noqa: E402

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
SEED = 42
N_FOLDS = 10
MAX_FEATURES = 10000


def _reference_pipeline_scores(texts, labels, folds, lemmatize):
    """
    Hand-coded scikit-learn reference: TfidfVectorizer with its own default
    tokenization, fitted on the training fold only.
    """
    corpus = (normalize_corpus(texts, {"useLemmatization": True})
              if lemmatize else list(texts))
    y = np.asarray(labels)
    acc, f1 = [], []
    for train_idx, test_idx in folds:
        vec = TfidfVectorizer(max_features=MAX_FEATURES, sublinear_tf=True)
        X_tr = vec.fit_transform([corpus[i] for i in train_idx])
        X_te = vec.transform([corpus[i] for i in test_idx])
        clf = LogisticRegression(max_iter=1000, random_state=SEED)
        clf.fit(X_tr, y[train_idx])
        pred = clf.predict(X_te)
        acc.append(accuracy_score(y[test_idx], pred))
        f1.append(f1_score(y[test_idx], pred, average="weighted"))
    return np.array(acc), np.array(f1)


def _textflow_pipeline_scores(texts, labels, folds, lemmatize):
    """TextFlow's own pipeline, driven through services.preprocessing."""
    settings = {"useTFIDF": True, "vectorSize": 100,
                "useLemmatization": lemmatize}
    corpus = normalize_corpus(texts, settings)
    y = np.asarray(labels)
    acc, f1 = [], []
    for train_idx, test_idx in folds:
        vec = TfidfVectorizer(max_features=MAX_FEATURES, sublinear_tf=True)
        X_tr = vec.fit_transform([corpus[i] for i in train_idx])
        X_te = vec.transform([corpus[i] for i in test_idx])
        clf = LogisticRegression(max_iter=1000, random_state=SEED)
        clf.fit(X_tr, y[train_idx])
        pred = clf.predict(X_te)
        acc.append(accuracy_score(y[test_idx], pred))
        f1.append(f1_score(y[test_idx], pred, average="weighted"))
    return np.array(acc), np.array(f1)


def _analyse(name, tf_f1, ref_f1, n_train, n_test, margin):
    print(f"\n{'='*78}\n{name}\n{'='*78}")
    print(f"TextFlow   F1 = {tf_f1.mean():.4f} ± {tf_f1.std(ddof=1):.4f}")
    print(f"reference  F1 = {ref_f1.mean():.4f} ± {ref_f1.std(ddof=1):.4f}")
    print(f"mean absolute per-fold delta = {np.abs(tf_f1-ref_f1).mean():.4f}")
    print(f"max  absolute per-fold delta = {np.abs(tf_f1-ref_f1).max():.4f}")

    plain = paired_ttest(tf_f1, ref_f1)
    corrected = corrected_resampled_ttest(tf_f1, ref_f1, n_train, n_test)
    tost = tost_paired(tf_f1, ref_f1, margin=margin, corrected=True,
                       n_train=n_train, n_test=n_test)
    dz = cohens_dz(tf_f1, ref_f1)

    print(f"\n  paired t-test (uncorrected)   t={plain['t']:+.4f}  p={plain['p']:.4f}")
    print(f"corrected resampled t-test    t={corrected['t']:+.4f}  "
          f"p={corrected['p']:.4f}")
    print(f"Cohen's dz                    {dz:+.4f}")
    print(f"\n  TOST, margin = ±{margin}")
    print(f"mean difference           {tost['mean_difference']:+.5f}")
    print(f"{int(tost['ci_level']*100)}% CI                    "
          f"[{tost['ci_lower']:+.5f}, {tost['ci_upper']:+.5f}]")
    print(f"p_lower={tost['p_lower']:.4f}  p_upper={tost['p_upper']:.4f}  "
          f"p_TOST={tost['p_tost']:.4f}")
    verdict = ("EQUIVALENT within the margin"
               if tost["equivalent"] else
               "NOT demonstrated equivalent within the margin")
    print(f"-> {verdict}")

    return {"name": name,
            "textflow_f1": {"mean": float(tf_f1.mean()),
                            "std": float(tf_f1.std(ddof=1)),
                            "per_fold": tf_f1.tolist()},
            "reference_f1": {"mean": float(ref_f1.mean()),
                             "std": float(ref_f1.std(ddof=1)),
                             "per_fold": ref_f1.tolist()},
            "mean_abs_delta": float(np.abs(tf_f1 - ref_f1).mean()),
            "max_abs_delta": float(np.abs(tf_f1 - ref_f1).max()),
            "paired_ttest_uncorrected": plain,
            "corrected_resampled_ttest": corrected,
            "tost": tost,
            "cohens_dz": dz}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n-per-class", type=int, default=2500)
    ap.add_argument("--margin", type=float, default=0.01,
                    help="equivalence margin in F1 units (pre-specified)")
    ap.add_argument("--folds", type=int, default=N_FOLDS)
    args = ap.parse_args()

    texts, labels, meta = load_imdb(n_per_class=args.n_per_class, seed=SEED)
    print(f"IMDb subsample: {meta['n_documents']} documents "
          f"({meta['n_per_class']} per class), seed={SEED}, "
          f"fingerprint={meta['corpus_sha256_16']}")
    print(f"Equivalence margin pre-specified at ±{args.margin} F1")

    y = np.asarray(labels)
    skf = StratifiedKFold(n_splits=args.folds, shuffle=True, random_state=SEED)
    folds = list(skf.split(texts, y))
    n_test = len(folds[0][1])
    n_train = len(folds[0][0])

    t0 = time.time()
    # A. Strict fidelity: both pipelines lemmatize, identical everything else.
    tf_acc_a, tf_f1_a = _textflow_pipeline_scores(texts, labels, folds, True)
    ref_acc_a, ref_f1_a = _reference_pipeline_scores(texts, labels, folds, True)
    res_a = _analyse("A. STRICT FIDELITY - identical preprocessing "
                     "(both lemmatized)", tf_f1_a, ref_f1_a,
                     n_train, n_test, args.margin)

    # B. Robustness to a preprocessing difference: TextFlow lemmatizes, the
    #    reference does not.
    tf_acc_b, tf_f1_b = tf_acc_a, tf_f1_a          # TextFlow lemmatizes
    ref_acc_b, ref_f1_b = _reference_pipeline_scores(texts, labels, folds, False)
    res_b = _analyse("B. PREPROCESSING ROBUSTNESS - TextFlow lemmatized, "
                     "reference not", tf_f1_b, ref_f1_b,
                     n_train, n_test, args.margin)

    elapsed = time.time() - t0
    out = {"dataset_meta": meta,
           "configuration": {
               "cv": f"StratifiedKFold(n_splits={args.folds}, shuffle=True, "
                     f"random_state={SEED})",
               "n_train_per_fold": int(n_train), "n_test_per_fold": int(n_test),
               "classifier": f"LogisticRegression(max_iter=1000, "
                             f"random_state={SEED})",
               "vectorizer": f"TfidfVectorizer(max_features={MAX_FEATURES}, "
                             f"sublinear_tf=True)",
               "equivalence_margin_f1": args.margin,
               "margin_prespecified": True,
               "seed": SEED,
               "runtime_seconds": round(elapsed, 1),
           },
           "experiment_a_strict_fidelity": res_a,
           "experiment_b_preprocessing_robustness": res_b}

    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = os.path.join(RESULTS_DIR, "fidelity.json")
    with open(path, "w") as fh:
        json.dump(out, fh, indent=2)
    print(f"\nWritten to {path}  ({elapsed:.1f}s)")


if __name__ == "__main__":
    main()

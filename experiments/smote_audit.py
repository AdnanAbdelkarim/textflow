"""
SMOTE implementation audit.

Reports, for every cross-validation fold:
  - class counts before and after SMOTE
  - the number of synthetic observations generated
  - the exact SMOTE parameters
  - the stage at which resampling is applied
  - confirmation that SMOTE is fitted on the training fold only
  - the exact Naive Bayes implementation and its parameters

It also runs the platform's earlier code path, which substituted GaussianNB for
MultinomialNB whenever SMOTE was enabled, alongside the corrected path, so the
effect of resampling can be separated from the effect of the classifier change.

Usage:
    python -m experiments.smote_audit --dataset imdb
    python -m experiments.smote_audit --dataset agnews --n-per-class 2500
"""
import argparse
import json
import os
import sys
import time

import numpy as np
from sklearn.model_selection import StratifiedKFold
from sklearn.naive_bayes import GaussianNB, MultinomialNB
from sklearn.linear_model import LogisticRegression
from sklearn.neighbors import KNeighborsClassifier
from sklearn.metrics import accuracy_score, f1_score
from imblearn.over_sampling import SMOTE

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.datasets import load_imdb, load_ag_news  # noqa: E402
from services.preprocessing import normalize_corpus, extract_tfidf_features  # noqa: E402

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
SEED = 42
N_FOLDS = 10


def _class_counts(y):
    from collections import Counter
    return {str(k): int(v) for k, v in sorted(Counter(list(y)).items())}


def run_audit(dataset, n_per_class, use_lemmatization, n_folds=N_FOLDS,
              max_features=10000):
    if dataset == "imdb":
        texts, labels, meta = load_imdb(n_per_class=n_per_class, seed=SEED)
    elif dataset == "agnews":
        texts, labels, meta = load_ag_news(n_per_class=n_per_class, seed=SEED)
    else:
        raise ValueError(f"unknown dataset {dataset!r}")

    print(f"\n{'='*78}\nSMOTE AUDIT - {meta['dataset']}\n{'='*78}")
    print(f"source              : {meta['source']}")
    print(f"documents           : {meta['n_documents']} "
          f"({meta['n_per_class']} per class)")
    print(f"class counts (full) : {meta['class_counts']}")
    print(f"corpus fingerprint  : sha256[:16]={meta['corpus_sha256_16']}")
    print(f"seed                : {SEED}")
    print(f"normalization       : lowercase, punctuation stripped, "
          f"lemmatization={use_lemmatization}")

    # SMOTE interpolates in feature space and therefore requires a dense
    # matrix. Unrestricted bigram TF-IDF on this corpus yields a vocabulary in
    # the hundreds of thousands, and densifying a 9,000 x 400,000 training fold
    # is not tractable (~29 GB per fold). The vocabulary is capped at
    # max_features, matching the max_features=10,000 used by the hand-coded
    # reference pipeline, so the two are directly comparable.
    settings = {"useTFIDF": True, "vectorSize": 100,
                "useLemmatization": use_lemmatization}
    print(f"max_features cap    : {max_features}")

    t0 = time.time()
    normalized = normalize_corpus(texts, settings)
    print(f"normalization time  : {time.time()-t0:.1f}s")

    y = np.asarray(labels)
    skf = StratifiedKFold(n_splits=n_folds, shuffle=True, random_state=SEED)

    fold_records = []
    scores = {k: [] for k in
              ("nb_plain", "nb_smote_multinomial", "nb_smote_gaussian",
               "lr_plain", "lr_smote", "knn_plain", "knn_smote")}

    for fold, (train_idx, test_idx) in enumerate(skf.split(normalized, y), start=1):
        tr_texts = [normalized[i] for i in train_idx]
        te_texts = [normalized[i] for i in test_idx]
        y_tr, y_te = y[train_idx], y[test_idx]

        # Vectorizer is fitted on the TRAINING fold only, then applied to test.
        from sklearn.feature_extraction.text import TfidfVectorizer
        vec = TfidfVectorizer(ngram_range=(1, 2), min_df=2,
                              max_features=max_features)
        X_tr = vec.fit_transform(tr_texts)
        X_te = vec.transform(te_texts)

        before = _class_counts(y_tr)

        # SMOTE is fitted on the training fold only; the test fold is never seen.
        smote = SMOTE(random_state=SEED, k_neighbors=5)
        X_tr_dense = X_tr.toarray()
        X_res, y_res = smote.fit_resample(X_tr_dense, y_tr)
        after = _class_counts(y_res)
        n_synth = int(len(y_res) - len(y_tr))

        X_te_dense = X_te.toarray()

        def ev(model, Xa, ya, Xb, yb):
            model.fit(Xa, ya)
            p = model.predict(Xb)
            return accuracy_score(yb, p), f1_score(yb, p, average="weighted")

        # Baseline: MultinomialNB, no resampling, sparse TF-IDF.
        a_nb, f_nb = ev(MultinomialNB(), X_tr, y_tr, X_te, y_te)
        # Corrected: MultinomialNB on the SMOTE output (still non-negative).
        a_nbm, f_nbm = ev(MultinomialNB(), X_res, y_res, X_te_dense, y_te)
        # GaussianNB in place of MultinomialNB, as the earlier implementation
        # did whenever SMOTE was enabled.
        a_nbg, f_nbg = ev(GaussianNB(), X_res, y_res, X_te_dense, y_te)

        lr_kw = dict(max_iter=1000, random_state=SEED)
        a_lr, f_lr = ev(LogisticRegression(**lr_kw), X_tr, y_tr, X_te, y_te)
        a_lrs, f_lrs = ev(LogisticRegression(**lr_kw), X_res, y_res, X_te_dense, y_te)
        a_kn, f_kn = ev(KNeighborsClassifier(n_neighbors=5), X_tr, y_tr, X_te, y_te)
        a_kns, f_kns = ev(KNeighborsClassifier(n_neighbors=5), X_res, y_res, X_te_dense, y_te)

        for k, v in [("nb_plain", a_nb), ("nb_smote_multinomial", a_nbm),
                     ("nb_smote_gaussian", a_nbg), ("lr_plain", a_lr),
                     ("lr_smote", a_lrs), ("knn_plain", a_kn), ("knn_smote", a_kns)]:
            scores[k].append(v)

        fold_records.append({
            "fold": fold,
            "n_train": int(len(y_tr)),
            "n_test": int(len(y_te)),
            "class_counts_before_smote": before,
            "class_counts_after_smote": after,
            "n_synthetic_generated": n_synth,
            "n_features": int(X_tr.shape[1]),
            "smote_fitted_on": "training fold only",
            "accuracy": {
                "NB_no_smote_MultinomialNB": round(a_nb, 4),
                "NB_smote_MultinomialNB": round(a_nbm, 4),
                "NB_smote_GaussianNB_substituted": round(a_nbg, 4),
                "LR_no_smote": round(a_lr, 4),
                "LR_smote": round(a_lrs, 4),
                "KNN_no_smote": round(a_kn, 4),
                "KNN_smote": round(a_kns, 4),
            },
            "f1_weighted": {
                "NB_no_smote_MultinomialNB": round(f_nb, 4),
                "NB_smote_MultinomialNB": round(f_nbm, 4),
                "NB_smote_GaussianNB_substituted": round(f_nbg, 4),
                "LR_no_smote": round(f_lr, 4), "LR_smote": round(f_lrs, 4),
                "KNN_no_smote": round(f_kn, 4), "KNN_smote": round(f_kns, 4),
            },
        })

        print(f"fold {fold:2d}: train={len(y_tr):5d} before={before} "
              f"after={after} synthetic=+{n_synth}")

    # ---- Summary ----
    print(f"\n{'-'*78}")
    print("PER-FOLD SYNTHETIC SAMPLE COUNT: "
          f"{[r['n_synthetic_generated'] for r in fold_records]}")
    print(f"{'-'*78}")
    hdr = f"{'configuration':<42}{'accuracy (mean ± std)':>26}"
    print(hdr); print("-" * 78)
    summary = {}
    rows = [
        ("NB  TF-IDF, no SMOTE       (MultinomialNB)", "nb_plain"),
        ("NB  TF-IDF + SMOTE         (MultinomialNB)", "nb_smote_multinomial"),
        ("NB  TF-IDF + SMOTE         (GaussianNB substituted)", "nb_smote_gaussian"),
        ("LR  TF-IDF, no SMOTE", "lr_plain"),
        ("LR  TF-IDF + SMOTE", "lr_smote"),
        ("KNN TF-IDF, no SMOTE", "knn_plain"),
        ("KNN TF-IDF + SMOTE", "knn_smote"),
    ]
    for label, key in rows:
        arr = np.array(scores[key])
        summary[key] = {"mean": float(arr.mean()), "std": float(arr.std(ddof=1)),
                        "per_fold": [float(x) for x in arr]}
        print(f"{label:<42}{arr.mean():>14.4f} ± {arr.std(ddof=1):.4f}")

    total_synth = sum(r["n_synthetic_generated"] for r in fold_records)
    print("-" * 78)
    print(f"\nCONCLUSION")
    print(f"Total synthetic observations generated across all "
          f"{n_folds} folds: {total_synth}")
    if total_synth == 0:
        print("SMOTE was a no-op on every fold: the training folds are already")
        print("balanced, so sampling_strategy='auto' has nothing to resample.")
        print("Any difference between the 'no SMOTE' and '+ SMOTE' rows above")
        print("therefore cannot be caused by SMOTE.")
        d_mult = summary["nb_smote_multinomial"]["mean"] - summary["nb_plain"]["mean"]
        d_gauss = summary["nb_smote_gaussian"]["mean"] - summary["nb_plain"]["mean"]
        print(f"\n  NB delta with MultinomialNB kept    : {d_mult:+.4f}")
        print(f"NB delta with GaussianNB substituted: {d_gauss:+.4f}")
        print("The reported degradation is entirely attributable to the")
        print("classifier substitution, not to resampling.")

    result = {
        "dataset_meta": meta,
        "configuration": {
            "n_folds": n_folds,
            "cv": "StratifiedKFold(shuffle=True, random_state=42)",
            "seed": SEED,
            "feature_extraction": f"TfidfVectorizer(ngram_range=(1,2), "
                                  f"min_df=2, max_features={max_features})",
            "normalization": {"lowercase": True, "strip_punctuation": True,
                              "lemmatization": use_lemmatization},
            "smote_params": {"random_state": SEED, "k_neighbors": 5,
                             "sampling_strategy": "auto",
                             "implementation": "imblearn.over_sampling.SMOTE"},
            "resampling_stage": "after train/test split and after vectorizer "
                                "fitted on the training fold; applied to the "
                                "training fold only",
            "nb_implementations": {
                "baseline": "sklearn.naive_bayes.MultinomialNB(alpha=1.0, fit_prior=True)",
                "substituted_under_smote": "sklearn.naive_bayes.GaussianNB(var_smoothing=1e-9)",
            },
            "lr_params": "LogisticRegression(max_iter=1000, random_state=42)",
            "knn_params": "KNeighborsClassifier(n_neighbors=5)",
        },
        "folds": fold_records,
        "summary": summary,
        "total_synthetic_samples": total_synth,
    }

    os.makedirs(RESULTS_DIR, exist_ok=True)
    # max_features is part of the identity of a run: the GaussianNB penalty
    # grows with vocabulary size, so runs at different caps must not overwrite
    # each other.
    out = os.path.join(
        RESULTS_DIR, f"smote_audit_{dataset}_maxfeat{max_features}_"
                     f"{n_folds}folds.json"
    )
    with open(out, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\n  Full per-fold record written to {out}")
    return result


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["imdb", "agnews"], default="imdb")
    ap.add_argument("--n-per-class", type=int, default=None)
    ap.add_argument("--folds", type=int, default=N_FOLDS)
    ap.add_argument("--no-lemmatization", action="store_true")
    ap.add_argument("--max-features", type=int, default=10000)
    args = ap.parse_args()

    n_per_class = args.n_per_class or (5000 if args.dataset == "imdb" else 2500)
    run_audit(args.dataset, n_per_class, not args.no_lemmatization, args.folds,
              max_features=args.max_features)


if __name__ == "__main__":
    main()

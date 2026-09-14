"""
Single-label benchmark for the IMDb and AG News tables.

Evaluates every model under each feature representation the platform allows,
with one shared set of cross-validation folds so that all comparisons are
paired.

Model and feature combinations follow the platform's own constraints:

  - MultinomialNB requires non-negative counts, so TF and TF-IDF only.
  - Gaussian Discriminant Analysis estimates a covariance matrix per class and
    requires dense continuous features, so Word2Vec only.
  - Logistic Regression, KNN and SVM accept all three.

Two deliberate departures from the platform's defaults, both of which leave the
reported numbers unchanged:

  - The vocabulary is capped at --max-features (default 10,000). The platform
    defaults to the full fitted vocabulary, which is not tractable for the
    dense operations some models need.
  - SVC is fitted with probability=False. With probability=True scikit-learn
    fits additional internal cross-validation models to calibrate
    probabilities. It does not affect predicted labels, and Platt calibration
    is monotonic in the decision function, so accuracy, F1 and AUC are all
    identical while the fit is several times faster. AUC is computed from the
    decision function.

Statistical comparisons are planned contrasts rather than tests against a
single baseline:

  - TF against TF-IDF within each algorithm.
  - Each algorithm against every other under a fixed representation.

Each contrast uses the Nadeau and Bengio corrected resampled t-test, which
accounts for the training-set overlap between folds, with Holm correction
applied across the family of tests and Cohen's dz reported as effect size.

Usage:
    python -m experiments.run_benchmarks --dataset imdb
    python -m experiments.run_benchmarks --dataset agnews
    python -m experiments.run_benchmarks --dataset both
"""
import argparse
import json
import os
import sys
import time
import warnings
from itertools import combinations

import numpy as np
from sklearn.discriminant_analysis import QuadraticDiscriminantAnalysis
from sklearn.feature_extraction.text import CountVectorizer, TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, roc_auc_score
)
from sklearn.model_selection import StratifiedKFold
from sklearn.naive_bayes import MultinomialNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from experiments.datasets import load_imdb, load_ag_news          # noqa: E402
from experiments.stats import (                                    # noqa: E402
    corrected_resampled_ttest, cohens_dz, holm_bonferroni
)
from services.preprocessing import (                               # noqa: E402
    normalize_corpus, Word2VecDocVectorizer
)

warnings.filterwarnings("ignore")

RESULTS_DIR = os.path.join(os.path.dirname(__file__), "results")
SEED = 42
N_FOLDS = 10

FEATURES = ("tfidf", "tf", "word2vec")
MODEL_FEATURES = {
    "NB":  ("tfidf", "tf"),
    "LR":  ("tfidf", "tf", "word2vec"),
    "KNN": ("tfidf", "tf", "word2vec"),
    "SVM": ("tfidf", "tf", "word2vec"),
    "GDA": ("word2vec",),
}


def build_model(name):
    if name == "NB":
        return MultinomialNB()
    if name == "LR":
        return LogisticRegression(max_iter=1000, random_state=SEED)
    if name == "KNN":
        return KNeighborsClassifier(n_neighbors=5)
    if name == "SVM":
        return SVC(kernel="linear", random_state=SEED)
    if name == "GDA":
        return QuadraticDiscriminantAnalysis()
    raise ValueError(name)


def fold_features(kind, train_texts, test_texts, max_features):
    """Fit the representation on the training fold only, transform both."""
    if kind == "tfidf":
        v = TfidfVectorizer(ngram_range=(1, 2), min_df=2, max_features=max_features)
        return v.fit_transform(train_texts), v.transform(test_texts)
    if kind == "tf":
        v = CountVectorizer(ngram_range=(1, 2), min_df=2, max_features=max_features)
        return v.fit_transform(train_texts), v.transform(test_texts)
    if kind == "word2vec":
        v = Word2VecDocVectorizer(vector_size=100, seed=SEED)
        return v.fit_transform(train_texts), v.transform(test_texts)
    raise ValueError(kind)


def score(model_name, X_tr, y_tr, X_te, y_te, binary_positive):
    """Fit, predict, and return the metrics the tables report."""
    model = build_model(model_name)
    model.fit(X_tr, y_tr)
    pred = model.predict(X_te)

    acc = accuracy_score(y_te, pred)
    p, r, f1, _ = precision_recall_fscore_support(
        y_te, pred, average="weighted", zero_division=0)

    auc = None
    if binary_positive is not None:
        y_bin = (np.asarray(y_te) == binary_positive).astype(int)
        try:
            if hasattr(model, "predict_proba"):
                classes = list(model.classes_)
                auc = roc_auc_score(
                    y_bin, model.predict_proba(X_te)[:, classes.index(binary_positive)])
            else:
                # Monotonic in the calibrated probability, so the AUC matches.
                auc = roc_auc_score(y_bin, model.decision_function(X_te))
        except Exception:
            auc = None

    return {"accuracy": float(acc), "precision_weighted": float(p),
            "recall_weighted": float(r), "f1_weighted": float(f1),
            "auc": None if auc is None else float(auc)}


def run_dataset(name, n_per_class, max_features, n_folds, lemmatize):
    if name == "imdb":
        texts, labels, meta = load_imdb(n_per_class=n_per_class, seed=SEED)
        binary_positive = "pos"
    elif name == "agnews":
        texts, labels, meta = load_ag_news(n_per_class=n_per_class, seed=SEED)
        binary_positive = None
    else:
        raise ValueError(name)

    print(f"\n{'=' * 78}\n{meta['dataset']}: {meta['n_documents']} documents, "
          f"fingerprint {meta['corpus_sha256_16']}\n{'=' * 78}")

    t0 = time.time()
    corpus = normalize_corpus(texts, {"useLemmatization": lemmatize})
    print(f"normalization (lemmatization={lemmatize}): {time.time() - t0:.0f}s")

    y = np.asarray(labels)
    folds = list(StratifiedKFold(n_splits=n_folds, shuffle=True,
                                 random_state=SEED).split(corpus, y))
    n_train, n_test = len(folds[0][0]), len(folds[0][1])
    print(f"folds: {n_folds} | train {n_train} | test {n_test} | "
          f"max_features {max_features}")

    # per_fold[(model, feature)] = list of metric dicts
    per_fold = {}
    for fi, (tr, te) in enumerate(folds, 1):
        tr_texts = [corpus[i] for i in tr]
        te_texts = [corpus[i] for i in te]
        for feat in FEATURES:
            ft = time.time()
            X_tr, X_te = fold_features(feat, tr_texts, te_texts, max_features)
            for model_name, allowed in MODEL_FEATURES.items():
                if feat not in allowed:
                    continue
                s = score(model_name, X_tr, y[tr], X_te, y[te], binary_positive)
                per_fold.setdefault((model_name, feat), []).append(s)
            print(f"  fold {fi:2d} {feat:<9} {time.time() - ft:6.1f}s", flush=True)

    summary = {}
    for (model_name, feat), runs in per_fold.items():
        row = {}
        for metric in runs[0]:
            vals = [r[metric] for r in runs if r[metric] is not None]
            row[metric] = ({"mean": float(np.mean(vals)),
                            "std": float(np.std(vals, ddof=1)),
                            "per_fold": [float(v) for v in vals]}
                           if vals else None)
        summary[f"{model_name}+{feat}"] = row

    print(f"\n{'configuration':<18}{'accuracy':>20}{'F1 (weighted)':>16}{'AUC':>9}")
    print("-" * 78)
    for key in sorted(summary):
        a, f1 = summary[key]["accuracy"], summary[key]["f1_weighted"]
        auc = summary[key]["auc"]
        auc_txt = f"{auc['mean']:.4f}" if auc else "n/a"
        print(f"{key:<18}{a['mean']:>12.4f} +/- {a['std']:.4f}"
              f"{f1['mean']:>16.4f}{auc_txt:>9}")

    contrasts = planned_contrasts(summary, n_train, n_test)
    result = {"dataset_meta": meta,
              "configuration": {
                  "n_folds": n_folds, "seed": SEED,
                  "cv": f"StratifiedKFold(n_splits={n_folds}, shuffle=True, "
                        f"random_state={SEED})",
                  "n_train_per_fold": int(n_train), "n_test_per_fold": int(n_test),
                  "max_features": max_features, "lemmatization": lemmatize,
                  "vectorizers": "ngram_range=(1,2), min_df=2",
                  "word2vec": "gensim, vector_size=100, window=5, min_count=2, "
                              "epochs=10, sg=0, workers=1, mean-pooled",
                  "models": {
                      "NB": "MultinomialNB(alpha=1.0)",
                      "LR": f"LogisticRegression(max_iter=1000, random_state={SEED})",
                      "KNN": "KNeighborsClassifier(n_neighbors=5)",
                      "SVM": f"SVC(kernel='linear', probability=False, random_state={SEED})",
                      "GDA": "QuadraticDiscriminantAnalysis()",
                  },
                  "auc": "from predict_proba, or the decision function for SVM",
              },
              "summary": summary,
              "planned_contrasts": contrasts}

    os.makedirs(RESULTS_DIR, exist_ok=True)
    path = os.path.join(RESULTS_DIR, f"benchmark_{name}.json")
    with open(path, "w") as fh:
        json.dump(result, fh, indent=2)
    print(f"\nwritten to {path}")
    return result


def planned_contrasts(summary, n_train, n_test, metric="f1_weighted"):
    """
    TF against TF-IDF within each algorithm, and every pair of algorithms
    under a fixed representation. Holm correction across the whole family.
    """
    tests = []

    for model_name, allowed in MODEL_FEATURES.items():
        if "tf" in allowed and "tfidf" in allowed:
            a, b = f"{model_name}+tf", f"{model_name}+tfidf"
            if a in summary and b in summary:
                tests.append(("representation", a, b))

    for feat in FEATURES:
        models = sorted(m for m, al in MODEL_FEATURES.items()
                        if feat in al and f"{m}+{feat}" in summary)
        for m1, m2 in combinations(models, 2):
            tests.append(("algorithm", f"{m1}+{feat}", f"{m2}+{feat}"))

    out = []
    for kind, a, b in tests:
        va = summary[a][metric]["per_fold"]
        vb = summary[b][metric]["per_fold"]
        t = corrected_resampled_ttest(va, vb, n_train, n_test)
        out.append({"family": kind, "a": a, "b": b, "metric": metric,
                    "mean_a": summary[a][metric]["mean"],
                    "mean_b": summary[b][metric]["mean"],
                    "mean_difference": t["mean_difference"],
                    "t": t["t"], "p_uncorrected": t["p"],
                    "cohens_dz": cohens_dz(va, vb)})

    if out:
        holm = holm_bonferroni([o["p_uncorrected"] for o in out])
        for o, adj, rej in zip(out, holm["adjusted_p"], holm["reject"]):
            o["p_holm"] = adj
            o["significant_after_holm"] = bool(rej)

    print(f"\nplanned contrasts on {metric} "
          f"({len(out)} tests, Holm corrected)")
    print("-" * 78)
    for o in sorted(out, key=lambda x: x["p_holm"]):
        mark = "*" if o["significant_after_holm"] else " "
        print(f" {mark} {o['a']:<16} vs {o['b']:<16} "
              f"diff={o['mean_difference']:+.4f} dz={o['cohens_dz']:+.2f} "
              f"p={o['p_uncorrected']:.4f} p_holm={o['p_holm']:.4f}")
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", choices=["imdb", "agnews", "both"], default="both")
    ap.add_argument("--imdb-per-class", type=int, default=5000)
    ap.add_argument("--agnews-per-class", type=int, default=2500)
    ap.add_argument("--max-features", type=int, default=10000)
    ap.add_argument("--folds", type=int, default=N_FOLDS)
    ap.add_argument("--no-lemmatization", action="store_true")
    args = ap.parse_args()

    names = ["imdb", "agnews"] if args.dataset == "both" else [args.dataset]
    for name in names:
        n = args.imdb_per_class if name == "imdb" else args.agnews_per_class
        run_dataset(name, n, args.max_features, args.folds,
                    not args.no_lemmatization)


if __name__ == "__main__":
    main()

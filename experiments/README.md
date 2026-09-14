# TextFlow - reproducibility package

Scripts that reproduce every table and statistical test reported for TextFlow.
They exercise the same `services/preprocessing.py` code path the platform uses,
so a result here is a result the platform produces.

## Install

```bash
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements-experiments.txt
```

## Data

| Dataset | Source | Retrieval |
|---|---|---|
| IMDb | Maas et al. (2011), `stanfordnlp/imdb` | automatic |
| AG News | Zhang et al. (2015), `fancyzhx/ag_news` | automatic |
| CODE-ACCORD | [Zenodo 10210022](https://zenodo.org/records/10210022) | manual -> `experiments/data/code_accord.csv` |

Canonical sources are used rather than third-party Kaggle mirrors. Every
subsample is stratified and seeded (`seed=42`); `experiments/datasets.py`
records the selected document indices and a SHA-256 fingerprint of the
resulting corpus in each result file, so a rerun can be proven identical.

## Which script produces which table

| Reported in the paper | Script |
|---|---|
| Table 2, IMDb classification performance | `run_benchmarks.py --dataset imdb` |
| Table 3, AG News classification performance | `run_benchmarks.py --dataset agnews` |
| Table 4, CODE-ACCORD multi-label performance | `run_multilabel.py` |
| Table 5, transformer performance and cost | `transformer_benchmark.py` |
| Table 6, implementation fidelity | `fidelity.py` |
| SMOTE audit reported in the discussion | `smote_audit.py` |

Table 1 is a literature comparison and Table 7 reports corpus metrics produced
by the platform itself, so neither has a script here.

## Scripts

### `run_benchmarks.py` - single-label and multi-class benchmarks

```bash
python -m experiments.run_benchmarks --dataset both
```

Evaluates every model and feature representation the platform permits, under
stratified 10-fold cross-validation, and reports accuracy, weighted precision,
recall and F1, with AUC-ROC for the binary task. The vocabulary is capped at
`--max-features` (default 10,000). The cap binds on both corpora: the uncapped
training vocabulary is 193,519 terms for IMDb and 49,391 for AG News, so TF and
TF-IDF both yield 10,000 features, while Word2Vec is 100 dimensions by
construction. These are the feature vector sizes reported in the tables.

### `run_multilabel.py` - multi-label benchmark

```bash
python -m experiments.run_multilabel
```

Derives the multi-label target from the CODE-ACCORD relation annotations, one
binary indicator per relation type excluding `none`, keeping the 856 sentences
that carry at least one label. Nine labels result. Classification is binary
relevance over the platform's models, evaluated with iterative stratification
so that rare labels appear in every fold; ordinary k-fold leaves several folds
without them. Reports Hamming loss, F1-macro, F1-micro, exact match and
per-label precision, recall and F1, against a stratified random baseline. This
corpus is small enough that its vocabulary falls below the cap, so the feature
vector size is the vocabulary itself, a mean of 3,569 features across folds
(range 3,527 to 3,617).

The derived dataset is committed at `experiments/data/code_accord_multilabel.csv`
so the multi-label results can be reproduced without repeating the derivation.

### `transformer_benchmark.py` - transformer fine-tuning

```bash
python experiments/transformer_benchmark.py
```

Fine-tunes each BERT variant the platform exposes and records classification
performance alongside training time, inference time, seconds per optimizer step
and peak memory. It uses a single seeded stratified 80/20 split rather than
10-fold cross-validation, because 10-fold over all four variants on both
datasets is roughly a 70 hour run. The script is standalone and runs on a GPU
runtime; the reported figures were measured on one NVIDIA T4.

### `smote_audit.py` - SMOTE implementation audit

```bash
python -m experiments.smote_audit --dataset imdb
python -m experiments.smote_audit --dataset agnews
```

Reports, per fold: class counts before and after SMOTE, the number of synthetic
observations generated, the exact SMOTE parameters, the resampling stage, and
confirmation that SMOTE is fitted on the training fold only. It evaluates
Naive Bayes three ways - no SMOTE (MultinomialNB), SMOTE with MultinomialNB
kept, and SMOTE with GaussianNB substituted - so the effect of resampling and
the effect of the classifier substitution can be separated.

### `fidelity.py` - implementation fidelity and equivalence

```bash
python -m experiments.fidelity --margin 0.01
```

Runs two separate experiments: strict fidelity (identical preprocessing in both
pipelines) and preprocessing robustness (TextFlow lemmatized, reference not).
Each is analysed with an uncorrected paired t-test, the Nadeau & Bengio
corrected resampled t-test, and TOST equivalence testing against a
pre-specified margin, with confidence intervals.

### `stats.py`

Statistical procedures: `tost_paired`, `corrected_resampled_ttest`,
`paired_ttest`, `cohens_dz`, `holm_bonferroni`.

## Notes on configuration

**Vocabulary cap.** SMOTE interpolates in feature space and requires a dense
matrix. Unrestricted bigram TF-IDF on these corpora yields a vocabulary in the
hundreds of thousands; densifying a 9,000 x 400,000 training fold needs roughly
29 GB. The audit therefore caps the vocabulary at `--max-features` (default
10,000), matching the hand-coded reference pipeline so the two are directly
comparable.

**Determinism.** `seed=42` throughout: subsampling, `StratifiedKFold(shuffle=True)`,
`SMOTE(random_state=...)`, and every classifier that accepts a seed. Word2Vec is
trained with `workers=1`, which is the only configuration in which gensim is
reproducible.

## Results

Each script writes a JSON record to `experiments/results/` containing the full
configuration, per-fold values, and dataset fingerprint.

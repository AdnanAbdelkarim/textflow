# TextFlow - No-Code NLP Platform

A visualization-first, no-code web platform for end-to-end NLP on labeled and
unlabeled text datasets. **Flask** backend, **vanilla JavaScript** frontend
(no build step), **Chart.js** and **D3.js** for visualization.

> Supervised by **Dr. Uzair Ahmad** | Designed and implemented by **Adnan Abdelkarim**

---

## Quick start

### Docker (recommended)

Requires Docker: Docker Desktop on Windows and macOS, or Docker Engine on Linux.

```bash
git clone https://github.com/AdnanAbdelkarim/textflow.git
cd textflow
docker compose up --build
```

Open `http://localhost:5000`. The first build downloads the dependencies and
language models and takes several minutes; later starts take seconds. The image
includes the spaCy models and NLTK corpora, so nothing is downloaded at request
time, and installs PyTorch from its CPU-only index, so it contains no CUDA
libraries.

If port 5000 is already in use (on macOS, AirPlay Receiver takes it), choose
another port:

```bash
TEXTFLOW_PORT=8080 docker compose up --build
```

On Windows PowerShell, set the variable first with `$env:TEXTFLOW_PORT=8080`.
Stop the platform with `docker compose down`.

Give Docker at least 4 GB of memory. Measured in the container after a full pass
through every feature, usage settles at about 1.8 GB, of which about 1.5 GB is
the worker holding the transformer NER model. Each of the two gunicorn workers
loads that model on its first NER request. Fine-tuning full BERT-base adds
AdamW optimizer state for 110M parameters, about 1.8 GB, so allow 6 GB if you
intend to use it.

Any Docker engine works. On macOS without Docker Desktop, Colima provides one:

```bash
brew install colima docker docker-compose
colima start --cpu 4 --memory 4
```

### Local

Requires Python 3.11.

```bash
git clone https://github.com/AdnanAbdelkarim/textflow.git
cd textflow
python3.11 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip setuptools wheel
pip install -r requirements.txt
python main.py
```

On Windows, activate the environment with `.venv\Scripts\activate` instead.
Open `http://localhost:5000`, or set `TEXTFLOW_PORT` to use another port.

The first NER request loads
`en_core_web_trf` and can take upwards of a minute on CPU; every later request
uses the cached model.

---

## Features

### Data input and auto-detection

| Type | Supported formats |
|---|---|
| Labeled | CSV (text + single categorical label), CSV (multiple binary label columns + text), TXT (tab-separated multi-label), XLSX |
| Unlabeled | CSV, TXT, DOCX, PDF, XLSX |

A label column is detected from low cardinality relative to row count, short
values, and column-name hints (`label`, `class`, `category`, `target`,
`sentiment`, `topic`, `tag`, `y`). String class names are supported; they are
encoded to indices internally and mapped back for display.

Label-dependent features (Label Distribution, Class Overlap, Preprocessing,
Predictive Modeling) show an informational message for unlabeled data.

DOCX/PDF text is extracted in the browser (mammoth / pdf.js), capped at 5,000
rows, and stored as a synthetic CSV.

### Exploratory analysis

Word cloud | keyword co-occurrence network (D3) | Zipf's law plot | vocabulary
coverage | label distribution | class overlap | corpus statistics (token count,
vocabulary size, mean AFINN valence, type-token ratio).

### Advanced NLP analysis

- **Sentiment** - AFINN lexicon, sentence level
- **NER** - spaCy (`en_core_web_trf`) and NLTK `ne_chunk`, selectable and comparable
- **Topic modeling** - LDA (`scikit-learn`), `random_state=0`, up to 20 topics
- **N-gram exploration** - unigrams/bigrams/trigrams, ranked table and bar chart, optional per-class breakdown and stopword toggle
- **Text classification analysis** - class-specific vocabulary and frequency ratios

### Preprocessing

All preprocessing runs server-side through `services/preprocessing.py`, so the
preview on the Preprocessing tab is produced by the same code that trains the
model.

- Normalization: lowercasing, punctuation removal, optional stopword removal
- **Stemming** - `nltk.stem.PorterStemmer`
- **Lemmatization** - spaCy `en_core_web_sm`, batched (mutually exclusive with stemming)
- **Feature extraction** - TF (`CountVectorizer`), TF-IDF (`TfidfVectorizer`), Word2Vec (`gensim`, mean-pooled document vectors)
- **Class imbalance** - SMOTE, random over/undersampling (`imbalanced-learn`)

Resampling is applied to the training partition only, and reports class counts
before and after plus the number of synthetic samples generated. If a resampler
is selected but generates nothing - SMOTE on an already-balanced dataset - the
interface says so explicitly.

### Predictive modeling

**Traditional ML** (scikit-learn): Naive Bayes (`MultinomialNB`), Logistic
Regression, KNN, SVM (linear), Gaussian Discriminant Analysis
(`QuadraticDiscriminantAnalysis`).

Model availability follows a real constraint, enforced in the backend:

| Feature extraction | Available models |
|---|---|
| TF / TF-IDF | Naive Bayes, Logistic Regression, SVM, KNN |
| Word2Vec | GDA, Logistic Regression, SVM, KNN |

`MultinomialNB` requires non-negative count-based features, so it cannot consume
Word2Vec embeddings; GDA estimates a per-class covariance matrix and requires
dense continuous features, so it cannot consume sparse TF/TF-IDF. An
out-of-contract request returns a 400 explaining the constraint.

**Transformers** (Hugging Face): BERT-Tiny (`prajjwal1/bert-tiny`), BERT-Small
(`prajjwal1/bert-small`), DistilBERT (`distilbert-base-uncased`), BERT
(`bert-base-uncased`). Available with any feature-extraction setting, since they
tokenize raw text with their own subword tokenizer and bypass the vectorizer.
Progress streams over Server-Sent Events.

Default fine-tuning hyperparameters (all client-overridable, all reported back
with the result): learning rate 5e-5, 3 epochs, batch size 8, max sequence
length 128, weight decay 0.01, warmup 10% of total optimizer steps, optimizer
`adamw_torch`, seed 42.

**Metrics**: accuracy, weighted precision/recall/F1, per-class classification
report, confusion matrix, ROC/AUC, misclassified document inspection.

### Leakage control

1. Split raw texts into train/test
2. Fit the vectorizer on the training partition only
3. Transform the test partition with the training vectorizer
4. Resample the training partition only

---

## Language support

English only. AFINN, the Porter stemmer, the bundled stopword list, the spaCy
pipelines, and the four BERT variants are all English-oriented. "General
purpose" here means no subject-matter restriction, not multilingual support.

## Deployment and data handling

`main.py` runs Flask's development server; the Docker image serves the app under
gunicorn. There is no authentication and no server-side persistence: uploaded
datasets live in the browser's `sessionStorage` and are posted to the backend
per request. The backend keeps only a short-lived in-process cache
(`services/cache.py`, 15-30 minute TTL) keyed by session id. Nothing is written
to disk, and no user data leaves the machine the server runs on.

---

## Project structure

```
main.py                     Flask entry point, page routes, blueprint registration
requirements.txt            Runtime dependencies
Dockerfile / docker-compose.yml
routes/
  nlp.py                    NER, sentiment, topic modeling
  predictive.py             Preprocessing preview, ML prediction, transformer SSE
  visualizations.py         Word frequency, co-occurrence, coverage, Zipf, n-grams
services/
  preprocessing.py          Normalize -> vectorize -> resample
  tokenization.py           Tokenizer and stopword list
  topic_labels.py           Topic auto-labelling
  cache.py                  Per-session in-process cache
  nltk_setup.py             NLTK data, spaCy NER and lemmatizer loaders
static/js/
  core/                     api, fileHandler, state, sessionCache, utils, debug
  nlp/                      ner, sentiment, topicModeling, ngrams
  pages/                    overview, visualizations, advanced
  ui/                       tabs, classification, forms
  visualizations/           wordCloud, keywordNetwork, classOverlap,
                            labelDistribution, pieChart, vocabCoverage, zipf
  preprocessing.js, predictive.js, script.js
templates/                  index, overview, visualizations, advanced,
                            preprocessing, predictive
```

---

## Academic context

- **Dr. Uzair Ahmad** - Author & Supervisor
- **Adnan Abdelkarim** - AI Engineer & Author

Special thanks to Dr. Uzair Ahmad for his supervision and guidance throughout
this project.

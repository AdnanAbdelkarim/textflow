"""
Preprocessing pipeline: normalization -> feature extraction -> (train-only) resampling.

Implementations used at each stage:

  - Stemming        : nltk.stem.PorterStemmer
  - Lemmatization   : spaCy lemmatizer (en_core_web_sm), batched via nlp.pipe
  - TF / TF-IDF     : scikit-learn CountVectorizer / TfidfVectorizer
  - Word2Vec        : gensim Word2Vec, mean-pooled into document vectors
  - SMOTE / ROS/RUS : imbalanced-learn

Resampling is applied to the training partition only; see `preprocess_pipeline`.
"""
import logging
import re

import numpy as np
from imblearn.over_sampling import SMOTE, RandomOverSampler
from imblearn.under_sampling import RandomUnderSampler
from sklearn.feature_extraction.text import TfidfVectorizer, CountVectorizer
from sklearn.preprocessing import StandardScaler

from services.tokenization import STOPWORDS

logger = logging.getLogger(__name__)

_PUNCT_RE = re.compile(r"[^\w\s]")
_WS_RE = re.compile(r"\s+")

# Documents are lemmatized in batches through spaCy; this bounds peak memory.
_SPACY_BATCH_SIZE = 200


# --------------------------------------------------------------------------
# Normalization
# --------------------------------------------------------------------------

def _basic_clean(text):
    """Lowercase, strip punctuation, collapse whitespace."""
    text = str(text).lower()
    text = _PUNCT_RE.sub(" ", text)
    return _WS_RE.sub(" ", text).strip()


def _strip_stopwords(tokens):
    return [t for t in tokens if t not in STOPWORDS]


def normalize_corpus(texts, settings):
    """
    Normalize a corpus of documents.

    Order: lowercase -> strip punctuation -> optional stopword removal ->
    optional stemming XOR lemmatization.

    Stemming and lemmatization are mutually exclusive; if both flags are set,
    lemmatization wins and a warning is logged (the UI enforces exclusivity,
    this is the backend guard).

    Args:
        texts: iterable of raw document strings
        settings: dict with useStemming / useLemmatization / removeStopwords

    Returns:
        list of normalized document strings
    """
    use_stemming = bool(settings.get("useStemming"))
    use_lemmatization = bool(settings.get("useLemmatization"))
    remove_stopwords = bool(settings.get("removeStopwords"))

    if use_stemming and use_lemmatization:
        logger.warning(
            "Both useStemming and useLemmatization set; applying lemmatization only."
        )
        use_stemming = False

    cleaned = [_basic_clean(t) for t in texts]

    if use_lemmatization:
        return _lemmatize_corpus(cleaned, remove_stopwords)

    out = []
    stemmer = _get_porter_stemmer() if use_stemming else None
    for doc in cleaned:
        tokens = doc.split()
        if remove_stopwords:
            tokens = _strip_stopwords(tokens)
        if stemmer is not None:
            tokens = [stemmer.stem(t) for t in tokens]
        out.append(" ".join(tokens))
    return out


def _get_porter_stemmer():
    from nltk.stem import PorterStemmer
    return PorterStemmer()


def _lemmatize_corpus(cleaned_texts, remove_stopwords):
    """Lemmatize with spaCy. Falls back to the unlemmatized text if unavailable."""
    from services.nltk_setup import get_lemmatizer

    nlp = get_lemmatizer()
    if nlp is None:
        logger.warning("No spaCy lemmatizer available; returning unlemmatized text.")
        if not remove_stopwords:
            return list(cleaned_texts)
        return [" ".join(_strip_stopwords(t.split())) for t in cleaned_texts]

    out = []
    for doc in nlp.pipe(cleaned_texts, batch_size=_SPACY_BATCH_SIZE):
        tokens = [tok.lemma_.strip().lower() for tok in doc if not tok.is_space]
        tokens = [t for t in tokens if t]
        if remove_stopwords:
            tokens = _strip_stopwords(tokens)
        out.append(" ".join(tokens))
    return out


# Kept for callers that normalize a single document.
def normalize_text(text, settings):
    """Normalize one document. Prefer `normalize_corpus` for batches."""
    return normalize_corpus([text], settings)[0]


# --------------------------------------------------------------------------
# Feature extraction
# --------------------------------------------------------------------------

def _max_features_from_percent(texts, settings, vectorizer_cls):
    """Translate the UI's vocabulary-percentage slider into a max_features count."""
    percent = float(settings.get("vectorSize", 100))
    percent = min(100.0, max(1.0, percent))
    probe = vectorizer_cls()
    probe.fit(texts)
    vocab_size = len(probe.vocabulary_)
    return max(10, int(vocab_size * (percent / 100.0)))


def extract_tfidf_features(texts, settings, vectorizer=None):
    """TF-IDF features. Fits when `vectorizer` is None, else transform-only."""
    if vectorizer is None:
        vectorizer = TfidfVectorizer(
            max_features=_max_features_from_percent(texts, settings, TfidfVectorizer),
            ngram_range=(1, 2),
            min_df=2,
        )
        return vectorizer.fit_transform(texts), vectorizer
    return vectorizer.transform(texts), vectorizer


def extract_tf_features(texts, settings, vectorizer=None):
    """Term-frequency features. Fits when `vectorizer` is None, else transform-only."""
    if vectorizer is None:
        vectorizer = CountVectorizer(
            max_features=_max_features_from_percent(texts, settings, CountVectorizer),
            ngram_range=(1, 2),
            min_df=2,
        )
        return vectorizer.fit_transform(texts), vectorizer
    return vectorizer.transform(texts), vectorizer


class Word2VecDocVectorizer:
    """
    Document vectorizer backed by a gensim Word2Vec model.

    A document vector is the mean of the vectors of its in-vocabulary tokens;
    documents with no in-vocabulary token map to the zero vector. Mean pooling
    is used because it is the standard baseline aggregation for Word2Vec
    document representations and keeps the vector dimensionality equal to the
    configured embedding size.
    """

    def __init__(self, vector_size=100, window=5, min_count=2, epochs=10,
                 sg=0, workers=1, seed=42):
        self.vector_size = int(vector_size)
        self.window = int(window)
        self.min_count = int(min_count)
        self.epochs = int(epochs)
        self.sg = int(sg)
        self.workers = int(workers)
        self.seed = int(seed)
        self.model = None

    @staticmethod
    def _tokenize(texts):
        return [t.split() for t in texts]

    def fit(self, texts):
        from gensim.models import Word2Vec

        tokenized = self._tokenize(texts)
        self.model = Word2Vec(
            sentences=tokenized,
            vector_size=self.vector_size,
            window=self.window,
            min_count=self.min_count,
            epochs=self.epochs,
            sg=self.sg,
            # workers=1 + fixed seed makes training deterministic; gensim is
            # only reproducible single-threaded.
            workers=self.workers,
            seed=self.seed,
        )
        return self

    def transform(self, texts):
        if self.model is None:
            raise ValueError("Word2VecDocVectorizer must be fitted before transform().")
        kv = self.model.wv
        out = np.zeros((len(texts), self.vector_size), dtype=np.float32)
        for i, doc in enumerate(self._tokenize(texts)):
            vectors = [kv[tok] for tok in doc if tok in kv]
            if vectors:
                out[i] = np.mean(vectors, axis=0)
        return out

    def fit_transform(self, texts):
        return self.fit(texts).transform(texts)

    @property
    def vocabulary_(self):
        """Mirrors the scikit-learn vectorizer attribute so callers can size the vocab."""
        if self.model is None:
            return {}
        return self.model.wv.key_to_index


def extract_word2vec_features(texts, settings, model=None):
    """Word2Vec document features. Trains when `model` is None, else transform-only."""
    if model is None:
        model = Word2VecDocVectorizer(
            vector_size=int(settings.get("vectorSize", 100)),
            seed=int(settings.get("randomState", 42)),
        )
        return model.fit_transform(texts), model
    return model.transform(texts), model


# --------------------------------------------------------------------------
# Resampling
# --------------------------------------------------------------------------

def apply_resampling(X, labels, settings, random_state=42):
    """
    Resample a TRAINING partition. Never call this on test data.

    Returns:
        (X_resampled, labels_resampled, info), where `info` reports the class
        counts before and after, the number of synthetic samples generated,
        and the parameters used. Callers surface this so that a resampler
        which generates nothing, for example SMOTE on an already-balanced
        fold, is distinguishable from one that was never applied.
    """
    from collections import Counter

    labels_array = np.array(labels)
    before = {str(k): int(v) for k, v in Counter(labels_array.tolist()).items()}

    method = None
    if settings.get("useSMOTE"):
        method = "SMOTE"
        k_neighbors = int(settings.get("smoteKNeighbors", 5))
        # SMOTE interpolates between neighbours and needs dense input.
        X_in = X.toarray() if hasattr(X, "toarray") else X
        min_class = min(Counter(labels_array.tolist()).values())
        # SMOTE requires k_neighbors < the smallest class size.
        k_eff = max(1, min(k_neighbors, min_class - 1))
        sampler = SMOTE(random_state=random_state, k_neighbors=k_eff)
        params = {"k_neighbors": k_eff, "sampling_strategy": "auto",
                  "random_state": random_state}
    elif settings.get("useOversampling"):
        method = "RandomOverSampler"
        X_in = X
        sampler = RandomOverSampler(random_state=random_state)
        params = {"sampling_strategy": "auto", "random_state": random_state}
    elif settings.get("useUndersampling"):
        method = "RandomUnderSampler"
        X_in = X
        sampler = RandomUnderSampler(random_state=random_state)
        params = {"sampling_strategy": "auto", "random_state": random_state}
    else:
        return X, labels, {"method": None, "applied": False,
                           "class_counts_before": before,
                           "class_counts_after": before,
                           "n_synthetic": 0, "params": {}}

    X_res, labels_res = sampler.fit_resample(X_in, labels_array)
    after = {str(k): int(v) for k, v in Counter(labels_res.tolist()).items()}
    n_synthetic = int(len(labels_res) - len(labels_array))

    info = {
        "method": method,
        "applied": True,
        "class_counts_before": before,
        "class_counts_after": after,
        "n_synthetic": n_synthetic,
        "params": params,
        # True when the resampler ran but produced no new samples.
        "no_op": n_synthetic == 0,
    }
    if n_synthetic == 0:
        logger.warning(
            "%s was applied but generated 0 samples: the training partition is "
            "already balanced (%s). Results will be identical to no resampling.",
            method, before,
        )
    return X_res, labels_res.tolist(), info


# --------------------------------------------------------------------------
# Pipeline
# --------------------------------------------------------------------------

def preprocess_pipeline(texts, labels, settings, artifacts=None, random_state=42):
    """
    Run normalization + feature extraction, and resampling when fitting.

    Fitting mode (`artifacts is None`) fits the vectorizer/scaler on `texts`.
    Transform mode reuses the artifacts fitted on the training partition, so
    the test partition never influences the fitted vocabulary or scaling.

    Resampling is applied in fitting mode only.
    """
    is_training = artifacts is None
    artifacts = artifacts or {}

    processed_texts = normalize_corpus(texts, settings)

    if settings.get("useWord2Vec"):
        X, vectorizer = extract_word2vec_features(
            processed_texts, settings, model=artifacts.get("word2vec_model")
        )
    elif settings.get("useTFIDF"):
        X, vectorizer = extract_tfidf_features(
            processed_texts, settings, vectorizer=artifacts.get("vectorizer")
        )
    elif settings.get("useTF"):
        X, vectorizer = extract_tf_features(
            processed_texts, settings, vectorizer=artifacts.get("vectorizer")
        )
    else:
        raise ValueError(
            "No feature extraction method selected: set one of "
            "useTF, useTFIDF or useWord2Vec."
        )

    # Word2Vec produces dense continuous vectors; standardize them so that
    # distance- and covariance-based models are not dominated by scale.
    # TF/TF-IDF are left untouched so they stay sparse and non-negative.
    scaler = None
    if settings.get("useWord2Vec"):
        if is_training:
            scaler = StandardScaler()
            X = scaler.fit_transform(X)
        else:
            scaler = artifacts.get("scaler")
            if scaler is not None:
                X = scaler.transform(X)

    resampling_info = {"method": None, "applied": False, "n_synthetic": 0}
    if is_training:
        X, labels, resampling_info = apply_resampling(
            X, labels, settings, random_state=random_state
        )

    vocab_size = len(getattr(vectorizer, "vocabulary_", {}) or {})
    n_features = int(X.shape[1]) if hasattr(X, "shape") else 0

    logger.info(
        "preprocess: n_docs=%d features=%s vocab=%d stem=%s lemma=%s "
        "extract=%s resampling=%s(+%d)",
        len(texts), n_features, vocab_size,
        bool(settings.get("useStemming")), bool(settings.get("useLemmatization")),
        _selected_extractor(settings), resampling_info.get("method"),
        resampling_info.get("n_synthetic", 0),
    )

    return {
        "vectors": X,
        "labels": labels,
        "processed_texts": processed_texts,
        "vocab_size": vocab_size,
        "n_features": n_features,
        "n_samples": len(labels),
        "resampling": resampling_info,
        "artifacts": {
            "vectorizer": vectorizer,
            "scaler": scaler,
            "word2vec_model": vectorizer if settings.get("useWord2Vec") else None,
        },
    }


def _selected_extractor(settings):
    if settings.get("useWord2Vec"):
        return "Word2Vec"
    if settings.get("useTFIDF"):
        return "TF-IDF"
    if settings.get("useTF"):
        return "TF"
    return None

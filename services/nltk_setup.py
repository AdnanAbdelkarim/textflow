"""
NLP library setup and lazy loaders.

Three independent loaders:
  - ensure_nltk_data() - call once at startup; downloads NLTK data only if missing
  - get_nlp() - lazy-load spaCy model on first call (cached, and serialised
    so that concurrent first callers share one load rather than each
    starting their own)
  - get_afinn() - lazy-load AFINN sentiment lexicon on first call
"""
import os
import logging
import threading
from functools import lru_cache

import nltk
import spacy
from afinn import Afinn


def ensure_nltk_data():
    """
    Download required NLTK corpora only if not already present.
    nltk.download() makes a network call even with quiet=True; this guard
    prevents that on every server restart in production.
    """
    required = [
        ('tokenizers/punkt',                      'punkt'),
        ('tokenizers/punkt_tab',                  'punkt_tab'),
        ('taggers/averaged_perceptron_tagger',     'averaged_perceptron_tagger'),
        ('taggers/averaged_perceptron_tagger_eng', 'averaged_perceptron_tagger_eng'),
        ('chunkers/maxent_ne_chunker',             'maxent_ne_chunker'),
        ('chunkers/maxent_ne_chunker_tab',         'maxent_ne_chunker_tab'),
        ('corpora/words',                          'words'),
    ]
    for path, name in required:
        try:
            nltk.data.find(path)
        except LookupError:
            nltk.download(name, quiet=True)


# lru_cache alone does not serialise concurrent first calls, so two callers
# arriving together would each load their own copy of the transformer. That
# matters here because the model is warmed up in a background thread at
# startup: without this lock a request arriving during the warm-up would load
# a second copy, doubling both the load time and the memory used.
_nlp_lock = threading.Lock()


def get_nlp():
    """Return the spaCy NER model, loading it once on first use."""
    with _nlp_lock:
        return _load_nlp()


@lru_cache(maxsize=1)
def _load_nlp():
    """
    Lazy-load spaCy NER model. Returns cached instance after first call.

    Load order (best to fastest):
      1. en_core_web_trf - transformer, best quality (installed via requirements.txt)
      2. en_core_web_lg - large static vectors, good quality
      3. en_core_web_md - medium, acceptable
      4. en_core_web_sm - small, poor quality
      5. blank model - last resort, NO NER capability

    NOTE: en_core_web_trf is loaded via direct package import (not spacy.load)
    because URL-installed spaCy models are not always registered in spaCy's
    model registry. The lru_cache ensures the model is only loaded once.
    """
    # Try transformer first - installed via requirements.txt URL
    try:
        import en_core_web_trf
        nlp = en_core_web_trf.load()
        for pipe in ["parser", "lemmatizer", "textcat"]:
            if nlp.has_pipe(pipe):
                nlp.disable_pipe(pipe)
        nlp.max_length = int(os.getenv("SPACY_MAX_LENGTH", 1_000_000))
        logging.info("Loaded en_core_web_trf via direct import (transformer - best quality)")
        return nlp
    except ImportError:
        logging.warning("en_core_web_trf not importable - run: pip install -r requirements.txt")
    except Exception as e:
        logging.warning(f"en_core_web_trf failed to load: {e}")

    # Fallback chain: lg -> md -> sm -> blank
    for model_name in ["en_core_web_lg", "en_core_web_md", "en_core_web_sm"]:
        try:
            nlp = spacy.load(model_name, disable=["parser", "lemmatizer", "textcat"])
            nlp.max_length = int(os.getenv("SPACY_MAX_LENGTH", 1_000_000))
            logging.info(f"Loaded {model_name} (fallback)")
            return nlp
        except Exception:
            continue

    logging.error("No spaCy model found. NER will return no entities.")
    nlp = spacy.blank("en")
    nlp.max_length = int(os.getenv("SPACY_MAX_LENGTH", 1_000_000))
    return nlp


@lru_cache(maxsize=1)
def get_afinn():
    """Return cached AFINN lexicon instance."""
    return Afinn()

@lru_cache(maxsize=1)
def get_lemmatizer():
    """
    Lazy-load a spaCy pipeline for lemmatization only.

    Deliberately separate from get_nlp(): get_nlp() serves NER and loads the
    transformer model with the lemmatizer disabled, which is both slow and
    unnecessary here. Lemmatization needs only tok2vec + tagger +
    attribute_ruler + lemmatizer from the small model.

    Returns None when no model is installed, so callers can degrade to
    unlemmatized text rather than failing the request.
    """
    for model_name in ["en_core_web_sm", "en_core_web_md", "en_core_web_lg"]:
        try:
            nlp = spacy.load(model_name, disable=["ner", "parser", "textcat"])
            nlp.max_length = int(os.getenv("SPACY_MAX_LENGTH", 1_000_000))
            logging.info("Loaded %s for lemmatization", model_name)
            return nlp
        except Exception:
            continue

    logging.error(
        "No spaCy model available for lemmatization. Install one with: "
        "python -m spacy download en_core_web_sm"
    )
    return None

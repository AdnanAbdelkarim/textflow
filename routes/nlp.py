"""
NLP endpoints - entity extraction, NER (multi-method), sentiment analysis,
topic modeling.
"""
import os
import re
import logging

from flask import Blueprint, request, jsonify
from nltk import word_tokenize, pos_tag, ne_chunk
from nltk.tree import Tree
from sklearn.feature_extraction.text import CountVectorizer
from sklearn.decomposition import LatentDirichletAllocation

from services.nltk_setup import get_nlp, get_afinn
from services.topic_labels import best_label_for_terms, auto_label_from_terms
from services.cache import session_cache

nlp_bp = Blueprint('nlp', __name__)


# Topic modeling caps (env-overridable)
TOPIC_MAX_CHARS_PER_DOC = int(os.getenv("TOPIC_MAX_CHARS_PER_DOC", 10000))
TOPIC_MAX_FEATURES = int(os.getenv("TOPIC_MAX_FEATURES", 10000))
TOPIC_MIN_TOPICS = int(os.getenv("TOPIC_MIN_TOPICS", 5))
TOPIC_MAX_TOPICS = int(os.getenv("TOPIC_MAX_TOPICS", 20))
TOPIC_MAX_DOCS = int(os.getenv("TOPIC_MAX_DOCS", 5000))


# Per-session NER cache (replaces the old process-level _ner_cache that was
#     keyed only by text length, a fingerprint that could collide across users)
#     session_cache is imported above and handles the storage.


def _clean_spacy_entities(entities):
    """Deduplicate spaCy entities and apply label preferences."""
    seen_texts = {}
    cleaned = []
    preferred_labels = {"number": "CARDINAL"}

    for e in entities:
        text_lower = e['text'].lower()
        if text_lower in preferred_labels:
            e['label'] = preferred_labels[text_lower]
        if text_lower in seen_texts:
            continue
        seen_texts[text_lower] = e['label']
        cleaned.append(e)
    return cleaned


def _get_nltk_ner(text):
    """Run NLTK NE chunker on text. Returns list of {text, label, source}."""
    from nltk.tree import Tree

    try:
        if not text or not text.strip():
            return []

        text = text[:5000]  # cap for performance
        tokens = word_tokenize(text)
        tagged = pos_tag(tokens)
        tree = ne_chunk(tagged)

        seen = set()
        unique = []
        for subtree in tree:
            if hasattr(subtree, 'label'):
                ent_text = ' '.join(c[0] for c in subtree.leaves())
                key = (ent_text.lower(), subtree.label())
                if key not in seen:
                    seen.add(key)
                    unique.append({
                        "text": ent_text,
                        "label": subtree.label(),
                        "source": "nltk"
                    })

        # Filter NLTK PERSON misclassifications - outside the loop
        _PERSON_STOPWORDS = {
            'adequate', 'smaller', 'larger', 'higher', 'lower', 'horizontal',
            'vertical', 'approved', 'general', 'special', 'additional',
            'standard', 'minimum', 'maximum', 'total', 'full', 'main',
            'suitable', 'appropriate', 'accessible', 'fixed', 'required'
        }
        unique = [
            e for e in unique                                         # <- 'unique' not 'unique_entities'
            if not (e['label'] == 'PERSON' and e['text'].lower() in _PERSON_STOPWORDS)
            and not (e['label'] == 'PERSON' and len(e['text'].split()) == 1
                     and e['text'][0].islower())
        ]
        return unique

    except Exception:
        logging.exception("get_nltk_ner failed")
        return []

@nlp_bp.post("/api/extract_entities")
def extract_entities():
    """Extract named entities using NLTK ne_chunker. Used by frontend word cloud preprocessing."""
    from nltk.tree import Tree

    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()

    if not text:
        return jsonify({"entities": []})

    try:
        tokens = word_tokenize(text[:10000])
        tagged = pos_tag(tokens)
        chunked = ne_chunk(tagged, binary=False)

        entities = []
        for subtree in chunked:
            if isinstance(subtree, Tree):
                entity_text = " ".join(token for token, _ in subtree.leaves())
                entities.append({"text": entity_text, "label": subtree.label()})

        return jsonify({"entities": entities})
    except Exception:
        logging.exception("extract_entities failed")
        return jsonify({"entities": []})


@nlp_bp.post("/ner")
def ner_alias():
    """
    Combined spaCy + NLTK NER with method selection (spacy/nltk/both).

    Cache strategy:
      - Both spaCy and NLTK results are cached together per (session, text).
      - On subsequent calls with the same text, only the requested method's
        slice is returned from cache - no recomputation.
    """
    data = request.get_json(force=True) or {}
    text = (data.get("text") or "").strip()
    ner_method = data.get("ner_method", "both")

    if not text:
        return jsonify({"entities": []})

    session_id = request.headers.get('X-Session-ID', 'anonymous')
    text_fp = session_cache.fingerprint(text)

    # Check session cache for pre-computed NER results
    cached = session_cache.get(session_id, 'ner', text_fp)

    if cached is None:
        # Compute both methods and cache the combined result
        spacy_ents = []
        nltk_ents = []

        try:
            # Cap total text at 20,000 chars for spaCy transformer performance.
            # The transformer model is ~10x slower than the small model on CPU.
            # For full-corpus NER on large datasets, use NLTK-only mode.
            spacy_text = text
            chunk_size = 5000
            spacy_ents = []
            nlp = get_nlp()
            for i in range(0, len(spacy_text), chunk_size):
                doc = nlp(spacy_text[i:i + chunk_size])
                spacy_ents.extend([{
                    "text": e.text,
                    "label": e.label_,
                    "start_char": int(e.start_char) + i,
                    "end_char": int(e.end_char) + i,
                    "source": "spacy"
                } for e in doc.ents])
            spacy_ents = _clean_spacy_entities(spacy_ents)
        except Exception:
            logging.exception("spaCy NER failed")

        try:
            nltk_ents = _get_nltk_ner(text)
        except Exception:
            logging.exception("NLTK NER failed")

        cached = {"spacy": spacy_ents, "nltk": nltk_ents}
        session_cache.set(session_id, 'ner', text_fp, cached, ttl=900)  # 15 min

    # Return only the requested method's slice
    if ner_method == "spacy":
        result = cached["spacy"]
    elif ner_method == "nltk":
        result = cached["nltk"]
    else:  # "both"
        combined = cached["spacy"] + cached["nltk"]
        seen = set()
        result = []
        for ent in combined:
            key = (ent["text"].lower(), ent["label"])
            if key not in seen:
                seen.add(key)
                result.append(ent)

    return jsonify({"entities": result})

@nlp_bp.post("/api/ner")
def ner_api_alias():
    """Alias for /ner - frontend calls both paths."""
    return ner_alias()


@nlp_bp.route('/sentiment', methods=['POST'])
def sentiment():
    """Sentence-level sentiment analysis using AFINN."""
    data = request.json
    text = data.get('text', '')

    if not text.strip():
        return jsonify({'error': 'Empty text received.'}), 400

    try:
        afinn = get_afinn()
        is_labeled = bool(re.match(r"^\[\d+\]", text.strip()))
        results = []
        sentence_counter = 1

        def _classify(score):
            if score > 0:
                return "Positive", "green"
            elif score < 0:
                return "Negative", "red"
            return "Neutral", "#999"

        if is_labeled:
            for line in text.strip().splitlines():
                match = re.match(r"^\[(\d+)\]\s*(.*)", line)
                if not match:
                    continue
                label = int(match[1])
                content = match[2]
                for sentence in re.split(r"[.?!]\s+", content):
                    if sentence.strip():
                        score = afinn.score(sentence)
                        sent_label, color = _classify(score)
                        results.append({
                            "sentence_id": sentence_counter,
                            "label": label,
                            "text": sentence.strip(),
                            "score": score,
                            "sentiment": sent_label,
                            "color": color
                        })
                        sentence_counter += 1
        else:
            for sentence in re.split(r"[.?!]\s+", text):
                if sentence.strip():
                    score = afinn.score(sentence)
                    sent_label, color = _classify(score)
                    results.append({
                        "sentence_id": sentence_counter,
                        "label": None,
                        "text": sentence.strip(),
                        "score": score,
                        "sentiment": sent_label,
                        "color": color
                    })
                    sentence_counter += 1

        return jsonify({"results": results})
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@nlp_bp.post("/api/topic_modeling")
def api_topic_modeling():
    """Run LDA topic modeling on documents. Returns topics + doc-topic mapping."""
    try:

        data = request.get_json(force=True) or {}
        rows = data.get("rows")
        if rows is None:
            txt = data.get("text") or ""
            rows = [txt] if isinstance(txt, str) else []

        is_labeled = bool(data.get("isLabeled", False))

        # --- Backend session cache check ---
        # Topic modeling (LDA) is the slowest endpoint. Cache keyed by
        # (session_id, rows fingerprint, isLabeled) so re-visiting the
        # advanced page after a hard-refresh is instant.
        session_id = request.headers.get('X-Session-ID', 'anonymous')
        rows_fp = session_cache.fingerprint(rows)
        cache_key_fp = f"{rows_fp}:{int(is_labeled)}"

        cached_result = session_cache.get(session_id, 'topic_modeling', cache_key_fp)
        if cached_result is not None:
            return jsonify(cached_result)

        # Normalize -> list[str], cap per-doc size
        docs = []
        for r in rows:
            s = (r if isinstance(r, str) else str(r or "")).strip()
            if not s:
                continue
            if TOPIC_MAX_CHARS_PER_DOC and len(s) > TOPIC_MAX_CHARS_PER_DOC:
                s = s[:TOPIC_MAX_CHARS_PER_DOC]
            docs.append(s)
        docs = docs[:TOPIC_MAX_DOCS]

        # Unlabeled single doc -> split into chunks for multi-document modeling
        if not is_labeled and len(docs) == 1:
            text = docs[0]
            parts = [text[i:i + 3000] for i in range(0, len(text), 3000)]
            docs = [p.strip() for p in parts if len(p.strip()) > 100]

        if not docs:
            return jsonify({"topics": [], "mapping": [], "warning": "no non-empty documents"}), 200

        # Vectorizer parameters depend on doc count
        n_docs = len(docs)
        if n_docs == 1:
            min_df, max_df = 1, 1.0
        elif n_docs < 5:
            min_df, max_df = 1, 0.95
        else:
            min_df, max_df = 2, 0.9

        # Extended English stopwords (matches the inline set in original main.py)
        english_stopwords = [
            'a', 'about', 'above', 'after', 'again', 'against', 'all', 'am', 'an', 'and',
            'any', 'are', 'as', 'at', 'be', 'because', 'been', 'before', 'being', 'below',
            'between', 'both', 'but', 'by', 'can', 'cannot', 'could', 'did', 'do', 'does',
            'doing', 'down', 'during', 'each', 'few', 'for', 'from', 'further', 'had', 'has',
            'have', 'having', 'he', 'her', 'here', 'hers', 'herself', 'him', 'himself', 'his',
            'how', 'i', 'if', 'in', 'into', 'is', 'it', 'its', 'itself', 'just', 'me', 'might',
            'more', 'most', 'must', 'my', 'myself', 'no', 'nor', 'not', 'now', 'of', 'off', 'on',
            'once', 'only', 'or', 'other', 'our', 'ours', 'ourselves', 'out', 'over', 'own',
            'same', 'she', 'should', 'so', 'some', 'such', 'than', 'that', 'the', 'their',
            'theirs', 'them', 'themselves', 'then', 'there', 'these', 'they', 'this', 'those',
            'through', 'to', 'too', 'under', 'until', 'up', 'very', 'was', 'we', 'were', 'what',
            'when', 'where', 'which', 'while', 'who', 'whom', 'why', 'will', 'with', 'would',
            'you', 'your', 'yours', 'yourself', 'yourselves'
        ]

        vec = CountVectorizer(
            stop_words=english_stopwords,
            token_pattern=r"(?u)\b[a-zA-Z]{3,}\b",
            min_df=min_df,
            max_df=max_df,
            max_features=TOPIC_MAX_FEATURES
        )

        try:
            X = vec.fit_transform(docs)
        except ValueError as e:
            return jsonify({"topics": [], "mapping": [], "error": "empty-vocabulary", "detail": str(e)}), 400

        if X.shape[1] == 0:
            return jsonify({"topics": [], "mapping": [], "error": "no-features", "detail": "vectorizer produced 0 features"}), 400

        # Choose safe number of topics
        n_topics = min(TOPIC_MAX_TOPICS, 5) if X.shape[0] == 1 else max(TOPIC_MIN_TOPICS, min(TOPIC_MAX_TOPICS, X.shape[0]))

        lda = LatentDirichletAllocation(
            n_components=n_topics,
            learning_method="online",
            random_state=0,
            max_iter=10
        )
        lda.fit(X)

        vocab = vec.get_feature_names_out()
        topic_word = lda.components_

        # Build topics with top 10 terms each
        topics = []
        for k in range(n_topics):
            comp = topic_word[k]
            top_idx = comp.argsort()[-10:][::-1]
            terms = [[str(vocab[i]), float(comp[i])] for i in top_idx]
            topics.append({
                "id": int(k + 1),
                "terms": terms,
                "weight": float(comp[top_idx].sum())
            })

        # Label each topic
        labels_only = []
        for k in range(n_topics):
            terms = topics[k]["terms"]
            fallback = auto_label_from_terms(terms, n=3)
            label = best_label_for_terms(
                terms, default_label=fallback, min_hits=1, min_score=0.0
            )
            topics[k]["label"] = label
            labels_only.append(label)

        # Doc-topic distribution
        doc_topic = lda.transform(X)
        topic_counts = doc_topic.sum(axis=0)
        den = float(topic_counts.sum() or 1.0)
        raw_pcts = (topic_counts / den) * 100.0
        rounded = [round(float(p), 2) for p in raw_pcts]
        drift = round(100.0 - sum(rounded), 2)
        if n_topics > 0:
            max_i = int(max(range(n_topics), key=lambda i: rounded[i]))
            rounded[max_i] = round(rounded[max_i] + drift, 2)
        for k in range(n_topics):
            topics[k]["percent"] = float(rounded[k])

        # Doc-topic mapping
        mapping = []
        for i in range(X.shape[0]):
            row = doc_topic[i]
            best_k = int(row.argmax())
            confidence = float(round(row[best_k] * 100.0, 2))
            snippet = (docs[i][:160] + "...") if len(docs[i]) > 180 else docs[i]
            mapping.append({
                "doc_id": int(i + 1),
                "topic": int(best_k + 1),
                "label": labels_only[best_k] if 0 <= best_k < len(labels_only) else f"Topic {best_k + 1}",
                "confidence": confidence,
                "snippet": snippet
            })

        result = {"topics": topics, "mapping": mapping}

        # Store in backend session cache (30 min TTL)
        session_cache.set(session_id, 'topic_modeling', cache_key_fp, result)

        return jsonify(result)

    except Exception as e:
        logging.exception("api_topic_modeling failed")
        return jsonify({"error": "topic-modeling-failed", "detail": str(e)}), 500
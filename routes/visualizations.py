"""
Visualization endpoints - word frequency, label distribution, coverage, Zipf,
cooccurrence network, word cloud frequencies.
"""
import re
import logging
from collections import Counter, defaultdict

import numpy as np
from scipy.sparse import csr_matrix
from sklearn.feature_extraction.text import CountVectorizer
from flask import Blueprint, request, jsonify

from services.tokenization import tokenize, tokenize_rows, STOPWORDS
from services.cache import wordcloud_cache, session_cache


# Create blueprint - routes register against this and get attached to the app later
viz_bp = Blueprint('visualizations', __name__)


# Caps shared across endpoints
MAX_CHARS_PER_ROW = 2000
MAX_TOPN = 1000
ZIPF_MAX_RANK = 50000


def _normalize_row_to_text(row):
    """Convert a row (str, dict, or other) to its text content."""
    if isinstance(row, str):
        s = row
    elif isinstance(row, dict):
        s = str(row.get("text") or row.get("Message") or "")
    else:
        s = str(row or "")
    if MAX_CHARS_PER_ROW:
        s = s[:MAX_CHARS_PER_ROW]
    return s


def _compute_word_frequency(rows, include_stopwords):
    """Internal: compute word frequencies from rows. Returns list of {word, frequency}."""
    from services.tokenization import MAX_TOKENS_PER_LINE

    tokens = []
    for r in rows:
        s = _normalize_row_to_text(r)
        t = tokenize(s, include_stopwords)
        if len(t) > MAX_TOKENS_PER_LINE:
            t = t[:MAX_TOKENS_PER_LINE]
        tokens.extend(t)

    counts = Counter(tokens)
    return [{"word": w, "frequency": int(c)} for w, c in counts.most_common(ZIPF_MAX_RANK)]


@viz_bp.route("/api/word_frequency", methods=["POST"])
def api_word_frequency():
    """Compute word frequencies. Optionally caches if preload_cache=True."""
    try:
        data = request.get_json(force=True) or {}
        rows = data.get("rows", []) or []
        include_stopwords = bool(data.get("includeStopwords", False))
        is_cache_request = bool(data.get("preload_cache", False))

        result = _compute_word_frequency(rows, include_stopwords)

        if is_cache_request:
            wordcloud_cache.store_frequency_data(rows, include_stopwords, "all", result)

        return jsonify(result)
    except Exception as e:
        logging.exception("api_word_frequency failed")
        return jsonify({"error": "word_frequency-failed", "detail": str(e)}), 500


@viz_bp.route("/api/preprocess_all_frequencies", methods=["POST"])
def preprocess_all_frequencies():
    """Pre-process frequency data for ALL classes upfront."""
    try:
        data = request.get_json(force=True) or {}
        rows = data.get("rows", [])
        include_stopwords = bool(data.get("includeStopwords", False))

        if not rows:
            return jsonify({"error": "No data provided"}), 400

        classes = list(set(row.get("label", "Unlabeled") for row in rows))
        results = {}

        for class_name in classes:
            class_data = (rows if class_name == "all"
                          else [r for r in rows if str(r.get("label", "Unlabeled")) == class_name])
            text_data = [r.get("text", r.get("email", "")) for r in class_data]
            results[class_name] = _compute_word_frequency(text_data, include_stopwords)

        all_text_data = [r.get("text", r.get("email", "")) for r in rows]
        results["all"] = _compute_word_frequency(all_text_data, include_stopwords)

        return jsonify({
            "status": "completed",
            "classes_processed": len(results),
            "results": results
        })
    except Exception as e:
        logging.exception("preprocess_all_frequencies failed")
        return jsonify({"error": "preprocessing-failed", "detail": str(e)}), 500


@viz_bp.route("/api/wordcloud_frequencies", methods=["POST"])
def get_wordcloud_frequencies():
    """Return word frequencies for word cloud rendering. Cached per class."""
    try:
        data = request.get_json(force=True) or {}
        rows = data.get("rows", [])
        include_stopwords = bool(data.get("includeStopwords", False))
        class_name = data.get("className", "all")

        cached = wordcloud_cache.get_frequency_data(rows, include_stopwords, class_name)
        if cached:
            return jsonify({"frequencies": cached, "cached": True, "className": class_name})

        text = " ".join(str(row) for row in rows if row)
        from services.tokenization import TOKEN_RE

        words = []
        for word in TOKEN_RE.findall(text.lower()):
            if len(word) > 2:
                if not include_stopwords and word in STOPWORDS:
                    continue
                words.append(word)

        freq_counter = Counter(words)
        freq_data = [[w, c] for w, c in freq_counter.most_common()]

        wordcloud_cache.store_frequency_data(rows, include_stopwords, class_name, freq_data)

        return jsonify({"frequencies": freq_data, "cached": False, "className": class_name})
    except Exception as e:
        logging.exception("get_wordcloud_frequencies failed")
        return jsonify({"error": str(e)}), 500


@viz_bp.route('/api/label_distribution', methods=['POST'])
def label_distribution():
    """Count occurrences of [label] prefixes from text lines."""
    import re
    data = request.get_json()
    rows = data.get("lines", [])

    label_counts = Counter()
    for row in rows:
        match = re.match(r"^\[(.+?)\]", row)
        if match:
            label_counts[match.group(1)] += 1

    return jsonify(dict(label_counts))


@viz_bp.route("/api/cooccurrence", methods=["POST"])
def api_cooccurrence():
    """
    Build a term cooccurrence network.

    Non-stopword vocabulary is always selected first and kept consistent.
    When include_stopwords=True, stopwords are ADDED on top - not substituted.
    This guarantees the same non-stopwords always appear regardless of the
    stopwords toggle, with stopwords layered on as additional nodes.
    """
    try:
        data = request.get_json(force=True) or {}
        rows = data.get("rows", []) or []
        include_stopwords = bool(data.get("includeStopwords", True))
        top_n = max(1, min(MAX_TOPN, int(data.get("topN", 100))))
        min_co = max(1, min(1000, int(data.get("minCooccurrence", 2))))

        texts = [_normalize_row_to_text(r) for r in rows]
        if not texts:
            return jsonify({"nodes": [], "links": []})

        pad = max(top_n * 3, 30)
        vocab_size = max(top_n, pad)
        token_pat = r"\b[A-Za-z0-9]{3,}\b"

        # -- Step 1: Always build non-stopword vocabulary (consistent base) ---------
        # This vocabulary is IDENTICAL whether stopwords are on or off.
        try:
            ns_vec = CountVectorizer(
                lowercase=True,
                stop_words=list(STOPWORDS),
                token_pattern=token_pat,
                binary=True,
            )
            X_ns = ns_vec.fit_transform(texts)
        except ValueError:
            return jsonify({"nodes": [], "links": []})

        if X_ns.shape[1] == 0:
            return jsonify({"nodes": [], "links": []})

        ns_vocab = ns_vec.get_feature_names_out()
        ns_term_df = np.asarray(X_ns.sum(axis=0)).flatten()

        # Top non-stopwords by document frequency - always the same set
        ns_keep_idx = np.argsort(ns_term_df)[::-1][:vocab_size]
        selected_ns = set(ns_vocab[ns_keep_idx])

        # -- Step 2: Optionally identify top stopwords from the text --------
        # Stopwords are selected separately so they don't compete with non-stopwords.
        top_stop = set()
        if include_stopwords:
            try:
                all_vec = CountVectorizer(
                    lowercase=True,
                    stop_words=None,
                    token_pattern=token_pat,
                    binary=True,
                )
                X_all = all_vec.fit_transform(texts)
                all_vocab = all_vec.get_feature_names_out()
                all_df = np.asarray(X_all.sum(axis=0)).flatten()

                stop_items = [
                    (all_vocab[i], float(all_df[i]))
                    for i in range(len(all_vocab))
                    if all_vocab[i] in STOPWORDS
                ]
                top_stop = {
                    w for w, _ in
                    sorted(stop_items, key=lambda x: -x[1])[:vocab_size]
                }
            except ValueError:
                top_stop = set()

        # -- Step 3: Build final binary matrix with combined vocabulary --------
        final_vocab_set = selected_ns | top_stop
        final_vocab = {w: i for i, w in enumerate(sorted(final_vocab_set))}
        final_terms = np.array(sorted(final_vocab_set))

        final_vec = CountVectorizer(
            lowercase=True,
            stop_words=None,
            token_pattern=token_pat,
            binary=True,
            vocabulary=final_vocab,
        )
        X_final = final_vec.transform(texts)

        # -- Step 4: Co-occurrence via sparse matrix multiplication --------
        cooc = (X_final.T @ X_final).tocoo()

        edges = []
        for i, j, v in zip(cooc.row, cooc.col, cooc.data):
            if i >= j:
                continue
            if v >= min_co:
                edges.append((str(final_terms[i]), str(final_terms[j]), int(v)))

        # Fallback for sparse classes: retry with min_co=1
        if not edges:
            return jsonify({"nodes": [], "links": []})

        if not edges:
            return jsonify({"nodes": [], "links": []})

        # -- Step 5: Top-N node selection - non-stopwords and stopwords separately -
        # Non-stopwords always get their top-N slots.
        # Stopwords are added on top (separate top-N) so they never displace
        # non-stopwords from the network.
        strength = defaultdict(int)
        for a, b, c in edges:
            strength[a] += c
            strength[b] += c

        if include_stopwords:
            # Non-stopword top-N (consistent, always the same nodes)
            ns_strength = {w: s for w, s in strength.items() if w not in STOPWORDS}
            ns_ordered = sorted(ns_strength.items(), key=lambda kv: (-kv[1], kv[0]))
            keep = {w for w, _ in ns_ordered[:top_n]}

            # Stopwords top-N added on top (extra nodes, not competing)
            stop_strength = {w: s for w, s in strength.items() if w in STOPWORDS}
            stop_ordered = sorted(stop_strength.items(), key=lambda kv: (-kv[1], kv[0]))
            keep |= {w for w, _ in stop_ordered[:top_n]}
        else:
            ordered = sorted(strength.items(), key=lambda kv: (-kv[1], kv[0]))
            keep = {w for w, _ in ordered[:top_n]}

        edges = [(a, b, c) for a, b, c in edges if a in keep and b in keep]
        if not edges:
            return jsonify({"nodes": [], "links": []})

        node_ids = sorted({w for a, b, _ in edges for w in (a, b)})
        nodes_out = [{"id": w} for w in node_ids]
        links_out = [{"source": a, "target": b, "value": c} for a, b, c in edges]

        return jsonify({"nodes": nodes_out, "links": links_out})

    except Exception as e:
        logging.exception("api_cooccurrence failed")
        return jsonify({"error": "cooccurrence-failed", "detail": str(e)}), 500
    
@viz_bp.route("/api/clear_preprocessing", methods=["POST"])
def clear_preprocessing():
    """
    Clear all server-side caches for this session.
    Called by the frontend whenever a new file is uploaded, so that stale
    NER/topic-modeling/word-frequency results don't survive into the new session.
    """
    session_id = request.headers.get('X-Session-ID', 'anonymous')
    session_cache.invalidate_session(session_id)
    wordcloud_cache.clear_old(max_hours=0)  # clear all in-memory word cloud cache too
    return jsonify({"status": "cleared", "session_id": session_id})

@viz_bp.route("/api/coverage", methods=["POST"])
def api_coverage():
    """Compute cumulative vocabulary coverage curve."""
    data = request.get_json(force=True) or {}
    rows = data.get("rows", []) or []
    include_stopwords = bool(data.get("includeStopwords", False))
    min_rank = int(data.get("minRank", 1))
    max_rank = int(data.get("maxRank", 10000))

    tokens = tokenize_rows(rows, include_stopwords)
    counts = Counter(tokens)
    if not counts:
        return jsonify({"ranks": [], "coverage": []})

    vocab = [w for w, _ in counts.most_common()]
    start = max(1, min_rank) - 1
    end = min(max_rank, len(vocab))

    total_tokens = sum(counts.values())
    seen = 0
    ranks = []
    covs = []
    for rank in range(start, end):
        seen += counts[vocab[rank]]
        ranks.append(rank + 1)
        covs.append(seen / total_tokens)

    return jsonify({"ranks": ranks, "coverage": covs})


@viz_bp.route('/api/zipf', methods=['POST'])
def zipf():
    """Compute Zipf rank-frequency data."""
    try:
        from services.tokenization import MAX_TOKENS_PER_LINE

        data = request.get_json(force=True) or {}
        rows = data.get("rows", []) or []
        include_stopwords = bool(data.get("includeStopwords", True))

        words = []
        for r in rows:
            s = _normalize_row_to_text(r)
            toks = tokenize(s, include_stopwords)
            if len(toks) > MAX_TOKENS_PER_LINE:
                toks = toks[:MAX_TOKENS_PER_LINE]
            words.extend(toks)

        if not words:
            return jsonify([])

        counter = Counter(words)
        sorted_items = counter.most_common(ZIPF_MAX_RANK)

        zipf_data = [
            {"rank": i + 1, "word": word, "freq": int(freq)}
            for i, (word, freq) in enumerate(sorted_items)
        ]
        return jsonify(zipf_data)
    except Exception as e:
        logging.exception("api_zipf failed")
        return jsonify({"error": "zipf-failed", "detail": str(e)}), 500

@viz_bp.route("/api/ngrams", methods=["POST"])
def api_ngrams():
    """
    Rank n-grams by frequency for the Advanced Analysis tab.

    Payload:
        rows              list of strings or {text, label} objects
        n                 n-gram order (1 = unigram, 2 = bigram, 3 = trigram)
        topN              how many to return (default 25)
        includeStopwords  keep stopwords in the n-grams (default False)
        className         restrict to one class label, or "all"

    Returns {"ngrams": [{"ngram": ..., "frequency": ...}], "n": n,
             "total_ngrams": int, "n_documents": int}
    """
    try:
        data = request.get_json(force=True) or {}
        rows = data.get("rows", []) or []
        n = max(1, min(5, int(data.get("n", 2))))
        top_n = max(1, min(MAX_TOPN, int(data.get("topN", 25))))
        include_stopwords = bool(data.get("includeStopwords", False))
        class_name = str(data.get("className", "all"))

        if not rows:
            return jsonify({"error": "No data provided"}), 400

        # Optional per-class breakdown; only meaningful for labeled data.
        if class_name != "all":
            wanted = class_name[5:] if class_name.startswith("label") else class_name
            rows = [
                r for r in rows
                if isinstance(r, dict) and str(r.get("label", "")) == wanted
            ]
            if not rows:
                return jsonify({"ngrams": [], "n": n, "total_ngrams": 0,
                                "n_documents": 0,
                                "warning": f"no documents for class {class_name}"})

        counts = Counter()
        n_docs = 0
        for row in rows:
            text = _normalize_row_to_text(row)
            tokens = tokenize(text, include_stopwords)
            if not tokens:
                continue
            n_docs += 1
            # n-grams do not span document boundaries.
            for i in range(len(tokens) - n + 1):
                counts[" ".join(tokens[i:i + n])] += 1

        ranked = [{"ngram": g, "frequency": int(c)}
                  for g, c in counts.most_common(top_n)]

        return jsonify({
            "ngrams": ranked,
            "n": n,
            "total_ngrams": int(sum(counts.values())),
            "unique_ngrams": len(counts),
            "n_documents": n_docs,
            "class": class_name,
            "stopwords_included": include_stopwords,
        })
    except Exception as e:
        logging.exception("api_ngrams failed")
        return jsonify({"error": "ngram-analysis-failed", "detail": str(e)}), 500

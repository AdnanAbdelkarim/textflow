"""
Predictive modeling endpoints.

  /api/preprocess - apply the preprocessing pipeline, report vocab + class counts
  /api/preprocess_preview - same, used by the Preprocessing tab's live preview
  /api/predict - train/evaluate a traditional ML model
  /api/predict_transformer_stream - fine-tune a BERT variant, streaming progress over SSE

torch and transformers are imported inside the transformer route only, to keep
5-8 seconds off server startup for a feature most sessions never touch.
"""
import json
import logging
from collections import Counter

import numpy as np
from flask import Blueprint, Response, request, jsonify
from sklearn.discriminant_analysis import QuadraticDiscriminantAnalysis
from sklearn.linear_model import LogisticRegression
from sklearn.base import clone
from sklearn.metrics import (
    accuracy_score, precision_recall_fscore_support, classification_report,
    hamming_loss, f1_score
)
from sklearn.model_selection import train_test_split
from sklearn.naive_bayes import MultinomialNB
from sklearn.neighbors import KNeighborsClassifier
from sklearn.svm import SVC

from services.preprocessing import preprocess_pipeline

logger = logging.getLogger(__name__)

pred_bp = Blueprint('predictive', __name__)


# Feature representations each model can consume.
#
#   - MultinomialNB models term counts and requires non-negative features, so
#     TF and TF-IDF only. SMOTE interpolates between non-negative points and
#     its output stays non-negative, so resampling does not disqualify it.
#   - QuadraticDiscriminantAnalysis estimates a per-class covariance matrix and
#     requires dense continuous features, so Word2Vec only.
#
# The UI swaps NB for GDA when Word2Vec is selected. This table is the backend
# guard behind that, so an unsupported combination returns a 400 naming the
# constraint instead of an exception from inside scikit-learn.
_MODEL_FEATURE_SUPPORT = {
    'nb':  {'useTF', 'useTFIDF'},
    'gda': {'useWord2Vec'},
    'lr':  {'useTF', 'useTFIDF', 'useWord2Vec'},
    'svm': {'useTF', 'useTFIDF', 'useWord2Vec'},
    'knn': {'useTF', 'useTFIDF', 'useWord2Vec'},
}

_MODEL_DISPLAY = {
    'nb': 'Naive Bayes (MultinomialNB)',
    'gda': 'Gaussian Discriminant Analysis (QuadraticDiscriminantAnalysis)',
    'lr': 'Logistic Regression',
    'svm': 'Support Vector Machine (linear kernel)',
    'knn': 'K-Nearest Neighbors',
}


def _selected_feature_method(settings):
    for key in ('useWord2Vec', 'useTFIDF', 'useTF'):
        if settings.get(key):
            return key
    return None


def _check_model_feature_compatibility(model_type, settings):
    """Return an error string when the model cannot consume the chosen features."""
    feature = _selected_feature_method(settings)
    if feature is None:
        return ("No feature extraction method selected. Choose TF, TF-IDF or "
                "Word2Vec in the Preprocessing tab.")

    supported = _MODEL_FEATURE_SUPPORT.get(model_type)
    if supported is None:
        return f"Unknown model '{model_type}'."
    if feature in supported:
        return None

    pretty = {'useTF': 'TF', 'useTFIDF': 'TF-IDF', 'useWord2Vec': 'Word2Vec'}
    if model_type == 'nb':
        return ("Naive Bayes (MultinomialNB) requires non-negative count-based "
                "features and cannot be trained on Word2Vec embeddings. Select "
                "TF or TF-IDF, or use Gaussian Discriminant Analysis instead.")
    if model_type == 'gda':
        return ("Gaussian Discriminant Analysis requires dense continuous "
                f"features and cannot be trained on {pretty[feature]} vectors. "
                "Select Word2Vec, or use Naive Bayes instead.")
    return (f"{_MODEL_DISPLAY.get(model_type, model_type)} does not support "
            f"{pretty[feature]} features.")


def _build_model(model_type, random_state):
    models = {
        'nb': MultinomialNB(),
        'lr': LogisticRegression(max_iter=1000, random_state=random_state),
        'svm': SVC(kernel='linear', probability=True, random_state=random_state),
        'knn': KNeighborsClassifier(n_neighbors=5),
        'gda': QuadraticDiscriminantAnalysis(),
    }
    return models.get(model_type)


@pred_bp.route('/api/preprocess', methods=['POST'])
def preprocess():
    """Apply the preprocessing pipeline and report vocabulary + class distribution."""
    try:
        data = request.get_json(force=True) or {}
        settings = data.get('settings', {})
        rows = data.get('rows', [])
        text_col = data.get('textCol', 'text')

        if not rows:
            return jsonify({'error': 'No data available for preprocessing'}), 400

        texts, labels = [], []
        for row in rows:
            text = row.get(text_col, row.get('text', row.get('email', '')))
            if text:
                texts.append(str(text))
                labels.append(row.get('label', 'Unlabeled'))

        if not texts:
            return jsonify({'error': 'No text data found'}), 400

        results = preprocess_pipeline(texts, labels, settings, artifacts=None)

        return jsonify({
            'success': True,
            'original_sample': texts[0][:300],
            'processed_sample': results['processed_texts'][0][:300]
                                if results['processed_texts'] else '',
            'vocab_size': results['vocab_size'],
            'n_samples': results['n_samples'],
            'vector_dimensions': results['n_features'],
            'original_class_distribution': dict(Counter(labels)),
            'new_class_distribution': dict(Counter(results['labels'])),
            'resampling': results['resampling'],
        })
    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.exception("preprocess failed")
        return jsonify({'error': 'Preprocessing failed', 'detail': str(e)}), 500


def _rows_are_multilabel(rows):
    """True when any row carries a list of labels rather than a single label."""
    return any(isinstance(r.get('labels'), list) and r.get('labels') for r in rows)


class BinaryRelevance:
    """
    One independent binary classifier per label.

    A label that is constant in the training split has no second class to
    learn from, so its classifier is replaced by that constant. Without this
    an all-negative label in a small split raises inside scikit-learn.
    """

    def __init__(self, base_estimator):
        self.base_estimator = base_estimator
        self.models_ = []

    def fit(self, X, Y):
        self.models_ = []
        for j in range(Y.shape[1]):
            col = Y[:, j]
            if len(np.unique(col)) < 2:
                self.models_.append(int(col[0]))
            else:
                self.models_.append(clone(self.base_estimator).fit(X, col))
        return self

    def predict(self, X):
        n = X.shape[0]
        out = np.zeros((n, len(self.models_)), dtype=int)
        for j, m in enumerate(self.models_):
            out[:, j] = np.full(n, m, dtype=int) if isinstance(m, int) else m.predict(X)
        return out

    @property
    def n_constant_labels(self):
        return sum(1 for m in self.models_ if isinstance(m, int))


def _predict_multilabel(rows, model_type, test_size, random_state,
                        use_preprocessed, settings):
    """Train one classifier per label and report multi-label metrics."""
    texts = [r.get('text', '') for r in rows]
    label_lists = [[str(x) for x in (r.get('labels') or [])] for r in rows]
    label_names = sorted({lab for labs in label_lists for lab in labs})
    if not label_names:
        return jsonify({'error': 'No labels found in the uploaded data.'}), 400

    index = {lab: j for j, lab in enumerate(label_names)}
    Y = np.zeros((len(texts), len(label_names)), dtype=int)
    for i, labs in enumerate(label_lists):
        for lab in labs:
            Y[i, index[lab]] = 1

    # Resampling is not defined for multi-label targets, so it is switched off
    # and reported rather than applied silently.
    settings = dict(settings or {})
    resampling_requested = [k for k in ('useSMOTE', 'useOversampling',
                                        'useUndersampling') if settings.get(k)]
    for k in resampling_requested:
        settings[k] = False

    idx_train, idx_test = train_test_split(
        np.arange(len(texts)), test_size=test_size, random_state=random_state)

    texts_train = [texts[i] for i in idx_train]
    texts_test = [texts[i] for i in idx_test]
    Y_train, Y_test = Y[idx_train], Y[idx_test]

    if use_preprocessed and settings:
        train = preprocess_pipeline(texts=texts_train,
                                    labels=['multilabel'] * len(texts_train),
                                    settings=settings, artifacts=None,
                                    random_state=random_state)
        X_train = train['vectors']
        X_test = preprocess_pipeline(texts=texts_test,
                                     labels=['multilabel'] * len(texts_test),
                                     settings=settings,
                                     artifacts=train['artifacts'])['vectors']
    else:
        from sklearn.feature_extraction.text import TfidfVectorizer
        vec = TfidfVectorizer(max_features=1000)
        X_train = vec.fit_transform(texts_train)
        X_test = vec.transform(texts_test)

    base = _build_model(model_type, random_state)
    if base is None:
        return jsonify({'error': f"Unknown model '{model_type}'."}), 400

    clf = BinaryRelevance(base).fit(X_train, Y_train)
    Y_pred = clf.predict(X_test)

    per_label_p, per_label_r, per_label_f1, support = \
        precision_recall_fscore_support(Y_test, Y_pred, average=None,
                                        zero_division=0)

    logger.info("predict (multi-label): model=%s labels=%d train=%s test=%s",
                model_type, len(label_names), X_train.shape, X_test.shape)

    return jsonify({
        'task': 'multilabel',
        'metrics': {
            'hamming_loss': float(hamming_loss(Y_test, Y_pred)),
            'f1_macro': float(f1_score(Y_test, Y_pred, average='macro',
                                       zero_division=0)),
            'f1_micro': float(f1_score(Y_test, Y_pred, average='micro',
                                       zero_division=0)),
            'subset_accuracy': float(accuracy_score(Y_test, Y_pred)),
        },
        'labels': label_names,
        'per_label': [
            {'label': label_names[j], 'precision': float(per_label_p[j]),
             'recall': float(per_label_r[j]), 'f1': float(per_label_f1[j]),
             'support': int(support[j])}
            for j in range(len(label_names))
        ],
        'label_statistics': {
            'label_cardinality': float(Y.sum(axis=1).mean()),
            'label_density': float(Y.sum(axis=1).mean() / Y.shape[1]),
            'label_prevalence': {label_names[j]: float(Y[:, j].mean())
                                 for j in range(len(label_names))},
        },
        'model_implementation':
            f"Binary relevance, one {_MODEL_DISPLAY.get(model_type, model_type)} "
            f"per label",
        'resampling': {
            'method': None, 'applied': False, 'n_synthetic': 0,
            'note': ('Resampling is not defined for multi-label targets and was '
                     'not applied: ' + ', '.join(resampling_requested))
            if resampling_requested else None,
        },
        'debug_info': {
            'train_size': int(len(idx_train)), 'test_size': int(len(idx_test)),
            'n_features': int(X_train.shape[1]),
            'n_labels': len(label_names),
            'constant_labels_in_training': int(clf.n_constant_labels),
        },
    })


@pred_bp.route('/api/predict', methods=['POST'])
def predict():
    """
    Train and evaluate one traditional ML model.

    Leakage control, in order:
      1. split raw texts into train/test
      2. fit the vectorizer on the training texts only
      3. transform the test texts with the training vectorizer
      4. resample the training partition only
    """
    try:
        data = request.get_json(force=True) or {}

        rows = data.get('rows', [])
        model_type = data.get('model', 'lr')
        test_size = float(data.get('testSize', 0.3))
        random_state = int(data.get('randomState', 42))
        use_preprocessed = bool(data.get('usePreprocessed', False))
        settings = data.get('preprocessingSettings', {}) or {}

        if not rows:
            return jsonify({'error': 'No data provided'}), 400

        if _rows_are_multilabel(rows):
            return _predict_multilabel(rows, model_type, test_size,
                                       random_state, use_preprocessed, settings)

        texts = [r.get('text', '') for r in rows]
        labels = [r.get('label') for r in rows]

        if use_preprocessed:
            incompatible = _check_model_feature_compatibility(model_type, settings)
            if incompatible:
                return jsonify({'error': incompatible}), 400

        model = _build_model(model_type, random_state)
        if model is None:
            return jsonify({'error': f"Unknown model '{model_type}'."}), 400

        # 1. Split raw text - no vectorizer has touched the data yet.
        texts_train, texts_test, y_train, y_test = train_test_split(
            texts, labels, test_size=test_size,
            random_state=random_state, stratify=labels
        )

        resampling_info = {'method': None, 'applied': False, 'n_synthetic': 0}

        if use_preprocessed and settings:
            # 2. Fit on train (this call also applies resampling to the train split).
            train_result = preprocess_pipeline(
                texts=texts_train, labels=list(y_train),
                settings=settings, artifacts=None, random_state=random_state
            )
            X_train = train_result['vectors']
            y_train = train_result['labels']
            resampling_info = train_result['resampling']

            # 3. Transform test with the training artifacts only.
            test_result = preprocess_pipeline(
                texts=texts_test, labels=list(y_test),
                settings=settings, artifacts=train_result['artifacts']
            )
            X_test = test_result['vectors']
            y_test = test_result['labels']
        else:
            from sklearn.feature_extraction.text import TfidfVectorizer
            vectorizer = TfidfVectorizer(max_features=1000)
            X_train = vectorizer.fit_transform(texts_train)
            X_test = vectorizer.transform(texts_test)

        # SMOTE densifies the training matrix; the test matrix must match.
        if not hasattr(X_train, 'toarray') and hasattr(X_test, 'toarray'):
            X_test = X_test.toarray()

        logger.info(
            "predict: model=%s train=%s test=%s resampling=%s(+%d)",
            model_type, getattr(X_train, 'shape', None), getattr(X_test, 'shape', None),
            resampling_info.get('method'), resampling_info.get('n_synthetic', 0),
        )

        model.fit(X_train, y_train)
        y_pred = model.predict(X_test)

        y_prob = None
        if hasattr(model, 'predict_proba'):
            y_prob_all = model.predict_proba(X_test)
            # Degenerate probabilities (only 0.0/1.0) make ROC meaningless.
            unique_probs = np.unique(y_prob_all.round(6))
            if all(p in (0.0, 1.0) for p in unique_probs):
                logger.warning("Degenerate predict_proba output; ROC suppressed.")
            elif y_prob_all.shape[1] == 2:
                y_prob = y_prob_all[:, 1].tolist()
            else:
                y_prob = y_prob_all.tolist()

        accuracy = accuracy_score(y_test, y_pred)
        precision, recall, f1, _ = precision_recall_fscore_support(
            y_test, y_pred, average='weighted', zero_division=0
        )

        return jsonify({
            'metrics': {
                'accuracy': float(accuracy),
                'precision': float(precision),
                'recall': float(recall),
                'f1': float(f1),
            },
            'classification_report': classification_report(y_test, y_pred, zero_division=0),
            'y_true': [str(label) for label in y_test],
            'y_pred': [str(pred) for pred in y_pred],
            'y_prob': y_prob,
            'model_implementation': _MODEL_DISPLAY.get(model_type, model_type),
            'resampling': resampling_info,
            'debug_info': {
                'train_size': int(len(y_train)),
                'test_size': int(len(y_test)),
                'n_features': int(X_train.shape[1]),
                'resampling_applied': bool(resampling_info.get('applied')),
                'synthetic_samples_generated': int(resampling_info.get('n_synthetic', 0)),
            },
        })

    except ValueError as e:
        return jsonify({'error': str(e)}), 400
    except Exception as e:
        logger.exception("predict failed")
        return jsonify({'error': str(e)}), 500


# Shared helpers for transformer routes (consolidates ~100 lines of duplication)
_MODEL_MAP = {
    'bert-tiny': 'prajjwal1/bert-tiny',
    'bert-small': 'prajjwal1/bert-small',
    'distilbert': 'distilbert-base-uncased',
    'bert': 'bert-base-uncased'
}
_MODEL_DISPLAY_NAMES = {
    'bert-tiny': 'BERT-Tiny', 'bert-small': 'BERT-Small',
    'distilbert': 'DistilBERT', 'bert': 'BERT'
}


def _build_text_dataset_class():
    """Lazy-build TextDataset class (avoids torch import at module load)."""
    import torch
    from torch.utils.data import Dataset

    class TextDataset(Dataset):
        def __init__(self, texts, labels, tokenizer, max_length=128):
            self.encodings = tokenizer(
                texts, truncation=True, padding=True,
                max_length=max_length, return_tensors='pt'
            )
            self.labels = torch.tensor(labels)

        def __getitem__(self, idx):
            item = {k: v[idx] for k, v in self.encodings.items()}
            item['labels'] = self.labels[idx]
            return item

        def __len__(self):
            return len(self.labels)

    return TextDataset

def transformers_available():
    """Whether the transformer stack is installed.

    The slim deployment image omits torch, transformers and the spaCy
    transformer model, which together are three quarters of the install. The
    interface asks before offering BERT fine-tuning so that a build without
    them presents an honest set of options rather than failing mid-training.
    """
    try:
        import importlib.util
        return all(importlib.util.find_spec(m) is not None
                   for m in ("torch", "transformers"))
    except Exception:
        return False


@pred_bp.route("/api/capabilities", methods=["GET"])
def api_capabilities():
    """Report which optional features this build supports."""
    return jsonify({"transformers": transformers_available()})


@pred_bp.route("/api/predict_transformer_stream", methods=["POST"])
def api_predict_transformer_stream():
    """Stream transformer training progress via Server-Sent Events."""

    data = request.get_json(force=True)
    rows = data.get("rows", [])
    model_type = data.get("model", "bert-tiny")
    test_size = max(0.05, min(0.9, float(data.get("testSize", 0.3))))
    random_state = int(data.get("randomState", 42))
    
    if not transformers_available():
        return jsonify({
            'error': 'This deployment does not include transformer fine-tuning. '
                     'It is available in the downloadable container, which '
                     'bundles PyTorch and the transformer models.'
        }), 501

    def generate():
        try:
            from transformers import Trainer, TrainingArguments, TrainerCallback
            from transformers import BertForSequenceClassification
            
            # The tokenizer moved between transformers versions.
            try:
                from transformers import BertTokenizer
            except ImportError:
                from transformers.models.bert import BertTokenizer
            
            try:
                from transformers import DistilBertTokenizer, DistilBertForSequenceClassification
            except ImportError:
                from transformers.models.distilbert import DistilBertTokenizer, DistilBertForSequenceClassification
            from sklearn.model_selection import train_test_split
            from sklearn.metrics import (
                accuracy_score, precision_score, recall_score, f1_score, classification_report
            )

            yield f"data: {json.dumps({'progress': 0, 'status': 'Loading data...'})}\n\n"

            texts, labels = [], []
            for r in rows:
                text = r.get("text", r.get("email", ""))
                label = r.get("label")
                if text and label is not None:
                    texts.append(str(text))
                    labels.append(label)

            yield f"data: {json.dumps({'progress': 5, 'status': 'Preparing model...'})}\n\n"

            model_name = _MODEL_MAP.get(model_type, 'prajjwal1/bert-tiny')
            unique_labels = sorted(set(labels))
            label2id = {l: i for i, l in enumerate(unique_labels)}
            id2label = {i: l for l, i in label2id.items()}
            labels_int = [label2id[l] for l in labels]

            texts_train, texts_test, y_train, y_test = train_test_split(
                texts, labels_int, 
                test_size=test_size, 
                random_state=random_state,
                stratify=labels_int  # Maintains class distribution
            )

            yield f"data: {json.dumps({'progress': 10, 'status': f'Loading {model_name}...'})}\n\n"

            # DistilBERT needs its own tokenizer and model classes.
            if model_type == 'distilbert':
                tokenizer = DistilBertTokenizer.from_pretrained(model_name)
                model = DistilBertForSequenceClassification.from_pretrained(
                    model_name, num_labels=len(unique_labels),
                    id2label=id2label, label2id=label2id
                )
            else:
                # bert-tiny, bert-small, bert all use BertTokenizer
                tokenizer = BertTokenizer.from_pretrained(model_name)
                model = BertForSequenceClassification.from_pretrained(
                    model_name, num_labels=len(unique_labels),
                    id2label=id2label, label2id=label2id
                )

            yield f"data: {json.dumps({'progress': 20, 'status': 'Tokenizing texts...'})}\n\n"

            TextDataset = _build_text_dataset_class()
            max_length = int(data.get("maxLength", 128))
            train_dataset = TextDataset(texts_train, y_train, tokenizer, max_length)
            test_dataset = TextDataset(texts_test, y_test, tokenizer, max_length)

            yield f"data: {json.dumps({'progress': 30, 'status': 'Starting training...'})}\n\n"

            # The trainer callback runs on the training thread; the queue
            # hands progress back to the generator that writes the stream.
            import queue
            progress_queue = queue.Queue()

            class StreamCallback(TrainerCallback):
                def __init__(self, total_steps, q):
                    self.total_steps = max(total_steps, 1)
                    self.q = q

                def on_step_end(self, args, state, control, **kwargs):
                    if state.global_step % 5 == 0:
                        progress = 30 + int((state.global_step / self.total_steps) * 60)
                        self.q.put({'progress': min(progress, 89), 'status': f'Training step {state.global_step}/{self.total_steps}...'})
                    return control

            # Fine-tuning hyperparameters. Client-overridable so that runs are
            # reproducible and reportable; the defaults are what the platform
            # uses when the user does not change them.
            hp = {
                "learning_rate": float(data.get("learningRate", 5e-5)),
                "num_train_epochs": int(data.get("epochs", 3)),
                "per_device_train_batch_size": int(data.get("batchSize", 8)),
                "per_device_eval_batch_size": int(data.get("batchSize", 8)),
                "max_seq_length": int(data.get("maxLength", 128)),
                # Warmup is a fraction of total steps, not a fixed count. A
                # fixed 100 steps exceeds the whole schedule on small datasets,
                # leaving the learning rate inside warmup for the entire run so
                # the model never actually trains.
                "warmup_steps": None,   # filled in below, once steps are known
                "weight_decay": float(data.get("weightDecay", 0.01)),
                "optimizer": "adamw_torch",
                "seed": random_state,
            }

            import math
            _steps_per_epoch = max(
                1, math.ceil(len(train_dataset) / hp["per_device_train_batch_size"])
            )
            _total_steps = _steps_per_epoch * hp["num_train_epochs"]
            hp["warmup_steps"] = int(data.get(
                "warmupSteps", max(1, min(100, int(0.1 * _total_steps)))
            ))
            hp["warmup_ratio_effective"] = round(hp["warmup_steps"] / _total_steps, 4)
            hp["total_optimizer_steps"] = _total_steps

            training_args = TrainingArguments(
                output_dir='./results',
                num_train_epochs=hp["num_train_epochs"],
                learning_rate=hp["learning_rate"],
                per_device_train_batch_size=hp["per_device_train_batch_size"],
                per_device_eval_batch_size=hp["per_device_eval_batch_size"],
                warmup_steps=hp["warmup_steps"],
                weight_decay=hp["weight_decay"],
                optim=hp["optimizer"],
                seed=hp["seed"],
                logging_steps=10,
                eval_strategy="epoch", save_strategy="no",
                load_best_model_at_end=False, report_to="none"
            )

            total_steps = _total_steps

            trainer = Trainer(
                model=model, args=training_args,
                train_dataset=train_dataset, eval_dataset=test_dataset,
                callbacks=[StreamCallback(total_steps, progress_queue)]  # Pass queue
            )
            
            # Training blocks, so run it off-thread and drain progress here.
            import threading
            training_done = threading.Event()
            training_error = [None]

            def run_training():
                try:
                    trainer.train()
                except Exception as e:
                    training_error[0] = e
                finally:
                    training_done.set()

            import time as _time
            _t0 = _time.time()
            training_thread = threading.Thread(target=run_training)
            training_thread.start()

            # Drain progress queue while training runs
            while not training_done.is_set() or not progress_queue.empty():
                try:
                    msg = progress_queue.get(timeout=0.5)
                    yield f"data: {json.dumps(msg)}\n\n"
                except queue.Empty:
                    continue

            train_seconds = _time.time() - _t0

            if training_error[0]:
                raise training_error[0]

            yield f"data: {json.dumps({'progress': 90, 'status': 'Evaluating model...'})}\n\n"

            predictions = trainer.predict(test_dataset)
            y_pred = np.argmax(predictions.predictions, axis=1)

            accuracy = round(float(accuracy_score(y_test, y_pred)), 3)
            precision = round(float(precision_score(y_test, y_pred, average='weighted', zero_division=0)), 3)
            recall = round(float(recall_score(y_test, y_pred, average='weighted', zero_division=0)), 3)
            f1 = round(float(f1_score(y_test, y_pred, average='weighted', zero_division=0)), 3)

            y_test_labels = [id2label[i] for i in y_test]
            y_pred_labels = [id2label[i] for i in y_pred]
            report = classification_report(y_test_labels, y_pred_labels, zero_division=0)
            misclassified = [texts_test[i][:100] for i in range(len(y_test)) if y_test[i] != y_pred[i]]

            result = {
                "model": _MODEL_DISPLAY_NAMES.get(model_type, model_type),
                "metrics": {"accuracy": accuracy, "precision": precision, "recall": recall, "f1": f1},
                "classification_report": report,
                "labels": unique_labels,
                "y_true": y_test_labels, "y_pred": y_pred_labels,
                "misclassified": misclassified,
                "preprocessing": None,
                # Reported so a run can be described exactly in a write-up.
                "hf_model_id": model_name,
                "hyperparameters": hp,
                "n_train": len(texts_train),
                "n_test": len(texts_test),
                "train_seconds": round(train_seconds, 1),
            }

            yield f"data: {json.dumps({'progress': 100, 'status': 'Complete', 'result': result})}\n\n"
        except Exception as e:
            logging.exception("api_predict_transformer_stream failed")
            yield f"data: {json.dumps({'error': str(e)})}\n\n"

    return Response(
        generate(),
        mimetype='text/event-stream',
        headers={
            'Cache-Control': 'no-cache',
            'X-Accel-Buffering': 'no'  # Prevents nginx from buffering the stream
        }
    )
            
@pred_bp.route('/api/preprocess_preview', methods=['POST'])
def preprocess_preview():
    """
    Preview endpoint for preprocessing - used by frontend to show results
    before applying to actual modeling.
    """
    try:
        data = request.get_json()
        
        # Extract data
        rows = data.get('rows', [])
        settings = data.get('settings', {})
        
        # Extract texts and labels
        texts = [row['text'] for row in rows]
        labels = [row['label'] for row in rows]
        
        print(f"[PREVIEW] Processing {len(texts)} texts with settings: {settings}")
        
        # Apply preprocessing (training mode - no artifacts)
        result = preprocess_pipeline(
            texts=texts,
            labels=labels,
            settings=settings,
            artifacts=None  # Training mode
        )
        
        print(f"[PREVIEW] Result: vocab_size={result.get('vocab_size')}, n_features={result.get('n_features')}")
        
        # Calculate class distributions
        from collections import Counter
        original_dist = dict(Counter(labels))
        processed_dist = dict(Counter(result['labels']))
        
        # Return preview data
        return jsonify({
            'vocab_size': result.get('vocab_size', 0),
            'vector_dimensions': result.get('n_features', 0),
            'processed_sample': result['processed_texts'][0] if result['processed_texts'] else '',
            'original_class_distribution': original_dist,
            'processed_class_distribution': processed_dist,
            'n_samples': result.get('n_samples', len(result['labels'])),
            # Lets the Preprocessing tab warn when a resampler was selected but
            # produced nothing (an already-balanced dataset).
            'resampling': result.get('resampling', {})
        })
        
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        print(f"[ERROR] preprocess_preview failed: {error_trace}")
        return jsonify({
            'error': str(e),
            'detail': error_trace
        }), 500
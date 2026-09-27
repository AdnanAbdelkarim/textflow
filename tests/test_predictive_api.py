"""The Predictive Modeling tab: training, evaluation, multi-label routing."""
import pytest

TFIDF = {"useTFIDF": True, "vectorSize": 100}
W2V = {"useWord2Vec": True, "vectorSize": 100}

SPARSE_OK = ["nb", "lr", "svm", "knn"]
DENSE_ONLY = ["gda"]


def _train(client, rows, model, settings=None):
    payload = {"rows": rows, "model": model, "testSize": 0.3, "randomState": 42}
    if settings is not None:
        payload["usePreprocessed"] = True
        payload["preprocessingSettings"] = settings
    return client.post("/api/predict", json=payload)


@pytest.mark.parametrize("model", SPARSE_OK)
def test_each_model_trains(client, rows, model):
    r = _train(client, rows, model)
    assert r.status_code == 200, f"{model}: {r.get_json()}"
    body = r.get_json()
    assert 0.0 <= body["metrics"]["accuracy"] <= 1.0
    assert body["classification_report"]
    assert body["model_implementation"], "the trained estimator is not reported"


@pytest.mark.parametrize("model", DENSE_ONLY)
def test_dense_only_model_trains_with_word2vec(client, rows, model):
    r = _train(client, rows, model, W2V)
    assert r.status_code == 200, f"{model}: {r.get_json()}"
    assert 0.0 <= r.get_json()["metrics"]["accuracy"] <= 1.0


def test_incompatible_model_and_features_is_refused_not_swapped(client, rows):
    """GDA cannot take sparse counts. It must be refused, never silently swapped.

    A silent substitution is what produced the SMOTE anomaly in the first place.
    """
    r = _train(client, rows, "gda", TFIDF)
    assert r.status_code == 400
    assert "error" in r.get_json()


def test_unknown_model_rejected(client, rows):
    r = _train(client, rows, "does_not_exist")
    assert r.status_code in (400, 422), r.get_json()


def test_empty_rows_rejected(client):
    r = client.post("/api/predict", json={"rows": [], "model": "lr"})
    assert r.status_code == 400


def test_multilabel_rows_route_to_multilabel_path(client, multilabel_rows):
    r = client.post("/api/predict",
                    json={"rows": multilabel_rows, "model": "lr",
                          "testSize": 0.3, "randomState": 42})
    assert r.status_code == 200, r.get_json()
    body = r.get_json()
    assert body["task"] == "multilabel"
    for key in ("hamming_loss", "f1_macro", "f1_micro", "subset_accuracy"):
        assert key in body["metrics"], f"missing {key}: {list(body['metrics'])}"
    assert 0.0 <= body["metrics"]["hamming_loss"] <= 1.0
    assert body["per_label"], "no per-label metrics returned"
    stats = body["label_statistics"]
    assert stats["label_cardinality"] >= 1.0
    assert 0.0 < stats["label_density"] <= 1.0


def test_multilabel_is_not_confused_with_single_label(client, rows):
    """Single-label rows must keep returning accuracy, not Hamming loss."""
    body = _train(client, rows, "lr").get_json()
    assert body.get("task") != "multilabel"
    assert "accuracy" in body["metrics"]
    assert "hamming_loss" not in body["metrics"]

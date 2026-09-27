"""Every page route renders and loads the scripts its tab depends on."""
import pytest

PAGES = ["/", "/overview", "/visualizations", "/advanced",
         "/preprocessing", "/predictive"]


@pytest.mark.parametrize("path", PAGES)
def test_page_renders(client, path):
    r = client.get(path)
    assert r.status_code == 200, f"{path} returned {r.status_code}"
    assert b"<html" in r.data.lower()


@pytest.mark.parametrize("path", PAGES)
def test_page_loads_shared_state_module(client, path):
    """A tab that misses core/state.js cannot resolve class names or the corpus."""
    body = client.get(path).data.decode()
    assert "core/state.js" in body, f"{path} does not load core/state.js"


def test_healthz(client):
    r = client.get("/healthz")
    assert r.status_code == 200
    assert b"ok" in r.data

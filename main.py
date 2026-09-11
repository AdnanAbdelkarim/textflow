"""
TextFlow - Flask application entry point.

After Phase 6 modularization, business logic lives in:
  - services/   (tokenization, topic_labels, cache, nltk_setup, preprocessing)
  - routes/     (pages, visualizations, nlp, predictive)

This file is responsible only for:
  1. Flask app initialization
  2. NLTK data setup (one-time, on startup)
  3. Page route registration (HTML templates)
  4. Blueprint registration (API endpoints)
  5. Health check endpoint
  6. Application entrypoint
"""
import logging
import os
import ssl

from flask import Flask, render_template

from services.nltk_setup import ensure_nltk_data
from routes.visualizations import viz_bp
from routes.nlp import nlp_bp
from routes.predictive import pred_bp


# --- Logging ---
logging.basicConfig(level=logging.INFO)


# --- TLS for NLTK downloads ---
# Some Python installs, notably the python.org macOS installer, ship without a
# CA bundle, so NLTK's urllib downloads fail certificate verification. Point
# urllib at certifi's bundle; verification stays enabled.
try:
    import certifi
    ssl._create_default_https_context = (
        lambda: ssl.create_default_context(cafile=certifi.where())
    )
except ImportError:
    pass


# --- NLTK setup (one-time on startup, downloads only if missing) ---
ensure_nltk_data()


# --- Flask app initialization ---
print("Flask app is starting...")
app = Flask(__name__, static_folder="static", template_folder="templates")
print("Flask app created.")


# --- Page routes (HTML templates) ---
@app.route('/')
def index():
    return render_template('index.html')


@app.route('/overview')
def overview():
    return render_template('overview.html')


@app.route('/advanced')
def advanced():
    return render_template('advanced.html')


@app.route('/visualizations')
def visualizations():
    return render_template('visualizations.html')


@app.route("/preprocessing")
def preprocessing():
    return render_template("preprocessing.html")


@app.route('/predictive')
def predictive():
    return render_template('predictive.html')


# --- API blueprints ---
app.register_blueprint(viz_bp)
app.register_blueprint(nlp_bp)
app.register_blueprint(pred_bp)


# --- Health check ---
@app.route("/healthz")
def healthz():
    return "ok", 200


# --- Entry point ---
if __name__ == "__main__":
    # Development server. Binds to localhost with the debugger off unless
    # FLASK_DEBUG=1, because the Werkzeug debugger allows code execution.
    # The Docker image serves the app with gunicorn instead.
    app.run(
        host=os.getenv("TEXTFLOW_HOST", "127.0.0.1"),
        port=int(os.getenv("TEXTFLOW_PORT", "5000")),
        debug=os.getenv("FLASK_DEBUG") == "1",
    )
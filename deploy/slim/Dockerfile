# syntax=docker/dockerfile:1
#
# Slim deployment image, for hosting the platform online.
#
# Built from requirements-slim.txt, which omits torch, transformers and the
# spaCy transformer model. Those are three quarters of the full install and
# serve two features a free CPU host cannot provide anyway: BERT fine-tuning,
# which needs a GPU, and transformer NER, which takes minutes to load.
#
# Everything else is unchanged: the six visualizations, sentiment analysis,
# topic modeling, n-gram exploration, preprocessing and the five classical
# classifiers. NER falls back to en_core_web_sm, and the interface hides BERT
# fine-tuning by asking /api/capabilities.
#
# Use the Dockerfile at the repository root for local and offline use, which
# keeps the transformer features.

FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# gensim compiles Cython extensions where no wheel is published.
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements-slim.txt .
RUN pip install --upgrade pip setuptools wheel \
    && pip install -r requirements-slim.txt

ENV NLTK_DATA=/opt/nltk_data
RUN python -m nltk.downloader -d /opt/nltk_data \
        punkt punkt_tab \
        averaged_perceptron_tagger averaged_perceptron_tagger_eng \
        maxent_ne_chunker maxent_ne_chunker_tab \
        words


FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NLTK_DATA=/opt/nltk_data \
    PATH="/opt/venv/bin:$PATH"

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/nltk_data /opt/nltk_data

RUN useradd --create-home --uid 1000 user
WORKDIR /app

COPY --chown=user:user main.py ./
COPY --chown=user:user routes/ ./routes/
COPY --chown=user:user services/ ./services/
COPY --chown=user:user static/ ./static/
COPY --chown=user:user templates/ ./templates/

RUN mkdir -p /app/results && chown -R user:user /app
USER user

# Hosts set PORT; 8080 is a common default when they do not.
ENV PORT=8080
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -fsS "http://localhost:${PORT}/healthz" || exit 1

# One worker, since a second would duplicate the loaded models in memory.
#
# Three threads rather than eight. Each in-flight request builds its own term
# matrix, so concurrency multiplies peak memory rather than just spreading the
# CPU. Measured on a 512 MB instance, eight threads under simultaneous
# requests reached 483 MB and the host closed connections. Three keeps the
# peak well inside the limit while still overlapping requests.
CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT} \
     --workers 1 --threads 3 --timeout 300 --graceful-timeout 30 \
     --max-requests 200 --max-requests-jitter 40 \
     --access-logfile - --error-logfile - main:app"]

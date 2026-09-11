# syntax=docker/dockerfile:1

# ---------------------------------------------------------------------------
# Build stage - install Python dependencies and pre-download model data.
#
# Models and NLTK corpora are baked into the image rather than downloaded at
# first request: en_core_web_trf alone is ~450 MB, and downloading it lazily
# would make the first NER request in a fresh container time out.
# ---------------------------------------------------------------------------
FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# build-essential is needed to compile gensim's Cython extensions on platforms
# without a prebuilt wheel (notably linux/arm64).
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
    && rm -rf /var/lib/apt/lists/*

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

COPY requirements.txt .

# CPU-only PyTorch. On Linux the default torch wheel declares the CUDA toolkit,
# cuDNN and cuSPARSELt as unconditional dependencies, adding several gigabytes
# of GPU libraries this container cannot use. Installing from the CPU index
# first satisfies the torch requirement that transformers[torch] pulls in, so
# the GPU build is never fetched.
ARG TORCH_VERSION=2.14.0
RUN pip install --upgrade pip setuptools wheel \
    && pip install "torch==${TORCH_VERSION}" \
         --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r requirements.txt

# NLTK corpora used by the NER and tokenization paths.
ENV NLTK_DATA=/opt/nltk_data
RUN python -m nltk.downloader -d /opt/nltk_data \
        punkt punkt_tab \
        averaged_perceptron_tagger averaged_perceptron_tagger_eng \
        maxent_ne_chunker maxent_ne_chunker_tab \
        words


# ---------------------------------------------------------------------------
# Runtime stage
# ---------------------------------------------------------------------------
FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    NLTK_DATA=/opt/nltk_data \
    PATH="/opt/venv/bin:$PATH" \
    HF_HOME=/home/textflow/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
        curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/nltk_data /opt/nltk_data

RUN useradd --create-home --uid 10001 textflow
WORKDIR /app

COPY --chown=textflow:textflow main.py ./
COPY --chown=textflow:textflow routes/ ./routes/
COPY --chown=textflow:textflow services/ ./services/
COPY --chown=textflow:textflow static/ ./static/
COPY --chown=textflow:textflow templates/ ./templates/

# Writable locations for the unprivileged user. The Hugging Face cache is
# created here with the right owner so the named volume compose mounts on it
# inherits that owner: Docker copies ownership into an empty volume on first
# mount, and would otherwise create it owned by root. The Trainer writes its
# working files under /app/results.
RUN mkdir -p /home/textflow/.cache/huggingface /app/results \
    && chown -R textflow:textflow /home/textflow/.cache /app

USER textflow
EXPOSE 5000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -fsS http://localhost:5000/healthz || exit 1

# Two workers with a long timeout: BERT fine-tuning and transformer NER are
# both long-running, single-request operations, and the SSE training stream
# must not be cut short by the default 30s worker timeout.
CMD ["gunicorn", "--bind", "0.0.0.0:5000", \
     "--workers", "2", "--threads", "4", \
     "--timeout", "1800", "--graceful-timeout", "30", \
     "--access-logfile", "-", "--error-logfile", "-", \
     "main:app"]

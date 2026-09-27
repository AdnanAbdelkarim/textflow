# syntax=docker/dockerfile:1
#
# TextFlow on Hugging Face Spaces (Docker SDK).
#
# Differences from the Dockerfile at the repository root, all of them forced by
# the Spaces runtime rather than by choice:
#   - Spaces routes traffic to port 7860 and runs the container as UID 1000.
#   - The free CPU tier has 2 vCPU and 16 GB RAM, so this runs a single gunicorn
#     worker. Two workers would hold two copies of the spaCy transformer.
#   - The application is cloned from GitHub at build time, so the Space stays a
#     thin deployment descriptor and the repository remains the single source of
#     truth. Pin TEXTFLOW_REF to a commit for a reproducible build.

FROM python:3.11-slim AS builder

ENV PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential git \
    && rm -rf /var/lib/apt/lists/*

ARG TEXTFLOW_REPO=https://github.com/AdnanAbdelkarim/textflow
ARG TEXTFLOW_REF=main
# Fetch the ref by name so that TEXTFLOW_REF accepts a branch, a tag or a
# commit SHA. "git clone --branch" would reject a bare SHA.
RUN git init /src \
    && git -C /src remote add origin "${TEXTFLOW_REPO}" \
    && git -C /src fetch --depth 1 origin "${TEXTFLOW_REF}" \
    && git -C /src checkout FETCH_HEAD

RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# CPU-only PyTorch, installed first so that the CUDA build is never pulled in
# as a transitive dependency of transformers[torch].
ARG TORCH_VERSION=2.14.0
RUN pip install --upgrade pip setuptools wheel \
    && pip install "torch==${TORCH_VERSION}" \
         --index-url https://download.pytorch.org/whl/cpu \
    && pip install -r /src/requirements.txt

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
    PATH="/opt/venv/bin:$PATH" \
    HOME=/home/user \
    HF_HOME=/home/user/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends curl \
    && rm -rf /var/lib/apt/lists/*

COPY --from=builder /opt/venv /opt/venv
COPY --from=builder /opt/nltk_data /opt/nltk_data

# Spaces runs the container as UID 1000.
RUN useradd --create-home --uid 1000 user
WORKDIR /app

COPY --from=builder --chown=user:user /src/main.py ./
COPY --from=builder --chown=user:user /src/routes/ ./routes/
COPY --from=builder --chown=user:user /src/services/ ./services/
COPY --from=builder --chown=user:user /src/static/ ./static/
COPY --from=builder --chown=user:user /src/templates/ ./templates/

RUN mkdir -p /home/user/.cache/huggingface /app/results \
    && chown -R user:user /home/user /app

USER user
EXPOSE 7860

HEALTHCHECK --interval=30s --timeout=5s --start-period=120s --retries=3 \
    CMD curl -fsS http://localhost:7860/healthz || exit 1

# One worker: the spaCy transformer is roughly 500 MB resident and a second
# worker would duplicate it. Threads carry the concurrency instead. The long
# timeout covers NER over a large corpus and the fine-tuning stream.
CMD ["gunicorn", "--bind", "0.0.0.0:7860", \
     "--workers", "1", "--threads", "8", \
     "--timeout", "1800", "--graceful-timeout", "30", \
     "--access-logfile", "-", "--error-logfile", "-", \
     "main:app"]

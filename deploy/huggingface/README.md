---
title: TextFlow
emoji: 📝
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
license: mit
---

# TextFlow

A no-code platform for text analysis and NLP. Upload a corpus and work through
six tabs: Input, Overview, Visualizations, Advanced Analysis, Preprocessing and
Predictive Modeling. No programming required.

This Space is a convenience demo. TextFlow is designed to run on your own
machine, and the container image in the
[repository](https://github.com/AdnanAbdelkarim/textflow) starts it with a
single command. Nothing is stored server-side: an uploaded dataset is held in
the browser session and sent with each request.

## What runs well here, and what does not

This Space uses the free CPU tier, 2 vCPU and 16 GB RAM, with one worker.

Comfortable: corpus statistics, all six visualizations, sentiment analysis,
topic modeling, n-gram exploration, preprocessing, and training the traditional
classifiers.

Slow: named entity recognition uses a transformer model that takes a few
minutes to load when the Space wakes up. The first request after a cold start
will wait for it.

Not usable on this tier: BERT fine-tuning in the Predictive Modeling tab. It
needs a GPU to finish in reasonable time. Run it locally, or on a GPU Space.

The free tier also sleeps after a period of inactivity, so the first visit
afterwards pays the start-up cost again.

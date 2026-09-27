# Deploying TextFlow to Hugging Face Spaces

The Space holds only `Dockerfile` and `README.md`. The application is cloned
from GitHub while the image builds, so the repository stays the single source
of truth and the Space never holds a second copy of the code.

## Create the Space

1. Sign in at <https://huggingface.co>, then go to **New** > **Space**.
2. Give it a name, choose **Docker** as the SDK and **Blank** as the template,
   and leave the hardware on the free CPU tier.
3. Clone the empty Space and copy these two files into it:

```bash
git clone https://huggingface.co/spaces/<your-username>/<space-name>
cp deploy/huggingface/Dockerfile deploy/huggingface/README.md <space-name>/
cd <space-name> && git add . && git commit -m "Deploy TextFlow" && git push
```

The build takes roughly 15 to 25 minutes. Most of it is PyTorch and the
`en_core_web_trf` model, which together come to about 1 GB.

## Pinning a version

`TEXTFLOW_REF` defaults to `main`. For a build that can be reproduced later,
set it to a commit in the Space settings under **Variables and secrets**, or
edit the `ARG` in the Dockerfile:

```dockerfile
ARG TEXTFLOW_REF=d711f7c
```

## Updating

The Space rebuilds when you push to it. Because the code is cloned during the
build, a change on GitHub alone does not trigger one, and Docker may reuse the
cached clone layer. Force a fresh clone by changing `TEXTFLOW_REF`, or use
**Factory rebuild** in the Space settings.

## Checking it came up

```bash
curl -fsS https://<your-username>-<space-name>.hf.space/healthz
```

Expect `ok`. The logs tab shows `NER model warm-up complete.` once the spaCy
transformer has finished loading, which is when named entity recognition
becomes responsive.

## Hardware

The free CPU tier runs everything except BERT fine-tuning, which needs a GPU.
If you need that in the hosted demo, upgrade the Space hardware and raise the
worker count in the Dockerfile.

# Hosting the slim build

The image built from `deploy/slim/Dockerfile` runs the platform without the
transformer stack, which takes the install from about 1,729 MB to about
415 MB. It fits the free tier of a container host; the full image does not.

What changes: BERT fine-tuning is unavailable, and named entity recognition
uses `en_core_web_sm` rather than the transformer model. The interface asks
`/api/capabilities` on load and hides BERT fine-tuning when it is absent,
rather than offering it and failing once training starts.

Everything else behaves as it does locally.

## Northflank

The free Developer plan gives one vCPU and 1 GB of memory per service, which
is enough for this image, and it deploys from GitHub on every push.

1. Sign in at <https://northflank.com> and create a project.
2. Add a **Combined service**, choose this repository and the `main` branch.
3. Set the build type to **Dockerfile** with the path
   `deploy/slim/Dockerfile` and the build context `/`.
4. Set the exposed port to `8080` and make it public.
5. Deploy. The first build takes roughly ten minutes.

The service is then reachable at the address Northflank assigns, and every
push to `main` rebuilds it.

## Anywhere else

The image reads the `PORT` environment variable and defaults to 8080, so it
also runs unchanged on Render, Railway, Fly.io or a plain virtual machine:

```bash
docker build -f deploy/slim/Dockerfile -t textflow-slim .
docker run -p 8080:8080 textflow-slim
```

## Checking a deployment

```bash
curl -fsS https://<your-host>/healthz          # expect: ok
curl -fsS https://<your-host>/api/capabilities # expect: {"transformers": false}
```

The second is the one worth checking after a deploy: if it reports `true`, the
full requirements were installed by mistake and the service will use far more
memory than the host allows.

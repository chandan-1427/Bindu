# Custom image (A1 mode)

When you pass `--image` to `bindu deploy`, the boxd runtime skips source
packaging entirely. boxd creates the VM from your Docker image and the
image's `CMD` is the entrypoint. Use this when:

- Your agent has gnarly native deps (Rust toolchain, system libs).
- You want reproducible deploys (pinned image hashes, audited bases).
- You ship your agent through CI/CD that already builds container
  images.

## Dockerfile template

```dockerfile
FROM python:3.12-slim

# Install bindu + your deps
WORKDIR /app
COPY pyproject.toml requirements*.txt ./
RUN pip install bindu
RUN pip install -r requirements.txt    # or: pip install -e .

# Copy your agent code
COPY . /app

# Entrypoint: invoke the agent script via the bindu CLI
CMD ["bindu", "serve", "--script", "/app/my_agent.py"]
```

Push to a registry that boxd can pull from (any public registry, or a
private one with credentials configured on your boxd account).

## Wiring it up

```bash
bindu deploy my_agent.py \
    --runtime=boxd \
    --image=ghcr.io/me/my-agent:v1.2.0
```

When `--image` is set:
- No source upload.
- No `pip install` step.
- The image's `CMD` starts the agent.
- Health check, log streaming, on-exit lifecycle: identical to A2.

## Trade-offs vs A2 (default)

| | A2 (source mount) | A1 (custom image) |
|---|---|---|
| Setup | None — just run | Build + push image |
| Iteration speed | Fast (1–3s warm) | Slow (build + push + redeploy) |
| Reproducibility | Depends on `pip install` resolving the same deps | Pinned by image hash |
| Native deps | Limited to what `pip install` can build in the VM | Anything that builds at image time |
| Image registry needed | No | Yes |

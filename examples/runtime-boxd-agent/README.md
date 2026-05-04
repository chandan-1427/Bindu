# runtime-boxd-agent

A bindu echo agent. Runs locally as a regular Python script, or deploys to a
[boxd](https://boxd.sh) microVM via `bindu deploy` — own machine, own IP, own
HTTPS domain, own DID.

The script body has no deploy logic — just `bindufy(config, handler)`. Where
the agent runs is decided by the CLI:

```bash
python agent.py                              # local: http://localhost:3773
bindu deploy agent.py --runtime=boxd ...     # remote: https://<name>.boxd.sh
```

## Run remotely

```bash
# 1. Install bindu with the boxd runtime extra
pip install 'bindu[runtime-boxd]'

# 2. Authenticate
boxd login           # browser flow; or set BOXD_TOKEN directly
export BOXD_TOKEN=$(jq -r .token ~/.config/boxd/credentials.json)

# 3. Deploy
bindu deploy agent.py \
    --runtime=boxd \
    --auto-suspend=60 \
    --on-exit=suspend
```

You should see:

```
✓ runtime-boxd-example serving at https://runtime-boxd-example.boxd.sh

[runtime-boxd-example] INFO: Started server process [...]
[runtime-boxd-example] INFO: Application startup complete.
```

In another terminal:

```bash
curl https://runtime-boxd-example.boxd.sh/health
curl https://runtime-boxd-example.boxd.sh/.well-known/agent.json
```

Ctrl-C the deploy terminal — boxd auto-suspends the VM after 60s of inactivity.
Re-run `bindu deploy` to resume (~1 second warm).

## What just happened

1. `bindu deploy` ran `agent.py` once locally with a capture sentinel set, so
   `bindufy()` returned the agent name and source root without serving.
2. The CLI packaged this directory into a tarball.
3. It created a boxd VM named `runtime-boxd-example` (or reused an existing
   one with that name).
4. It uploaded the tarball, ran `pip install bindu` + `pip install -e .`
   inside the VM.
5. It exec'd `bindu serve --script agent.py` inside the VM, which runs the
   script normally — `bindufy()` sees no capture sentinel and serves the
   standard in-process server on port 3773.
6. Boxd's proxy routes public HTTPS traffic to the agent's port.
7. The host streams VM logs to your terminal until you Ctrl-C.

## See also

- `docs/runtime/README.md` — overview of the runtime-provider abstraction.
- `docs/runtime/boxd.md` — full `bindu deploy` flag reference (vcpu, memory,
  on_exit modes, etc.).
- `docs/runtime/custom-image.md` — A1 mode (deploy from a pre-built Docker
  image instead of shipping source).

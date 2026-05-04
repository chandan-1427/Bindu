"""Bindu echo agent — runs in-process locally, or in a boxd VM via the CLI.

The script body is a vanilla bindu agent: ``bindufy(config, handler)`` and
nothing else. There is no deploy logic here — that lives in the ``bindu
deploy`` CLI, which packages this directory, ships it to a boxd VM, installs
bindu + the user's deps, and starts the agent there. The host streams VM
logs and supervises until Ctrl-C; A2A clients talk directly to the public
URL printed at startup.

Local dev::

    python agent.py
    # serves on http://localhost:3773

Deploy to a boxd VM::

    pip install 'bindu[runtime-boxd]'
    export BOXD_TOKEN=$(boxd login --json | jq -r .token)
    bindu deploy agent.py --runtime=boxd --auto-suspend=60 --on-exit=suspend

After ``✓ runtime-boxd-example serving at https://...``, hit it::

    curl https://runtime-boxd-example.boxd.sh/health
    curl https://runtime-boxd-example.boxd.sh/.well-known/agent.json

Ctrl-C detaches; the VM auto-suspends after 60s of inactivity. Re-running
``bindu deploy`` resumes in ~1s.

See ``docs/runtime/`` for the full runtime-provider documentation.
"""

from bindu.penguin.bindufy import bindufy


def handler(messages: list[dict[str, str]]):
    """Echo the latest user message back."""
    if not messages:
        return "send a message"
    return [
        {
            "role": "assistant",
            "content": messages[-1].get("content", ""),
        }
    ]


config = {
    "author": "you@example.com",
    "name": "runtime-boxd-example",
    "description": "Echo agent running inside a boxd microVM.",
    "deployment": {
        # The agent inside the VM binds 0.0.0.0:3773 so the boxd proxy can
        # reach it. The host injects BINDU_PUBLIC_URL automatically when
        # deployed via ``bindu deploy``.
        "url": "http://0.0.0.0:3773",
        "expose": True,
    },
}


if __name__ == "__main__":
    bindufy(config, handler)

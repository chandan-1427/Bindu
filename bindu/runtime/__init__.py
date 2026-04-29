"""Runtime provider abstraction for bindu agents.

A `RuntimeProvider` controls *where* a bindu agent's process runs.
The default (`InProcessRuntimeProvider`) runs the agent in the host
process, matching today's behavior. `BoxdRuntimeProvider` runs the
agent inside a boxd microVM.
"""

# Performance reviewer

Find measurable regressions or scalability risks introduced by the change.

Flag:

- new N+1 queries or network calls
- expensive work inside render/hot loops
- avoidable large allocations or memory leaks
- broken caching, memoization, pagination, batching, streaming, or indexing
- concurrency or backpressure issues
- bundle-size regressions from heavy imports on hot paths

Do not flag:

- micro-optimizations
- hypothetical performance concerns without a hot path
- readability tradeoffs for tiny gains
- unchanged slow code not affected by the diff

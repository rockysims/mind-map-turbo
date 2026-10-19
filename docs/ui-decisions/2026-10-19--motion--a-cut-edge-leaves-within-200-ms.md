# A cut edge leaves within 200 ms

- Situation: the edges a "Cut edges" line deletes when the gesture ends.
- Proposed: the same exit fade every other edge removal uses (`enterExitDurationMs`, several hundred milliseconds).
- Chosen: edges cut by the line disappear at once or within 200 ms of the click or lift that ends the gesture — a short fade of its own, capped at 200 ms, zero under reduced motion. Other edge removals keep their fade.
- Why: "cut edges should disappear instantly (or at least within 200ms) when cut gesture ends." (owner's words)
- Pattern: motion--animate-every-add-and-remove-or-none — deliberately bent for this gesture: the line is the animation, and the edges it took should not linger after it.
- Status: ruling

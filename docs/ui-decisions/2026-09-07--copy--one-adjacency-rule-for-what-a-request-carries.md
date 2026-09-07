# One adjacency rule for what a request carries

- Situation: a request gathers two kinds of context from the graph, files from one hop and prose from several, and each could follow its own rule about which edges count.
- Proposed: prose follows incoming directed edges only, on the argument that an undirected edge says "related" and not "came first".
- Chosen: both follow the same rule, incoming directed or undirected, with the prose walk capped by hops.
- Why: "not sure I fully understand but I like the simplicity of one rule" (owner's words)
- Pattern: copy--fix-the-vocabulary-in-one-pass (one rule the reader can hold in their head).
- Status: ruling

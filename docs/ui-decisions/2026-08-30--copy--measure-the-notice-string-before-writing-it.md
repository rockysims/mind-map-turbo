# Measure the notice string before writing it

- Situation: a toolbar notice in a fixed 12rem column that stacks one sentence per line, with `white-space: nowrap`.
- Proposed: the one-sentence version of the newer-app warning, which measured 208px against a 182px widest existing line.
- Chosen: two sentences measuring 157px and 172px, the second naming the consequence rather than leaving it inferred, rendered in the toolbar's amber; the date stays because it is what tells the reader which file is the newer app. Notice statuses name their own severity — the six existing sticky notices do not escalate with it.
- Why: "The wording changed with the colour, because it had to" — the longer line "would have wrapped and grown a bar the toolbar deliberately keeps a fixed size." And: "That is work at risk, which is what the toolbar's amber is for, so the notice now says so in colour as well as words."
- Pattern: copy--treat-copy-length-as-a-layout-constraint
- Status: ruling

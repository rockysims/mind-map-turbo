/**
 * The one place that decides what an attachment is called once it reaches the
 * runtime.
 *
 * Three parties have to agree on that name and they used to each guess it:
 * `pyExecutor` writes the file into the work directory under it, the probe reports its
 * digest under it (`os.path.basename`), and `aiRequest` both lists it in the
 * system prompt as a name the script may open and matches digests to inputs by
 * it. Any disagreement is silent — the model is told a filename that does not
 * exist, or a measured digest is dropped from the request — so the rule lives
 * here and all three import it.
 */

/**
 * The directory scripts save into, which lives in the work directory beside the
 * attachments — so an attachment of that exact name has nowhere to be written.
 */
const OUTPUT_DIR_NAME = 'outputs';

/**
 * The name a file takes inside the runtime's work directory.
 *
 * Attachment names come from the user's filesystem and travel through the
 * graph file, so a path separator in one must not decide where the runtime
 * writes: only the basename survives, trimmed. A name that is nothing but
 * separators, dots or spaces would name a directory entry the runtime cannot
 * create, so it becomes `input`; a file called exactly `outputs` would collide
 * with the output directory, and writing over a directory fails the whole run,
 * so it gets a suffix instead.
 */
export function executorInputName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const trimmed = base.trim();
	if (trimmed === '' || trimmed === '.' || trimmed === '..') return 'input';
	return trimmed === OUTPUT_DIR_NAME ? `${OUTPUT_DIR_NAME}.input` : trimmed;
}

/**
 * The names a whole collection of inputs takes inside the work directory:
 * every one sanitised, and every repeat given a suffix so no two files land on
 * the same path.
 *
 * `executorInputName` decides one name at a time and cannot see a collision,
 * which stopped mattering the moment a node could read two neighbours' run
 * outputs: two sweeps each writing `plot.png` used to be one file written twice
 * — the second over the first — with the model told about both. So the rule
 * that makes a name unique has to see the whole list, and it is applied once
 * per collection rather than at each of the places that later need a name.
 *
 * Order-dependent and *only* order-dependent: the same list always yields the
 * same names, the first occurrence keeps the name it asked for, and each later
 * one takes the lowest free `-N` before its extension (`plot.png`,
 * `plot-2.png`, `plot-3.png`). A suffixed name that would itself collide with a
 * name asked for later takes the next number rather than either being dropped
 * or overwriting it.
 */
export function disambiguateExecutorNames(names: readonly string[]): string[] {
	const taken = new Set<string>();
	return names.map((name) => {
		const sanitised = executorInputName(name);
		if (!taken.has(sanitised)) {
			taken.add(sanitised);
			return sanitised;
		}
		const { stem, extension } = splitExtension(sanitised);
		for (let suffix = 2; ; suffix += 1) {
			const candidate = `${stem}-${suffix}${extension}`;
			if (taken.has(candidate)) continue;
			taken.add(candidate);
			return candidate;
		}
	});
}

/**
 * A filename as stem plus extension, so a suffix goes *before* the extension
 * and `plot-2.png` is still a PNG to everything that reads names.
 *
 * The last dot wins, so `archive.tar.gz` keeps `.gz`; a leading dot is not an
 * extension, so a dotfile suffixes at the end like a name with no dot at all.
 */
function splitExtension(name: string): { stem: string; extension: string } {
	const dot = name.lastIndexOf('.');
	if (dot <= 0) return { stem: name, extension: '' };
	return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

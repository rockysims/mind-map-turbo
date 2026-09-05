/**
 * The one place that decides what an attachment is called once it reaches the
 * runtime.
 *
 * Three parties have to agree on that name and they used to each guess it:
 * `pyExecutor` writes the file into `/inputs` under it, the probe reports its
 * digest under it (`os.path.basename`), and `aiRequest` both lists it in the
 * system prompt as a name the script may open and matches digests to inputs by
 * it. Any disagreement is silent — the model is told a filename that does not
 * exist, or a measured digest is dropped from the request — so the rule lives
 * here and all three import it.
 */

/**
 * The name a file takes inside the runtime's input directory.
 *
 * Attachment names come from the user's filesystem and travel through the
 * graph file, so a path separator in one must not decide where the runtime
 * writes: only the basename survives, trimmed. A name that is nothing but
 * separators, dots or spaces would name a directory entry the runtime cannot
 * create, so it becomes `input`.
 */
export function executorInputName(name: string): string {
	const base = name.split(/[\\/]/).pop() ?? '';
	const trimmed = base.trim();
	return trimmed === '' || trimmed === '.' || trimmed === '..' ? 'input' : trimmed;
}

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

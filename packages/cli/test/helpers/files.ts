/** A rendered file's content; throws with the rendered paths when it is missing. */
export function file(
  files: ReadonlyArray<{ path: string; content: string }>,
  path: string,
): string {
  const found = files.find((entry) => entry.path === path);
  if (!found)
    throw new Error(`${path} not rendered; have ${files.map((entry) => entry.path).join(', ')}`);
  return found.content;
}

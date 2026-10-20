import { rename } from "node:fs/promises";

/** Reads a JSON file; missing or corrupt → undefined. */
export async function readJson<T>(path: string): Promise<T | undefined> {
  const file = Bun.file(path);
  if (!(await file.exists())) return undefined;
  try {
    return (await file.json()) as T;
  } catch {
    return undefined;
  }
}

/** Write to a temp file and rename, so nobody ever reads a half-written file. */
export async function writeAtomic(path: string, content: string) {
  const tmp = `${path}.tmp`;
  await Bun.write(tmp, content);
  await rename(tmp, path);
}

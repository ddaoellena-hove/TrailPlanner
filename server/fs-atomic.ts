import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

/** Écriture atomique sur disque (fichier temporaire + rename dans le même dossier). */
export async function writeAtomic(target: string, content: string | Buffer): Promise<void> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content);
  await rename(temporary, target);
}

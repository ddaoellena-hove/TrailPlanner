import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { MAX_GPX_BYTES } from './gpx';

export class ConnectorError extends Error {}

/** Fichier proposé par une source : rien n'est lu tant que la synchronisation ne le demande pas. */
export type Candidate = { fileName: string; size: number; mtimeMs: number };

/**
 * Source de sorties. Une source ne fait que fournir des octets GPX : validation, doublons et
 * enregistrement restent dans `ActivityStore`. Elle ne modifie jamais ce qu'elle lit.
 */
export interface ActivityConnector {
  readonly label: string;
  list(): Promise<Candidate[]>;
  read(fileName: string): Promise<Buffer>;
}

/** Un fichier modifié il y a moins longtemps est peut-être encore en cours d'écriture. */
export const SETTLE_MS = 5000;

/**
 * Dossier choisi par l'utilisateur, lu sans être modifié : ni déplacement, ni renommage,
 * ni suppression. Seuls les `.gpx` du premier niveau sont pris, liens symboliques exclus.
 */
export class FolderConnector implements ActivityConnector {
  constructor(
    private readonly folder: string,
    private readonly now: () => number = Date.now,
  ) {
    if (!path.isAbsolute(folder)) {
      throw new ConnectorError('Le dossier de synchronisation doit être un chemin absolu');
    }
  }

  get label(): string {
    return this.folder;
  }

  async list(): Promise<Candidate[]> {
    let entries;
    try {
      entries = await readdir(this.folder, { withFileTypes: true });
    } catch (error) {
      const code = error instanceof Error && 'code' in error ? error.code : null;
      throw new ConnectorError(
        code === 'ENOENT'
          ? `Dossier introuvable : ${this.folder}`
          : code === 'ENOTDIR'
            ? `Ce chemin n'est pas un dossier : ${this.folder}`
            : `Dossier illisible : ${this.folder}`,
      );
    }
    const candidates: Candidate[] = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.gpx$/i.test(entry.name) || entry.name.startsWith('.')) continue;
      const info = await stat(path.join(this.folder, entry.name));
      if (this.now() - info.mtimeMs < SETTLE_MS) continue;
      candidates.push({ fileName: entry.name, size: info.size, mtimeMs: info.mtimeMs });
    }
    return candidates.toSorted((a, b) => a.fileName.localeCompare(b.fileName));
  }

  async read(fileName: string): Promise<Buffer> {
    // Le nom vient de `list()` : on refuse tout ce qui sortirait du dossier.
    if (path.basename(fileName) !== fileName) throw new ConnectorError('Nom de fichier invalide');
    const file = path.join(this.folder, fileName);
    const info = await stat(file);
    if (info.size > MAX_GPX_BYTES) throw new ConnectorError('Fichier trop volumineux (10 Mo maximum)');
    return readFile(file);
  }
}

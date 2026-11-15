import type { SyncReport } from './schema';

function count(n: number, one: string, many: string): string {
  return `${n} ${n > 1 ? many : one}`;
}

/** Résumé d'un passage : « 2 sorties importées, 1 doublon, 1 en attente, 1 échec ». */
export function summarizeSyncReport(report: SyncReport): string {
  const parts = [
    report.imported.length > 0 && count(report.imported.length, 'sortie importée', 'sorties importées'),
    report.duplicates.length > 0 && count(report.duplicates.length, 'doublon', 'doublons'),
    report.pending.length > 0 && `${report.pending.length} en attente`,
    report.failed.length > 0 && count(report.failed.length, 'échec', 'échecs'),
  ].filter((part): part is string => typeof part === 'string');
  if (parts.length > 0) return parts.join(', ');
  return report.alreadyHandled > 0
    ? 'Aucun nouveau fichier'
    : 'Aucun fichier GPX dans le dossier';
}

/** Le serveur exige un chemin absolu : « /Users/… » ou « C:\… ». */
export function isAbsoluteFolder(folder: string): boolean {
  return folder.startsWith('/') || /^[A-Za-z]:[\\/]/.test(folder);
}

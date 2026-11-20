import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

export type Row = Record<string, unknown>;

export async function openCatalog(file: string, readOnly = false): Promise<DuckDBConnection> {
  const instance = await DuckDBInstance.create(file, readOnly ? { access_mode: 'READ_ONLY' } : {});
  const connection = await instance.connect();
  await connection.run(
    'INSTALL spatial; LOAD spatial; INSTALL h3 FROM community; LOAD h3; SET geometry_always_xy = true;',
  );
  return connection;
}

/** Exécute un fichier SQL après remplacement des `{{clé}}`. */
export async function runSqlFile(
  connection: DuckDBConnection,
  name: string,
  params: Record<string, string | number>,
): Promise<void> {
  const file = path.join(path.dirname(new URL(import.meta.url).pathname), '..', name);
  let sql = await readFile(file, 'utf8');
  for (const [key, value] of Object.entries(params)) sql = sql.replaceAll(`{{${key}}}`, String(value));
  await connection.run(sql);
}

/** Lignes en objets JS ; les BIGINT deviennent des nombres ou des chaînes selon leur taille. */
export async function rows<T extends Row = Row>(connection: DuckDBConnection, sql: string): Promise<T[]> {
  const reader = await connection.runAndReadAll(sql);
  return reader.getRowObjectsJS().map(
    (row) =>
      Object.fromEntries(
        Object.entries(row).map(([k, v]) => [
          k,
          typeof v === 'bigint' ? (Number.isSafeInteger(Number(v)) ? Number(v) : v.toString()) : v,
        ]),
      ) as T,
  );
}

export function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

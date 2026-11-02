import { serve } from '@hono/node-server';
import { Client } from '@notionhq/client';
import { createApp } from './app';
import { env } from './env';
import { checkKeys } from './health';
import { NotionExporter } from './notion';

const notionClient = env.notionToken ? new Client({ auth: env.notionToken }) : undefined;
const notion =
  notionClient && env.notionDataSourceId && env.notionAreaPageId
    ? new NotionExporter(notionClient, {
        dataSourceId: env.notionDataSourceId,
        areaPageId: env.notionAreaPageId,
      })
    : undefined;

// Une seule vérification par démarrage : celle d'ORS consomme une requête du quota.
let health: ReturnType<typeof checkKeys> | undefined;

const app = createApp({
  tripsDir: env.tripsDir,
  settingsFile: env.settingsFile,
  orsApiKey: env.orsApiKey,
  notion,
  health: () => (health ??= checkKeys(env.orsApiKey, notionClient)),
});

const port = Number(process.env.API_PORT ?? 5174);

serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, ({ address, port }) => {
  console.log(`API Trailplan sur http://${address}:${port} (voyages : ${env.tripsDir})`);
});

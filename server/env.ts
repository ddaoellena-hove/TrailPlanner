import path from 'node:path';

try {
  process.loadEnvFile();
} catch {
  // Pas de .env : l'app reste utilisable sans clés (SPEC §3).
}

const rootDir = path.resolve(import.meta.dirname, '..');

export const env = {
  orsApiKey: process.env.ORS_API_KEY || undefined,
  anthropicApiKey: process.env.ANTHROPIC_API_KEY || undefined,
  openaiApiKey: process.env.OPENAI_API_KEY || undefined,
  openaiModel: process.env.OPENAI_MODEL || undefined,
  notionToken: process.env.NOTION_TOKEN || undefined,
  notionDataSourceId: process.env.NOTION_PROJECTS_DATA_SOURCE_ID || undefined,
  notionAreaPageId: process.env.NOTION_AREA_TRAVEL_PAGE_ID || undefined,
  tripsDir: path.resolve(rootDir, process.env.TRIPS_DIR || './trips'),
  settingsFile: path.resolve(rootDir, process.env.SETTINGS_FILE || './settings.json'),
};

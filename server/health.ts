import type { Client } from '@notionhq/client';
import type { Health } from '../shared/schema';

const ORS_CHECK_URL =
  'https://api.openrouteservice.org/v2/directions/driving-car?start=6.08,44.56&end=6.09,44.57';

/** Une panne réseau ne dit rien de la clé : seul un refus explicite la rend invalide. */
async function checkOrs(apiKey: string | undefined): Promise<Health['ors']> {
  if (!apiKey) return 'missing';
  try {
    const response = await fetch(ORS_CHECK_URL, {
      headers: { authorization: apiKey },
      signal: AbortSignal.timeout(5000),
    });
    return response.status === 401 || response.status === 403 ? 'invalid' : 'configured';
  } catch {
    return 'configured';
  }
}

async function checkNotion(client: Pick<Client, 'users'> | undefined): Promise<Health['notion']> {
  if (!client) return 'missing';
  try {
    await client.users.me({});
    return 'configured';
  } catch (error) {
    const status = error instanceof Error && 'status' in error ? error.status : undefined;
    return status === 401 ? 'invalid' : 'configured';
  }
}

export async function checkKeys(
  orsApiKey: string | undefined,
  notion: Pick<Client, 'users'> | undefined,
): Promise<Health> {
  const [ors, notionStatus] = await Promise.all([checkOrs(orsApiKey), checkNotion(notion)]);
  return { ors, notion: notionStatus };
}

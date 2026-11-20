import type { AssistantProviderId, Health } from '../shared/schema';
import { checkObsidianVault } from './obsidian';

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

export async function checkKeys(
  orsApiKey: string | undefined,
  obsidianVaultDir: string | undefined,
  assistantProviders: AssistantProviderId[] = [],
): Promise<Health> {
  const [ors, obsidian] = await Promise.all([
    checkOrs(orsApiKey),
    checkObsidianVault(obsidianVaultDir),
  ]);
  return {
    ors,
    obsidian,
    assistant: assistantProviders.length > 0 ? 'configured' : 'missing',
    assistantProviders,
  };
}

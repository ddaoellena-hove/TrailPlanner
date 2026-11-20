import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bookmark,
  CalendarPlus,
  Car,
  Clock,
  Compass,
  Landmark,
  Route,
  Trash2,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { AddEscapadeToTripDialog } from '@/components/AddEscapadeToTripDialog';
import {
  DiscoverFilters,
  ORIGIN_PRESETS,
  type DiscoverFilterState,
} from '@/components/DiscoverFilters';
import { DiscoverMap } from '@/components/DiscoverMap';
import {
  EscapadePreparePanel,
  type EscapadeDraft,
} from '@/components/EscapadePreparePanel';
import { SuggestionCard } from '@/components/SuggestionCard';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api } from '@/lib/api';
import { useEscapades, useSettings } from '@/lib/hooks';
import { formatDuration, formatMeters } from '../../shared/format';
import type {
  DiscoveryQuery,
  DiscoveryResponse,
  Escapade,
  NewEscapade,
  SuggestionResult,
} from '../../shared/schema';

const DEFAULT_FILTERS: DiscoverFilterState = {
  origin: ORIGIN_PRESETS[0]!,
  maxDriveMin: 45,
  minDistanceKm: 5,
  maxDistanceKm: 15,
  maxElevationGainM: null,
  maxPavedPercent: null,
  withDog: false,
  intent: {
    scenic: 0.6,
    isolation: 0.5,
    heritage: 0.3,
    novelty: 0.5,
  },
};

function toDiscoveryQuery(
  filters: DiscoverFilterState,
  overrides?: Partial<DiscoveryQuery>,
): Partial<DiscoveryQuery> & Pick<DiscoveryQuery, 'origin'> {
  return {
    origin: filters.origin.location,
    maxDriveMin: filters.maxDriveMin,
    minDistanceKm: filters.minDistanceKm,
    maxDistanceKm: filters.maxDistanceKm,
    maxElevationGainM: filters.maxElevationGainM ?? undefined,
    maxPavedRatio:
      filters.maxPavedPercent !== null ? filters.maxPavedPercent / 100 : undefined,
    withDog: filters.withDog,
    loopsOnly: true,
    intent: filters.intent,
    limit: 12,
    ...overrides,
  };
}

function draftToPayload(draft: EscapadeDraft): NewEscapade {
  return {
    title: draft.title.trim(),
    origin: draft.origin,
    startTime: draft.startTime,
    suggestion: draft.suggestion,
    bonusStop: draft.bonusStop,
    bonusDurationMin: draft.bonusDurationMin,
    ...(draft.notes.trim() ? { notes: draft.notes.trim() } : {}),
  };
}

function escapadeToDraft(escapade: Escapade): EscapadeDraft {
  return {
    id: escapade.id,
    title: escapade.title,
    origin: escapade.origin,
    startTime: escapade.startTime,
    suggestion: escapade.suggestion,
    bonusStop: escapade.bonusStop,
    bonusDurationMin: escapade.bonusDurationMin,
    notes: escapade.notes ?? '',
  };
}

export function DiscoverPage() {
  const queryClient = useQueryClient();
  const settings = useSettings();
  const escapades = useEscapades();

  const [activeTab, setActiveTab] = useState<'discover' | 'saved'>('discover');
  const [filters, setFilters] = useState<DiscoverFilterState>(DEFAULT_FILTERS);
  const [pickOriginMode, setPickOriginMode] = useState(false);
  const [result, setResult] = useState<DiscoveryResponse | null>(null);
  const [activeTrailId, setActiveTrailId] = useState<string | null>(null);
  const [draft, setDraft] = useState<EscapadeDraft | null>(null);
  const [feedbackMap, setFeedbackMap] = useState<Record<string, 'liked' | 'dismissed'>>({});
  const [addDialogTarget, setAddDialogTarget] = useState<{
    title: string;
    hasBonusStop: boolean;
    savedId?: string;
  } | null>(null);
  const lastSurpriseId = useRef<string | null>(null);

  const openPrepare = useCallback(
    (suggestion: SuggestionResult, origin = filters.origin) => {
      setActiveTrailId(suggestion.trailId);
      setActiveTab('discover');
      setDraft({
        title: `Escapade — ${suggestion.name}`,
        origin,
        startTime: settings.dayStartTime || '09:00',
        suggestion,
        bonusStop: null,
        bonusDurationMin: 45,
        notes: '',
      });
    },
    [filters.origin, settings.dayStartTime],
  );

  const searchMutation = useMutation({
    mutationFn: (query: Partial<DiscoveryQuery> & Pick<DiscoveryQuery, 'origin'>) =>
      api.discover(query),
    onSuccess: (data) => {
      setResult(data);
      setActiveTrailId(data.suggestions[0]?.trailId ?? null);
    },
    onError: (error) => {
      toast.error(`Découverte impossible : ${error.message}`);
    },
  });

  const surpriseMutation = useMutation({
    mutationFn: () =>
      api.discover(
        toDiscoveryQuery(filters, {
          intent: {
            scenic: 0.7,
            isolation: 0.6,
            heritage: 0.4,
            novelty: 1,
          },
          diversityLambda: 0.55,
          limit: 10,
        }),
      ),
    onSuccess: (data) => {
      setResult(data);
      if (data.suggestions.length === 0) {
        toast.info('Aucune boucle disponible pour ces critères.');
        return;
      }
      const candidates = data.suggestions.filter(
        (s) => s.trailId !== lastSurpriseId.current && feedbackMap[s.trailId] !== 'dismissed',
      );
      const pool = candidates.length > 0 ? candidates : data.suggestions;
      const pick = pool[Math.floor(Math.random() * Math.min(pool.length, 4))] ?? pool[0]!;
      lastSurpriseId.current = pick.trailId;
      openPrepare(pick);
      toast.success(`Idée surprise : ${pick.name}`);
    },
    onError: (error) => {
      toast.error(`Surprends-moi indisponible : ${error.message}`);
    },
  });

  const feedbackMutation = useMutation({
    mutationFn: (params: { trailId: string; verdict: 'liked' | 'dismissed' }) =>
      api.addDiscoveryFeedback({
        trailId: params.trailId,
        origin: filters.origin.location,
        verdict: params.verdict,
      }),
    onSuccess: (saved) => {
      if (saved.verdict === 'liked' || saved.verdict === 'dismissed') {
        setFeedbackMap((prev) => ({ ...prev, [saved.trailId]: saved.verdict as 'liked' | 'dismissed' }));
      }
      toast.success(
        saved.verdict === 'liked'
          ? 'Boucle marquée comme appréciée'
          : 'Boucle écartée pour les prochaines découvertes',
      );
    },
    onError: (error) => {
      toast.error(`Avis non enregistré : ${error.message}`);
    },
  });

  const saveEscapadeMutation = useMutation({
    mutationFn: async (current: EscapadeDraft) => {
      const payload = draftToPayload(current);
      return current.id ? api.updateEscapade(current.id, payload) : api.createEscapade(payload);
    },
    onSuccess: (saved) => {
      setDraft(escapadeToDraft(saved));
      void queryClient.invalidateQueries({ queryKey: ['escapades'] });
      toast.success(`Escapade « ${saved.title} » enregistrée`);
    },
    onError: (error) => {
      toast.error(`Enregistrement impossible : ${error.message}`);
    },
  });

  const deleteEscapadeMutation = useMutation({
    mutationFn: api.deleteEscapade,
    onSuccess: (_, id) => {
      if (draft?.id === id) setDraft(null);
      void queryClient.invalidateQueries({ queryKey: ['escapades'] });
      toast.success('Escapade supprimée');
    },
    onError: (error) => {
      toast.error(`Suppression impossible : ${error.message}`);
    },
  });

  // Lancement initial au montage pour afficher tout de suite des boucles réelles sur la carte.
  const initialTriggered = useRef(false);
  useEffect(() => {
    if (initialTriggered.current) return;
    initialTriggered.current = true;
    searchMutation.mutate(toDiscoveryQuery(DEFAULT_FILTERS));
  }, [searchMutation]);

  const mapSuggestions = useMemo(() => {
    const list = result?.suggestions ?? [];
    if (draft && !list.some((s) => s.trailId === draft.suggestion.trailId)) {
      return [draft.suggestion, ...list];
    }
    return list;
  }, [result, draft]);

  const mapOrigin = draft ? draft.origin : filters.origin;
  const mapActiveTrailId = draft ? draft.suggestion.trailId : activeTrailId;

  const ensureCurrentDraftSaved = async (): Promise<string> => {
    if (addDialogTarget?.savedId) return addDialogTarget.savedId;
    if (!draft) throw new Error('Aucune escapade en préparation');
    const saved = await saveEscapadeMutation.mutateAsync(draft);
    return saved.id;
  };

  return (
    <main className="mx-auto max-w-[1600px]">
      <div className="grid lg:grid-cols-[minmax(380px,500px)_1fr]">
        {/* Carte en haut sur mobile, collée à droite sur grand écran */}
        <div className="order-1 h-[38vh] min-h-[260px] border-b lg:order-2 lg:sticky lg:top-0 lg:h-[calc(100vh-3.5rem)] lg:border-b-0 lg:border-l">
          <DiscoverMap
            origin={mapOrigin.location}
            originName={mapOrigin.name}
            suggestions={mapSuggestions}
            activeTrailId={mapActiveTrailId}
            bonusStop={draft?.bonusStop ?? null}
            pickOriginMode={pickOriginMode}
            onSelectTrail={(trailId) => {
              setActiveTrailId(trailId);
              if (draft) {
                const picked = mapSuggestions.find((s) => s.trailId === trailId);
                if (picked) {
                  setDraft({
                    ...draft,
                    suggestion: picked,
                    title: `Escapade — ${picked.name}`,
                    bonusStop: null,
                  });
                }
              }
            }}
            onPickOrigin={(location) => {
              const label = `${location.lat.toFixed(4)}, ${location.lng.toFixed(4)}`;
              const nextFilters: DiscoverFilterState = {
                ...filters,
                origin: { name: label, location },
              };
              setFilters(nextFilters);
              setPickOriginMode(false);
              setDraft(null);
              searchMutation.mutate(toDiscoveryQuery(nextFilters));
            }}
          />
        </div>

        {/* Panneau gauche : Découvrir / Préparer / Mes escapades */}
        <div className="order-2 p-4 sm:p-6 lg:order-1">
          <div className="mb-4 flex items-center justify-between gap-2">
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Découvrir & Préparer</h1>
              <p className="text-xs text-muted-foreground">
                Boucles autour de vous, étape bonus &lt; 15 min et passerelle vers vos voyages.
              </p>
            </div>
          </div>

          <Tabs
            value={activeTab}
            onValueChange={(next) => setActiveTab(next === 'saved' ? 'saved' : 'discover')}
          >
            <TabsList className="mb-4 grid w-full grid-cols-2">
              <TabsTrigger value="discover" className="gap-1.5">
                <Compass className="size-4" aria-hidden />
                Découvrir
              </TabsTrigger>
              <TabsTrigger value="saved" className="gap-1.5">
                <Bookmark className="size-4" aria-hidden />
                Mes escapades
                {Boolean(escapades.data?.length) && (
                  <Badge variant="secondary" className="ml-1 px-1.5 py-0 text-[11px]">
                    {escapades.data?.length}
                  </Badge>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="discover" className="grid gap-4">
              {draft ? (
                <EscapadePreparePanel
                  draft={draft}
                  variants={result?.suggestions ?? []}
                  isSaving={saveEscapadeMutation.isPending}
                  onChange={setDraft}
                  onSelectVariant={(variant) => {
                    setActiveTrailId(variant.trailId);
                    setDraft({
                      ...draft,
                      suggestion: variant,
                      title: `Escapade — ${variant.name}`,
                      bonusStop: null,
                    });
                  }}
                  onBack={() => setDraft(null)}
                  onSave={() => saveEscapadeMutation.mutate(draft)}
                  onOpenAddToTrip={() =>
                    setAddDialogTarget({
                      title: draft.title,
                      hasBonusStop: Boolean(draft.bonusStop),
                    })
                  }
                />
              ) : (
                <>
                  <DiscoverFilters
                    value={filters}
                    pickOriginMode={pickOriginMode}
                    isSearching={searchMutation.isPending || surpriseMutation.isPending}
                    onChange={setFilters}
                    onTogglePickOrigin={() => setPickOriginMode((v) => !v)}
                    onSearch={() => searchMutation.mutate(toDiscoveryQuery(filters))}
                    onSurprise={() => surpriseMutation.mutate()}
                  />

                  {searchMutation.isPending && (
                    <div className="grid gap-3">
                      <Skeleton className="h-40 w-full" />
                      <Skeleton className="h-40 w-full" />
                    </div>
                  )}

                  {searchMutation.isError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive"
                    >
                      {searchMutation.error.message}
                    </div>
                  )}

                  {result && !searchMutation.isPending && (
                    <div className="grid gap-3">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          <strong className="text-foreground">{result.suggestions.length}</strong>{' '}
                          suggestion{result.suggestions.length > 1 ? 's' : ''} diversifiée
                          {result.suggestions.length > 1 ? 's' : ''} ({result.totalMatching}{' '}
                          compatible{result.totalMatching > 1 ? 's' : ''})
                        </span>
                        <span>
                          Portée :{' '}
                          {result.isochroneSource === 'ign'
                            ? 'isochrone IGN'
                            : 'rayon estimé'}
                        </span>
                      </div>

                      {result.suggestions.length === 0 ? (
                        <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
                          Aucune boucle ne correspond à ces critères. Essayez d’élargir la durée de
                          route ou la fourchette de distance.
                        </div>
                      ) : (
                        result.suggestions.map((suggestion) => (
                          <SuggestionCard
                            key={suggestion.trailId}
                            suggestion={suggestion}
                            active={suggestion.trailId === activeTrailId}
                            feedbackVerdict={feedbackMap[suggestion.trailId]}
                            onSelect={() => setActiveTrailId(suggestion.trailId)}
                            onPrepare={() => openPrepare(suggestion)}
                            onFeedback={(verdict) =>
                              feedbackMutation.mutate({ trailId: suggestion.trailId, verdict })
                            }
                          />
                        ))
                      )}
                    </div>
                  )}
                </>
              )}
            </TabsContent>

            <TabsContent value="saved" className="grid gap-3">
              {escapades.isPending && <Skeleton className="h-32 w-full" />}

              {escapades.data?.length === 0 && (
                <div className="rounded-lg border border-dashed p-8 text-center text-sm">
                  <p className="font-medium">Aucune escapade enregistrée</p>
                  <p className="mt-1 text-muted-foreground">
                    Ouvrez une suggestion dans « Découvrir », assemblez votre chronologie et
                    enregistrez-la ici.
                  </p>
                </div>
              )}

              {escapades.data?.map((item) => (
                <Card key={item.id}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base">{item.title}</CardTitle>
                      <Badge variant="outline" className="shrink-0 tabular-nums">
                        Départ {item.startTime}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Depuis {item.origin.name} · {item.suggestion.name}
                    </p>
                  </CardHeader>
                  <CardContent className="grid gap-3 pt-0 text-xs">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                      <span className="inline-flex items-center gap-1 font-medium text-foreground">
                        <Route className="size-3.5" aria-hidden />
                        {formatMeters(item.suggestion.distanceMeters)}
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Car className="size-3.5" aria-hidden />
                        {formatDuration(item.totalDriveMin)} de route
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Clock className="size-3.5" aria-hidden />
                        {formatDuration(item.totalDurationMin)} porte-à-porte
                      </span>
                    </div>

                    {item.bonusStop && (
                      <div className="inline-flex items-center gap-1.5 rounded bg-amber-500/10 px-2 py-1 text-amber-800 dark:text-amber-300">
                        <Landmark className="size-3.5 shrink-0" aria-hidden />
                        <span>
                          Étape bonus : <strong>{item.bonusStop.name}</strong> (+
                          {item.bonusStop.detourMin} min)
                        </span>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 border-t pt-2.5">
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => {
                          setDraft(escapadeToDraft(item));
                          setActiveTrailId(item.suggestion.trailId);
                          setActiveTab('discover');
                        }}
                      >
                        Ouvrir
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() =>
                          setAddDialogTarget({
                            title: item.title,
                            hasBonusStop: Boolean(item.bonusStop),
                            savedId: item.id,
                          })
                        }
                      >
                        <CalendarPlus className="size-3.5" aria-hidden />
                        Ajouter à un voyage
                      </Button>
                      <Button
                        type="button"
                        size="icon"
                        className="ml-auto size-8 text-muted-foreground hover:text-destructive"
                        variant="ghost"
                        aria-label={`Supprimer ${item.title}`}
                        onClick={() => deleteEscapadeMutation.mutate(item.id)}
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <AddEscapadeToTripDialog
        open={Boolean(addDialogTarget)}
        escapadeTitle={addDialogTarget?.title ?? ''}
        hasBonusStop={addDialogTarget?.hasBonusStop ?? false}
        ensureSaved={ensureCurrentDraftSaved}
        onClose={() => setAddDialogTarget(null)}
      />
    </main>
  );
}

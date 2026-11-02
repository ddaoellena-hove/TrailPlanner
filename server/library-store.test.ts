import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { addHikes } from '../shared/trip';
import { DEFAULT_SETTINGS, type Hike } from '../shared/schema';
import { LibraryHikeNotFoundError, LibraryStore } from './library-store';
import { TripStore } from './trip-store';

const { pace } = DEFAULT_SETTINGS;

const gpx = (lat: number) =>
  Buffer.from(`<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>Col</name><trkseg>
<trkpt lat="${lat}" lon="5.90"><ele>1400</ele></trkpt>
<trkpt lat="${lat + 0.01}" lon="5.91"><ele>1500</ele></trkpt>
</trkseg></trk></gpx>`);

describe('LibraryStore', () => {
  let dir: string;
  let trips: TripStore;
  let library: LibraryStore;

  const newTrip = (name: string) =>
    trips.create({ name, startDate: '2027-07-01', endDate: '2027-07-02', withDog: false });

  const importInto = async (slug: string, bytes: Buffer): Promise<Hike> => {
    const hike = await trips.importGpx(slug, { pace, bytes, fileName: 'col.gpx' });
    await trips.save(addHikes(await trips.get(slug), [hike]));
    return hike;
  };

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'library-'));
    trips = new TripStore(dir);
    library = new LibraryStore(dir, trips);
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  it('reprend les voyages une fois, sans doublon ni toucher à leurs fichiers', async () => {
    const first = await newTrip('Un');
    const second = await newTrip('Deux');
    const hike = await importInto(first.slug, gpx(44.7));
    await importInto(second.slug, gpx(44.7));
    await importInto(second.slug, gpx(45.1));
    const tripFile = path.join(dir, first.slug, 'trip.json');
    const before = await readFile(tripFile, 'utf8');

    expect(await library.list()).toHaveLength(2);
    expect(await new LibraryStore(dir, trips).list()).toHaveLength(2);
    expect(await readFile(tripFile, 'utf8')).toBe(before);
    expect(await readFile(path.join(dir, first.slug, hike.gpxFile))).toEqual(gpx(44.7));
  });

  it('ignore un GPX déjà connu', async () => {
    const trip = await newTrip('Un');
    const hike = await trips.importGpx(trip.slug, { pace, bytes: gpx(44.7), fileName: 'a.gpx' });
    const added = await library.add(hike, gpx(44.7));
    expect(await library.add({ ...hike, name: 'Autre' }, gpx(44.7))).toEqual(added);
  });

  it('n’écrit qu’une entrée pour des ajouts simultanés', async () => {
    const trip = await newTrip('Un');
    const hike = await trips.importGpx(trip.slug, { pace, bytes: gpx(44.7), fileName: 'a.gpx' });
    await Promise.all([library.add(hike, gpx(44.7)), library.add(hike, gpx(44.7))]);
    expect(await library.list()).toHaveLength(1);
  });

  it('une rando retirée ne revient pas à la relecture, et les voyages la gardent', async () => {
    const trip = await newTrip('Un');
    const hike = await importInto(trip.slug, gpx(44.7));
    const [entry] = await library.list();
    await library.remove(entry!.id);

    expect(await new LibraryStore(dir, trips).list()).toEqual([]);
    expect((await trips.get(trip.slug)).hikes).toHaveLength(1);
    expect(await readFile(path.join(dir, trip.slug, hike.gpxFile))).toEqual(gpx(44.7));
    expect(await readdir(path.join(dir, '.library', '.trash'))).toHaveLength(1);
  });

  it('relie la copie d’un voyage à sa rando par l’empreinte du GPX', async () => {
    const trip = await newTrip('Un');
    const hike = await importInto(trip.slug, gpx(44.7));
    const [entry] = await library.list();
    expect(await library.links(trip.slug)).toEqual({ [hike.id]: entry!.id });
  });

  it('enregistre et retire une sortie', async () => {
    const trip = await newTrip('Un');
    await importInto(trip.slug, gpx(44.7));
    const [entry] = await library.list();
    const { outings } = await library.addOuting(entry!.id, { date: '2027-07-01', durationMin: 120 });
    expect(outings).toMatchObject([{ date: '2027-07-01', durationMin: 120 }]);
    const after = await library.removeOuting(entry!.id, outings[0]!.id);
    expect(after.outings).toEqual([]);
  });

  it('recalcule les durées avec un nouveau rythme', async () => {
    const trip = await newTrip('Un');
    await importInto(trip.slug, gpx(44.7));
    const [entry] = await library.list();
    await library.applyPace({ ...pace, breakFactor: pace.breakFactor * 2 });
    const [slower] = await library.list();
    expect(slower!.stats.estimatedDurationMin).toBeGreaterThan(entry!.stats.estimatedDurationMin);
  });

  it('refuse une rando inconnue', async () => {
    await expect(library.remove('inconnue')).rejects.toBeInstanceOf(LibraryHikeNotFoundError);
  });
});

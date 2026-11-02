import { describe, expect, it, vi } from 'vitest';
import { CARNET_TITLE, type CarnetBlock } from '../shared/carnet';
import type { Trip } from '../shared/schema';
import { NotionExporter, toNotionBlocks } from './notion';

const trip = {
  name: 'Écrins',
  startDate: '2027-07-01',
  endDate: '2027-07-05',
} as Trip;

const config = { dataSourceId: 'ds', areaPageId: 'area' };
const blocks: CarnetBlock[] = [{ type: 'paragraph', text: [{ text: 'Bonjour' }] }];

type PageRequest = {
  parent: { page_id?: string };
  properties: { title?: { title: { text: { content: string } }[] } };
};

/** Notion en mémoire : une page → ses blocs enfants. */
function fakeNotion(initial: Record<string, { id: string; type: string; title?: string }[]> = {}) {
  const children = new Map(Object.entries(initial));
  const toBlock = (block: { id: string; type: string; title?: string }) => ({
    object: 'block',
    id: block.id,
    type: block.type,
    ...(block.type === 'child_page' ? { child_page: { title: block.title } } : {}),
  });
  const api = {
    pages: {
      create: vi.fn(async ({ parent, properties }: PageRequest) => {
        const id = `page-${api.pages.create.mock.calls.length}`;
        if (parent.page_id) {
          const list = children.get(parent.page_id) ?? [];
          list.push({ id, type: 'child_page', title: properties.title?.title[0]?.text.content });
          children.set(parent.page_id, list);
        }
        return { id };
      }),
      update: vi.fn(async () => ({})),
    },
    blocks: {
      delete: vi.fn(async ({ block_id }: { block_id: string }) => {
        for (const [key, list] of children) {
          children.set(key, list.filter((block) => block.id !== block_id));
        }
        return {};
      }),
      children: {
        list: vi.fn(async ({ block_id }: { block_id: string }) => ({
          results: (children.get(block_id) ?? []).map(toBlock),
          next_cursor: null,
        })),
        append: vi.fn(async ({ block_id, children: added }: { block_id: string; children: unknown[] }) => {
          const list = children.get(block_id) ?? [];
          list.push(...added.map((_, index) => ({ id: `${block_id}-b${list.length + index}`, type: 'paragraph' })));
          children.set(block_id, list);
          return {};
        }),
      },
    },
    dataSources: { query: vi.fn(async () => ({ results: [] as unknown[] })) },
  };
  return { api, children };
}

const exporter = (api: unknown) =>
  new NotionExporter(api as ConstructorParameters<typeof NotionExporter>[0], config);

describe('export Notion', () => {
  it('crée le projet avec ses propriétés, puis la sous-page', async () => {
    const { api, children } = fakeNotion();

    const ids = await exporter(api).export(trip, { mode: 'create' }, blocks, 'Résumé');

    const [project] = api.pages.create.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(project.parent).toEqual({ type: 'data_source_id', data_source_id: 'ds' });
    expect(project.icon).toEqual({ type: 'emoji', emoji: '🏔️' });
    expect(project.properties).toEqual({
      Project: { title: [{ text: { content: 'Écrins' } }] },
      Area: { relation: [{ id: 'area' }] },
      Status: { select: { name: 'Backlog' } },
      'Start date': { date: { start: '2027-07-01', end: '2027-07-05' } },
      Outcome: { rich_text: [{ text: { content: 'Résumé' } }] },
    });
    expect(ids.projectPageId).toBe('page-1');
    expect(children.get('page-1')?.[0]).toMatchObject({ title: CARNET_TITLE });
  });

  it('se lie à un projet sans toucher à son contenu ni à ses autres propriétés', async () => {
    const written = [{ id: 'objectif', type: 'paragraph' }];
    const { api, children } = fakeNotion({ projet: written });

    await exporter(api).export(
      trip,
      { mode: 'link', projectPageId: 'projet', updateStartDate: true },
      blocks,
      'Résumé',
    );

    expect(children.get('projet')?.[0]?.id).toBe('objectif');
    expect(api.blocks.delete).not.toHaveBeenCalled();
    expect(api.pages.update).toHaveBeenCalledWith({
      page_id: 'projet',
      properties: { 'Start date': { date: { start: '2027-07-01', end: '2027-07-05' } } },
    });
  });

  it('ne change pas la date sans confirmation', async () => {
    const { api } = fakeNotion({ projet: [] });
    await exporter(api).export(
      trip,
      { mode: 'link', projectPageId: 'projet', updateStartDate: false },
      blocks,
      '',
    );
    expect(api.pages.update).not.toHaveBeenCalled();
  });

  it('remplace le carnet au ré-export, sans le dupliquer', async () => {
    const { api, children } = fakeNotion({
      projet: [
        { id: 'objectif', type: 'paragraph' },
        { id: 'carnet', type: 'child_page', title: CARNET_TITLE },
      ],
      carnet: [{ id: 'ancien', type: 'paragraph' }],
    });
    const known = { ...trip, notion: { projectPageId: 'projet' } };

    const ids = await exporter(api).export(known, { mode: 'create' }, blocks, '');

    expect(ids.itineraryPageId).toBe('carnet');
    expect(api.pages.create).not.toHaveBeenCalled();
    expect(api.blocks.delete).toHaveBeenCalledExactlyOnceWith({ block_id: 'ancien' });
    expect(children.get('carnet')).toHaveLength(1);
    expect(children.get('projet')).toHaveLength(2);
  });

  it('ne vide jamais une autre sous-page, même avec un id stocké trompeur', async () => {
    const { api, children } = fakeNotion({
      projet: [{ id: 'notes', type: 'child_page', title: 'Mes notes' }],
      notes: [{ id: 'precieux', type: 'paragraph' }],
    });
    const known = {
      ...trip,
      notion: { projectPageId: 'projet', itineraryPageId: 'notes' },
    };

    await exporter(api).export(known, { mode: 'create' }, blocks, '');

    expect(children.get('notes')?.[0]?.id).toBe('precieux');
  });

  it('envoie par lots de 100 blocs', async () => {
    const { api } = fakeNotion({ projet: [] });
    const many: CarnetBlock[] = Array.from({ length: 250 }, () => blocks[0]!);
    await exporter(api).export(
      trip,
      { mode: 'link', projectPageId: 'projet', updateStartDate: false },
      many,
      '',
    );
    const sizes = api.blocks.children.append.mock.calls.map(([args]) => args.children.length);
    expect(sizes).toEqual([100, 100, 50]);
  });

  it('explique une page inaccessible', async () => {
    const { api } = fakeNotion();
    const { APIResponseError, APIErrorCode } = await import('@notionhq/client');
    api.blocks.children.list.mockRejectedValue(
      Object.assign(Object.create(APIResponseError.prototype) as object, {
        code: APIErrorCode.ObjectNotFound,
        name: 'APIResponseError',
        message: 'not found',
      }),
    );
    await expect(
      exporter(api).export(
        trip,
        { mode: 'link', projectPageId: 'x', updateStartDate: false },
        blocks,
        '',
      ),
    ).rejects.toThrow(/partagez votre intégration/);
  });

  it('filtre la recherche sur Travel & Outdoors', async () => {
    const { api } = fakeNotion();
    api.dataSources.query.mockResolvedValue({
      results: [
        {
          id: 'p1',
          properties: { Project: { type: 'title', title: [{ plain_text: 'Écrins' }] } },
        },
      ],
    });

    expect(await exporter(api).searchProjects('écr')).toEqual([{ id: 'p1', title: 'Écrins' }]);
    expect(api.dataSources.query).toHaveBeenCalledWith(
      expect.objectContaining({
        filter: {
          and: [
            { property: 'Area', relation: { contains: 'area' } },
            { property: 'Project', title: { contains: 'écr' } },
          ],
        },
      }),
    );
  });
});

describe('toNotionBlocks', () => {
  it('convertit liens, tâches et tableaux', () => {
    const [todo, table] = toNotionBlocks([
      { type: 'todo', text: [{ text: 'Lien', url: 'https://a.example/' }] },
      { type: 'table', header: ['A', 'B'], rows: [[[{ text: '1' }], [{ text: '2' }]]] },
    ]);
    expect(todo).toMatchObject({
      type: 'to_do',
      to_do: {
        checked: false,
        rich_text: [{ text: { content: 'Lien', link: { url: 'https://a.example/' } } }],
      },
    });
    expect(table).toMatchObject({ table: { table_width: 2, has_column_header: true } });
  });

  it('coupe un tableau trop long', () => {
    const rows = Array.from({ length: 150 }, () => [[{ text: 'x' }]]);
    const tables = toNotionBlocks([{ type: 'table', header: ['A'], rows }]);
    expect(tables).toHaveLength(2);
  });
});

import {
  APIErrorCode,
  type BlockObjectRequest,
  type Client,
  isFullBlock,
  isNotionClientError,
} from '@notionhq/client';
import { CARNET_TITLE, type CarnetBlock, type Inline } from '../shared/carnet';
import type { NotionExportRequest, NotionProject, Trip } from '../shared/schema';

const MAX_BLOCKS_PER_REQUEST = 100;

export class NotionExportError extends Error {}

type NotionConfig = { dataSourceId: string; areaPageId: string };
type NotionApi = Pick<Client, 'pages' | 'blocks' | 'dataSources'>;
type NotionIds = { projectPageId: string; itineraryPageId: string };

function richText(text: Inline[]) {
  return text.map(({ text: content, url }) => ({
    type: 'text' as const,
    text: { content, link: url ? { url } : null },
  }));
}

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function tableBlocks(header: string[], rows: Inline[][][]): BlockObjectRequest[] {
  const headerRow = header.map((title) => [{ text: title }]);
  // Une table n'accepte que 100 lignes par requête, en-tête comprise.
  return chunks(rows, MAX_BLOCKS_PER_REQUEST - 1).map((part) => ({
    type: 'table',
    table: {
      table_width: header.length,
      has_column_header: true,
      has_row_header: false,
      children: [headerRow, ...part].map((row) => ({
        type: 'table_row',
        table_row: { cells: row.map(richText) },
      })),
    },
  }));
}

export function toNotionBlocks(blocks: CarnetBlock[]): BlockObjectRequest[] {
  return blocks.flatMap((block): BlockObjectRequest[] => {
    switch (block.type) {
      case 'callout':
        return [
          {
            type: 'callout',
            callout: { rich_text: richText(block.text), icon: { type: 'emoji', emoji: '🥾' } },
          },
        ];
      case 'heading':
        return [{ type: 'heading_2', heading_2: { rich_text: richText([{ text: block.text }]) } }];
      case 'paragraph':
        return [{ type: 'paragraph', paragraph: { rich_text: richText(block.text) } }];
      case 'bullet':
        return [
          {
            type: 'bulleted_list_item',
            bulleted_list_item: { rich_text: richText(block.text) },
          },
        ];
      case 'todo':
        return [
          {
            type: 'to_do',
            to_do: { rich_text: richText(block.text), checked: block.checked ?? false },
          },
        ];
      case 'table':
        return tableBlocks(block.header, block.rows);
    }
  });
}

function explain(error: unknown): NotionExportError {
  if (isNotionClientError(error)) {
    if (error.code === APIErrorCode.Unauthorized) {
      return new NotionExportError('Token Notion refusé : vérifiez NOTION_TOKEN dans .env.');
    }
    if (
      error.code === APIErrorCode.ObjectNotFound ||
      error.code === APIErrorCode.RestrictedResource
    ) {
      return new NotionExportError(
        "Notion refuse l'accès : partagez votre intégration avec la base Projects (… > Connexions).",
      );
    }
    return new NotionExportError(`Notion : ${error.message}`);
  }
  return new NotionExportError(error instanceof Error ? error.message : 'Export impossible');
}

/**
 * Seule couche qui écrit dans Notion. Une page projet n'est jamais modifiée dans son contenu :
 * seule la sous-page carnet est remplie, et elle est reconnue avant d'être vidée.
 */
export class NotionExporter {
  constructor(
    private readonly notion: NotionApi,
    private readonly config: NotionConfig,
  ) {}

  private async guarded<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error) {
      throw explain(error);
    }
  }

  searchProjects(query: string): Promise<NotionProject[]> {
    return this.guarded(async () => {
      const { results } = await this.notion.dataSources.query({
        data_source_id: this.config.dataSourceId,
        page_size: 20,
        filter: {
          and: [
            { property: 'Area', relation: { contains: this.config.areaPageId } },
            ...(query.trim()
              ? [{ property: 'Project', title: { contains: query.trim() } }]
              : []),
          ],
        },
      });
      return results.flatMap((result) => {
        if (!('properties' in result)) return [];
        const title = result.properties.Project;
        if (title?.type !== 'title') return [];
        return [{ id: result.id, title: title.title.map((part) => part.plain_text).join('') }];
      });
    });
  }

  private async createProject(trip: Trip, outcome: string): Promise<string> {
    const page = await this.notion.pages.create({
      parent: { type: 'data_source_id', data_source_id: this.config.dataSourceId },
      icon: { type: 'emoji', emoji: '🏔️' },
      properties: {
        Project: { title: [{ text: { content: trip.name } }] },
        Area: { relation: [{ id: this.config.areaPageId }] },
        Status: { select: { name: 'Backlog' } },
        'Start date': { date: { start: trip.startDate, end: trip.endDate } },
        Outcome: { rich_text: [{ text: { content: outcome } }] },
      },
    });
    return page.id;
  }

  private async updateStartDate(projectPageId: string, trip: Trip): Promise<void> {
    await this.notion.pages.update({
      page_id: projectPageId,
      properties: { 'Start date': { date: { start: trip.startDate, end: trip.endDate } } },
    });
  }

  private async listChildren(blockId: string) {
    const children = [];
    let cursor: string | undefined;
    do {
      const page = await this.notion.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
      children.push(...page.results);
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
    return children;
  }

  /** Cherche parmi les enfants du projet : un id stocké seul ne suffit pas pour vider une page. */
  private async findCarnet(projectPageId: string): Promise<string | null> {
    const children = await this.listChildren(projectPageId);
    const carnet = children.find(
      (block) =>
        isFullBlock(block) &&
        block.type === 'child_page' &&
        block.child_page.title === CARNET_TITLE,
    );
    return carnet?.id ?? null;
  }

  private async replaceContent(pageId: string, blocks: BlockObjectRequest[]): Promise<void> {
    for (const child of await this.listChildren(pageId)) {
      await this.notion.blocks.delete({ block_id: child.id });
    }
    for (const part of chunks(blocks, MAX_BLOCKS_PER_REQUEST)) {
      await this.notion.blocks.children.append({ block_id: pageId, children: part });
    }
  }

  export(
    trip: Trip,
    request: NotionExportRequest,
    blocks: CarnetBlock[],
    outcome: string,
  ): Promise<NotionIds> {
    return this.guarded(async () => {
      const known = trip.notion?.projectPageId;
      let projectPageId: string;
      if (known) {
        projectPageId = known;
      } else if (request.mode === 'create') {
        projectPageId = await this.createProject(trip, outcome);
      } else {
        projectPageId = request.projectPageId;
        if (request.updateStartDate) await this.updateStartDate(projectPageId, trip);
      }

      let itineraryPageId = await this.findCarnet(projectPageId);
      if (!itineraryPageId) {
        const page = await this.notion.pages.create({
          parent: { type: 'page_id', page_id: projectPageId },
          properties: { title: { title: [{ text: { content: CARNET_TITLE } }] } },
        });
        itineraryPageId = page.id;
      }
      await this.replaceContent(itineraryPageId, toNotionBlocks(blocks));
      return { projectPageId, itineraryPageId };
    });
  }
}

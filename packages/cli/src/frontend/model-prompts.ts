import { validUrl } from '../args.js';
import { Cancelled, type Prompter, type Reporter, validateWith } from '../ui.js';
import { type RenderModel, selectTypes } from './model.js';
import { DEFAULT_API_URL, type ModelRequest, type ModelSource } from './options.js';
import {
  deliveryModel,
  type Fetch,
  findSpace,
  listSpaces,
  type ManagementApi,
  managementModel,
  type Space,
} from './source.js';

export interface ModelContext {
  /** `null` when every answer comes from the command line. */
  prompter: Prompter | null;
  reporter: Reporter;
  fetch: Fetch;
}

export interface ResolvedModel {
  /** `null` for the example teaser. */
  model: RenderModel | null;
  /** Set when a space was picked on the management API. */
  spaceId?: string;
}

/** Reads the content model and the types to generate; with a terminal, failures offer a retry. */
export async function resolveModel(
  request: ModelRequest,
  deliveryUrl: string,
  context: ModelContext,
): Promise<ResolvedModel> {
  const { prompter } = context;
  const source: ModelSource = request.source ?? (prompter ? await askSource(prompter) : 'none');
  if (source === 'none') return { model: null };

  const read: { model: RenderModel; spaceId?: string } | null =
    source === 'delivery'
      ? await fromDelivery(deliveryUrl, context)
      : await fromManagement(request, context);
  if (!read) return { model: null };

  if (read.model.types.length === 0) {
    context.reporter.warn(
      'The space has no content or block types yet; writing the example teaser',
    );
    return { model: null, ...(read.spaceId ? { spaceId: read.spaceId } : {}) };
  }

  const model =
    request.types !== undefined || !prompter
      ? selectTypes(read.model, request.types ?? 'all')
      : await askTypes(prompter, read.model);
  return { model, ...(read.spaceId ? { spaceId: read.spaceId } : {}) };
}

/** Reads `/v1/types` from the delivery API; no key or space needed. */
async function fromDelivery(
  url: string,
  context: ModelContext,
): Promise<{ model: RenderModel } | null> {
  for (;;) {
    const found = await attempt(context, () =>
      context.reporter.spin(
        `Reading the content model from ${url}`,
        () => deliveryModel(url, context.fetch),
        (model) => described(model),
      ),
    );
    if (found !== 'retry') return found ? { model: found } : null;
  }
}

/** Reads a space's types from the management API; any failure re-asks the address and key. */
async function fromManagement(
  request: ModelRequest,
  context: ModelContext,
): Promise<{ model: RenderModel; spaceId: string } | null> {
  const { prompter, reporter } = context;
  let given = request;
  let lastUrl = request.apiUrl ?? DEFAULT_API_URL;

  for (;;) {
    const api = await askApi(given, lastUrl, prompter);
    lastUrl = api.url;

    const found = await attempt(context, async () => {
      const spaces = await reporter.spin(
        `Reading the spaces ${api.url} lets the key see`,
        () => listSpaces(api, context.fetch),
        (list) => `${list.length} space${list.length === 1 ? '' : 's'} found`,
      );
      const space = await pickSpace(spaces, given.space, prompter, reporter);
      const model = await reporter.spin(
        `Reading the content model of ${space.name}`,
        () => managementModel(api, space.id, context.fetch),
        (read) => described(read),
      );
      return { model, spaceId: space.id };
    });
    if (found !== 'retry') return found;
    // Asked again, with the last answers offered.
    const { apiUrl: _url, apiKey: _key, space: _space, ...kept } = given;
    given = kept;
  }
}

async function askApi(
  given: ModelRequest,
  lastUrl: string,
  prompter: Prompter | null,
): Promise<ManagementApi> {
  if (!prompter) {
    if (!given.apiKey) {
      throw new Error(
        '--api-key is required to read the content model from the management API ' +
          '(create one in the admin under Settings > API keys)',
      );
    }
    return { url: given.apiUrl ?? DEFAULT_API_URL, apiKey: given.apiKey };
  }

  const url =
    given.apiUrl ??
    validUrl(
      'api-url',
      await prompter.text({
        message: 'URL of the management API',
        defaultValue: lastUrl,
        validate: validateWith((value) => validUrl('api-url', value)),
      }),
    );
  const apiKey =
    given.apiKey ??
    (await prompter.password({
      message: 'API key (create one in the admin under Settings > API keys)',
      validate: (value) => (value ? undefined : 'The management API needs a key'),
    }));
  return { url, apiKey };
}

async function pickSpace(
  spaces: Space[],
  wanted: string | undefined,
  prompter: Prompter | null,
  reporter: Reporter,
): Promise<Space> {
  if (wanted || !prompter || spaces.length <= 1) {
    const space = findSpace(spaces, wanted);
    if (!wanted) reporter.step(`Using the space ${space.name} (${space.machineName})`);
    return space;
  }
  const id = await prompter.select({
    message: 'Which space should the components be written for?',
    options: spaces.map((space) => ({
      value: space.id,
      label: space.name,
      hint: space.machineName,
    })),
    initialValue: spaces[0]?.id ?? '',
  });
  return spaces.find((space) => space.id === id) as Space;
}

/** Runs one step; with a terminal, a failure offers a retry or the example teaser. */
async function attempt<T>(
  context: ModelContext,
  work: () => Promise<T>,
): Promise<T | null | 'retry'> {
  try {
    return await work();
  } catch (error) {
    if (!context.prompter || error instanceof Cancelled) throw error;
    context.reporter.warn(error instanceof Error ? error.message : String(error));
    const next = await context.prompter.select({
      message: 'The content model could not be read. What now?',
      options: [
        { value: 'retry', label: 'Try again' },
        { value: 'skip', label: 'Go on without it', hint: 'writes the example teaser block' },
      ],
      initialValue: 'retry',
    });
    return next === 'retry' ? 'retry' : null;
  }
}

async function askSource(prompter: Prompter): Promise<ModelSource> {
  return prompter.select<ModelSource>({
    message: "Write components for a space's content and block types?",
    options: [
      {
        value: 'management',
        label: 'Yes, from the management API',
        hint: 'with an API key; pick the space, then the types',
      },
      {
        value: 'delivery',
        label: 'Yes, from the delivery API above',
        hint: 'no key; the space a public instance is pinned to',
      },
      { value: 'none', label: 'No', hint: 'start from the example teaser block' },
    ],
    initialValue: 'management',
  });
}

/** All types, or a pick. */
async function askTypes(prompter: Prompter, model: RenderModel): Promise<RenderModel> {
  const contents = model.types.filter((type) => type.kind === 'content');
  const blocks = model.types.filter((type) => type.kind === 'block');

  const scope = await prompter.select<'all' | 'pick'>({
    message: 'Which types should get a component?',
    options: [
      {
        value: 'all',
        label: `All ${model.types.length} types`,
        hint: `${contents.length} content, ${blocks.length} block`,
      },
      { value: 'pick', label: 'Let me choose' },
    ],
    initialValue: 'all',
  });
  if (scope === 'all') return model;

  const option = (type: RenderModel['types'][number]) => ({
    value: type.name,
    label: type.label,
    hint: `${type.name}, ${type.fields.length} field${type.fields.length === 1 ? '' : 's'}`,
  });
  const groups: Record<string, ReturnType<typeof option>[]> = {};
  if (contents.length > 0) groups['Content types'] = contents.map(option);
  if (blocks.length > 0) groups['Block types'] = blocks.map(option);

  const picked = await prompter.multiselect({
    message: 'Pick the types (space toggles, a group name toggles the whole group)',
    groups,
  });
  return selectTypes(model, picked);
}

function described(model: RenderModel): string {
  const contents = model.types.filter((type) => type.kind === 'content').length;
  const blocks = model.types.length - contents;
  return `Found ${contents} content type${contents === 1 ? '' : 's'} and ${blocks} block type${blocks === 1 ? '' : 's'}`;
}

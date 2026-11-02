/** Browser-safe AI catalogue shared by server and admin: providers, capabilities, styles. */

export const AI_PROVIDER_KINDS = ['anthropic', 'openai', 'google', 'custom'] as const;
export type AiProviderKind = (typeof AI_PROVIDER_KINDS)[number];

/** The hosted providers: one card each, one row per space. */
export const AI_HOSTED_KINDS = ['anthropic', 'openai', 'google'] as const;

/** The kind for a hosted provider, `custom:<slug>` for one of several self-hosted ones. */
export type AiProviderRef = string;

export const AI_PROVIDER_REF_PATTERN = /^(anthropic|openai|google|custom:[a-z0-9][a-z0-9-]{0,39})$/;
export const AI_CUSTOM_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,39}$/;

export function aiProviderRef(kind: AiProviderKind, slug?: string | null): AiProviderRef {
  return kind === 'custom' ? `custom:${slug ?? ''}` : kind;
}

export function parseAiProviderRef(ref: AiProviderRef): { kind: AiProviderKind; slug: string } {
  if (ref.startsWith('custom:')) return { kind: 'custom', slug: ref.slice('custom:'.length) };
  return { kind: ref as AiProviderKind, slug: '' };
}

/** Self-hosted protocols: OpenAI-style chat completions, or Ollama's native `/api/chat`. */
export const AI_CUSTOM_APIS = ['openai', 'ollama'] as const;
export type AiCustomApi = (typeof AI_CUSTOM_APIS)[number];

/** A self-hosted provider, with abilities its operator declares. */
export interface AiCustomConfig {
  /** Up to and including the version segment: `http://ollama:11434/v1`. */
  baseUrl: string;
  api: AiCustomApi;
  /** The jobs this endpoint is offered for. */
  capabilities: AiCapability[];
  /** Whether the model reliably answers in JSON, which documents and designs need. */
  json: boolean;
  /** The answer's ceiling in tokens; absent leaves it to the server. */
  maxOutputTokens?: number | undefined;
  /** The context window to ask for (Ollama's `num_ctx`); absent leaves it to the server. */
  contextWindow?: number | undefined;
  /** Local models are slow; the hosted default timeout would cut them off. */
  timeoutSeconds?: number | undefined;
}

export const AI_CUSTOM_DEFAULTS: AiCustomConfig = {
  baseUrl: 'http://localhost:11434/v1',
  api: 'openai',
  capabilities: ['text'],
  json: true,
  timeoutSeconds: 300,
};

/** What a provider can be asked for. A provider is offered a job only if it lists it. */
export const AI_CAPABILITIES = ['text', 'image', 'video'] as const;
export type AiCapability = (typeof AI_CAPABILITIES)[number];

/** Capability -> model id. Spelled out to fit `exactOptionalPropertyTypes`. */
export type AiModelMap = { [K in AiCapability]?: string | undefined };

/** A model option: `id` is sent to the provider, `label` is its common name. */
export interface AiModelOption {
  id: string;
  label: string;
  /** One line under the option: what it is for, or what it costs you in speed. */
  hint?: string;
}

export interface AiProviderMeta {
  kind: AiProviderKind;
  label: string;
  /** One line under the label in the settings form. */
  description: string;
  capabilities: readonly AiCapability[];
  /** The provider's own name for the key. */
  credentialLabel: string;
  credentialHint: string;
  /** Suggested models per capability. */
  models: Partial<Record<AiCapability, readonly AiModelOption[]>>;
  defaultModels: Partial<Record<AiCapability, string>>;
}

export const AI_PROVIDERS: Record<AiProviderKind, AiProviderMeta> = {
  anthropic: {
    kind: 'anthropic',
    label: 'Claude',
    description: "Anthropic's models, for copy and long-form text.",
    capabilities: ['text'],
    credentialLabel: 'Anthropic API key',
    credentialHint: 'Starts with sk-ant-. From console.anthropic.com.',
    models: {
      text: [
        { id: 'claude-opus-5', label: 'Claude Opus 5', hint: 'The most capable; the default.' },
        { id: 'claude-sonnet-5', label: 'Claude Sonnet 5', hint: 'Faster and cheaper.' },
        { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5', hint: 'Fastest, for short copy.' },
      ],
    },
    defaultModels: { text: 'claude-opus-5' },
  },
  openai: {
    kind: 'openai',
    label: 'ChatGPT',
    description: "OpenAI's models, for copy and long-form text.",
    capabilities: ['text'],
    credentialLabel: 'OpenAI API key',
    credentialHint: 'Starts with sk-. From platform.openai.com.',
    models: {
      text: [
        { id: 'gpt-5', label: 'GPT-5' },
        { id: 'gpt-5-mini', label: 'GPT-5 mini', hint: 'Faster and cheaper.' },
        { id: 'gpt-4.1', label: 'GPT-4.1' },
      ],
    },
    defaultModels: { text: 'gpt-5' },
  },
  google: {
    kind: 'google',
    label: 'Google',
    description: 'Nano Banana and Imagen for stills, Veo for video, through the Gemini API.',
    capabilities: ['image', 'video'],
    credentialLabel: 'Gemini API key',
    credentialHint: 'From aistudio.google.com. The same key covers every model below.',
    models: {
      // Nano Banana uses `:generateContent`, Imagen `:predict`; the Google client picks by id.
      image: [
        {
          id: 'gemini-3-pro-image',
          label: 'Nano Banana Pro',
          hint: 'Gemini 3 Pro Image. The most faithful, and the one that can render text in a picture.',
        },
        {
          id: 'gemini-3-pro-image-preview',
          label: 'Nano Banana Pro (preview id)',
          hint: 'The same model under the id it launched with. Use it if a key cannot see the one above.',
        },
        {
          id: 'gemini-3.1-flash-image',
          label: 'Nano Banana 2',
          hint: 'Gemini 3.1 Flash Image. Nearly as good, several times faster.',
        },
        {
          id: 'gemini-3.1-flash-lite-image',
          label: 'Nano Banana 2 Lite',
          hint: 'The cheapest. 1K only.',
        },
        { id: 'gemini-2.5-flash-image', label: 'Nano Banana (legacy)' },
        { id: 'imagen-4.0-generate-001', label: 'Imagen 4' },
        { id: 'imagen-4.0-ultra-generate-001', label: 'Imagen 4 Ultra' },
      ],
      video: [
        { id: 'veo-3.1-generate-preview', label: 'Veo 3.1' },
        { id: 'veo-3.0-generate-001', label: 'Veo 3' },
      ],
    },
    defaultModels: { image: 'gemini-3-pro-image', video: 'veo-3.1-generate-preview' },
  },
  custom: {
    kind: 'custom',
    label: 'Self-hosted',
    description:
      'A model you run yourself - Ollama, LM Studio, vLLM, LocalAI or any OpenAI-compatible server.',
    // The most a self-hosted endpoint may be set up for; each one says which it has.
    capabilities: ['text', 'image'],
    credentialLabel: 'API key (optional)',
    credentialHint: 'Only if the server asks for one. Sent as a bearer token.',
    models: {},
    defaultModels: {},
  },
};

/** The providers that can serve a capability, in the order the picker lists them. */
export function providersFor(capability: AiCapability): readonly AiProviderKind[] {
  return AI_PROVIDER_KINDS.filter((kind) => AI_PROVIDERS[kind].capabilities.includes(capability));
}

// Style catalogues

/** One choice in the dialog: what the editor picks, and what it adds to the prompt. */
export interface AiStyleOption {
  id: string;
  label: string;
  /** Appended to the instruction sent to the model. Empty for "no preference". */
  prompt: string;
}

export interface AiStyleGroup {
  id: string;
  label: string;
  /** Which generation kinds show this group. */
  capabilities: readonly AiCapability[];
  /** True when leaving it unset is meaningful; the picker then offers "No preference". */
  optional: boolean;
  options: readonly AiStyleOption[];
}

const WRITING_STYLES: readonly AiStyleOption[] = [
  { id: 'neutral', label: 'Neutral', prompt: 'Write in a plain, neutral register.' },
  {
    id: 'marketing',
    label: 'Marketing',
    prompt: 'Write as marketing copy: concrete benefits, active voice, no filler.',
  },
  {
    id: 'journalistic',
    label: 'Journalistic',
    prompt: 'Write as a journalist would: the point first, then the detail behind it.',
  },
  {
    id: 'technical',
    label: 'Technical',
    prompt: 'Write for a technical reader: precise, unembellished, correct terminology.',
  },
  {
    id: 'storytelling',
    label: 'Storytelling',
    prompt: 'Write as a short narrative, with a scene the reader can picture.',
  },
  {
    id: 'conversational',
    label: 'Conversational',
    prompt: 'Write as if speaking to one reader: short sentences, second person.',
  },
  {
    id: 'academic',
    label: 'Academic',
    prompt: 'Write in an academic register: measured, qualified, impersonal.',
  },
  {
    id: 'seo',
    label: 'SEO',
    prompt:
      'Write for search: lead with the search intent, use the topic words naturally, keep it scannable. Never stuff keywords.',
  },
];

const TONES: readonly AiStyleOption[] = [
  { id: 'friendly', label: 'Friendly', prompt: 'Keep the tone warm and welcoming.' },
  { id: 'professional', label: 'Professional', prompt: 'Keep the tone professional and calm.' },
  { id: 'playful', label: 'Playful', prompt: 'Keep the tone light and playful.' },
  { id: 'confident', label: 'Confident', prompt: 'Keep the tone confident and direct.' },
  { id: 'empathetic', label: 'Empathetic', prompt: 'Keep the tone empathetic and reassuring.' },
  { id: 'urgent', label: 'Urgent', prompt: 'Keep the tone urgent without alarming the reader.' },
  { id: 'witty', label: 'Witty', prompt: 'Allow dry wit, never at the expense of the reader.' },
];

/** A length preset in words (per field, per document) and blocks. Spaces can override them. */
export interface AiLengthPreset {
  id: string;
  label: string;
  /** One text field written on its own. */
  fieldWords: number;
  /** The body of a whole document, across its fields and blocks. */
  documentWords: number;
  /** How many blocks a document's block field holds; null leaves it to the model. */
  blocks: number | null;
}

export const AI_DEFAULT_LENGTHS: readonly AiLengthPreset[] = [
  { id: 'short', label: 'Short', fieldWords: 30, documentWords: 250, blocks: 3 },
  { id: 'medium', label: 'Medium', fieldWords: 90, documentWords: 700, blocks: 5 },
  { id: 'long', label: 'Long', fieldWords: 250, documentWords: 1500, blocks: 8 },
  { id: 'extensive', label: 'Extensive', fieldWords: 500, documentWords: 3000, blocks: 12 },
];

/** The ceilings a length may be set to, here and in the settings form alike. */
export const AI_LENGTH_LIMITS = { words: 20_000, blocks: 60, presets: 12 } as const;

/** What one generation is sized to, once a preset or a custom number has been read. */
export interface AiLengthTarget {
  words?: number | undefined;
  blocks?: number | undefined;
}

/** Explicit numbers win, else the space preset the `length` style names. */
export function resolveLength(
  scope: 'field' | 'document',
  styles: Record<string, string | undefined> | null | undefined,
  presets: readonly AiLengthPreset[],
  explicit?: AiLengthTarget | null,
): AiLengthTarget | null {
  const preset = presets.find((entry) => entry.id === styles?.length);
  const words =
    explicit?.words ??
    (preset ? preset[scope === 'field' ? 'fieldWords' : 'documentWords'] : undefined);
  const blocks =
    explicit?.blocks ?? (scope === 'document' ? (preset?.blocks ?? undefined) : undefined);
  if (!words && !blocks) return null;
  return { ...(words ? { words } : {}), ...(blocks ? { blocks } : {}) };
}

/** The presets offered as the length picker's options; the phrase is built from numbers. */
const LENGTHS: readonly AiStyleOption[] = AI_DEFAULT_LENGTHS.map((preset) => ({
  id: preset.id,
  label: preset.label,
  prompt: '',
}));

const IMAGE_STYLES: readonly AiStyleOption[] = [
  {
    id: 'photo',
    label: 'Photographic',
    prompt: 'A photograph, realistic lighting and depth of field.',
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    prompt: 'A cinematic still, film grain, dramatic lighting.',
  },
  {
    id: 'illustration',
    label: 'Illustration',
    prompt: 'A digital illustration with clean linework.',
  },
  {
    id: 'watercolour',
    label: 'Watercolour',
    prompt: 'A watercolour painting with soft bleeding edges.',
  },
  { id: 'render3d', label: '3D render', prompt: 'A polished 3D render with soft studio lighting.' },
  {
    id: 'flat',
    label: 'Flat vector',
    prompt: 'A flat vector illustration, bold shapes, limited palette.',
  },
  { id: 'isometric', label: 'Isometric', prompt: 'An isometric illustration, precise geometry.' },
  { id: 'lineart', label: 'Line art', prompt: 'Monochrome line art on a plain background.' },
  {
    id: 'minimal',
    label: 'Minimal',
    prompt: 'A minimal composition with generous negative space.',
  },
];

const IMAGE_MOODS: readonly AiStyleOption[] = [
  { id: 'bright', label: 'Bright', prompt: 'Bright, airy, high key.' },
  { id: 'moody', label: 'Moody', prompt: 'Moody, low key, deep shadows.' },
  { id: 'warm', label: 'Warm', prompt: 'Warm colour temperature, golden light.' },
  { id: 'cool', label: 'Cool', prompt: 'Cool colour temperature, blue cast.' },
  { id: 'vibrant', label: 'Vibrant', prompt: 'Saturated, high-contrast colour.' },
  { id: 'muted', label: 'Muted', prompt: 'Muted, desaturated palette.' },
];

const VIDEO_STYLES: readonly AiStyleOption[] = [
  {
    id: 'cinematic',
    label: 'Cinematic',
    prompt: 'Shot like a film: shallow depth of field, considered framing.',
  },
  {
    id: 'documentary',
    label: 'Documentary',
    prompt: 'Observational documentary footage, natural light.',
  },
  { id: 'product', label: 'Product', prompt: 'A product shot on a clean set, studio lighting.' },
  { id: 'animation', label: 'Animation', prompt: 'Animated, stylised, not photoreal.' },
  { id: 'timelapse', label: 'Timelapse', prompt: 'A timelapse: visible passage of time.' },
  { id: 'aerial', label: 'Aerial', prompt: 'An aerial drone shot.' },
];

const CAMERA_MOTIONS: readonly AiStyleOption[] = [
  { id: 'static', label: 'Static', prompt: 'The camera does not move.' },
  { id: 'pan', label: 'Pan', prompt: 'The camera pans slowly across the scene.' },
  { id: 'dolly-in', label: 'Push in', prompt: 'The camera pushes slowly towards the subject.' },
  { id: 'dolly-out', label: 'Pull out', prompt: 'The camera pulls slowly away from the subject.' },
  { id: 'orbit', label: 'Orbit', prompt: 'The camera orbits the subject.' },
  { id: 'handheld', label: 'Handheld', prompt: 'Handheld camera, slight natural shake.' },
];

const ratio = (id: string): AiStyleOption => ({ id, label: id, prompt: '' });

export const AI_STYLE_GROUPS: readonly AiStyleGroup[] = [
  {
    id: 'writingStyle',
    label: 'Writing style',
    capabilities: ['text'],
    optional: true,
    options: WRITING_STYLES,
  },
  { id: 'tone', label: 'Tone', capabilities: ['text'], optional: true, options: TONES },
  { id: 'length', label: 'Length', capabilities: ['text'], optional: true, options: LENGTHS },
  {
    id: 'imageStyle',
    label: 'Image style',
    capabilities: ['image'],
    optional: true,
    options: IMAGE_STYLES,
  },
  { id: 'mood', label: 'Mood', capabilities: ['image'], optional: true, options: IMAGE_MOODS },
  {
    id: 'aspectRatio',
    label: 'Aspect ratio',
    capabilities: ['image'],
    optional: false,
    // Only ratios every image model accepts.
    options: ['1:1', '4:3', '3:4', '16:9', '9:16'].map(ratio),
  },
  {
    id: 'resolution',
    label: 'Resolution',
    capabilities: ['image'],
    optional: true,
    // Nano Banana only; Imagen requests omit it, and 2 Lite always renders 1K.
    options: [
      { id: '1K', label: '1K', prompt: '' },
      { id: '2K', label: '2K', prompt: '' },
      { id: '4K', label: '4K', prompt: '' },
    ],
  },
  {
    id: 'videoStyle',
    label: 'Video style',
    capabilities: ['video'],
    optional: true,
    options: VIDEO_STYLES,
  },
  {
    id: 'cameraMotion',
    label: 'Camera',
    capabilities: ['video'],
    optional: true,
    options: CAMERA_MOTIONS,
  },
  {
    id: 'videoAspectRatio',
    label: 'Aspect ratio',
    capabilities: ['video'],
    optional: false,
    options: ['16:9', '9:16'].map(ratio),
  },
  {
    id: 'duration',
    label: 'Duration',
    capabilities: ['video'],
    optional: false,
    options: [
      { id: '4', label: '4 seconds', prompt: '' },
      { id: '6', label: '6 seconds', prompt: '' },
      { id: '8', label: '8 seconds', prompt: '' },
    ],
  },
];

/** The groups a generation of this kind shows, in order. */
export function styleGroupsFor(capability: AiCapability): readonly AiStyleGroup[] {
  return AI_STYLE_GROUPS.filter((group) => group.capabilities.includes(capability));
}

/** The phrases the chosen options contribute, in catalogue order. */
export function stylePhrases(
  capability: AiCapability,
  chosen: Record<string, string | undefined> | null | undefined,
): string[] {
  const phrases: string[] = [];
  for (const group of styleGroupsFor(capability)) {
    const id = chosen?.[group.id];
    if (!id) continue;
    const option = group.options.find((entry) => entry.id === id);
    if (option?.prompt) phrases.push(option.prompt);
  }
  return phrases;
}

/** A chosen option's id when the catalogue knows it, else the fallback. */
export function styleValue(
  groupId: string,
  chosen: Record<string, string | undefined> | null | undefined,
  fallback: string,
): string {
  const group = AI_STYLE_GROUPS.find((entry) => entry.id === groupId);
  const id = chosen?.[groupId];
  return group?.options.some((option) => option.id === id) ? (id as string) : fallback;
}

/** Default system prompts; editable per space. */
export const AI_DEFAULT_SYSTEM_PROMPTS: Record<AiProviderKind, string> = {
  anthropic: [
    'You write copy for a website managed in a CMS.',
    'Return only the text that belongs in the field - no preamble, no explanation, no quotation marks around the whole answer, and no markdown headings unless the field is a rich text field.',
    'Match the language of the request. Never invent facts, names, prices or dates; if a detail is missing, write around it.',
  ].join(' '),
  openai: [
    'You write copy for a website managed in a CMS.',
    'Return only the text that belongs in the field - no preamble, no explanation, no quotation marks around the whole answer, and no markdown headings unless the field is a rich text field.',
    'Match the language of the request. Never invent facts, names, prices or dates; if a detail is missing, write around it.',
  ].join(' '),
  // Same text prompt as the hosted ones.
  custom: [
    'You write copy for a website managed in a CMS.',
    'Return only the text that belongs in the field - no preamble, no explanation, no quotation marks around the whole answer, and no markdown headings unless the field is a rich text field.',
    'Match the language of the request. Never invent facts, names, prices or dates; if a detail is missing, write around it.',
  ].join(' '),
  google: [
    'Generate imagery for a website managed in a CMS.',
    'Prefer clean, uncluttered compositions that leave room for text, and avoid legible words, logos and recognisable brands in the frame.',
  ].join(' '),
};

// Generations

/** `design` is a text generation that lays out content types, templates or workflows. */
export const AI_GENERATION_KINDS = ['text', 'image', 'video', 'document', 'design'] as const;
export type AiGenerationKind = (typeof AI_GENERATION_KINDS)[number];

export const AI_GENERATION_STATUSES = ['pending', 'running', 'succeeded', 'failed'] as const;
export type AiGenerationStatus = (typeof AI_GENERATION_STATUSES)[number];

/** Whether a generation has finished, either way. */
export function isSettled(status: AiGenerationStatus): boolean {
  return status === 'succeeded' || status === 'failed';
}

/** The field types the magic wand is offered on, by what the generation would produce. */
export const AI_TEXT_FIELD_TYPES: readonly string[] = ['string', 'richtext'];
export const AI_ASSET_FIELD_TYPES: readonly string[] = ['asset'];

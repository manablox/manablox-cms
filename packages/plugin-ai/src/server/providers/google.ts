import { delay, ManabloxError } from '@manablox/core';
import { assertUsable } from './answer.js';
import { requestBytes, requestJson, transport } from './http.js';
import type { AiProviderClient, MediaResult, ProviderCall } from './types.js';

const BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Max wait for a Veo operation. */
const VIDEO_TIMEOUT_MS = 10 * 60 * 1000;
const VIDEO_POLL_MS = 10_000;

/** Imagen response: base64 image on a prediction. */
interface PredictResponse {
  predictions?: Array<{ bytesBase64Encoded?: string; mimeType?: string }>;
}

/** Gemini response: base64 image on one of the parts. */
interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: GeminiPart[] };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
}

interface GeminiPart {
  text?: string;
  inlineData?: { mimeType?: string; data?: string };
  /** REST uses camelCase; snake_case is read too. */
  inline_data?: { mime_type?: string; mimeType?: string; data?: string };
}

/** Whether a model id is an image model (Gemini or Imagen). */
function imageish(id: string): boolean {
  return id.includes('image') || id.startsWith('imagen');
}

/** `GET /models` response; names are `models/<id>`. */
interface ModelListResponse {
  models?: Array<{ name: string }>;
}

interface Operation {
  name: string;
  done?: boolean;
  error?: { message?: string };
  response?: {
    generateVideoResponse?: { generatedSamples?: Array<{ video?: { uri?: string } }> };
    generatedSamples?: Array<{ video?: { uri?: string } }>;
  };
}

function headers(apiKey: string): Record<string, string> {
  return { 'content-type': 'application/json', 'x-goog-api-key': apiKey };
}

/** A file name from the prompt's first words. */
function nameFrom(prompt: string, fallback: string): string {
  const slug = prompt
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .split('-')
    .slice(0, 6)
    .join('-');
  return slug || fallback;
}

/** True for Nano Banana (Gemini) image models, which use `:generateContent` rather than `:predict`. */
export function isGeminiImageModel(model: string): boolean {
  return model.startsWith('gemini-');
}

/** Google Gemini API: Nano Banana and Imagen for images, Veo (long-running) for video. */
export const googleProvider: AiProviderClient = {
  kind: 'google',
  capabilities: ['image', 'video'],

  generateImage(call: ProviderCall): Promise<MediaResult> {
    return isGeminiImageModel(call.model) ? nanoBananaImage(call) : imagenImage(call);
  },

  async generateVideo(call: ProviderCall): Promise<MediaResult> {
    const started = await requestJson<Operation>(
      `${BASE}/models/${encodeURIComponent(call.model)}:predictLongRunning`,
      {
        method: 'POST',
        headers: headers(call.apiKey),
        body: JSON.stringify({
          instances: [{ prompt: promptOf(call) }],
          parameters: {
            aspectRatio: call.options.aspectRatio ?? '16:9',
            ...(call.options.duration ? { durationSeconds: Number(call.options.duration) } : {}),
          },
        }),
      },
      transport('google', call),
    );

    const uri = await pollVideo(started, call);
    // The download needs the API key too.
    const bytes = await requestBytes(
      uri,
      {
        headers: { 'x-goog-api-key': call.apiKey },
      },
      transport('google', call),
    );
    return {
      body: bytes,
      mimeType: 'video/mp4',
      filename: nameFrom(call.prompt, 'generated-video'),
    };
  },

  /** Checks the model is among those the key can see, listing alternatives if not. */
  async verify(call): Promise<void> {
    const body = await requestJson<ModelListResponse>(
      `${BASE}/models?pageSize=1000`,
      { headers: headers(call.apiKey) },
      transport('google', call),
    );

    const available = (body.models ?? []).map((entry) => entry.name.replace(/^models\//, ''));
    const model = call.model;
    if (!model || available.includes(model)) return;

    const alternatives = available
      .filter((id) => (model.includes('veo') ? id.includes('veo') : imageish(id)))
      .join(', ');
    throw ManabloxError.badRequest('plugins.ai.provider.model.notFound', {
      provider: 'google',
      model,
      available: alternatives,
      message: alternatives
        ? `This key cannot use "${model}". It can use: ${alternatives}.`
        : `This key cannot use "${model}", and has no model of that kind available at all.`,
    });
  },
};

/** System prompt followed by the user prompt. */
function promptOf(call: ProviderCall): string {
  return `${call.system}\n\n${call.prompt}`.trim();
}

/** Nano Banana image generation. Some models refuse `IMAGE` alone, so `TEXT` is requested too. */
async function nanoBananaImage(call: ProviderCall): Promise<MediaResult> {
  const body = await requestJson<GenerateContentResponse>(
    `${BASE}/models/${encodeURIComponent(call.model)}:generateContent`,
    {
      method: 'POST',
      headers: headers(call.apiKey),
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: promptOf(call) }] }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
          imageConfig: {
            aspectRatio: call.options.aspectRatio ?? '1:1',
            ...(call.options.resolution ? { imageSize: call.options.resolution } : {}),
          },
        },
      }),
    },
    transport('google', call),
  );

  // A blocked prompt is a 200 with a reason and no image.
  const blocked = body.promptFeedback?.blockReason ?? blockingFinish(body);
  assertUsable('google', blocked);
  if (blocked) {
    throw ManabloxError.badRequest('plugins.ai.response.unusable', {
      provider: 'google',
      reason: blocked,
    });
  }

  const image = imagePart(body);
  if (!image?.data) throw ManabloxError.badRequest('plugins.ai.response.empty');
  return {
    body: Buffer.from(image.data, 'base64'),
    mimeType: image.mimeType ?? 'image/png',
    filename: nameFrom(call.prompt, 'generated-image'),
  };
}

/** The first part with inline data. */
function imagePart(body: GenerateContentResponse): { data: string; mimeType?: string } | null {
  for (const part of body.candidates?.[0]?.content?.parts ?? []) {
    const inline = part.inlineData ?? part.inline_data;
    const data = inline?.data;
    if (!data) continue;
    const mimeType =
      (inline as { mimeType?: string }).mimeType ?? (inline as { mime_type?: string }).mime_type;
    return { data, ...(mimeType ? { mimeType } : {}) };
  }
  return null;
}

/** A finish reason other than `STOP`. */
function blockingFinish(body: GenerateContentResponse): string | null {
  const reason = body.candidates?.[0]?.finishReason;
  return reason && reason !== 'STOP' ? reason : null;
}

/** Imagen image generation. */
async function imagenImage(call: ProviderCall): Promise<MediaResult> {
  const body = await requestJson<PredictResponse>(
    `${BASE}/models/${encodeURIComponent(call.model)}:predict`,
    {
      method: 'POST',
      headers: headers(call.apiKey),
      body: JSON.stringify({
        instances: [{ prompt: promptOf(call) }],
        // Imagen takes no image size.
        parameters: { sampleCount: 1, aspectRatio: call.options.aspectRatio ?? '1:1' },
      }),
    },
    transport('google', call),
  );

  const prediction = body.predictions?.[0];
  if (!prediction?.bytesBase64Encoded) throw ManabloxError.badRequest('plugins.ai.response.empty');
  return {
    body: Buffer.from(prediction.bytesBase64Encoded, 'base64'),
    mimeType: prediction.mimeType ?? 'image/png',
    filename: nameFrom(call.prompt, 'generated-image'),
  };
}

/** Polls the operation and returns the video URI. */
async function pollVideo(started: Operation, call: ProviderCall): Promise<string> {
  const deadline = Date.now() + VIDEO_TIMEOUT_MS;
  let operation = started;

  while (!operation.done) {
    if (Date.now() > deadline) throw ManabloxError.badRequest('plugins.ai.generation.notReady');
    await delay(VIDEO_POLL_MS, call.signal);
    operation = await requestJson<Operation>(
      `${BASE}/${operation.name}`,
      { headers: headers(call.apiKey) },
      transport('google', call),
    );
  }

  if (operation.error) {
    throw ManabloxError.badRequest('plugins.ai.request.failed', {
      provider: 'google',
      message: operation.error.message ?? '',
    });
  }

  const samples =
    operation.response?.generateVideoResponse?.generatedSamples ??
    operation.response?.generatedSamples ??
    [];
  const uri = samples[0]?.video?.uri;
  if (!uri) throw ManabloxError.badRequest('plugins.ai.response.empty');
  return uri;
}

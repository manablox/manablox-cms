# `@manablox/plugin-ai`

AI assistance for Manablox, as a plugin:

- **Write text** for a field or a whole document with Claude (Anthropic), ChatGPT (OpenAI) or a model you run yourself, like Ollama, LM Studio, vLLM or any OpenAI-compatible server.
- **Create images and videos** with Google (Gemini images, Imagen, Veo).
- **Design content** from a description: content types, block types and content templates, and with the website plugin, themes and block designs; with workflows, a workflow.
- **The AI workflow node** (`ai.generate`), which writes text, a document or a picture in a run.

Each space sets up its own AI providers, so two spaces can use two accounts, and a space
can have no AI at all. API keys are stored encrypted (AES-256-GCM) with the instance's
`AUTH_SECRET` and are never sent to the browser. Text answers come right away; images and
videos run as background jobs (`ai:generate`), because a video can take minutes. The
providers are called with plain `fetch`, so the plugin carries no provider libraries.

Without the plugin an instance has no AI, and nothing of it is shown in the admin. The
admin loads the plugin's screens at runtime, so the prebuilt `@manablox/admin` needs no
rebuild.

## Install

```sh
npm install @manablox/plugin-ai
```

A project made with `manablox create` has it when AI was picked as a feature (`--ai`, or `ai`
in `--features`); nothing is preselected. Add it to an existing project with
`manablox plugin install ai`.

## Usage

Add the plugin to the management instance's config:

```ts
import { defineConfig, envList } from '@manablox/core';
import { aiPlugin } from '@manablox/plugin-ai';

export default defineConfig({
  // database, auth, storage ...
  plugins: [
    // Private-network hosts a self-hosted model may be reached at, as `host` or `host:port`.
    aiPlugin({ allowedHosts: envList('AI_ALLOWED_HOSTS', []) }),
  ],
});
```

Then run the migrations (`manablox migrate`): the plugin's tables are `ai_providers` and
`ai_generations`.

## Options of `aiPlugin`

- `allowedHosts`: hosts on the private network a self-hosted model may be reached at, as `host` or `host:port` (`ollama`, `localhost:11434`). A model at a public address needs no entry.
- `designRetries`: how often a design with problems is sent back to the model with them, 2 by default.

## What it adds

- Procedures under `plugins.ai.*`: providers, settings, generation and designs.
- Permissions `ai:read`, `ai:use` and `ai:configure`.
- Controls: the flag `features.plugins.ai`, and `features.plugins.ai.images`, `.video`, `.designModels`, `.designSpace` and `.workflows`, the usage metric `usage.plugins.ai.calls`, the rate rule `rateLimits.plugins.ai.calls` and `retention.plugins.ai.generationsDays`.
- The providers in space exports (`ai.providers`, without keys) and snapshots (keys carried over on the same instance).
- `plugins: { ai: { copyFrom } }` on `spaces.create`: copies another space's providers.
- Services for other plugins, `plugins.get('ai')`: `ai` (generation and providers) and `design` (checked designs behind `features.plugins.ai.designModels`).

The browser-safe catalogue of providers, models and styles is `@manablox/plugin-ai/sdk`.

## License

MIT, see `LICENSE`.

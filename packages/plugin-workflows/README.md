# `@manablox/plugin-workflows`

Workflows for Manablox, as a plugin: automations editors build in the admin, "when this
happens, do these steps", drawn as nodes on a canvas.

## Triggers

A workflow starts when:

- something happens to a document: created, updated, saved, published, unpublished or deleted,
- a schedule is due, written as a cron expression like `0 9 * * 1` (every Monday at 9:00) in a time zone you choose,
- another workflow runs it, with values it declares,
- someone runs it by hand,
- something another plugin adds happens, such as an incoming webhook call (`@manablox/plugin-webhooks`).

Abort triggers stop a workflow's runs that are still going: on an event, or on what
another plugin adds.

## Steps

Steps are connected like a flow chart. There are:

- **actions**: send an email (SMTP, Gmail, Microsoft, Resend, SendGrid, Postmark, Mailgun), send a web push notification, call an HTTP endpoint, create or update a document, read a website, transform JSON, and the actions other plugins add, such as the AI plugin's `ai.generate`,
- **conditions** and **switches**: go one way or another depending on rules,
- **waits**: pause for some time,
- **loops**: run steps once for each item of a list, a number of times, or until rules hold,
- **calls**: run another workflow and carry on with what it hands back,
- **stops**: end the run.

Texts in steps can use `{{ placeholders }}` that are filled from the run, like
`{{ content.title }}` or `{{ nodes.fetch.body.id }}`. Every workflow has a draft and
published versions, and every run is recorded step by step.

Without the plugin an instance has no workflows, and nothing of them is shown in the
admin. The admin loads the plugin's screens at runtime, so the prebuilt `@manablox/admin`
needs no rebuild.

## Install

```sh
npm install @manablox/plugin-workflows @manablox/plugin-webhooks
```

A project made with `manablox create` has the workflows plugin when workflows were picked as
a feature (`--workflows`, or `workflows` in `--features`), and the webhooks plugin, which
brings the webhook trigger, when webhooks were picked; nothing is preselected. Each works
without the other. Add them to an existing project with
`manablox plugin install workflows webhooks`.

## Usage

Add the plugin to the management instance's config, with the webhooks plugin for the
webhook trigger. The public (delivery) config needs neither:

```ts
import { defineConfig } from '@manablox/core';
import { webhooksPlugin } from '@manablox/plugin-webhooks';
import { workflowsPlugin } from '@manablox/plugin-workflows';

export default defineConfig({
  // database, auth, storage ...
  plugins: [workflowsPlugin(), webhooksPlugin()],
});
```

Then run the migrations (`manablox migrate`): the plugin's tables are `workflows`,
`workflows_versions` and `workflows_runs`.

## Options of `workflowsPlugin`

- `runTimeoutSeconds`: how long one run may take, delays excluded, 300 by default.
- `maxCrawlPages`: how many pages one crawl may fetch, whatever the node asks for, 50 by default.

## What it adds

- Procedures under `plugins.workflows.*`: workflows, versions, runs, test runs, starting and aborting runs, workflow files and, with the AI plugin, designing a workflow from a description.
- Permissions `workflows:read` and `workflows:write`.
- Controls: the flag `features.plugins.workflows`, `features.plugins.workflows.http` and `.mail`, the limit `limits.plugins.workflows.active`, the usage metric `usage.plugins.workflows.runs`, the rate rules `rateLimits.plugins.workflows.starts` and `.concurrency` and `retention.plugins.workflows.runsDays`.
- Hooks `workflows:beforeEnable`, `workflows:beforeRun` and `workflows:afterRun`.
- The job `workflows:run` and the maintenance task `workflows:pruneRuns`.
- Workflows in space exports (`workflows.workflows`), environment copies and promotes, and the config export.
- Workflows declared in code: `defineWorkflow` from `@manablox/plugin-workflows/define`, under `resources.plugins['workflows.workflow']`.
- Extension points for other plugins, `contributions: { workflows: { actions, triggers, abortTriggers, fieldKinds, designHints } }`, and services, `plugins.get('workflows')`, whose `engine.runTrigger` starts the runs of a contributed trigger kind.

## Entry points

- `@manablox/plugin-workflows`: the plugin, its services and the engine.
- `@manablox/plugin-workflows/define`: safe to load at config time: `defineWorkflow`, `defineWorkflowAction`, `defineWorkflowTrigger`, `defineWorkflowAbortTrigger` and the types of the extension points.
- `@manablox/plugin-workflows/sdk`: browser-safe types and constants: the graph, triggers, runs and action metadata.
- `@manablox/plugin-workflows/schema`: the zod input schemas of workflow graphs.
- `@manablox/plugin-workflows/cli`: its part of `manablox create`.
- `@manablox/plugin-workflows/admin-slots`: the types of the admin slots other plugins fill (`workflows:triggerForm`, `workflows:nodeForm`, `workflows:fieldControl`, `workflows:createActions`).

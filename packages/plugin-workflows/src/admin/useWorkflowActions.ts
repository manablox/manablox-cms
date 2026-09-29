import { confirmAndRun, type EditorForm, requireSpace, runWrite, toast } from '@manablox/admin-sdk';
import { computed, type Ref, ref } from 'vue';
import { useRouter } from 'vue-router';
import { type Draft, triggerKind } from './model';
import { exportWorkflowFile, type TestSample, type Workflow, workflows } from './queries';

/** Copies a version into the draft, after asking; the same flow on the editor and the version page. */
export function restoreVersion(
  id: string,
  version: number,
  options: { unsaved?: boolean; after?: () => unknown } = {},
): Promise<boolean> {
  return confirmAndRun(
    {
      title: `Restore version ${version}?`,
      message: `The draft becomes a copy of this version${
        options.unsaved ? ', and your unsaved changes are dropped' : ', replacing its changes'
      }. Nothing runs differently until you publish it.`,
      confirmLabel: 'Restore to the draft',
    },
    async () => {
      await workflows.restoreVersion(requireSpace(), id, version);
      await options.after?.();
    },
    { success: `Version ${version} is now the draft` },
  );
}

/** Downloads the saved draft, or `version`, as a file; failures are toasted. */
export function exportWorkflow(id: string, name: string, version?: number): Promise<boolean> {
  return runWrite(() => exportWorkflowFile(requireSpace(), id, name, version));
}

interface WorkflowActionsOptions {
  id: Ref<string>;
  form: EditorForm<Draft>;
  workflow: Ref<Workflow | undefined>;
  readOnly: Ref<boolean>;
  /** Declared in config: only its switch saves. */
  isCode: Ref<boolean>;
  /** Points at the first error after a failed save. */
  onInvalid: () => void;
  /** Runs after a version became the draft. */
  onRestored: () => void;
}

const input = (current: Draft) => ({
  name: current.name.trim(),
  description: current.description.trim() || null,
  enabled: current.enabled,
  trigger: current.trigger,
  abortTriggers: current.abortTriggers,
  nodes: current.nodes,
  edges: current.edges,
});

/** The editor's writes: save, publish, test runs, restore, clone, export and delete. */
export function useWorkflowActions(options: WorkflowActionsOptions) {
  const { id, form, workflow, readOnly, isCode } = options;
  const router = useRouter();

  async function save(): Promise<boolean> {
    const current = form.draft.value;
    if (!current || readOnly.value || !form.isDirty.value) return !form.isDirty.value;
    const ok = await form.submit(async () => {
      const saved = await workflows.update({
        spaceId: requireSpace(),
        id: id.value,
        ...input(current),
      });
      form.markSaved();
      toast.success(
        saved.publishedVersion === null
          ? `Saved "${saved.name}"; publish it to let its trigger run it`
          : `Saved "${saved.name}"; publish to make the changes live`,
      );
    });
    if (!ok) options.onInvalid();
    return ok;
  }

  // --- publishing -----------------------------------------------------------------------

  /** Unsaved edits, a never-published draft or saved changes can be published. */
  const canPublish = computed(
    () =>
      !readOnly.value &&
      (form.isDirty.value ||
        workflow.value?.publishedVersion === null ||
        Boolean(workflow.value?.draftChanged)),
  );
  const askingPublish = ref(false);
  const publishing = ref(false);

  /** Publishes the draft, saving unsaved edits in the same call. */
  async function publish(note: string | null) {
    const current = form.draft.value;
    if (!current || publishing.value) return;
    const dirty = form.isDirty.value;
    publishing.value = true;
    const ok = await form.submit(async () => {
      const spaceId = requireSpace();
      const saved = dirty
        ? await workflows.update({ spaceId, id: id.value, ...input(current), publish: true, note })
        : (await workflows.publish(spaceId, id.value, note)).workflow;
      form.markSaved();
      toast.success(
        saved.enabled
          ? `Published version ${saved.publishedVersion}; it runs from now on`
          : `Published version ${saved.publishedVersion}; switch it on to let it run`,
      );
    });
    publishing.value = false;
    askingPublish.value = false;
    if (!ok) options.onInvalid();
  }

  const restore = (version: number) =>
    restoreVersion(id.value, version, { unsaved: form.isDirty.value, after: options.onRestored });

  // --- the switch, copies and deletion ----------------------------------------------------

  /** A declared workflow's switch saves at once; the normal save is closed to it. */
  async function toggleEnabled(enabled: boolean) {
    const current = form.draft.value;
    if (!current) return;
    current.enabled = enabled;
    if (!isCode.value) return;
    const ok = await runWrite(
      async () => {
        const saved = await workflows.setEnabled(requireSpace(), id.value, enabled);
        current.enabled = saved.enabled;
        form.markSaved();
        return saved;
      },
      { success: (saved) => `${saved.name} is ${enabled ? 'on' : 'off'}` },
    );
    if (!ok) current.enabled = !enabled;
  }

  /** Copies the saved version, disabled and untied from config; saves a dirty draft first. */
  async function clone() {
    if (!readOnly.value && form.isDirty.value && !(await save())) return;
    await runWrite(
      async () => {
        const created = await workflows.duplicate(requireSpace(), id.value);
        form.markSaved();
        await router.push(`/workflows/${created.id}`);
        return created;
      },
      { success: (created) => `Copied to "${created.name}"` },
    );
  }

  /** Downloads the saved draft; unsaved edits are not in it. */
  function exportFile() {
    if (form.isDirty.value)
      toast.success('Exporting the saved draft; save to include your changes');
    const name = workflow.value?.slug || form.draft.value?.name || 'workflow';
    return exportWorkflow(id.value, name);
  }

  function remove() {
    const name = form.draft.value?.name ?? 'the workflow';
    return confirmAndRun(
      {
        title: 'Delete this workflow?',
        message: 'Its run history goes with it. Nothing it already sent is undone.',
        confirmLabel: 'Delete workflow',
        danger: true,
      },
      async () => {
        await workflows.remove(requireSpace(), id.value);
        form.markSaved();
        await router.replace('/workflows');
      },
      { success: `Deleted "${name}"` },
    );
  }

  // --- test runs --------------------------------------------------------------------------

  /** The last test run, painted onto the canvas. */
  const inspectedRun = ref<string | null>(null);
  const running = ref(false);
  /** Asking for a document, a called workflow's values, or a contributed kind's sample. */
  const asking = ref<'document' | 'input' | 'sample' | null>(null);

  /** Test-runs the saved draft; saves a dirty draft first. Its outcome is toasted from the run. */
  async function runNow(sample: TestSample = {}) {
    if (form.isDirty.value && !(await save())) return;
    asking.value = null;
    await runWrite(
      async () => {
        const run = await workflows.runNow(requireSpace(), id.value, sample);
        inspectedRun.value = run.id;
        if (run.status === 'succeeded') toast.success('Test run went through');
        else if (run.status === 'waiting') toast.success('Test run started - it is now waiting');
        else if (run.status === 'skipped') toast.success('Test run stopped at a condition');
        else toast.error(`Test run failed: ${run.error ?? 'see the run'}`);
      },
      { busy: running },
    );
  }

  /**
   * Event workflows need a document, called and manual ones values, contributed kinds what their
   * plugin asks for (e.g. a sample call), if anything.
   */
  function startRun() {
    const trigger = form.draft.value?.trigger;
    if (!trigger) return;
    const kind: string = trigger.kind;
    if (trigger.kind === 'schedule') void runNow();
    else if (trigger.kind === 'call' || trigger.kind === 'manual') {
      if (trigger.parameters.length) asking.value = 'input';
      else void runNow();
    } else if (trigger.kind === 'event') asking.value = 'document';
    else if (triggerKind(kind).entry?.sample) asking.value = 'sample';
    else void runNow();
  }

  return {
    save,
    canPublish,
    askingPublish,
    publishing,
    publish,
    restore,
    toggleEnabled,
    clone,
    exportFile,
    remove,
    inspectedRun,
    running,
    asking,
    runNow,
    startRun,
  };
}

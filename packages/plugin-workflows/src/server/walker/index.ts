import type { Manablox } from '@manablox/core/node';
import type { WorkflowNodeLog, WorkflowRunState } from '../../sdk.js';
import type { WorkflowRow, WorkflowRunRow } from '../db/index.js';
import type { PauseRun, WalkerEnvironment, WalkOutcome } from './types.js';
import { Walk } from './walk.js';

export {
  ABORT_CHECK_MS,
  type NodeOutcome,
  type WalkerEnvironment,
  type WalkOutcome,
  type WorkflowCallRequest,
  type WorkflowCallResult,
} from './types.js';

/** Interprets one run over one graph; outputs land under `nodes.<key>`. */
export class RunWalker {
  readonly log: WorkflowNodeLog[];
  private readonly walker: Walk;

  constructor(
    /** Saves the run to resume at `resumeAt`, or when its called run ends. */
    pause: PauseRun,
    manablox: Manablox,
    workflow: WorkflowRow,
    run: WorkflowRunRow,
    env: WalkerEnvironment,
  ) {
    this.walker = new Walk(pause, manablox, workflow, run, env);
    this.log = this.walker.log;
  }

  /** The run's state as stored. */
  storedState(): WorkflowRunState {
    return this.walker.storedState();
  }

  /** Aborts the run: in-flight requests are cancelled and no further node starts. */
  stop(): void {
    this.walker.stop();
  }

  walk(): Promise<WalkOutcome> {
    return this.walker.walk();
  }
}

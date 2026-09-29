# `@manablox/jobs`

Background work that should not slow down a request:

- creating the resized versions of uploaded images,
- the jobs of plugins, such as webhook deliveries with retries when the receiver is down (the webhooks plugin), workflow runs (the workflows plugin) and AI images and videos, which can take minutes (the AI plugin),
- housekeeping on a schedule: removing expired API keys every hour, and the plugins' own tasks, such as pruning old workflow runs every ten minutes.

With Valkey or Redis configured, jobs go into a BullMQ queue and survive a restart, and
the housekeeping runs as repeatable jobs, once across all replicas. Without it, the same
jobs run directly in the server process and the housekeeping on a timer, which is fine for
a single small server.

## Do I need to install it?

Usually not. `@manablox/server` installs and uses it for you. You only import it
directly when you build your own server setup or a plugin that needs it.

## Main exports

- `createJobRunner(manablox, handlers, { worker })`: starts the job queue and runs each job with its handler. `handlers` maps a job name to a function that takes the job's data; the server fills it in for the jobs its services own. `worker: false` only adds jobs and leaves running them to another process.
- `JobRunner`: `enqueue` adds a job, `schedule` runs housekeeping jobs every so often, `close` stops the queue on shutdown.
- `JobHandlers`: the handler map, one optional function per job name.
- `JobPayloads`: the list of all jobs and the data each one needs.
- `MAINTENANCE_SCHEDULE`: the housekeeping jobs and how often each runs, for `schedule`.

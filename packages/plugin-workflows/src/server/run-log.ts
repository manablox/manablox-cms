import { WORKFLOW_LOG_OUTPUT_LIMIT, type WorkflowNodeLog } from '../sdk.js';

/** Redacts decrypted secrets; run logs are visible to anyone who can see the workflow. */
export function scrubText(secrets: ReadonlySet<string>, value: string | null): string | null {
  if (value === null || secrets.size === 0) return value;
  let out = value;
  for (const secret of secrets) {
    if (secret.length >= 4) out = out.split(secret).join('[redacted]');
  }
  return out;
}

/** A node's output for its log line, scrubbed and cut to size. */
export function logOutput(
  secrets: ReadonlySet<string>,
  output: unknown,
): Pick<WorkflowNodeLog, 'output' | 'outputTruncated'> {
  if (output === undefined) return {};
  let json: string | undefined;
  try {
    json = JSON.stringify(output);
  } catch {
    return { output: '[not serialisable]', outputTruncated: true };
  }
  if (json === undefined) return {};
  const scrubbed = scrubText(secrets, json) ?? json;
  if (scrubbed.length > WORKFLOW_LOG_OUTPUT_LIMIT) {
    return { output: scrubbed.slice(0, WORKFLOW_LOG_OUTPUT_LIMIT), outputTruncated: true };
  }
  try {
    return { output: JSON.parse(scrubbed) as unknown };
  } catch {
    return { output: scrubbed, outputTruncated: true };
  }
}

export function scrubDetail(
  secrets: ReadonlySet<string>,
  detail: Record<string, unknown> | null,
): Record<string, unknown> | null {
  if (detail === null || secrets.size === 0) return detail;
  const scrubbed = scrubText(secrets, JSON.stringify(detail));
  return scrubbed ? (JSON.parse(scrubbed) as Record<string, unknown>) : detail;
}

// Single source of truth for interpreting Run.failedReason. The executor encodes
// failures as short codes (see lib/dag/executor.ts:reasonFor and
// lib/runtime/recovery.ts). This module maps a code to a category, the right
// recovery action, and user-facing copy so the run UI, the retry route, and any
// future surface stay consistent.
//
// recoveryAction contract:
//   'edit-models' — provider/lead-plan failures the user fixes by switching the
//                   team's models (handled by the existing team-models flow).
//   'retry'       — failures the user re-attempts from the start (handled by the
//                   retry route: in-place reset or clone-new-run).
//   'none'        — no failure.

export type FailureCategory =
  | 'provider_unavailable'
  | 'provider_auth'
  | 'provider_unknown'
  | 'schema_error'
  | 'timeout'
  | 'rate_limit'
  | 'model_not_found'
  | 'aborted'
  | 'cancelled'
  | 'plan_invalid'
  | 'plan_failed'
  | 'task_failed'
  | 'process_restart'
  | 'unknown'
  | 'none';

export type RecoveryAction = 'edit-models' | 'retry' | 'none';

export interface FailureClass {
  category: FailureCategory;
  recoveryAction: RecoveryAction;
  title: string;
  help: string;
}

export function classifyFailure(failedReason: string | null | undefined): FailureClass {
  const reason = failedReason ?? '';
  if (!reason) {
    return { category: 'none', recoveryAction: 'none', title: '', help: '' };
  }

  if (reason === 'user_cancelled') {
    return {
      category: 'cancelled',
      recoveryAction: 'retry',
      title: 'Run cancelled',
      help: 'You cancelled this run. Retry starts it again from the beginning — a run that already had a plan starts as a fresh copy and keeps this cancelled run for reference.',
    };
  }

  if (reason.startsWith('lead_plan_provider_unavailable:')) {
    return {
      category: 'provider_unavailable',
      recoveryAction: 'edit-models',
      title: 'Lead provider unavailable',
      help: "The Lead agent's provider could not be reached. Switch the affected agents to an available provider/model, then save to retry.",
    };
  }
  if (reason.startsWith('lead_plan_provider_auth:')) {
    return {
      category: 'provider_auth',
      recoveryAction: 'edit-models',
      title: 'Provider authentication failed',
      help: 'The provider rejected the configured key. Check Settings, or switch the agents to a provider with a working key, then save to retry.',
    };
  }
  if (reason.startsWith('lead_plan_unknown_provider:')) {
    return {
      category: 'provider_unknown',
      recoveryAction: 'edit-models',
      title: 'Unknown provider',
      help: 'A configured model points at a provider the app does not recognize. Switch the agents to a known provider/model, then save to retry.',
    };
  }
  if (reason.startsWith('lead_plan_rate_limit:') || reason.startsWith('rate_limit:')) {
    return {
      category: 'rate_limit',
      recoveryAction: 'retry',
      title: 'Provider rate limit reached',
      help: 'The provider is rate limiting requests. Wait a moment and retry, or switch the affected agents to a different provider/model.',
    };
  }
  if (
    reason.startsWith('lead_plan_model_not_found:') ||
    reason.startsWith('model_not_found:')
  ) {
    return {
      category: 'model_not_found',
      recoveryAction: 'edit-models',
      title: 'Model not found',
      help: 'A configured model is not recognized by its provider. Switch the affected agents to a valid model, then save to retry.',
    };
  }
  if (reason === 'lead_plan_schema_error') {
    return {
      category: 'schema_error',
      recoveryAction: 'edit-models',
      title: 'Lead returned an invalid plan',
      help: 'The Lead model produced a malformed DAG. Switch the Lead to a stronger structured-output model, then save to retry.',
    };
  }
  if (reason.startsWith('lead_plan_timeout:')) {
    return {
      category: 'timeout',
      recoveryAction: 'edit-models',
      title: 'Lead planning timed out',
      help: 'The Lead model did not return a plan before the timeout. Switch the Lead to a faster or stronger model, then save to retry.',
    };
  }
  if (reason === 'lead_plan_aborted') {
    return {
      category: 'aborted',
      recoveryAction: 'retry',
      title: 'Planning was interrupted',
      help: 'Lead planning was aborted before it finished. You can retry this run from the start.',
    };
  }
  if (reason.startsWith('lead_plan_invalid:')) {
    return {
      category: 'plan_invalid',
      recoveryAction: 'retry',
      title: 'Plan failed validation',
      help: 'The generated plan did not pass validation. Retry the run; if it keeps failing, edit the team models first.',
    };
  }
  if (reason.startsWith('lead_plan_failed:')) {
    return {
      category: 'plan_failed',
      recoveryAction: 'retry',
      title: 'Planning failed',
      help: 'The Lead agent could not produce a plan. Retry the run from the start.',
    };
  }
  if (reason.startsWith('task_failed:')) {
    return {
      category: 'task_failed',
      recoveryAction: 'retry',
      title: 'A task failed during execution',
      help: 'One of the planned tasks failed while running. Retry starts a fresh run with the same team and prompt; this failed run is kept for reference.',
    };
  }
  if (reason === 'process_restart') {
    return {
      category: 'process_restart',
      recoveryAction: 'retry',
      title: 'Interrupted by a server restart',
      help: 'The server restarted while this run was in progress, so it was marked failed. You can retry it.',
    };
  }
  return {
    category: 'unknown',
    recoveryAction: 'retry',
    title: 'Run failed',
    help: 'This run ended in a failed state. You can retry it.',
  };
}

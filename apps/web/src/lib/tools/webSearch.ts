// Web search stub. Registered with enabled=false so policy denies it before
// invocation. The execute body is a guard — if a future caller bypasses the
// registry it will still throw rather than make outbound requests.

import { z } from 'zod';

import { registerTool } from './registry';

registerTool({
  name: 'web.search',
  enabled: false,
  description: 'Web search (disabled in MVP).',
  argsSchema: z.object({ query: z.string().min(1) }),
  execute: async () => {
    throw new Error('tool_disabled: web.search is not enabled in MVP');
  },
});

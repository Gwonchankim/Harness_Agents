// Side-effect import order: register fs tools, then the disabled web.search
// stub, so policy.evaluate sees them in the registry.
import './fsTools';
import './webSearch';

export {
  invokeTool,
  registerTool,
  getTool,
  listToolNames,
  ToolDeniedError,
} from './registry';
export { evaluatePolicy, ALLOWED_TOOL_NAMES } from './policy';
export type { ToolContext, ToolDefinition, PolicyResult } from './types';

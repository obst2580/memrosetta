export {
  isClaudeCodeInstalled,
  isClaudeCodeConfigured,
  registerClaudeCodeHooks,
  removeClaudeCodeHooks,
  updateClaudeMd,
  removeClaudeMdSection,
} from './claude-code.js';

export {
  isGenericMCPConfigured,
  registerGenericMCP,
  removeGenericMCP,
  getGenericMCPPath,
} from './mcp.js';

export {
  isCursorConfigured,
  registerCursorMCP,
  removeCursorMCP,
  getCursorMcpConfigPath,
  getCursorRulesPath,
  updateCursorRules,
  removeCursorRulesSection,
} from './cursor.js';

export {
  isCodexInstalled,
  isCodexConfigured,
  registerCodexMCP,
  removeCodexMCP,
  getCodexConfigFilePath,
  getAgentsMdPath,
  updateAgentsMd,
  removeAgentsMdSection,
} from './codex.js';

export { resolveMcpCommand, resolveHookCommand } from './resolve-command.js';

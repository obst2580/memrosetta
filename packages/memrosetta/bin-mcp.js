#!/usr/bin/env node
// Bootstraps the @memrosetta/mcp stdio server.
//
// Historical note (Codex Windows analysis 2026-04-17):
// The previous implementation built an absolute path via
// `require.resolve` + `path.join` and passed that string directly
// to dynamic `import()`. On Windows the resulting value looks like
// `C:\Users\...\dist\index.js` and Node's ESM loader rejects it with
// `ERR_UNSUPPORTED_ESM_URL_SCHEME` ("Received protocol 'c:'"), which
// crashed the MCP process before the initialize handshake could
// complete. Codex users saw "connection closed: initialize response".
//
// Using a bare-specifier import makes Node's module resolver do the
// right thing on every platform without manipulating URL schemes.
import '@memrosetta/mcp';



## MemRosetta (Long-term Memory)

MCP server `memrosetta` provides persistent memory across sessions.
userId defaults to the system username -- no need to specify it.

### When to search (memrosetta_search)
When you need information not in the current context, search past memories.

### When to store (memrosetta_store)

**After EVERY response, run this checklist:**
1. Did I encounter a DECISION? (tech choice, approach selection) -> store as "decision"
2. Did I learn a new FACT? (config, architecture, project info) -> store as "fact"
3. Did the user state a PREFERENCE? (style, tool choice, pattern) -> store as "preference"
4. Did we COMPLETE something? (deploy, migration, fix) -> store as "event"
5. None of the above? -> skip, do not store.

Always include 2-3 keywords. Example:
  content: "Decided to use OAuth2 with PKCE for auth"
  type: "decision"
  keywords: "auth, oauth2, pkce"

Do NOT store:
- Code itself (belongs in git)
- File operations ("Created file X", "Modified Y")
- Debugging steps and attempts
- Simple confirmations or acknowledgments

### When to relate (memrosetta_relate)
When new information updates or contradicts existing memories, create a relation.

### Working memory (memrosetta_working_memory)
Call this at the start of complex tasks to load relevant context.

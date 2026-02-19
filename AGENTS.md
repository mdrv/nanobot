# Nanobot Development Guidelines

## Quick Commands

### Python (nanobot/)
```bash
# Lint & format
ruff check nanobot/
ruff format nanobot/

# Tests
pytest                              # Run all tests
pytest tests/test_cli_input.py::test_read_interactive_input_async_returns_input  # Single test
pytest tests/test_cli_input.py -k "test_read_interactive_input_async"       # Filter tests
pytest --cov=nanobot                 # With coverage
```

### TypeScript (bridge/)
```bash
cd bridge && npm run build    # Compile
cd bridge && npm run dev      # Build + run
cd bridge && npm start        # Start server
```

## Code Style

### Python
**Imports**: stdlib → external → internal
```python
import asyncio
from pathlib import Path
from loguru import logger
from nanobot.channels.base import BaseChannel
```

**Type hints**: Use PEP 604 unions (`str | None`), always return types
```python
async def handle_message(msg: str | None) -> dict[str, Any]:
    ...
```

**Docstrings**: Google style with Args/Returns sections

**Error handling**: Log with context, then raise
```python
try:
    await ws.send(payload)
except ConnectionError as e:
    logger.error(f"WebSocket failed: {e}")
    raise
```

**Naming**: `PascalCase` (classes), `snake_case` (functions/vars), `_private` (internal)

**Configuration**: Use Pydantic models with `Field(default_factory=list)` for mutable defaults

### TypeScript
**Types**: Define interfaces in `types.ts`, use `?` for optional fields
```typescript
export interface InboundMessage {
  id: string;
  sender: string;
  content?: string;
  isGroup: boolean;
}
```

**Classes**: Private fields for internal state
```typescript
export class WhatsAppClient {
  private sock: WASocket | null = null;
  async connect(): Promise<void> { ... }
}
```

**Error handling**: `try/catch` with console.error, then throw

## WhatsApp Channel Development

**Mention detection**: Bot responds only when mentioned in groups; direct messages always respond

**Quiz system (Kotaete)**:
- Tracks: question, answer, start time, chat ID
- Response types: Exact → ✅ "Correct!" + end, Partial → ✨, Close (Levenshtein ≤2) → 🔍
- Custom quizzes per group via group-specific config

**Bridge protocol**: WebSocket between Python and Node.js
- Python sends: `{ type: "send", to, text }`
- Node.js emits: `{ type: "message", sender, content, isGroup }`
- Auth via optional `bridge_token` in config

**Testing**: Mock WebSocket for channel tests, test quiz logic with various inputs

## General Guidelines

- **Type safety**: No `any` in Python, strict mode in TypeScript
- **Async**: `asyncio` (Python) and `async/await` (TypeScript)
- **Logging**: `loguru` (Python), `pino/console` (TypeScript)
- **Line length**: 100 chars (both Python and TypeScript)
- **Versions**: Python 3.11+, Node 20.0.0+

## Project Structure

```
nanobot/          # Python core
├── channels/     # Platform integrations (WhatsApp, Telegram, etc.)
├── agents/       # Agent logic, tools, memory
├── providers/    # LLM provider implementations
└── config/       # Pydantic schemas

bridge/           # TypeScript WhatsApp bridge
├── src/
│   ├── whatsapp.ts   # Baileys client wrapper
│   ├── server.ts     # WebSocket server
│   ├── kotaete.ts    # Quiz system
│   └── types.ts      # Shared types
└── package.json

tests/            # pytest tests
workspace/        # Agent workspace
```

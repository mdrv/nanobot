# Kotaete Quiz System Integration

## Overview

**Kotaete** (答えて - Japanese for "answer/respond") is a quiz/answer system that monitors ignored group messages in WhatsApp and responds to quiz answers.

## Features

- **Quiz State Management**: Start, stop, and track quiz state
- **Answer Validation**: Three levels of matching:
  - ✅ **Exact match**: Responds with "Correct!" message
  - ✨ **Partial match**: Reacts with sparkle emoji
  - 🔍 **Close match**: Reacts with magnifying glass emoji (Levenshtein distance)
- **Integration**: Automatically receives ignored group messages from WhatsApp

## Architecture

```
WhatsApp (Group Messages)
        ↓
WhatsAppClient (filters mentions)
        ↓
    ┌───────┴───────┐
    ↓               ↓
Mentioned      Ignored
Messages       Messages
    ↓               ↓
Python        Kotaete
Backend       (Quiz System)
```

## Usage

### Starting a Quiz

Send a WebSocket command to start a quiz:

```json
{
  "type": "quiz_start",
  "chatId": "123456789-1234567890@g.us",
  "question": "What is the capital of France?",
  "answer": "Paris",
  "replyToMessageId": "3EB0ABCDEF_1234567890@g.us"
}
```

**Parameters:**
- `chatId`: Group JID (ends with `@g.us`)
- `question`: Quiz question (for logging)
- `answer`: Correct answer (case-insensitive, trimmed)
- `replyToMessageId` (optional): Message ID to reply to

### Answer Matching

When a user sends a message in the group (without mentioning the bot), Kotaete checks it against the active quiz:

1. **Exact Match**: `userAnswer.toLowerCase().trim() === correctAnswer`
   - Response: "✅ Correct!" message (quoted reply)
   - Action: Ends the quiz

2. **Partial Match**: `userAnswer.includes(correctAnswer) || correctAnswer.includes(userAnswer)`
   - Response: ✨ reaction emoji
   - Action: Quiz continues

3. **Close Match**: Levenshtein distance ≤ 2 (short answers) or ≤ 10% (long answers)
   - Response: 🔍 reaction emoji
   - Action: Quiz continues

### Ending a Quiz

```json
{
  "type": "quiz_end"
}
```

### Checking Quiz Status

```json
{
  "type": "quiz_status"
}
```

**Response:**
```json
{
  "type": "quiz_status",
  "active": true,
  "quiz": {
    "active": true,
    "question": "What is the capital of France?",
    "correctAnswer": "paris",
    "startTime": 1739520000000,
    "chatId": "123456789-1234567890@g.us",
    "messageId": "3EB0ABCDEF_1234567890@g.us"
  }
}
```

## WebSocket Events

### From Bridge → Python Client

```json
{
  "type": "quiz_started",
  "quiz": {
    "active": true,
    "question": "...",
    "correctAnswer": "...",
    "startTime": 1234567890,
    "chatId": "...",
    "messageId": "..."
  }
}
```

```json
{
  "type": "quiz_ended",
  "reason": "answered" | "timeout" | "cancelled"
}
```

## Example: Python Client

```python
import asyncio
import websockets
import json

async def quiz_bot():
    uri = "ws://127.0.0.1:3001"

    async with websockets.connect(uri) as ws:
        # Authenticate if token is set
        # await ws.send(json.dumps({"type": "auth", "token": "your-token"}))

        # Start a quiz
        await ws.send(json.dumps({
            "type": "quiz_start",
            "chatId": "123456789-1234567890@g.us",
            "question": "What is 2 + 2?",
            "answer": "4"
        }))

        # Listen for events
        while True:
            msg = await ws.recv()
            data = json.loads(msg)
            print(f"Received: {data}")

            if data.get("type") == "quiz_ended":
                print("Quiz ended!")
                break

asyncio.run(quiz_bot())
```

## Advanced: Matching Logic

### Levenshtein Distance

Used for "close match" detection. Calculates the minimum number of single-character edits (insertions, deletions, substitutions) to change one string into another.

**Examples:**
- `"Paris"` vs `"Pariss"` → Distance: 1 (close match 🔍)
- `"Paris"` vs `"Pari"` → Distance: 1 (close match 🔍)
- `"Paris"` vs `"London"` → Distance: 6 (no match)

### Matching Rules

| Answer Length | Max Distance for Close Match |
|---------------|------------------------------|
| ≤ 10 chars    | ≤ 2                          |
| > 10 chars    | max(3, 10% of length)        |

## Implementation Files

- `bridge/src/kotaete.ts` - Core quiz logic
- `bridge/src/whatsapp.ts` - WhatsApp client with `onIgnoredGroupMessage` callback
- `bridge/src/server.ts` - WebSocket server integration

## Testing Quiz Matching

```typescript
import { Kotaete } from './kotaete.js';

// Test matching behavior
const kotaete = new Kotaete(waClient);

await kotaete.startQuiz(
  '123456789-1234567890@g.us',
  'What is 2 + 2?',
  '4'
);

// Simulate messages
await kotaete.checkAnswer('123456789-1234567890@g.us', '4', messageKey);      // ✅ Exact
await kotaete.checkAnswer('123456789-1234567890@g.us', 'The answer is 4', messageKey);  // ✨ Partial
await kotaete.checkAnswer('123456789-1234567890@g.us', 'Four', messageKey);    // 🔍 Close
```

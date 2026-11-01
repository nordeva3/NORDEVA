# VELORA AI — Gemini 2.4.3

VELORA AI now uses Google's Gemini API instead of OpenAI.

## Server environment

```text
GEMINI_API_KEY=
GEMINI_MODEL=gemini-3.8-flash
```

Keep `GEMINI_API_KEY` server-only. Do not prefix it with `VITE_` and never commit a real key.

## Behavior

- Gemini Interactions API is called only from the server.
- The browser sends the existing VELORA chat history to the server; the server sends it as typed user/model interaction steps.
- `store: false` is used so the chat implementation does not request third-party server-side conversation storage.
- Hindi, Hinglish, Unicode, emoji and multiline text are returned as text without manual encoding/decoding transformations.
- The response parser supports both `output_text` and model-output step text, so minor response-shape differences do not blank the chat.
- API failures return a safe user-facing message while detailed provider response text is limited in server logs.
- The assistant is explicitly scoped to VELORA Marketplace and is instructed not to invent private account data, transactions, policies or features.
- The assistant can explain VELORA buyer/seller/admin workflows and point users to known VELORA pages.

## Important deployment note

The ZIP intentionally contains no Gemini API key. Configure the real key in the production server environment before enabling VELORA AI.

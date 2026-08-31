# NOVA Echo — sidecar (adapted from nova-echo / openai-whisper)

This directory is the **copied + adapted** speech substrate for NOVA.
Original: `openai/whisper` (MIT) — now stored as `nova-echo` reference at `D:\nova-references\nova-echo`.
License retained at `LICENSE.echo`.

## What's in here
- `audio.py`, `transcribe.py`, `model.py`, `tokenizer.py`, `decoding.py` — core whisper modules as vendored reference (not edited)
- `server.py` — tiny HTTP wrapper NOVA Node calls: `POST /transcribe` (multipart `file`) → `{text, language}`

## Run
```
pip install -U openai-whisper
pip install torch --index-url https://download.pytorch.org/whl/cpu  # or CUDA build
python echo/server.py --model turbo --port 8765
```
Set `ECHO_SIDECAR_URL=http://127.0.0.1:8765` in NOVA's `.env` (optional — NOVA degrades gracefully without it).

## Where it's used
- `server/src/core/echo/transcribe.js` — Node wrapper (stub + sidecar call)
- `server/src/routes/v1/widget.js` & `server/src/routes/portal` — upload → transcript → `runChat()`
- Voice role `voice_receptionist` consumes transcripts as normal chat turns.

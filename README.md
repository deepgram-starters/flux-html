# Flux Transcription Frontend

> **This is a frontend submodule - do not use directly**

This repository contains the shared frontend for Deepgram Flux (v2 Listen) starter applications. It is designed to be used as a git submodule within backend starter projects.

## About Flux

Deepgram's Flux API (`wss://api.deepgram.com/v2/listen`) introduces a turn-based streaming transcription model. Instead of interim/final results, Flux uses `TurnInfo` events with built-in contextual turn detection:

- **StartOfTurn** — A new speech turn has begun
- **Update** — Transcript updated within the current turn
- **EagerEndOfTurn** — Tentative end of turn detected (may resume)
- **TurnResumed** — Turn continues after an eager end-of-turn
- **EndOfTurn** — Turn is confirmed complete

## Configuration Options

| Option | Description | Default | Range |
|--------|-------------|---------|-------|
| EOT Threshold | Confidence threshold for end-of-turn detection | 0.7 | 0.5–0.9 |
| Eager EOT Threshold | Threshold for early end-of-turn hints | (disabled) | 0.3–0.9 |
| EOT Timeout (ms) | Silence duration before forcing end-of-turn | 5000 | 1000–30000 |
| Key Terms | Comma-separated terms to boost recognition | (empty) | — |

## Usage

To use this frontend with a complete working application, see:

**Node.js Starter:**
- [node-flux](https://github.com/deepgram-starters/node-flux)

**Other Languages:**

Browse all available starters at [github.com/deepgram-starters](https://github.com/deepgram-starters)

## About

This frontend is automatically integrated as a submodule in the backend starters listed above. Running this repository standalone will not work as it requires backend WebSocket endpoints to function properly.

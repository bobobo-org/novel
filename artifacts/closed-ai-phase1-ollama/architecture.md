# Architecture

`Browser Studio -> LocalBridgeClient -> Local Bridge 127.0.0.1:3217 -> Ollama 127.0.0.1:11434 -> user-owned model`

The existing `local-ollama` provider and Platform Router remain authoritative. The Bridge is an implementation boundary, not a new provider kind. Results remain candidate-only. The Bridge stores no prompt or output.

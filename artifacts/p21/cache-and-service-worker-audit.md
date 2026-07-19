# Cache and service worker audit

P2.1 does not introduce a service worker or a new application cache. The AI health route remains `Cache-Control: no-store, max-age=0`. Static build stamping is skipped outside deployment, preventing local build timestamps from being presented as production evidence.

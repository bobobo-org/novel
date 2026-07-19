# Remaining risks

- Browser IndexedDB round-trip and multi-tab conflict recovery still require production browser evidence.
- Long-novel 100k/300k/500k performance measurements are not complete; status must remain partial.
- Backup import currently validates the v3 format; legacy import compatibility needs a dedicated migration adapter before it can be called ready.
- Browser AI and Private AI Hub are contracts, not installed/connected runtimes.

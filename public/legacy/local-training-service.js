(function () {
  "use strict";

  const DEFAULT_BASE_URL = "http://localhost:8765";
  let controller = null;

  function baseUrl() {
    return (document.getElementById("phase1TrainingEndpoint")?.value || localStorage.getItem("novel_local_training_endpoint") || DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  function saveEndpoint(value) {
    localStorage.setItem("novel_local_training_endpoint", (value || DEFAULT_BASE_URL).replace(/\/+$/, ""));
  }

  async function request(path, options = {}) {
    controller = new AbortController();
    const url = `${baseUrl()}${path}`;
    let response;
    try {
      response = await fetch(url, {
        ...options,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers || {})
        }
      });
    } catch (error) {
      if (error.name === "AbortError") throw new Error("已中止本地訓練服務請求。");
      throw new Error(`無法連接本地訓練服務：${url}`);
    }
    let data = null;
    try { data = await response.json(); } catch (error) {}
    if (!response.ok) throw new Error(data?.detail || data?.error || `本地訓練服務回應失敗：HTTP ${response.status}`);
    return data;
  }

  function get(path) {
    return request(path);
  }

  function post(path, body = {}) {
    return request(path, { method: "POST", body: JSON.stringify(body) });
  }

  function abort() {
    if (controller) controller.abort();
  }

  window.LocalTrainingService = {
    DEFAULT_BASE_URL,
    baseUrl,
    saveEndpoint,
    get,
    post,
    abort,
    health: () => get("/health"),
    hardware: () => get("/hardware"),
    models: () => get("/models"),
    trainingStatus: () => get("/training/status"),
    trainingLogs: () => get("/training/logs"),
    adapters: () => get("/adapters"),
    buildDataset: (samples) => post("/dataset/build", { samples }),
    validateDataset: (samples) => post("/dataset/validate", { samples }),
    startTraining: (payload) => post("/training/start", payload),
    stopTraining: () => post("/training/stop"),
    testAdapter: (payload) => post("/adapters/test", payload),
    activateAdapter: (id) => post("/adapters/activate", { adapter_id: id }),
    deleteAdapter: (id) => post("/adapters/delete", { adapter_id: id })
  };
})();

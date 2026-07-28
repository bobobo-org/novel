import crypto from "node:crypto";

export const OFFLINE_PREFERENCE_MODEL_SCHEMA = "novel-offline-preference-model-v1";

export const FEATURE_NAMES = Object.freeze([
  "length",
  "dialogueDensity",
  "sentenceRhythm",
  "sentenceVariance",
  "paragraphRhythm",
  "lexicalDiversity",
  "sensoryDetail",
  "actionDensity",
  "emotionLabelDensity",
  "adverbDensity",
  "punctuationVariety",
  "endingHook",
]);

const FEATURE_GUIDANCE = Object.freeze({
  length: ["允許較完整的段落發展，但不要灌水。", "保持精煉，刪除不推進人物或事件的句子。"],
  dialogueDensity: ["提高自然對話比例，讓人物用聲音與反應推動場景。", "減少連續對話，補上必要動作、環境與內在節奏。"],
  sentenceRhythm: ["使用較舒展的句子承載場景與情緒轉折。", "偏好短而有力的句子，避免句構拖沓。"],
  sentenceVariance: ["交錯長短句，建立明顯節奏變化。", "維持穩定清楚的句長，避免刻意碎裂。"],
  paragraphRhythm: ["讓段落有完整的小推進與收束。", "多分段並留白，維持快速閱讀節奏。"],
  lexicalDiversity: ["避免重複詞彙，選擇更精準而自然的表達。", "使用一致、易懂的詞彙，不要為變化而堆砌近義詞。"],
  sensoryDetail: ["用可見、可聽、可觸的細節呈現場景。", "減少感官鋪陳，把篇幅留給事件與選擇。"],
  actionDensity: ["讓人物透過動作、選擇與後果推動情節。", "降低連續動作密度，補足必要理解與情緒停頓。"],
  emotionLabelDensity: ["可直接標示少量關鍵情緒以保持清楚。", "少直接命名情緒，改用動作、語氣與細節呈現。"],
  adverbDensity: ["允許少量程度與方式副詞微調語氣。", "刪減『非常、十分、極其』等程度詞，改用具體描寫。"],
  punctuationVariety: ["適度混合逗號、破折號、問句與停頓，塑造聲音。", "收斂標點變化，維持乾淨穩定的敘述。"],
  endingHook: ["段尾留下選擇、問題、反轉或迫近代價。", "段尾自然收束，不要每段都刻意製造懸念。"],
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function normalizedText(value) {
  return String(value || "").normalize("NFKC").replace(/\r\n?/g, "\n").trim();
}

function density(text, pattern) {
  const matches = text.match(pattern)?.length ?? 0;
  return Math.min(1, matches / Math.max(1, [...text].length / 80));
}

function mean(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
}

function variance(values) {
  if (!values.length) return 0;
  const average = mean(values);
  return mean(values.map((value) => (value - average) ** 2));
}

function clamp(value, minimum = -1, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function extractPreferenceFeatures(input) {
  const text = normalizedText(input);
  const characters = [...text];
  const sentences = text.split(/[。！？!?…]+/u).map((item) => [...item.trim()].length).filter(Boolean);
  const paragraphs = text.split(/\n+/u).map((item) => [...item.trim()].length).filter(Boolean);
  const compact = characters.filter((character) => !/\s/u.test(character));
  const bigrams = new Set();
  for (let index = 0; index < compact.length - 1; index += 1) {
    bigrams.add(`${compact[index]}${compact[index + 1]}`);
  }
  const quoteCharacters = characters.filter((character) => /[「」『』“”"]/u.test(character)).length;
  const punctuationKinds = new Set(characters.filter((character) => /[，。！？；：、—…,.!?;:]/u.test(character)));
  const sentenceAverage = mean(sentences);
  const paragraphAverage = mean(paragraphs);
  return [
    Math.tanh(characters.length / 600),
    clamp(quoteCharacters / Math.max(2, characters.length * 0.04), 0, 1),
    Math.tanh(sentenceAverage / 36),
    Math.tanh(Math.sqrt(variance(sentences)) / 24),
    Math.tanh(paragraphAverage / 180),
    clamp(bigrams.size / Math.max(1, compact.length - 1), 0, 1),
    density(text, /看見|聽見|聞到|氣味|溫度|觸感|光|影|聲|風|雨|血|汗|冷|熱/gu),
    density(text, /走|跑|抓|推|拉|轉身|抬|低下|撲|退|進|揮|躲|撞|握|放|站|坐/gu),
    density(text, /感到|覺得|悲傷|高興|憤怒|害怕|緊張|震驚|痛苦|開心/gu),
    density(text, /非常|十分|極其|格外|異常|地[，。！？；：、\s]/gu),
    clamp(punctuationKinds.size / 10, 0, 1),
    density(text.slice(-160), /卻|但是|突然|原來|為什麼|怎麼|？|\?|！|!|代價|選擇|來不及/gu),
  ];
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0);
}

function sigmoid(value) {
  if (value >= 0) return 1 / (1 + Math.exp(-value));
  const exp = Math.exp(value);
  return exp / (1 + exp);
}

function pairDifference(sample) {
  const chosen = extractPreferenceFeatures(sample.chosen);
  const rejected = extractPreferenceFeatures(sample.rejected);
  return chosen.map((value, index) => value - rejected[index]);
}

function accuracy(weights, pairs) {
  if (!pairs.length) return null;
  return pairs.filter((pair) => dot(weights, pair) > 0).length / pairs.length;
}

export function trainOfflinePreferenceModel(input) {
  const samples = Array.isArray(input.samples)
    ? input.samples.map((sample) => ({
      chosen: normalizedText(sample?.chosen),
      rejected: normalizedText(sample?.rejected),
    }))
    : [];
  if (samples.length < 2) {
    throw Object.assign(new Error("至少需要兩組已核准的偏好對照。"), {
      code: "OFFLINE_TRAINING_SAMPLE_MINIMUM",
    });
  }
  if (samples.length > 128) {
    throw Object.assign(new Error("單次離線訓練最多接受 128 組偏好對照。"), {
      code: "OFFLINE_TRAINING_SAMPLE_LIMIT",
    });
  }
  if (samples.some((sample) =>
    sample.chosen.length < 8
    || sample.rejected.length < 8
    || sample.chosen.length > 12_000
    || sample.rejected.length > 12_000
    || sample.chosen === sample.rejected)) {
    throw Object.assign(new Error("偏好對照必須不同，且每段需為 8 至 12,000 字元。"), {
      code: "OFFLINE_TRAINING_SAMPLE_INVALID",
    });
  }

  const epochs = Math.max(20, Math.min(800, Number(input.epochs) || 240));
  const learningRate = Math.max(0.001, Math.min(1, Number(input.learningRate) || 0.08));
  const l2 = Math.max(0, Math.min(1, Number(input.l2) || 0.015));
  const allPairs = samples.map(pairDifference);
  const holdoutPairs = allPairs.length >= 5
    ? allPairs.filter((_, index) => index % 5 === 0)
    : [];
  const trainingPairs = allPairs.length >= 5
    ? allPairs.filter((_, index) => index % 5 !== 0)
    : allPairs;
  const weights = Array(FEATURE_NAMES.length).fill(0);
  let finalLoss = 0;
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    let epochLoss = 0;
    for (const pair of trainingPairs) {
      const probability = sigmoid(dot(weights, pair));
      epochLoss += -Math.log(Math.max(probability, 1e-9));
      for (let index = 0; index < weights.length; index += 1) {
        const gradient = (probability - 1) * pair[index] + l2 * weights[index];
        weights[index] = clamp(weights[index] - learningRate * gradient, -8, 8);
      }
    }
    finalLoss = epochLoss / trainingPairs.length;
  }

  const datasetDigest = sha256(stable(samples.map((sample) => ({
    chosen: sha256(sample.chosen),
    rejected: sha256(sample.rejected),
  }))));
  const createdAt = new Date().toISOString();
  const modelId = `preference-${datasetDigest.slice(0, 16)}-${createdAt.replace(/\D/g, "").slice(0, 14)}`;
  const artifactWithoutDigest = {
    schemaVersion: OFFLINE_PREFERENCE_MODEL_SCHEMA,
    modelId,
    modelType: "pairwise-logistic-style-adapter",
    projectId: String(input.projectId || "local-project"),
    baseModelId: String(input.baseModelId || "runtime-selected"),
    datasetVersion: String(input.datasetVersion || "local-approved-v1"),
    datasetDigest,
    trainingMethod: "offline_pairwise_logistic_gradient_descent",
    featureNames: [...FEATURE_NAMES],
    weights: weights.map((value) => Number(value.toFixed(8))),
    bias: 0,
    hyperparameters: { epochs, learningRate, l2 },
    metrics: {
      trainingPairs: trainingPairs.length,
      holdoutPairs: holdoutPairs.length,
      trainingPairAccuracy: accuracy(weights, trainingPairs),
      holdoutPairAccuracy: accuracy(weights, holdoutPairs),
      allPairAccuracy: accuracy(weights, allPairs),
      finalLoss: Number(finalLoss.toFixed(8)),
    },
    privacy: {
      runsOffline: true,
      rawSamplesStored: false,
      rawSamplesReturned: false,
      externalRequest: false,
      dataLeftDevice: false,
    },
    createdAt,
    status: "candidate",
  };
  return {
    ...artifactWithoutDigest,
    artifactDigest: sha256(stable(artifactWithoutDigest)),
  };
}

export function verifyOfflinePreferenceModel(artifact) {
  if (!artifact || artifact.schemaVersion !== OFFLINE_PREFERENCE_MODEL_SCHEMA) return false;
  if (!Array.isArray(artifact.weights) || artifact.weights.length !== FEATURE_NAMES.length) return false;
  if (!artifact.weights.every((value) => Number.isFinite(value))) return false;
  const { artifactDigest, ...withoutDigest } = artifact;
  return typeof artifactDigest === "string"
    && /^[a-f0-9]{64}$/i.test(artifactDigest)
    && sha256(stable(withoutDigest)) === artifactDigest;
}

export function scoreWithPreferenceModel(artifact, content) {
  if (!verifyOfflinePreferenceModel(artifact)) {
    throw Object.assign(new Error("偏好模型雜湊驗證失敗。"), {
      code: "OFFLINE_TRAINING_ARTIFACT_INVALID",
    });
  }
  return sigmoid(dot(artifact.weights, extractPreferenceFeatures(content)) + Number(artifact.bias || 0));
}

export function preferenceModelGuidance(artifact) {
  if (!verifyOfflinePreferenceModel(artifact)) {
    throw Object.assign(new Error("偏好模型雜湊驗證失敗。"), {
      code: "OFFLINE_TRAINING_ARTIFACT_INVALID",
    });
  }
  const ranked = artifact.weights
    .map((weight, index) => ({ weight, feature: FEATURE_NAMES[index] }))
    .filter((item) => Math.abs(item.weight) >= 0.03)
    .sort((left, right) => Math.abs(right.weight) - Math.abs(left.weight))
    .slice(0, 6);
  const instructions = ranked.map((item) =>
    FEATURE_GUIDANCE[item.feature][item.weight >= 0 ? 0 : 1]);
  return {
    adapterId: artifact.modelId,
    adapterDigest: artifact.artifactDigest,
    instructions,
    text: instructions.length
      ? `套用本機已核准偏好模型（${artifact.modelId}）：\n- ${instructions.join("\n- ")}`
      : "本機偏好模型未形成顯著風格方向；維持中性敘事。",
  };
}

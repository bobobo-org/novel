from __future__ import annotations

import hashlib
import json

import numpy as np

SCHEMA_VERSION = "novel-browser-extractive-model-v1"
MODEL_ID = "novel-browser-extractive-v1"
FEATURE_NAMES = [
    "bias",
    "earlyPosition",
    "normalizedLength",
    "eventDensity",
    "consequenceDensity",
    "dialogue",
    "lexicalDiversity",
    "hookDensity",
]
EVENT_TERMS = [
    "發現", "突然", "必須", "決定", "證明", "否決", "失蹤", "敵人",
    "災難", "求救", "推翻", "刪除", "坦白", "隱瞞", "選擇", "改口",
    "不存在", "未來", "禁區", "受傷", "替換", "錄音", "座標", "記憶",
]
CONSEQUENCE_TERMS = ["因此", "所以", "卻", "但", "然而", "必須", "決定", "只有"]
HOOK_TERMS = [
    "忽然", "突然", "竟", "原來", "發現", "真正", "唯一", "未來",
    "失蹤", "刪除", "隱瞞", "坦白",
]

# Each row is synthetic and includes the zero-based sentence that carries the
# central event. Rotation below prevents the model from learning a fixed slot.
EXAMPLES = [
    (["林昭在雨夜抵達圖書館。", "他發現失蹤帳冊旁留下帶血的指紋。", "守門人說今晚沒有外人進入。"], 1),
    (["列車準時進站。", "盟友忽然承認自己隱瞞了敵人的真實身分。", "遠處的鐘聲響了三次。"], 1),
    (["城裡停電後只剩緊急照明。", "人群安靜等待。", "主角必須在救出孩子與保住唯一證據之間選擇。"], 2),
    (["早餐已經冷了。", "她打開信封，發現失蹤十年的父親仍活著。", "窗外開始下雪。"], 1),
    (["隊伍穿過森林。", "嚮導突然改變路線，把所有人帶向禁區。", "沒有人立刻反對。"], 1),
    (["會議持續兩小時。", "董事會否決了撤離計畫。", "因此主角決定公開被隱藏的災難報告。"], 2),
    (["海面平靜無風。", "雷達顯示不存在的船正快速接近。", "船員收起晚餐。"], 1),
    (["她完成最後一次檢查。", "病人的檢驗結果證明藥物遭人替換。", "走廊傳來腳步聲。"], 1),
    (["比賽進入中場。", "隊長受傷離場。", "替補新人決定違抗教練，改用從未演練的戰術。"], 2),
    (["市場依舊熱鬧。", "孩子買了一顆糖。", "主角在攤販桌下發現王室失竊的印章。"], 2),
    (["太空站繞過行星背面。", "通訊系統忽然收到來自未來三小時後的求救訊號。", "工程師關閉音樂。"], 1),
    (["審判即將結束。", "證人改口否認先前證詞。", "被告卻拿出一段足以推翻整起案件的錄音。"], 2),
    (["祭典的煙火升空。", "少女在人群中看見與自己長得完全相同的人。", "攤販繼續叫賣。"], 1),
    (["團隊抵達安全屋。", "門鎖沒有破壞痕跡。", "屋內所有資料都被刪除，只有牆上留下下一個座標。"], 2),
    (["雨終於停了。", "他原本準備離開。", "盟友卻交出鑰匙，坦白真正的敵人一直藏在組織內部。"], 2),
    (["學校宣布正常上課。", "學生們走進教室。", "主角發現每個人的記憶都少了同一天。"], 2),
]


def canonical_json(value: object) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def features(sentence: str, index: int, total: int) -> list[float]:
    characters = [character for character in sentence if not character.isspace()]
    return [
        1,
        1 - index / max(total - 1, 1),
        min(len(characters) / 45, 1),
        min(sum(term in sentence for term in EVENT_TERMS) / 3, 1),
        min(sum(term in sentence for term in CONSEQUENCE_TERMS) / 2, 1),
        1 if "「" in sentence or "」" in sentence else 0,
        len(set(characters)) / max(len(characters), 1),
        min(sum(term in sentence for term in HOOK_TERMS) / 2, 1),
    ]


def train() -> dict[str, object]:
    paragraphs: list[list[str]] = []
    labels: list[int] = []
    matrices: list[np.ndarray] = []
    for index, (sentences, core_index) in enumerate(EXAMPLES):
        shift = index % len(sentences)
        rotated = sentences[shift:] + sentences[:shift]
        paragraphs.append(rotated)
        labels.append((core_index - shift) % len(sentences))
        matrices.append(
            np.asarray(
                [features(sentence, position, len(rotated)) for position, sentence in enumerate(rotated)],
                dtype=float,
            )
        )

    train_indexes = list(range(12))
    holdout_indexes = list(range(12, 16))
    weights = np.zeros(len(FEATURE_NAMES))
    for _ in range(5_000):
        gradient = np.zeros_like(weights)
        for index in train_indexes:
            logits = matrices[index] @ weights
            probabilities = np.exp(logits - logits.max())
            probabilities /= probabilities.sum()
            probabilities[labels[index]] -= 1
            gradient += matrices[index].T @ probabilities
        weights -= 0.03 * (gradient / len(train_indexes) + 0.001 * weights)

    def accuracy(indexes: list[int]) -> float:
        return sum(
            int(np.argmax(matrices[index] @ weights)) == labels[index]
            for index in indexes
        ) / len(indexes)

    record: dict[str, object] = {
        "schemaVersion": SCHEMA_VERSION,
        "modelId": MODEL_ID,
        "trainingObjective": "softmax_sentence_ranking",
        "featureNames": FEATURE_NAMES,
        "weights": [round(float(value), 8) for value in weights],
        "trainingSource": "operator-authored-synthetic-ground-truth",
        "trainingExamples": len(train_indexes),
        "holdoutExamples": len(holdout_indexes),
        "sentenceCandidates": sum(len(paragraph) for paragraph in paragraphs),
        "labelPositionDiversity": len(set(labels)),
        "trainingTop1Accuracy": accuracy(train_indexes),
        "holdoutTop1Accuracy": accuracy(holdout_indexes),
        "syntheticDataOnly": True,
        "rawUserContentIncluded": False,
        "trainingDatasetDigest": hashlib.sha256(
            canonical_json({"paragraphs": paragraphs, "labels": labels}).encode("utf-8")
        ).hexdigest(),
    }
    record["modelDigest"] = hashlib.sha256(
        canonical_json(record).encode("utf-8")
    ).hexdigest()
    return record


if __name__ == "__main__":
    print(json.dumps(train(), ensure_ascii=False, indent=2))

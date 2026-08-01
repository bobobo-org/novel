import type { CharacterPortraitAsset } from "../domain";

const MAX_SOURCE_BYTES = 10 * 1024 * 1024;
const MAX_STORED_BYTES = 420 * 1024;

function loadImage(file: File) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error("無法讀取這張圖片，請改用 PNG、JPG 或 WebP。"));
    };
    image.src = objectUrl;
  });
}
function canvasBlob(canvas: HTMLCanvasElement, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("圖片壓縮失敗，請改用另一張圖片。")),
      "image/webp",
      quality,
    );
  });
}

function drawSquare(image: HTMLImageElement, size: number) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("瀏覽器無法建立圖片處理畫布。");
  const sourceSize = Math.min(image.naturalWidth, image.naturalHeight);
  const sourceX = Math.max(0, (image.naturalWidth - sourceSize) / 2);
  const sourceY = Math.max(0, (image.naturalHeight - sourceSize) / 2);
  context.fillStyle = "#081321";
  context.fillRect(0, 0, size, size);
  context.drawImage(
    image,
    sourceX,
    sourceY,
    sourceSize,
    sourceSize,
    0,
    0,
    size,
    size,
  );
  return canvas;
}

function blobDataUrl(blob: Blob) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("圖片轉換失敗。"));
    reader.readAsDataURL(blob);
  });
}

async function digestBlob(blob: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

export async function prepareCharacterPortraitUpload(input: {
  file: File;
  visualDescription?: string;
  traits?: string[];
}): Promise<CharacterPortraitAsset> {
  if (!input.file.type.startsWith("image/")) {
    throw new Error("請選擇圖片檔案。" );
  }
  if (input.file.size > MAX_SOURCE_BYTES) {
    throw new Error("原圖不可超過 10 MB。" );
  }
  const image = await loadImage(input.file);
  let selectedBlob: Blob | null = null;
  for (const option of [
    { size: 512, quality: 0.82 },
    { size: 448, quality: 0.76 },
    { size: 384, quality: 0.7 },
  ]) {
    const blob = await canvasBlob(drawSquare(image, option.size), option.quality);
    selectedBlob = blob;
    if (blob.size <= MAX_STORED_BYTES) break;
  }
  if (!selectedBlob || selectedBlob.size > MAX_STORED_BYTES) {
    throw new Error("圖片壓縮後仍過大，請先裁切人物頭像再上傳。" );
  }
  const [assetUri, assetDigest] = await Promise.all([
    blobDataUrl(selectedBlob),
    digestBlob(selectedBlob),
  ]);
  const fallbackName = input.file.name.replace(/\.[^.]+$/u, "").trim() || "自訂角色";
  const traits = [...new Set((input.traits ?? []).map((item) => item.trim()).filter(Boolean))];
  return {
    id: `upload-${assetDigest.slice(0, 16)}`,
    source: "upload",
    assetUri,
    assetDigest,
    themeId: "custom-upload",
    themeLabel: "自訂參考圖",
    role: fallbackName,
    visualDescription: input.visualDescription?.trim()
      || `使用者核准的「${fallbackName}」人物參考圖。`,
    traits: traits.length ? traits : ["使用者上傳", "人物參考圖"],
    generatedBy: "user-upload",
  };
}

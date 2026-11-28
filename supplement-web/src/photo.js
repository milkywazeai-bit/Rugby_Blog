// Photos are stored inline in Firestore documents (1 MiB limit per document) so the
// app works on the free Spark plan, which no longer includes Cloud Storage.
const MAX_SIDE = 480;
const MAX_BYTES = 180 * 1024;

function loadImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("이미지를 읽을 수 없어요.")); };
    img.src = url;
  });
}

export async function compressPhoto(file) {
  if (!file || !/^image\//.test(file.type)) throw new Error("사진 파일만 넣을 수 있어요.");
  const img = await loadImage(file);
  const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
  const w = Math.max(1, Math.round(img.naturalWidth * scale));
  const h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  let quality = 0.8;
  let data = canvas.toDataURL("image/jpeg", quality);
  while (data.length * 0.75 > MAX_BYTES && quality > 0.4) {
    quality -= 0.1;
    data = canvas.toDataURL("image/jpeg", quality);
  }
  return data;
}

export function isSafePhoto(src) {
  return typeof src === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(src);
}

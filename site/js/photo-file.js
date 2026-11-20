// Shrink a receipt on the device before it is stored. The long edge starts at 1600px
// and the first save is JPEG at 0.7. If that is still large, quality and size step down
// until the file is about 300KB, and never over 1MB.
const TARGET_BYTES = 300 * 1024;
const MAX_BYTES = 1_000_000;
const STEPS = [
  [1600, 0.7],
  [1600, 0.55],
  [1600, 0.4],
  [1280, 0.5],
  [1024, 0.45],
  [800, 0.4],
  [640, 0.35],
];

export async function shrinkReceipt(file) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("Choose a photo.");
  const type = String(file.type || "");
  if (type && !type.startsWith("image/")) throw new Error("Choose a photo.");
  let source;
  try {
    source = await loadSource(file);
  } catch {
    throw new Error("That photo could not be read. Try another one.");
  }
  try {
    let blob = null;
    for (const [edge, quality] of STEPS) {
      blob = await renderJpeg(source, edge, quality);
      if (blob.size <= TARGET_BYTES) break;
    }
    if (!blob || blob.size > MAX_BYTES) throw new Error("That photo is still over 1MB after shrinking. Try a different one.");
    return blob;
  } finally {
    source.close?.();
  }
}

async function loadSource(file) {
  if (typeof createImageBitmap === "function") {
    try {
      return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch {
      /* Fall through to an Image element. Some files only decode that way. */
    }
  }
  const url = URL.createObjectURL(file);
  try {
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("read"));
      image.src = url;
    });
    return image;
  } finally {
    URL.revokeObjectURL(url);
  }
}

function renderJpeg(source, edge, quality) {
  const longest = Math.max(source.width || 1, source.height || 1);
  const scale = Math.min(1, edge / longest);
  const width = Math.max(1, Math.round(source.width * scale));
  const height = Math.max(1, Math.round(source.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("That photo could not be saved.");
  context.drawImage(source, 0, 0, width, height);
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error("That photo could not be saved."));
      else resolve(blob);
    }, "image/jpeg", quality);
  });
}

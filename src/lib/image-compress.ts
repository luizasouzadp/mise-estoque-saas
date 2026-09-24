// Reduz a foto da nota antes de enviar para a IA (mais leve = leitura mais rápida).
// A foto original continua sendo a que é guardada no arquivo de notas.
const MAX_SIDE = 1600;
const QUALITY = 0.85;

function readAsDataUrl(f: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export async function fileToCompressedDataUrl(file: File): Promise<string> {
  // PDFs e outros formatos seguem como estão.
  if (!file.type.startsWith("image/")) return readAsDataUrl(file);
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    // Foto já pequena: não vale recomprimir.
    if (scale === 1 && file.size < 600_000) {
      bitmap.close();
      return readAsDataUrl(file);
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      bitmap.close();
      return readAsDataUrl(file);
    }
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, "image/jpeg", QUALITY));
    if (!blob || blob.size >= file.size) return readAsDataUrl(file);
    return readAsDataUrl(blob);
  } catch {
    // Se o navegador não conseguir reduzir, envia a foto original.
    return readAsDataUrl(file);
  }
}

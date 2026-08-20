// Release 1.2.15 (b)+(c) — compressão/redimensionamento das capturas no cliente
// antes de as enviar para a server function, e limite explícito de bytes.
//
// Contexto: posters/cartazes PNG de alta resolução geravam payloads base64 de
// 30-40 MB, acima do limite de transporte da infraestrutura edge — o pedido
// falhava no browser antes de chegar ao servidor ("Erro desconhecido").

export const IMAGE_MAX_DIMENSION = 1600;
export const IMAGE_JPEG_QUALITY = 0.8;

/** Limite conservador para o corpo total (base64) de um pedido de match. */
export const MAX_PAYLOAD_BYTES = 12_000_000;

/** Redimensiona mantendo o rácio; nunca amplia imagens pequenas. */
export function scaleToMax(
  width: number,
  height: number,
  maxDimension: number = IMAGE_MAX_DIMENSION,
): { width: number; height: number } {
  if (width <= 0 || height <= 0) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxDimension) return { width: Math.round(width), height: Math.round(height) };
  const ratio = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** Bytes reais transportados por um data URL (payload base64 incluído). */
export function dataUrlBytes(dataUrl: string): number {
  return dataUrl.length;
}

/** Bytes decodificados da imagem contida num data URL base64. */
export function decodedImageBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(",");
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

export function totalPayloadBytes(texto: string, imagens: string[]): number {
  return texto.length + imagens.reduce((sum, img) => sum + dataUrlBytes(img), 0);
}

export function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Valida o payload antes do envio. Devolve mensagem clara quando excede o
 * limite, em vez de deixar o fetch abortar sem explicação.
 */
export function checkPayloadLimit(
  texto: string,
  imagens: string[],
  limit: number = MAX_PAYLOAD_BYTES,
): { ok: true } | { ok: false; bytes: number; message: string } {
  const bytes = totalPayloadBytes(texto, imagens);
  if (bytes <= limit) return { ok: true };
  return {
    ok: false,
    bytes,
    message:
      `As capturas ocupam ${formatMb(bytes)}, acima do limite de ${formatMb(limit)} por análise. ` +
      `Remove algumas imagens (ou envia-as em dois lotes) e tenta novamente.`,
  };
}

/**
 * Comprime um ficheiro de imagem para JPEG redimensionado.
 * Browser-only (usa canvas). Em caso de falha devolve o original em data URL.
 */
export async function compressImageFile(
  file: File,
  opts: { maxDimension?: number; quality?: number } = {},
): Promise<string> {
  const maxDimension = opts.maxDimension ?? IMAGE_MAX_DIMENSION;
  const quality = opts.quality ?? IMAGE_JPEG_QUALITY;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaleToMax(bitmap.width, bitmap.height, maxDimension);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("canvas indisponível");
    // Fundo branco: JPEG não tem alfa.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(bitmap, 0, 0, width, height);
    bitmap.close?.();
    const out = canvas.toDataURL("image/jpeg", quality);
    if (!out.startsWith("data:image/")) throw new Error("saída inválida");
    return out;
  } catch {
    return await fileToDataUrl(file);
  }
}

export function fileToDataUrl(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

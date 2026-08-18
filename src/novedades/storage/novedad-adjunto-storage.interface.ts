export interface NovedadAdjuntoStorage {
  guardar(buffer: Buffer, mimetype: 'image/jpeg' | 'image/png' | 'application/pdf'): Promise<string>; // → path relativo p.ej. "2026/07/<uuid>.jpg"
  leer(path: string): Promise<{ buffer: Buffer; mimetype: string }>;
  borrar(path: string): Promise<void>;
}
export const NOVEDAD_ADJUNTO_STORAGE = 'NOVEDAD_ADJUNTO_STORAGE';

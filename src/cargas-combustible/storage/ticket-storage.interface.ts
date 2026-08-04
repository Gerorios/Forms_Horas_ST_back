export interface TicketStorage {
  guardar(buffer: Buffer, mimetype: 'image/jpeg' | 'image/png'): Promise<string>; // → path relativo p.ej. "2026/07/<uuid>.jpg"
  leer(path: string): Promise<{ buffer: Buffer; mimetype: string }>;
  borrar(path: string): Promise<void>;
}
export const TICKET_STORAGE = 'TICKET_STORAGE';

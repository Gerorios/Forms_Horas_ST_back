import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FsTicketStorage } from './fs-ticket-storage.service';

describe('FsTicketStorage', () => {
  let dir: string;
  let storage: FsTicketStorage;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'tickets-'));
    storage = new FsTicketStorage(dir);
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('guarda y lee un jpeg, devolviendo path relativo año/mes', async () => {
    const path = await storage.guardar(Buffer.from('foto-fake'), 'image/jpeg');
    expect(path).toMatch(/^\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/);
    const { buffer, mimetype } = await storage.leer(path);
    expect(buffer.toString()).toBe('foto-fake');
    expect(mimetype).toBe('image/jpeg');
  });

  it('rechaza paths con traversal', async () => {
    await expect(storage.leer('../../etc/passwd')).rejects.toThrow();
  });

  it('borra un archivo', async () => {
    const path = await storage.guardar(Buffer.from('x'), 'image/png');
    await storage.borrar(path);
    await expect(storage.leer(path)).rejects.toThrow();
  });
});

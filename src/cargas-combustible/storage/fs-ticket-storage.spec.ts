import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { FsTicketStorage } from './fs-ticket-storage.service';

jest.mock('fs/promises', () => {
  const actual = jest.requireActual('fs/promises');
  return { ...actual, readFile: jest.fn(actual.readFile) };
});
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { readFile } = require('fs/promises') as { readFile: jest.Mock };

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
    await expect(storage.leer(path)).rejects.toThrow(NotFoundException);
  });

  it('propaga un error no-ENOENT como InternalServerErrorException, no como 404', async () => {
    const path = await storage.guardar(Buffer.from('x'), 'image/png');
    const errorAcceso = Object.assign(new Error('permiso denegado'), { code: 'EACCES' });
    readFile.mockRejectedValueOnce(errorAcceso);
    let capturado: unknown;
    try {
      await storage.leer(path);
    } catch (err) {
      capturado = err;
    }
    expect(capturado).toBeInstanceOf(InternalServerErrorException);
    expect(capturado).not.toBeInstanceOf(NotFoundException);
  });
});

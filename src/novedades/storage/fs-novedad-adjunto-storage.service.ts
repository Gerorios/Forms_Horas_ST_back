import { Injectable, NotFoundException, BadRequestException, InternalServerErrorException } from '@nestjs/common';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { join, resolve, sep } from 'path';
import { randomUUID } from 'crypto';
import { NovedadAdjuntoStorage } from './novedad-adjunto-storage.interface';

const EXT_POR_MIME: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'application/pdf': 'pdf',
};
const MIME_POR_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  pdf: 'application/pdf',
};

@Injectable()
export class FsNovedadAdjuntoStorage implements NovedadAdjuntoStorage {
  private readonly baseDir: string;

  constructor(baseDir?: string) {
    this.baseDir = resolve(baseDir ?? process.env.NOVEDADES_ADJUNTOS_DIR ?? './storage/novedades');
  }

  private resolverSeguro(path: string): string {
    const absoluto = resolve(this.baseDir, path);
    if (!absoluto.startsWith(this.baseDir + sep)) throw new BadRequestException('Path inválido');
    return absoluto;
  }

  async guardar(buffer: Buffer, mimetype: 'image/jpeg' | 'image/png' | 'application/pdf'): Promise<string> {
    const ext = EXT_POR_MIME[mimetype];
    if (!ext) throw new BadRequestException('Formato de adjunto no soportado');
    const ahora = new Date();
    const subdir = `${ahora.getFullYear()}/${String(ahora.getMonth() + 1).padStart(2, '0')}`;
    const relativo = `${subdir}/${randomUUID()}.${ext}`;
    await mkdir(join(this.baseDir, subdir), { recursive: true });
    await writeFile(this.resolverSeguro(relativo), buffer);
    return relativo;
  }

  async leer(path: string): Promise<{ buffer: Buffer; mimetype: string }> {
    const absoluto = this.resolverSeguro(path);
    try {
      const buffer = await readFile(absoluto);
      const ext = path.split('.').pop() ?? '';
      return { buffer, mimetype: MIME_POR_EXT[ext] ?? 'application/octet-stream' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        throw new NotFoundException('Adjunto no encontrado');
      }
      throw new InternalServerErrorException('Error al leer el adjunto');
    }
  }

  async borrar(path: string): Promise<void> {
    await unlink(this.resolverSeguro(path)).catch(() => undefined);
  }
}

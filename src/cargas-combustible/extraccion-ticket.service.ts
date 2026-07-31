import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

const PROMPT = `Analizá esta foto de un ticket/remito/factura de una estación de servicio argentina.
Respondé SOLO un JSON (sin markdown) con esta forma exacta:
{"legible": boolean, "litros": number|null, "monto": number|null, "fecha": "YYYY-MM-DD"|null, "nroComprobante": string|null, "tipoCombustible": string|null, "estacion": string|null}
- "legible": false solo si la imagen no es un comprobante de combustible o no se puede leer casi nada.
- "monto" es el total pagado en pesos, sin separador de miles, punto decimal.
- "nroComprobante" es el número de la factura o remito tal como figura.
- "tipoCombustible" y "estacion" tal como figuran impresos; null si no aparecen.
No inventes valores: ante la duda, null.`;

export type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
  };
};

const normalizar = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

@Injectable()
export class ExtraccionTicketService {
  private readonly logger = new Logger(ExtraccionTicketService.name);
  private readonly cliente?: Anthropic;

  constructor(private prisma: PrismaService, @Optional() @Inject(ANTHROPIC_CLIENT) cliente?: Anthropic) {
    this.cliente = cliente ?? (process.env.ANTHROPIC_API_KEY ? new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY }) : undefined);
  }

  // Proveedor primario: Anthropic. Alternativo: OpenAI (OPENAI_API_KEY), mismo contrato y degradación.
  private async llamarModelo(foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' }): Promise<string | null> {
    if (this.cliente) {
      const respuesta = await this.cliente.messages.create({
        model: 'claude-haiku-4-5',
        max_tokens: 512,
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: foto.mimetype, data: foto.buffer.toString('base64') } },
          { type: 'text', text: PROMPT },
        ]}],
      });
      const texto = respuesta.content.find((b) => b.type === 'text');
      return texto && texto.type === 'text' ? texto.text : null;
    }
    if (process.env.OPENAI_API_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 512,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${foto.mimetype};base64,${foto.buffer.toString('base64')}` } },
            { type: 'text', text: PROMPT },
          ]}],
        }),
      });
      if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 200)}`);
      const data = await res.json();
      return typeof data?.choices?.[0]?.message?.content === 'string' ? data.choices[0].message.content : null;
    }
    return null;
  }

  async extraer(foto: { buffer: Buffer; mimetype: 'image/jpeg' | 'image/png' }): Promise<ExtraccionTicket> {
    if (!this.cliente && !process.env.OPENAI_API_KEY) return { legible: false, sugerencias: null };
    try {
      const texto = await this.llamarModelo(foto);
      if (!texto) return { legible: false, sugerencias: null };
      const json = JSON.parse(texto.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, ''));
      if (!json.legible) return { legible: false, sugerencias: null };

      const [estaciones, tipos] = await Promise.all([
        this.prisma.estacionServicio.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
        this.prisma.tipoCombustible.findMany({ where: { activo: true }, select: { id: true, nombre: true } }),
      ]);
      const matchear = (valor: string | null, catalogo: { id: number; nombre: string }[]) => {
        if (!valor) return null;
        const v = normalizar(valor);
        const hit = catalogo.find((c) => normalizar(c.nombre) === v)
          ?? catalogo.find((c) => v.includes(normalizar(c.nombre)) || normalizar(c.nombre).includes(v));
        return hit?.id ?? null;
      };
      return { legible: true, sugerencias: {
        litros: typeof json.litros === 'number' ? json.litros : null,
        monto: typeof json.monto === 'number' ? json.monto : null,
        fechaCarga: typeof json.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.fecha) ? json.fecha : null,
        nroComprobante: typeof json.nroComprobante === 'string' ? json.nroComprobante : null,
        tipoCombustibleId: matchear(json.tipoCombustible ?? null, tipos),
        estacionId: matchear(json.estacion ?? null, estaciones),
      }};
    } catch (e) {
      this.logger.warn(`Extracción de ticket falló: ${e instanceof Error ? e.message : e}`);
      return { legible: false, sugerencias: null };
    }
  }
}

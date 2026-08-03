import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';

const PROMPT = `Sos un extractor de datos de comprobantes de carga de combustible de estaciones de servicio argentinas (YPF, Shell, Axion, Puma, Gulf, blancas). Recibís UNA foto y devolvés SOLO un objeto JSON, sin markdown, sin comentarios, sin texto antes ni después.

## PASO 1 — Clasificá el comprobante
Determiná "tipoComprobante" con uno de estos valores:
- "REMITO": el comprobante dice REMITO, REM., VALE, ORDEN DE CARGA, CUENTA CORRIENTE o CTA CTE. Es una carga a cuenta corriente de la empresa, NO tiene CAE.
- "FACTURA_A", "FACTURA_B", "FACTURA_C": comprobante fiscal, dice FACTURA seguido de una letra grande en un recuadro, o TIQUE FACTURA A/B/C.
- "TIQUE": tique no fiscal, comprobante X, o ticket de surtidor sin letra fiscal.
- "OTRO": cualquier otra cosa.
Si en la MISMA imagen conviven un remito y una factura, priorizá el REMITO.

## PASO 2 — Extraé el número de comprobante
Buscá en este orden y usá la PRIMERA coincidencia:

A) Si es REMITO: buscá etiquetas REMITO, REMITO Nº, REM., Nº REMITO, VALE Nº.
   Ejemplo: "REMITO : R 0021 - 00059874" → devolvé "R 0021-00059874".
   Conservá la letra (R, X), los ceros a la izquierda y el guion. Eliminá solo los espacios sobrantes alrededor del guion.

B) Si es FACTURA o TIQUE FACTURA: el número SIEMPRE tiene el formato punto de venta (4 dígitos) + número (8 dígitos).
   Etiquetas posibles, todas válidas: "COMP. NRO", "COMP. Nº", "Nro. Comprobante", "FACTURA Nº", "FC A Nº", "TIQUE FACTURA B", "Nº", "N°", "PTO VTA / NRO".
   Formas en que puede aparecer impreso:
     "0003-00012345"      → "0003-00012345"
     "0003 00012345"      → "0003-00012345"
     "00030 0012345"      → normalizá a 4+8
     "P.V. 0003  Nº 12345" → "0003-00012345"  (rellená con ceros hasta 8 dígitos)
     "FACTURA B 3-12345"  → "0003-00012345"
   Si el punto de venta aparece en el encabezado y el número correlativo abajo (típico en controlador fiscal), combinálos.
   Si encontrás el número pero NO el punto de venta, poné puntoVenta en null y nroComprobante con el número tal cual figura.

## NUNCA uses como número de comprobante
- CAE / C.A.E. / CAI / COD. AUTORIZACION: siempre 14 dígitos corridos, casi siempre acompañado de "Vto. CAE". Va en el campo "cae", nunca en nroComprobante.
- CUIT / C.U.I.T. (11 dígitos, formato 30-12345678-9) ni el CUIL del chofer.
- Nº de registro, REG. Nº, MEMORIA FISCAL, Nº DE MAQUINA FISCAL, DGI, INGRESOS BRUTOS.
- Número de surtidor, pico, manguera, turno, cajero, operador, tarjeta, patente, kilometraje.
- Código de barras, número de lote, número de transacción, cupón de tarjeta.
- Un "Nº" suelto del encabezado que NO tenga 8 dígitos ni esté acompañado de punto de venta.

## Resto de los campos
- "litros": cantidad cargada. Etiquetas: LTS, Lts., LITROS, CANT., CANTIDAD, VOLUMEN, L. Suele tener 2 o 3 decimales. NO confundir con el precio por litro (que es un número mucho más grande) ni con el total.
- "precioLitro": precio unitario por litro si figura (PRECIO UNIT., $/L, P.UNIT.). null si no aparece.
- "monto": importe TOTAL en pesos. Etiquetas: TOTAL, IMPORTE TOTAL, TOTAL $, A PAGAR, SON PESOS. Si hay SUBTOTAL y TOTAL, usá TOTAL. Ignorá "Efectivo", "Vuelto", "Su pago", "Saldo".
  Formato argentino de entrada: el punto es separador de miles y la coma es decimal. "45.678,90" → 45678.90. Devolvé número con punto decimal y sin separador de miles.
- "fecha": formato argentino DD/MM/AAAA. "05/03/2026" es 5 de marzo, NUNCA 3 de mayo. Si el año viene con 2 dígitos, expandí a 20XX. Devolvé "YYYY-MM-DD".
- "tipoCombustible": tal como figura impreso (ej: "INFINIA DIESEL", "EURO DIESEL", "SUPER", "V-POWER NAFTA", "GNC"). null si no aparece.
- "estacion": razón social o nombre de fantasía de la estación tal como figura. null si no aparece.
- "cuitEstacion": CUIT del emisor, solo dígitos, sin guiones. null si no aparece.
- "cae": el CAE/CAI si existe, solo dígitos. null si no aparece.
- "lineaOrigenNumero": copiá TEXTUALMENTE la línea completa de la imagen de donde extrajiste el nroComprobante, tal cual la leés (con su etiqueta). Si no encontraste número, null.

## Coherencia
Si tenés litros y precioLitro, verificá que litros × precioLitro ≈ monto (tolerancia 5%). Si no cierra, revisá si confundiste litros con precio unitario y corregí.

## Reglas de honestidad
- NO inventes ni completes datos por probabilidad. Ante la mínima duda sobre un campo: null.
- Si un dígito está borroso, cortado, tapado por un dedo, quemado por el flash o el papel térmico está desvanecido, ese campo va en null. Es preferible null a un número equivocado.
- "legible": false SOLO si la imagen no es un comprobante de combustible, o está tan mal que no se puede leer casi nada. Si se lee parcialmente, legible = true y los campos ilegibles en null.
- "confianzaNumero": "alta" si leíste el número nítido y con etiqueta clara; "media" si lo inferiste combinando partes o la etiqueta era ambigua; "baja" si hay dígitos dudosos.

## Formato de salida (exacto, todas las claves siempre presentes)
{"legible": boolean, "tipoComprobante": "REMITO"|"FACTURA_A"|"FACTURA_B"|"FACTURA_C"|"TIQUE"|"OTRO", "nroComprobante": string|null, "puntoVenta": string|null, "numero": string|null, "lineaOrigenNumero": string|null, "confianzaNumero": "alta"|"media"|"baja", "litros": number|null, "precioLitro": number|null, "monto": number|null, "fecha": "YYYY-MM-DD"|null, "tipoCombustible": string|null, "estacion": string|null, "cuitEstacion": string|null, "cae": string|null}`;

export type TipoComprobante = 'REMITO' | 'FACTURA_A' | 'FACTURA_B' | 'FACTURA_C' | 'TIQUE' | 'OTRO';
export type ExtraccionTicket = {
  legible: boolean;
  sugerencias: null | {
    litros: number | null; monto: number | null; fechaCarga: string | null;
    nroComprobante: string | null; tipoCombustibleId: number | null; estacionId: number | null;
    tipoComprobante: TipoComprobante | null;
    medioPagoSugerido: 'cuenta_corriente' | 'caja' | null;
    confianzaNumero: 'alta' | 'media' | 'baja' | null;
    lineaOrigenNumero: string | null;
    precioLitro: number | null;
    advertenciaCoherencia: string | null;
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
        max_tokens: 1024,
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
          model: 'gpt-5.1',
          max_completion_tokens: 2048,
          response_format: { type: 'json_object' },
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${foto.mimetype};base64,${foto.buffer.toString('base64')}`, detail: 'high' } },
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
      const TIPOS_COMPROBANTE: TipoComprobante[] = ['REMITO', 'FACTURA_A', 'FACTURA_B', 'FACTURA_C', 'TIQUE', 'OTRO'];
      const tipoComprobante = TIPOS_COMPROBANTE.includes(json.tipoComprobante) ? (json.tipoComprobante as TipoComprobante) : null;
      const medioPagoSugerido = tipoComprobante === 'REMITO' ? 'cuenta_corriente'
        : tipoComprobante && tipoComprobante !== 'OTRO' ? 'caja' : null;
      const confianzaNumero = ['alta', 'media', 'baja'].includes(json.confianzaNumero) ? json.confianzaNumero : null;
      const lineaOrigenNumero = typeof json.lineaOrigenNumero === 'string' ? json.lineaOrigenNumero.slice(0, 200) : null;
      const precioLitro = typeof json.precioLitro === 'number' ? json.precioLitro : null;
      const litros = typeof json.litros === 'number' ? json.litros : null;
      const monto = typeof json.monto === 'number' ? json.monto : null;
      let advertenciaCoherencia: string | null = null;
      if (litros !== null && precioLitro !== null && monto !== null && monto > 0) {
        const calculado = litros * precioLitro;
        if (Math.abs(calculado - monto) / monto > 0.05) {
          advertenciaCoherencia = `Litros × precio unitario ($ ${calculado.toFixed(2)}) no coincide con el total ($ ${monto.toFixed(2)}).`;
        }
      }

      return { legible: true, sugerencias: {
        litros,
        monto,
        fechaCarga: typeof json.fecha === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(json.fecha) ? json.fecha : null,
        nroComprobante: typeof json.nroComprobante === 'string' ? json.nroComprobante : null,
        tipoCombustibleId: matchear(json.tipoCombustible ?? null, tipos),
        estacionId: matchear(json.estacion ?? null, estaciones),
        tipoComprobante,
        medioPagoSugerido,
        confianzaNumero,
        lineaOrigenNumero,
        precioLitro,
        advertenciaCoherencia,
      }};
    } catch (e) {
      this.logger.warn(`Extracción de ticket falló: ${e instanceof Error ? e.message : e}`);
      return { legible: false, sugerencias: null };
    }
  }
}

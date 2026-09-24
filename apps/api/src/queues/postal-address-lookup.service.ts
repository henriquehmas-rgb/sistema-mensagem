import { Injectable } from '@nestjs/common';

export interface PostalAddress {
  street: string;
  neighborhood: string;
  city: string;
  state: string;
}

/**
 * Consulta pública e restrita ao ViaCEP: apenas um CEP já informado pelo
 * interessado. Não aceita URL configurável, não transmite telefone/nome e
 * nunca é usada como evidência de cobertura — a decisão continua no IXC.
 */
@Injectable()
export class PostalAddressLookupService {
  async lookup(postalCode: string): Promise<PostalAddress | null> {
    if (!/^\d{8}$/.test(postalCode)) return null;
    try {
      const response = await fetch(`https://viacep.com.br/ws/${postalCode}/json/`, {
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(4_000),
      });
      if (!response.ok) return null;
      const raw: unknown = await response.json();
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
      const data = raw as Record<string, unknown>;
      if (data.erro === true) return null;
      const text = (key: string) => typeof data[key] === 'string' ? data[key].trim() : '';
      const state = text('uf').toUpperCase();
      const city = text('localidade');
      const neighborhood = text('bairro');
      const street = text('logradouro');
      if (!city || !state || !/^[A-Z]{2}$/.test(state)) return null;
      return { street, neighborhood, city, state };
    } catch {
      return null;
    }
  }
}

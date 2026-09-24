import { BadGatewayException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { IxcHttpClient } from './ixc-http.client';

const args = [
  'https://ixc.example.com/webservice/v1',
  { username: 'user', token: 'secret' },
  'cliente' as const,
  { qtype: 'cliente.id', query: '1' },
] as const;

function transientError(): BadGatewayException {
  const error = new BadGatewayException('indisponível');
  Object.assign(error, { ixcTransient: true });
  return error;
}

describe('IxcHttpClient — resiliência', () => {
  it('protege a configuração de Auto Viabilidade com a mesma repetição limitada', async () => {
    const client = new IxcHttpClient();
    const request = vi
      .spyOn(client as never, 'postTechnicalViabilityOnce')
      .mockRejectedValueOnce(transientError())
      .mockResolvedValueOnce({ versao_viabilidade: '3' });

    await expect(client.readAutoViabilityConfig(args[0], args[1])).resolves.toEqual({ versao_viabilidade: '3' });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('repete uma vez uma falha transitória e recupera', async () => {
    const client = new IxcHttpClient();
    const requestOnce = vi
      .spyOn(client as never, 'requestOnce')
      .mockRejectedValueOnce(transientError())
      .mockResolvedValueOnce({ registros: [] });

    await expect(client.list(...args)).resolves.toEqual({ registros: [] });
    expect(requestOnce).toHaveBeenCalledTimes(2);
  });

  it('repete uma vez a consulta técnica somente leitura após resposta transitória', async () => {
    const client = new IxcHttpClient();
    const request = vi
      .spyOn(client as never, 'postTechnicalViabilityOnce')
      .mockRejectedValueOnce(transientError())
      .mockResolvedValueOnce({ 0: { status_viabilidade: 'S' }, success: true });

    await expect(client.checkAutoViability(args[0], args[1], {
      latitude: -16.06, longitude: -57.68,
    })).resolves.toEqual({ 0: { status_viabilidade: 'S' }, success: true });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it('não repete erro definitivo da consulta técnica', async () => {
    const client = new IxcHttpClient();
    const request = vi
      .spyOn(client as never, 'postTechnicalViabilityOnce')
      .mockRejectedValue(new BadGatewayException('consulta recusada'));

    await expect(client.checkAutoViability(args[0], args[1], {
      latitude: -16.06, longitude: -57.68,
    })).rejects.toThrow('consulta recusada');
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('não repete erros definitivos', async () => {
    const client = new IxcHttpClient();
    const requestOnce = vi
      .spyOn(client as never, 'requestOnce')
      .mockRejectedValue(new BadGatewayException('consulta recusada'));

    await expect(client.list(...args)).rejects.toThrow('consulta recusada');
    expect(requestOnce).toHaveBeenCalledTimes(1);
  });

  it('abre o circuito depois de três consultas consecutivas malsucedidas', async () => {
    const client = new IxcHttpClient();
    const requestOnce = vi.spyOn(client as never, 'requestOnce').mockRejectedValue(transientError());

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await expect(client.list(...args)).rejects.toThrow('indisponível');
    }
    expect(requestOnce).toHaveBeenCalledTimes(6);

    await expect(client.list(...args)).rejects.toThrow('falhas consecutivas');
    expect(requestOnce).toHaveBeenCalledTimes(6);
  });
});

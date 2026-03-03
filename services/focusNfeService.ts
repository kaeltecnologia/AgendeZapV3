import { FocusNfeConfig } from '../types';

const BASE_HOM = 'https://homologacao.focusnfe.com.br/v2';
const BASE_PRD = 'https://api.focusnfe.com.br/v2';

export interface EmitNfseParams {
  config: FocusNfeConfig;
  dataEmissao: string;          // YYYY-MM-DD
  tomadorNome: string;
  tomadorCpfCnpj?: string;
  discriminacao: string;        // descrição dos serviços (texto livre)
  valorServicos: number;        // valor BRUTO total
  valorDeclaravel: number;      // cota-parte do estabelecimento (base ISS)
  referencia: string;           // ID único para idempotência
}

export interface EmitNfseResult {
  success: boolean;
  ref?: string;
  nfseNumero?: string;
  link?: string;
  error?: string;
}

export async function emitirNfse(params: EmitNfseParams): Promise<EmitNfseResult> {
  const { config, dataEmissao, tomadorNome, tomadorCpfCnpj, discriminacao,
    valorServicos, valorDeclaravel, referencia } = params;

  const base = config.ambiente === 'producao' ? BASE_PRD : BASE_HOM;
  const deducoes = Math.max(0, valorServicos - valorDeclaravel);

  const payload: Record<string, unknown> = {
    data_emissao: dataEmissao,
    prestador: {
      cnpj: config.cnpj.replace(/\D/g, ''),
      inscricao_municipal: config.inscricaoMunicipal,
      codigo_municipio: String(config.municipio),
    },
    tomador: {
      razao_social: tomadorNome,
      ...(tomadorCpfCnpj ? { cpf: tomadorCpfCnpj.replace(/\D/g, '') } : {}),
    },
    servico: {
      valor_servicos: valorServicos.toFixed(2),
      deducoes: deducoes.toFixed(2),
      valor_iss: (valorDeclaravel * config.aliquotaIss / 100).toFixed(2),
      base_calculo: valorDeclaravel.toFixed(2),
      aliquota: config.aliquotaIss,
      discriminacao,
      codigo_servico: config.codigoServico,
      municipio_prestacao_servico: String(config.municipio),
    },
  };

  const token = btoa(`${config.token}:`);
  const url = `${base}/nfse?ref=${encodeURIComponent(referencia)}`;

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const data = await resp.json();

    if (resp.ok || resp.status === 201 || resp.status === 202) {
      return {
        success: true,
        ref: data.ref ?? referencia,
        nfseNumero: data.numero_nfse ?? data.numero ?? undefined,
        link: data.caminho_xml_nota_fiscal ?? data.url ?? undefined,
      };
    }

    // Error response from FocusNFe
    const errMsg = Array.isArray(data.errors)
      ? data.errors.map((e: { message?: string; mensagem?: string }) => e.message ?? e.mensagem).join('; ')
      : (data.mensagem ?? data.message ?? JSON.stringify(data));

    return { success: false, error: errMsg };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: `Erro de conexão: ${message}` };
  }
}

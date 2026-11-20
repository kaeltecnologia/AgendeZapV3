// Tutoriais em vídeo do AgendeZap.
// Para publicar um novo: coloque o .mp4 e a capa .jpg em public/tutoriais/ e preencha
// `arquivo` (nome sem extensão) e `duracao` do item. Item sem `arquivo` aparece como "Em breve".

export type Tutorial = {
  id: string;
  titulo: string;
  descricao: string;
  grupo: 'Primeira configuração' | 'Dia a dia';
  arquivo?: string;   // public/tutoriais/<arquivo>.mp4 e .jpg
  duracao?: string;   // ex.: "1:02"
};

export const TUTORIAIS: Tutorial[] = [
  { id: '01', grupo: 'Primeira configuração', titulo: 'Como marcar um horário na agenda', descricao: 'Do horário livre ao agendamento confirmado, em poucos toques.', arquivo: '01-como-marcar-horario-na-agenda', duracao: '1:02' },
  { id: '02', grupo: 'Primeira configuração', titulo: 'Dados do salão e horário de funcionamento', descricao: 'Nome, WhatsApp, Instagram e os dias e horários em que o salão abre.', arquivo: '02-dados-do-salao-e-horario', duracao: '1:08' },
  { id: '03', grupo: 'Primeira configuração', titulo: 'Como cadastrar os serviços', descricao: 'Categorias, preço, duração e custo de material.', arquivo: '03-cadastrar-servicos', duracao: '0:54' },
  { id: '04', grupo: 'Primeira configuração', titulo: 'Como cadastrar a equipe', descricao: 'Profissionais, comissão, serviços que fazem, PIN e pausas.' },
  { id: '05', grupo: 'Primeira configuração', titulo: 'Como conectar o WhatsApp do salão', descricao: 'Conecte o número do salão para enviar confirmações e lembretes.' },
  { id: '06', grupo: 'Primeira configuração', titulo: 'Lembretes automáticos', descricao: 'Check-in, lembrete antes do horário, recuperação e aniversário.' },
  { id: '07', grupo: 'Primeira configuração', titulo: 'Agente IA no WhatsApp', descricao: 'Deixe a IA responder e agendar pelos seus clientes.' },
  { id: '08', grupo: 'Primeira configuração', titulo: 'Link de agendamento online', descricao: 'Sua página para o cliente marcar sozinho, com a sua cara.' },
  { id: '09', grupo: 'Primeira configuração', titulo: 'Como cadastrar clientes', descricao: 'Cadastro, aniversário e modos de lembrete por cliente.' },
  { id: '10', grupo: 'Dia a dia', titulo: 'Painel inicial', descricao: 'Faturamento, atendimentos e o que precisa da sua atenção.' },
  { id: '11', grupo: 'Dia a dia', titulo: 'Status do atendimento', descricao: 'Confirmar, cliente chegou, finalizar e faltou.' },
  { id: '12', grupo: 'Dia a dia', titulo: 'Comandas: abrir e fechar', descricao: 'Produtos, serviços extras, pagamento e comissões.' },
  { id: '13', grupo: 'Dia a dia', titulo: 'Conversas do WhatsApp', descricao: 'Responda e agende sem sair da conversa.' },
  { id: '14', grupo: 'Dia a dia', titulo: 'Ficha do cliente', descricao: 'Histórico, consumo e clientes fixos (recorrência).' },
  { id: '15', grupo: 'Dia a dia', titulo: 'Financeiro', descricao: 'Despesas, adiantamentos e lucro do período.' },
  { id: '16', grupo: 'Dia a dia', titulo: 'Folha de pagamento', descricao: 'Comissões, adiantamentos e pagamento da equipe.' },
  { id: '17', grupo: 'Dia a dia', titulo: 'Planos e pacotes', descricao: 'Pacotes mensais com serviços incluídos.' },
  { id: '18', grupo: 'Dia a dia', titulo: 'Assinaturas', descricao: 'Mensalidades dos clientes, cobrança e renovação.' },
  { id: '19', grupo: 'Dia a dia', titulo: 'Estoque e produtos', descricao: 'Insumos do salão e produtos para venda.' },
  { id: '20', grupo: 'Dia a dia', titulo: 'Notas fiscais', descricao: 'Configuração e emissão de NFS-e.' },
  { id: '21', grupo: 'Dia a dia', titulo: 'Portal do profissional', descricao: 'Como cada profissional acessa a própria agenda.' },
  { id: '22', grupo: 'Dia a dia', titulo: 'Usando o AgendeZap no celular', descricao: 'Menu, agenda e atalhos no celular.' },
];


import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./mockDb";
import { AppointmentStatus, BookingSource } from "../types";
import { sendProfessionalNotification } from "./notificationService";

// Helper: converte Date para string ISO local (sem offset UTC)
function toLocalISO(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const processWhatsAppMessage = async (tenantId: string, phone: string, name: string, message: string, apiKey?: string) => {
  const tenants = await db.getAllTenants();
  const tenant = tenants.find(t => t.id === tenantId);
  const resolvedKey = apiKey || (tenant as any)?.gemini_api_key || '';
  if (!resolvedKey) {
    return { replyText: 'Chave de IA não configurada. Contate o administrador.', intent: 'CHAT' };
  }
  const ai = new GoogleGenAI({ apiKey: resolvedKey });

  const [allProfessionals, allServices] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
  ]);

  // Filtrar apenas profissionais e serviços ATIVOS
  const professionals = allProfessionals.filter(p => p.active !== false);
  const services = allServices.filter(s => s.active !== false);

  const shopName = tenant?.name || "Barbearia";
  const today = new Date();

  if (professionals.length === 0 || services.length === 0) {
    return {
      replyText: `Olá! Sou o assistente da ${shopName}. No momento nosso catálogo está em manutenção, mas logo voltaremos ao normal!`,
      intent: "CHAT",
      error: "O administrador precisa cadastrar barbeiros e serviços."
    };
  }

  // Preço seguro: trata null/undefined/NaN
  const safePrice = (price: any): string => {
    const n = Number(price);
    return isNaN(n) ? '0,00' : n.toFixed(2).replace('.', ',');
  };

  const context = `
    IDENTIDADE: Você é o Atendente Digital da "${shopName}".
    OBJETIVO: Agendar horários de forma rápida e natural.

    CATÁLOGO:
    - Profissionais: ${professionals.map(p => `${p.name || 'Sem Nome'}`).join(', ')}.
    - Serviços: ${services.map(s => `${s.name || 'Sem Nome'} (R$${safePrice(s.price)}, ${s.durationMinutes || 30}min)`).join(', ')}.

    DATA ATUAL: ${today.toLocaleString('pt-BR')} (Hoje é ${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][today.getDay()]}).

    REGRAS:
    1. Nunca use listas numeradas.
    2. Se o cliente pedir agendamento, você deve identificar: O que ele quer (Serviço), com quem (Profissional) e quando (Data/Hora).
    3. IMPORTANTE: O cliente pode pedir MÚLTIPLOS serviços de uma vez (ex: "cabelo e barba", "corte e relaxamento"). Nesse caso, retorne TODOS os serviços no array "serviceNames". Nunca ignore um serviço mencionado.
    4. SINÔNIMOS COMUNS: "cabelo"/"cortar"/"cabeça"/"degradê" = Corte. "barba"/"barbinha" = Barba. "sobrancelha" = Sobrancelha. "progressiva"/"alisar"/"produtinho" = Alisamento. "pintar"/"mechas"/"reflexo" = Coloração.
    5. Se faltar informação, peça educadamente.
    6. Ao confirmar, use o campo "appointmentDetails" no JSON de saída.
    7. Para o campo "dateTime", use sempre o formato ISO 8601 SEM timezone (Ex: 2024-05-20T14:30:00). NUNCA adicione "Z" ao final.
    8. Use os NOMES EXATOS dos serviços do catálogo no array serviceNames (ex: se o catálogo tem "Corte" e o cliente diz "cabelo", retorne "Corte").
    9. Horários coloquiais: "5 e meia"=17:30, "as 3"=15:00, "meio dia"=12:00, "agora"=horário mais próximo.
    10. Se só houver 1 profissional, não pergunte qual profissional.
  `;

  try {
    const response = await ai.models.generateContent({
      model: "gemini-2.0-flash",
      contents: message,
      config: {
        systemInstruction: context,
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            replyText: { type: Type.STRING, description: "Texto que será enviado ao cliente no WhatsApp" },
            intent: { type: Type.STRING, enum: ["BOOKING", "CHAT"] },
            appointmentDetails: {
              type: Type.OBJECT,
              properties: {
                professionalName: { type: Type.STRING },
                serviceNames: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Array com TODOS os serviços pedidos pelo cliente (ex: ['Corte', 'Barba']). Use os nomes EXATOS do catálogo." },
                dateTime: { type: Type.STRING, description: "Data e hora no formato ISO SEM timezone (Ex: 2026-03-24T14:30:00)" }
              }
            }
          },
          required: ["replyText", "intent"]
        }
      }
    });

    const result = JSON.parse(response.text || "{}");

    // Lógica de agendamento se os detalhes foram extraídos
    if (result.appointmentDetails?.dateTime) {
      const dateStr = result.appointmentDetails.dateTime;
      // Evita interpretar como UTC: remove Z se a IA adicionou
      const cleanDateStr = dateStr.replace(/Z$/, '').replace(/[+-]\d{2}:\d{2}$/, '');
      const requestedDate = new Date(cleanDateStr);

      if (!isNaN(requestedDate.getTime())) {
        const customer = await db.findOrCreateCustomer(tenantId, phone, name);

        // Match inteligente para profissional
        const profName = (result.appointmentDetails.professionalName || "").toLowerCase();
        const prof = (profName
          ? professionals.find(p => (p.name || '').toLowerCase().includes(profName))
          : null) || professionals[0];

        // Match múltiplos serviços — suporta array (novo) e string (legado)
        const rawNames: string[] = Array.isArray(result.appointmentDetails.serviceNames)
          ? result.appointmentDetails.serviceNames
          : result.appointmentDetails.serviceName
            ? [result.appointmentDetails.serviceName]
            : [];

        const matchedSvcs = rawNames
          .map(n => services.find(s => (s.name || '').toLowerCase().includes((n || '').toLowerCase())))
          .filter(Boolean) as typeof services;

        // Deduplica serviços (caso a IA retorne o mesmo serviço 2x)
        const uniqueSvcs = matchedSvcs.filter((s, i, arr) => arr.findIndex(x => x.id === s.id) === i);

        // Fallback: se nenhum serviço matched, usa o primeiro
        const svcs = uniqueSvcs.length > 0 ? uniqueSvcs : [services[0]];
        const totalDuration = svcs.reduce((sum, s) => sum + (s.durationMinutes || 30), 0);
        const totalPrice = svcs.reduce((sum, s) => sum + (Number(s.price) || 0), 0);

        const check = await db.isSlotAvailable(tenantId, prof.id, requestedDate, totalDuration);

        if (check.available) {
          const svcIds = svcs.map(s => s.id);
          // Usar hora local, não UTC
          const localStartTime = toLocalISO(requestedDate);

          const newApp = await db.addAppointment({
            tenant_id: tenantId,
            customer_id: customer.id,
            professional_id: prof.id,
            service_id: svcIds[0],
            serviceIds: svcIds,
            startTime: localStartTime,
            durationMinutes: totalDuration,
            status: AppointmentStatus.CONFIRMED,
            source: BookingSource.AI
          });

          await sendProfessionalNotification(newApp);

          // Confirmação com todos os serviços
          const svcList = svcs.map(s => s.name || 'Serviço').join(' + ');
          const priceStr = safePrice(totalPrice);
          const dateFormatted = requestedDate.toLocaleDateString('pt-BR');
          const timeFormatted = requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
          result.replyText = `Show! ✅ Agendado com sucesso:\n\n✂️ *${svcList}* (R$${priceStr})\n👤 *${prof.name}*\n📅 *${dateFormatted} às ${timeFormatted}*\n\nTe esperamos lá!`;
        } else {
          const timeFormatted = requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
          result.replyText = `Poxa, o horário das ${timeFormatted} com ${prof.name || 'o profissional'} já está ocupado.${check.reason ? ` (${check.reason})` : ''} Quer tentar outro momento?`;
        }
      }
    }

    return result;
  } catch (error: any) {
    console.error('[geminiService] Error:', error?.message || error);
    return {
      replyText: "Olá! Notei que você enviou uma mensagem, mas tive um erro temporário no processamento. Pode repetir, por favor?",
      intent: "CHAT"
    };
  }
};

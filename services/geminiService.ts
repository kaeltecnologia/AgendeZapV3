
import { GoogleGenAI, Type } from "@google/genai";
import { db } from "./mockDb";
import { AppointmentStatus, BookingSource } from "../types";
import { sendProfessionalNotification } from "./notificationService";

export const processWhatsAppMessage = async (tenantId: string, phone: string, name: string, message: string, apiKey?: string) => {
  const tenants = await db.getAllTenants();
  const tenant = tenants.find(t => t.id === tenantId);
  const resolvedKey = apiKey || (tenant as any)?.gemini_api_key || '';
  if (!resolvedKey) {
    return { replyText: 'Chave de IA não configurada. Contate o administrador.', intent: 'CHAT' };
  }
  const ai = new GoogleGenAI({ apiKey: resolvedKey });
  
  const [professionals, services] = await Promise.all([
    db.getProfessionals(tenantId),
    db.getServices(tenantId),
  ]);

  const shopName = tenant?.name || "Barbearia";
  const today = new Date();

  if (professionals.length === 0 || services.length === 0) {
    return { 
      replyText: `Olá! Sou o assistente da ${shopName}. No momento nosso catálogo está em manutenção, mas logo voltaremos ao normal!`, 
      intent: "CHAT",
      error: "O administrador precisa cadastrar barbeiros e serviços."
    };
  }

  const context = `
    IDENTIDADE: Você é o Atendente Digital da "${shopName}".
    OBJETIVO: Agendar horários de forma rápida e natural.
    
    CATÁLOGO:
    - Barbeiros: ${professionals.map(p => p.name).join(', ')}.
    - Serviços: ${services.map(s => `${s.name} (R$${s.price.toFixed(2)})`).join(', ')}.
    
    DATA ATUAL: ${today.toLocaleString('pt-BR')} (Hoje é ${['Domingo','Segunda','Terça','Quarta','Quinta','Sexta','Sábado'][today.getDay()]}).

    REGRAS:
    1. Nunca use listas numeradas.
    2. Se o cliente pedir agendamento, você deve identificar: O que ele quer (Serviço), com quem (Barbeiro) e quando (Data/Hora).
    3. IMPORTANTE: O cliente pode pedir MÚLTIPLOS serviços de uma vez (ex: "cabelo e barba", "corte e relaxamento"). Nesse caso, retorne TODOS os serviços no array "serviceNames". Nunca ignore um serviço mencionado.
    4. Se faltar informação, peça educadamente.
    5. Ao confirmar, use o campo "appointmentDetails" no JSON de saída.
    6. Para o campo "dateTime", use sempre o formato ISO 8601 (Ex: 2024-05-20T14:30:00).
  `;

  try {
    const response = await ai.models.generateContent({
      // Use gemini-3-pro-preview for complex text tasks such as information extraction for booking
      model: "gemini-3-pro-preview",
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
                serviceNames: { type: Type.ARRAY, items: { type: Type.STRING }, description: "Array com TODOS os serviços pedidos pelo cliente (ex: ['Corte', 'Barba'])" },
                dateTime: { type: Type.STRING, description: "Data e hora no formato ISO" }
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
      const requestedDate = new Date(result.appointmentDetails.dateTime);
      
      if (!isNaN(requestedDate.getTime())) {
        const customer = await db.findOrCreateCustomer(tenantId, phone, name);
        
        // Match inteligente para profissional
        const prof = professionals.find(p => p.name.toLowerCase().includes(result.appointmentDetails.professionalName?.toLowerCase() || "")) || professionals[0];

        // Match múltiplos serviços — suporta array (novo) e string (legado)
        const rawNames: string[] = Array.isArray(result.appointmentDetails.serviceNames)
          ? result.appointmentDetails.serviceNames
          : result.appointmentDetails.serviceName
            ? [result.appointmentDetails.serviceName]
            : [];

        const matchedSvcs = rawNames
          .map(name => services.find(s => s.name.toLowerCase().includes(name.toLowerCase())))
          .filter(Boolean) as typeof services;

        // Fallback: se nenhum serviço matched, usa o primeiro
        const svcs = matchedSvcs.length > 0 ? matchedSvcs : [services[0]];
        const totalDuration = svcs.reduce((sum, s) => sum + s.durationMinutes, 0);
        const totalPrice = svcs.reduce((sum, s) => sum + s.price, 0);

        const check = await db.isSlotAvailable(tenantId, prof.id, requestedDate, totalDuration);

        if (check.available) {
          const svcIds = svcs.map(s => s.id);
          const newApp = await db.addAppointment({
            tenant_id: tenantId,
            customer_id: customer.id,
            professional_id: prof.id,
            service_id: svcIds[0],
            serviceIds: svcIds,
            startTime: requestedDate.toISOString(),
            durationMinutes: totalDuration,
            status: AppointmentStatus.CONFIRMED,
            source: BookingSource.AI
          });

          await sendProfessionalNotification(newApp);

          // Confirmação com todos os serviços
          const svcList = svcs.map(s => s.name).join(' + ');
          result.replyText = `Show! ✅ Agendado com sucesso:\n\n✂️ *${svcList}* (R$${totalPrice.toFixed(2).replace('.', ',')})\n👤 *${prof.name}*\n📅 *${requestedDate.toLocaleDateString('pt-BR')} às ${requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})}*\n\nTe esperamos lá!`;
        } else {
          result.replyText = `Poxa, o horário das ${requestedDate.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'})} com ${prof.name} já está ocupado. Quer tentar outro momento?`;
        }
      }
    }

    return result;
  } catch (error: any) {
    return { 
      replyText: "Olá! Notei que você enviou uma mensagem, mas tive um erro temporário no processamento. Pode repetir, por favor?", 
      intent: "CHAT" 
    };
  }
};

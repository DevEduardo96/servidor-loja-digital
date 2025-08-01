import express from 'express';
import { createClient } from '@supabase/supabase-js';
import mercadopago from 'mercadopago';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

mercadopago.configure({
  access_token: process.env.MERCADO_PAGO_ACCESS_TOKEN!,
});

// Webhook Mercado Pago para pagamento
app.post('/webhook/mercadopago', async (req, res) => {
  const { id, topic } = req.body;

  if (topic !== 'payment') {
    return res.status(200).send('Evento ignorado');
  }

  try {
    // Busca pagamento no Mercado Pago
    const paymentResponse = await mercadopago.payment.findById(id);
    const payment = paymentResponse.body;

    if (payment.status === 'approved') {
      // Atualiza status no Supabase
      const { error: updateError } = await supabase
        .from('pagamentos')
        .update({ status: 'approved', paid_at: new Date().toISOString() })
        .eq('id', payment.id);

      if (updateError) {
        console.error('Erro ao atualizar pagamento:', updateError);
        return res.status(500).send('Erro ao atualizar pagamento');
      }

      // Busca dados do pagamento para pegar email e produtos
      const { data: pagamento, error: fetchError } = await supabase
        .from('pagamentos')
        .select('email_cliente, produtos')
        .eq('id', payment.id)
        .single();

      if (fetchError || !pagamento) {
        console.error('Erro ao buscar pagamento:', fetchError);
        return res.status(500).send('Pagamento não encontrado');
      }

      const produtosComprados: { id: number }[] = pagamento.produtos;

      // Busca links de download ativos para os produtos e pagamento
      const { data: links, error: linksError } = await supabase
        .from('downloads')
        .select('download_url')
        .in('product_id', produtosComprados.map(p => p.id))
        .eq('payment_id', payment.id)
        .eq('is_active', true);

      if (linksError) {
        console.error('Erro ao buscar links de download:', linksError);
        return res.status(500).send('Erro ao buscar links');
      }

      // Aqui você pode enviar os links por email ou retornar na resposta
      // Por simplicidade, vamos retornar JSON com os links

      return res.status(200).json({
        message: 'Pagamento aprovado e links disponíveis',
        email_cliente: pagamento.email_cliente,
        links_download: links?.map(l => l.download_url) ?? [],
      });
    }

    return res.status(200).send('Pagamento não aprovado');
  } catch (error) {
    console.error('Erro no webhook:', error);
    return res.status(500).send('Erro interno');
  }
});

// Iniciar servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta ${PORT}`);
});

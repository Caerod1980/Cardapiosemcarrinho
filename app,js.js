const express = require('express');
const mercadopago = require('mercadopago');
const cors = require('cors');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 10000;

// Middleware
app.use(cors());
app.use(express.json());

// Configurar Mercado Pago
mercadopago.configure({
    access_token: process.env.MERCADOPAGO_ACCESS_TOKEN,
    integrator_id: process.env.INTEGRATOR_ID // Opcional
});

// Rota de saúde
app.get('/', (req, res) => {
    res.json({
        status: 'online',
        service: 'BebCom Payments API',
        version: '1.0.0'
    });
});

// Criar pagamento PIX
app.post('/create-pix', async (req, res) => {
    try {
        const { transaction_amount, description, customer_name, order_type, items } = req.body;

        // Validação básica
        if (!transaction_amount || transaction_amount <= 0) {
            return res.status(400).json({ error: 'Valor inválido' });
        }

        // Criar ID único para o pedido
        const external_reference = `BEBCOM-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

        // Configurar pagamento PIX
        const payment_data = {
            transaction_amount: parseFloat(transaction_amount),
            description: description || `Pedido BebCom - ${customer_name || 'Cliente'}`,
            payment_method_id: 'pix',
            payer: {
                email: req.body.payer?.email || 'cliente@bebcom.com',
                first_name: customer_name?.split(' ')[0] || 'Cliente',
                last_name: customer_name?.split(' ').slice(1).join(' ') || 'BebCom',
                identification: {
                    type: 'CPF',
                    number: req.body.payer?.identification?.number || '00000000000'
                }
            },
            external_reference: external_reference,
            notification_url: process.env.WEBHOOK_URL || 'https://bebcom-payments.onrender.com/webhook',
            statement_descriptor: 'BEBCOM LOUNGE',
            metadata: {
                customer_name: customer_name,
                order_type: order_type,
                items: items,
                created_at: new Date().toISOString()
            },
            additional_info: {
                items: items?.map(item => ({
                    id: item.name.replace(/\s+/g, '_').toLowerCase(),
                    title: item.name,
                    description: `Quantidade: ${item.quantity}`,
                    quantity: item.quantity,
                    unit_price: item.price,
                    category_id: "drinks"
                })) || []
            }
        };

        console.log('Criando pagamento PIX:', {
            amount: payment_data.transaction_amount,
            reference: external_reference,
            customer: customer_name
        });

        // Criar pagamento no Mercado Pago
        const payment = await mercadopago.payment.create(payment_data);

        // Extrair dados do PIX
        const point_of_interaction = payment.body.point_of_interaction;

        if (!point_of_interaction || !point_of_interaction.transaction_data) {
            throw new Error('Resposta do Mercado Pago inválida');
        }

        const response = {
            id: payment.body.id,
            status: payment.body.status,
            status_detail: payment.body.status_detail,
            transaction_amount: payment.body.transaction_amount,
            external_reference: payment.body.external_reference,
            date_created: payment.body.date_created,
            date_of_expiration: payment.body.date_of_expiration,
            point_of_interaction: {
                transaction_data: {
                    qr_code_base64: point_of_interaction.transaction_data.qr_code_base64,
                    qr_code: point_of_interaction.transaction_data.qr_code,
                    ticket_url: point_of_interaction.transaction_data.ticket_url
                }
            },
            payer: {
                first_name: payment.body.payer.first_name,
                last_name: payment.body.payer.last_name
            }
        };

        console.log('Pagamento criado com sucesso:', response.id);

        res.json(response);

    } catch (error) {
        console.error('Erro ao criar pagamento PIX:', error);

        // Em ambiente de desenvolvimento, retornar dados simulados
        if (process.env.NODE_ENV === 'development') {
            console.log('Retornando dados simulados para desenvolvimento');
            res.json({
                id: `dev-${Date.now()}`,
                status: "pending",
                status_detail: "pending_waiting_payment",
                transaction_amount: req.body.transaction_amount || 10,
                external_reference: `DEV-BEBCOM-${Date.now()}`,
                date_created: new Date().toISOString(),
                date_of_expiration: new Date(Date.now() + 30 * 60000).toISOString(),
                point_of_interaction: {
                    transaction_data: {
                        qr_code_base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
                        qr_code: "00020101021226850014br.gov.bcb.pix2565api.mercadopago.com/v1/payments/123456789/qr-code5204000053039865802BR5913MERCADOPAGO.COM6009SAO PAULO62070503***6304E2CA",
                        ticket_url: "https://www.mercadopago.com.br/payments/123456789/ticket?caller_id=123456789&hash=abc123"
                    }
                },
                payer: {
                    first_name: req.body.customer_name?.split(' ')[0] || "Cliente",
                    last_name: "Teste"
                },
                _dev_mode: true
            });
        } else {
            res.status(500).json({
                error: 'Erro ao criar pagamento',
                message: error.message
            });
        }
    }
});

// Verificar status do pagamento
app.get('/check-payment/:id', async (req, res) => {
    try {
        const paymentId = req.params.id;

        // Se for ID de desenvolvimento
        if (paymentId.startsWith('dev-')) {
            return res.json({
                status: "approved", // Simular aprovado para testes
                status_detail: "accredited",
                date_approved: new Date().toISOString(),
                _dev_mode: true
            });
        }

        // Buscar no Mercado Pago
        const payment = await mercadopago.payment.get(paymentId);

        res.json({
            id: payment.body.id,
            status: payment.body.status,
            status_detail: payment.body.status_detail,
            status_message: getStatusMessage(payment.body.status),
            transaction_amount: payment.body.transaction_amount,
            date_approved: payment.body.date_approved,
            date_last_updated: payment.body.date_last_updated,
            external_reference: payment.body.external_reference
        });

    } catch (error) {
        console.error('Erro ao verificar pagamento:', error);

        // Para desenvolvimento, simular sucesso
        if (process.env.NODE_ENV === 'development') {
            res.json({
                status: "approved",
                status_detail: "accredited",
                date_approved: new Date().toISOString(),
                _dev_mode: true
            });
        } else {
            res.status(500).json({
                error: 'Erro ao verificar pagamento',
                message: error.message
            });
        }
    }
});

// Webhook para notificações do Mercado Pago
app.post('/webhook', async (req, res) => {
    try {
        const { type, data } = req.body;

        console.log('Webhook recebido:', { type, data });

        if (type === 'payment') {
            const paymentId = data.id;

            // Aqui você pode atualizar seu banco de dados
            // ou enviar notificação para o sistema principal

            console.log(`Pagamento ${paymentId} atualizado via webhook`);

            // Buscar detalhes do pagamento
            const payment = await mercadopago.payment.get(paymentId);
            console.log('Status do pagamento:', payment.body.status);
        }

        res.status(200).send('OK');

    } catch (error) {
        console.error('Erro no webhook:', error);
        res.status(500).send('Erro');
    }
});

// Rota para listar pagamentos (apenas para admin)
app.get('/payments', async (req, res) => {
    try {
        // Configurar filtros
        const filters = {
            sort: 'date_created',
            criteria: 'desc',
            external_reference: req.query.order_id,
            range: 'date_created',
            begin_date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
            end_date: new Date().toISOString()
        };

        const payments = await mercadopago.payment.search(filters);

        res.json({
            total: payments.body.paging.total,
            payments: payments.body.results.map(p => ({
                id: p.id,
                status: p.status,
                transaction_amount: p.transaction_amount,
                date_created: p.date_created,
                date_approved: p.date_approved,
                external_reference: p.external_reference,
                customer_name: p.metadata?.customer_name
            }))
        });

    } catch (error) {
        console.error('Erro ao listar pagamentos:', error);
        res.status(500).json({ error: error.message });
    }
});

// Função auxiliar para mensagens de status
function getStatusMessage(status) {
    const messages = {
        'pending': 'Aguardando pagamento',
        'approved': 'Pagamento aprovado',
        'authorized': 'Pagamento autorizado',
        'in_process': 'Pagamento em análise',
        'in_mediation': 'Pagamento em mediação',
        'rejected': 'Pagamento recusado',
        'cancelled': 'Pagamento cancelado',
        'refunded': 'Pagamento reembolsado',
        'charged_back': 'Pagamento contestado'
    };

    return messages[status] || 'Status desconhecido';
}

// Iniciar servidor
app.listen(PORT, () => {
    console.log(`?? Servidor rodando na porta ${PORT}`);
    console.log(`?? URL: https://bebcom-payments.onrender.com`);
    console.log(`?? Modo: ${process.env.NODE_ENV || 'production'}`);
});// JavaScript source code

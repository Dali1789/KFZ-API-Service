const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// SUPABASE CLIENT
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// Health Check
app.get('/health', (req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

// SIMPLE WEBHOOK THAT WORKS
app.post('/api/retell/webhook', async (req, res) => {
    try {
        console.log('📞 WEBHOOK:', JSON.stringify(req.body, null, 2));
        
        const callId = req.body.call_id || `test_${Date.now()}`;
        const transcript = req.body.transcript || '';
        
        console.log('📝 Call ID:', callId);
        console.log('📝 Transcript length:', transcript.length);
        
        if (transcript && transcript.length > 10) {
            // DIRECT DATABASE INSERT
            const { data, error } = await supabase
                .from('kfz_calls')
                .insert({
                    tenant_project_id: '8718ff92-0e7b-41fb-9c71-253d3d708764',
                    retell_call_id: callId,
                    transcript: transcript,
                    call_type: 'inbound',
                    call_outcome: 'success'
                });
                
            if (error) {
                console.error('❌ DB Error:', error);
                return res.status(500).json({ error: error.message });
            }
            
            console.log('✅ SAVED TO DATABASE!');
            
            // SEND EMAIL NOTIFICATION
            const nodemailer = require('nodemailer');
            
            const transporter = nodemailer.createTransport({
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                auth: {
                    user: process.env.SMTP_USER,
                    pass: process.env.SMTP_PASS
                }
            });
            
            try {
                await transporter.sendMail({
                    from: process.env.SMTP_USER,
                    to: process.env.OWNER_EMAIL,
                    subject: '📞 Neuer KFZ-Anruf empfangen',
                    text: `Call ID: ${callId}\n\nTranskript:\n${transcript}`
                });
                
                console.log('✅ EMAIL SENT!');
            } catch (emailError) {
                console.error('❌ Email Error:', emailError);
            }
            
            return res.json({ success: true, saved: true, callId });
        }
        
        res.json({ success: true, message: 'No transcript' });
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// API Endpoints
app.get('/api/calls', async (req, res) => {
    try {
        const { data, error } = await supabase
            .from('kfz_calls')
            .select('*')
            .eq('tenant_project_id', '8718ff92-0e7b-41fb-9c71-253d3d708764')
            .order('created_at', { ascending: false });
            
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/dashboard', async (req, res) => {
    try {
        const { count } = await supabase
            .from('kfz_calls')
            .select('*', { count: 'exact', head: true })
            .eq('tenant_project_id', '8718ff92-0e7b-41fb-9c71-253d3d708764');
            
        res.json({ total_calls: count || 0, timestamp: new Date().toISOString() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log('🚀 SIMPLE KFZ API running on port', PORT);
    console.log('📧 E-Mail configured:', !!process.env.SMTP_HOST);
    console.log('🔗 Webhook ready!');
});

module.exports = app;
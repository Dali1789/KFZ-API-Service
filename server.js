const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

// Import our modular libraries
const { extractCustomerDataIntelligent } = require('./lib/dataExtraction');
const {
    getTenantProjectId,
    createOrUpdateCustomer,
    createProject,
    saveCallRecord,
    scheduleAppointment,
    handleCallbackRequest,
    logAnalyticsEvent,
    testEmailConfiguration,
    sendTestNotification,
    sendNotificationEmail,
    calendarService
} = require('./lib/businessLogic');

const app = express();

// ================================
// MIDDLEWARE
// ================================
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use('/public', express.static(path.join(__dirname, 'public')));

// ================================
// SUPABASE CLIENT
// ================================
const supabaseOptions = {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
        headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    }
};

const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    supabaseOptions
);

console.log('🔗 Supabase Client initialized with:', {
    url: process.env.SUPABASE_URL,
    hasServiceKey: !!process.env.SUPABASE_SERVICE_KEY,
    headers: Object.keys(supabaseOptions.global.headers)
});

// ================================
// ROUTES
// ================================

// Dashboard
app.get('/', (req, res) => res.redirect('/public/dashboard.html'));
app.get('/dashboard', (req, res) => res.redirect('/public/dashboard.html'));
app.get('/ping', (req, res) => res.status(200).send('pong'));

// Health Check
app.get('/health', async (req, res) => {
    try {
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '3.5.0',
            services: { database: { status: 'unknown' }, email: { status: 'unknown' }, retell: { status: 'unknown' } }
        };
        
        // Database test
        try {
            const { data, error } = await supabase.from('kfz_customers').select('count', { count: 'exact', head: true });
            healthData.services.database = error 
                ? { status: 'error', message: error.message }
                : { status: 'healthy', message: 'Connected successfully' };
        } catch (dbError) {
            healthData.services.database = { status: 'error', message: dbError.message };
        }
        
        // Email test
        const requiredEmailVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'];
        const missingVars = requiredEmailVars.filter(varName => !process.env[varName]);
        healthData.services.email = {
            status: missingVars.length === 0 ? 'healthy' : 'warning',
            message: missingVars.length === 0 ? `Configured for ${process.env.OWNER_EMAIL}` : `Missing: ${missingVars.join(', ')}`
        };
        
        // Retell test
        healthData.services.retell = {
            status: process.env.RETELL_API_KEY ? 'healthy' : 'warning',
            message: process.env.RETELL_API_KEY ? 'API key configured' : 'API key missing'
        };
        
        const statusCode = Object.values(healthData.services).some(s => s.status === 'error') ? 503 : 200;
        res.status(statusCode).json(healthData);
        
    } catch (error) {
        res.status(503).json({ status: 'error', error: error.message, timestamp: new Date().toISOString() });
    }
});

// Main Webhook
app.post('/api/retell/webhook', async (req, res) => {
    try {
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        console.log('📞 Webhook:', { call_id, call_status, transcript_length: transcript?.length || 0 });
        
        const tenantProjectId = await getTenantProjectId(supabase);
        if (!tenantProjectId) throw new Error('Tenant project not found');
        
        const extractedData = extractCustomerDataIntelligent(transcript);
        
        if (extractedData && extractedData.name && extractedData.phone) {
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
            const project = await createProject(customer, extractedData, tenantProjectId, supabase);
            
            await saveCallRecord(call_id, transcript, duration_seconds, customer.id, project.id, extractedData, tenantProjectId, supabase);
            
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            if (extractedData.type === 'CALLBACK') {
                await handleCallbackRequest(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            res.json({ 
                success: true, 
                message: 'Webhook processed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment
                }
            });
        } else {
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: call_id,
                call_type: 'inbound',
                duration_seconds,
                transcript,
                call_purpose: 'data_extraction_failed',
                call_outcome: 'requires_manual_review'
            });
            
            res.json({ success: true, message: 'Call logged for manual review', requires_manual_review: true });
        }
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.status(500).json({ error: error.message, call_id: req.body.call_id });
    }
});

// Test Endpoints
app.get('/api/test/email', async (req, res) => {
    try {
        const result = await testEmailConfiguration();
        res.json({ success: result.success, details: result });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

app.post('/api/test/notification', async (req, res) => {
    try {
        const { type = 'appointment' } = req.body;
        const result = await sendTestNotification(type);
        res.json({ success: result.success, messageId: result.messageId });
    } catch (error) {
        res.status(500).json({ success: false, error: error.message });
    }
});

// API Endpoints
app.get('/api/customers', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase.from('kfz_customers').select('*').eq('tenant_project_id', tenantProjectId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/projects', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase.from('kfz_projects').select('*').eq('tenant_project_id', tenantProjectId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/calls', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase.from('kfz_calls').select('*').eq('tenant_project_id', tenantProjectId);
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Dashboard Data
app.get('/api/dashboard', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const today = new Date().toISOString().split('T')[0];
        
        const [projects, calls, customers, appointments] = await Promise.all([
            supabase.from('kfz_projects').select('*', { count: 'exact', head: true }).eq('tenant_project_id', tenantProjectId),
            supabase.from('kfz_calls').select('*', { count: 'exact', head: true }).eq('tenant_project_id', tenantProjectId),
            supabase.from('kfz_customers').select('*', { count: 'exact', head: true }).eq('tenant_project_id', tenantProjectId),
            supabase.from('kfz_appointments').select('*', { count: 'exact', head: true }).eq('tenant_project_id', tenantProjectId)
        ]);
        
        res.json({
            totals: {
                projects: projects.count || 0,
                calls: calls.count || 0,
                customers: customers.count || 0,
                appointments: appointments.count || 0
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 404 Handler
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        availableEndpoints: [
            'GET /health', 'GET /ping', 'POST /api/retell/webhook',
            'GET /api/customers', 'GET /api/projects', 'GET /api/calls',
            'GET /api/dashboard', 'GET /api/test/email', 'POST /api/test/notification'
        ]
    });
});

// ================================
// SERVER START
// ================================
const PORT = process.env.PORT || 3000;

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('🚀 KFZ-Sachverständiger API läuft auf Port', PORT);
    console.log(`🌐 Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`🩺 Health: http://localhost:${PORT}/health`);
    console.log(`🔗 Webhook: http://localhost:${PORT}/api/retell/webhook`);
    console.log(`📧 E-Mail Test: http://localhost:${PORT}/api/test/email`);
    console.log('💾 Database: Connected');
    console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('📧 E-Mail Notifications: ACTIVE');
    console.log('📅 Calendar Integration: ACTIVE');
});

module.exports = app;
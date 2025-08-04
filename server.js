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
            version: '3.5.0-fixed',
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

// ENHANCED Main Webhook with Debug Logging
app.post('/api/retell/webhook', async (req, res) => {
    try {
        // Enhanced logging for debugging
        console.log('📞 Webhook received:', {
            headers: req.headers,
            body_keys: Object.keys(req.body),
            body: req.body
        });
        
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        // Check for different possible field names from Retell
        const actualTranscript = transcript || req.body.call_transcript || req.body.conversation || req.body.text || '';
        const actualCallId = call_id || req.body.callId || req.body.id || 'unknown';
        const actualDuration = duration_seconds || req.body.duration || req.body.call_duration || 0;
        const actualStatus = call_status || req.body.status || req.body.call_status || 'unknown';
        
        console.log('📞 Parsed webhook data:', { 
            call_id: actualCallId, 
            call_status: actualStatus, 
            transcript_length: actualTranscript?.length || 0,
            transcript_preview: actualTranscript?.substring(0, 100) || 'No transcript'
        });
        
        const tenantProjectId = await getTenantProjectId(supabase);
        if (!tenantProjectId) throw new Error('Tenant project not found');
        
        const extractedData = extractCustomerDataIntelligent(actualTranscript);
        
        if (extractedData && extractedData.name && extractedData.phone) {
            console.log('✅ Valid data extracted, creating customer and project...');
            
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
            const project = await createProject(customer, extractedData, tenantProjectId, supabase);
            
            await saveCallRecord(actualCallId, actualTranscript, actualDuration, customer.id, project.id, extractedData, tenantProjectId, supabase);
            
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                console.log('📅 Scheduling appointment...');
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            if (extractedData.type === 'CALLBACK') {
                console.log('📞 Handling callback request...');
                await handleCallbackRequest(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            console.log('🎉 Webhook processing successful');
            res.json({ 
                success: true, 
                message: 'Webhook processed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    confidence_score: extractedData.confidence_score
                }
            });
        } else {
            console.log('⚠️ No valid customer data extracted, logging for manual review...');
            
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: actualCallId,
                call_type: 'inbound',
                duration_seconds: actualDuration,
                transcript: actualTranscript,
                call_purpose: 'data_extraction_failed',
                call_outcome: 'requires_manual_review',
                extracted_data: extractedData || { error: 'No valid data extracted' }
            });
            
            res.json({ 
                success: true, 
                message: 'Call logged for manual review', 
                requires_manual_review: true,
                extracted_data: extractedData,
                reason: extractedData ? 'Missing required fields (name/phone)' : 'No data extracted'
            });
        }
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Request body:', req.body);
        
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id || req.body.callId || 'unknown',
            timestamp: new Date().toISOString(),
            debug_info: {
                body_keys: Object.keys(req.body),
                error_type: error.name,
                error_stack: error.stack
            }
        });
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
    console.log('🔧 DEBUG MODE: Enhanced logging active');
});

module.exports = app;
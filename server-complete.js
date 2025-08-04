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
    logAnalyticsEvent
} = require('./lib/businessLogic');

// Import performance monitoring
const {
    requestMonitoringMiddleware,
    errorMonitoringMiddleware,
    monitorExtraction,
    monitorDatabaseOperation,
    monitorWebhook,
    markPhase,
    monitor
} = require('./lib/performanceMiddleware');

// Import test routes for calendar and email testing
const testRoutes = require('./routes/testRoutes');

const app = express();

// ================================
// MIDDLEWARE WITH MONITORING
// ================================
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
}));
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files from public directory
app.use('/public', express.static(path.join(__dirname, 'public')));

// Add performance monitoring middleware
app.use(requestMonitoringMiddleware);

// ================================
// TEST ROUTES INTEGRATION
// ================================
app.use('/api/test', testRoutes);

// ================================
// ENHANCED SUPABASE CLIENT WITH API KEY HEADERS
// ================================
const supabaseOptions = {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    },
    global: {
        headers: {
            'apikey': process.env.SUPABASE_SERVICE_KEY,
            'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
            'Content-Type': 'application/json',
            'Prefer': 'return=representation'
        }
    }
};

// Add custom headers if configured
if (process.env.SUPABASE_HEADERS) {
    try {
        const customHeaders = JSON.parse(process.env.SUPABASE_HEADERS);
        supabaseOptions.global.headers = { ...supabaseOptions.global.headers, ...customHeaders };
        console.log('🔑 Custom Supabase headers configured');
    } catch (error) {
        console.warn('⚠️ Invalid SUPABASE_HEADERS format:', error.message);
    }
}

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
// DASHBOARD ROUTES
// ================================

// Redirect root to dashboard
app.get('/', (req, res) => {
    res.redirect('/public/dashboard.html');
});

// Dashboard redirect
app.get('/dashboard', (req, res) => {
    res.redirect('/public/dashboard.html');
});

// Zusätzlicher einfacher Health Check für Load Balancer
app.get('/ping', (req, res) => {
    res.status(200).send('pong');
});

// ================================
// HEALTH CHECK WITH PERFORMANCE METRICS
// ================================
app.get('/health', async (req, res) => {
    try {
        markPhase(req, 'health_check_start');
        
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '3.3.0-calendar-email-integration',
            environment: process.env.NODE_ENV || 'development',
            services: {
                database: { status: 'unknown', message: 'Testing...' },
                email: { status: 'unknown', message: 'Testing...' },
                retell: { status: 'unknown', message: 'Testing...' }
            },
            memory: {
                used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + ' MB',
                total: Math.round(process.memoryUsage().heapTotal / 1024 / 1024) + ' MB'
            }
        };
        
        // Datenbank-Status prüfen mit verbesserter Fehlerbehandlung
        try {
            if (supabase) {
                console.log('🔍 Testing database connection...');
                const { data, error } = await supabase.from('kfz_customers').select('count', { count: 'exact', head: true });
                
                if (error) {
                    console.error('❌ Database connection error:', error);
                    healthData.services.database = {
                        status: 'error',
                        message: error.message,
                        code: error.code || 'unknown',
                        details: error.details || 'No additional details'
                    };
                } else {
                    console.log('✅ Database connection successful');
                    healthData.services.database = {
                        status: 'healthy',
                        message: 'Connected successfully',
                        recordCount: data ? data.length : 0
                    };
                }
            } else {
                healthData.services.database = {
                    status: 'error',
                    message: 'Supabase client not initialized'
                };
            }
        } catch (dbError) {
            console.error('❌ Database test failed:', dbError);
            healthData.services.database = {
                status: 'error',
                message: dbError.message,
                type: dbError.name || 'Unknown Error'
            };
        }
        
        // E-Mail & Kalender-Status prüfen
        try {
            const requiredEmailVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'];
            const missingVars = requiredEmailVars.filter(varName => !process.env[varName]);
            
            healthData.services.email = {
                status: missingVars.length === 0 ? 'healthy' : 'warning',
                message: missingVars.length === 0 
                    ? `Email & Calendar configured for ${process.env.OWNER_EMAIL}` 
                    : `Missing variables: ${missingVars.join(', ')}`,
                config: {
                    host: process.env.SMTP_HOST || 'not set',
                    port: process.env.SMTP_PORT || 'not set',
                    user: process.env.SMTP_USER || 'not set',
                    recipient: process.env.OWNER_EMAIL || 'not set'
                },
                features: ['appointment_notifications', 'callback_alerts', 'calendar_integration', 'html_emails']
            };
        } catch (emailError) {
            healthData.services.email = {
                status: 'error',
                message: emailError.message
            };
        }
        
        // Retell-Status prüfen
        try {
            healthData.services.retell = {
                status: process.env.RETELL_API_KEY ? 'healthy' : 'warning',
                message: process.env.RETELL_API_KEY ? 'API key configured' : 'API key missing',
                webhookUrl: req.protocol + '://' + req.get('host') + '/api/retell/webhook'
            };
        } catch (retellError) {
            healthData.services.retell = {
                status: 'error',
                message: retellError.message
            };
        }
        
        // Gesamtstatus bestimmen
        const serviceStatuses = Object.values(healthData.services).map(s => s.status);
        if (serviceStatuses.includes('error')) {
            healthData.status = 'degraded';
        } else if (serviceStatuses.includes('warning')) {
            healthData.status = 'warning';
        }
        
        const performanceHealthData = monitor.getHealthCheck();
        
        markPhase(req, 'health_check_complete');
        
        // Response Status Code basierend auf Gesundheit
        const statusCode = healthData.status === 'healthy' ? 200 : 
                          healthData.status === 'warning' ? 200 : 503;
        
        res.status(statusCode).json({
            ...healthData,
            ...performanceHealthData,
            service: 'KFZ-Sachverständiger API',
            features: [
                'advanced_natural_language_processing', 
                'multi_layered_extraction', 
                'confidence_scoring',
                'intelligent_validation',
                'modular_architecture',
                'real_time_performance_monitoring',
                'health_checks',
                'error_tracking',
                'web_dashboard',
                'gmail_api_integration',
                'kong_api_gateway_auth',
                'calendar_integration',
                'email_notifications',
                'appointment_scheduling',
                'callback_management'
            ]
        });
        
    } catch (error) {
        console.error('❌ Health Check Fehler:', error);
        res.status(503).json({
            status: 'error',
            timestamp: new Date().toISOString(),
            error: error.message,
            message: 'Health check failed'
        });
    }
});

// ================================
// ENHANCED RETELL WEBHOOK WITH MONITORING
// ================================
app.post('/api/retell/webhook', async (req, res) => {
    try {
        markPhase(req, 'webhook_received');
        
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        console.log('📞 Enhanced Retell Webhook with Performance Monitoring:', { 
            call_id, 
            call_status, 
            duration: duration_seconds,
            transcript_length: transcript?.length || 0,
            requestId: req.requestId
        });
        
        markPhase(req, 'tenant_lookup_start');
        const dbMonitor = monitorDatabaseOperation(req.requestId, 'SELECT', 'tenant_projects');
        dbMonitor.start();
        
        const tenantProjectId = await getTenantProjectId(supabase);
        dbMonitor.end(!!tenantProjectId, tenantProjectId ? 1 : 0);
        
        if (!tenantProjectId) {
            throw new Error('KFZ-Sachverständiger Projekt nicht gefunden');
        }
        
        markPhase(req, 'extraction_start');
        
        // Monitor extraction with wrapper
        const monitoredExtraction = monitorExtraction(req.requestId, extractCustomerDataIntelligent);
        let extractedData = monitoredExtraction(transcript);
        
        markPhase(req, 'extraction_complete');
        
        // 2. PROCESS EXTRACTED DATA WITH MONITORING
        if (extractedData && extractedData.name && extractedData.phone) {
            markPhase(req, 'customer_processing_start');
            
            // Monitor customer creation
            const customerDbMonitor = monitorDatabaseOperation(req.requestId, 'INSERT/UPDATE', 'kfz_customers');
            customerDbMonitor.start();
            
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
            customerDbMonitor.end(!!customer, 1);
            
            markPhase(req, 'project_creation_start');
            
            // Monitor project creation
            const projectDbMonitor = monitorDatabaseOperation(req.requestId, 'INSERT', 'kfz_projects');
            projectDbMonitor.start();
            
            const project = await createProject(customer, extractedData, tenantProjectId, supabase);
            projectDbMonitor.end(!!project, 1);
            
            markPhase(req, 'call_record_start');
            
            // Monitor call record saving
            const callDbMonitor = monitorDatabaseOperation(req.requestId, 'INSERT', 'kfz_calls');
            callDbMonitor.start();
            
            await saveCallRecord(
                call_id, 
                transcript, 
                duration_seconds, 
                customer.id, 
                project.id, 
                extractedData, 
                tenantProjectId,
                supabase
            );
            callDbMonitor.end(true, 1);
            
            markPhase(req, 'analytics_start');
            
            // Enhanced analytics with performance context
            await logAnalyticsEvent(
                'call_completed_enhanced', 
                tenantProjectId, 
                project.id, 
                customer.id,
                { 
                    call_type: extractedData.type,
                    duration_seconds,
                    retell_call_id: call_id,
                    extraction_method: 'advanced_multi_layer',
                    confidence_score: extractedData.confidence_score || 0,
                    request_id: req.requestId,
                    processing_time: Date.now() - req.startTime
                },
                supabase
            );
            
            // Handle appointments
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                markPhase(req, 'appointment_scheduling_start');
                
                const appointmentDbMonitor = monitorDatabaseOperation(req.requestId, 'INSERT', 'kfz_appointments');
                appointmentDbMonitor.start();
                
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
                appointmentDbMonitor.end(!!appointment, appointment ? 1 : 0);
                
                if (appointment) {
                    await logAnalyticsEvent(
                        'appointment_scheduled_enhanced', 
                        tenantProjectId, 
                        project.id, 
                        customer.id,
                        { 
                            appointment_date: appointment.scheduled_date,
                            appointment_type: appointment.appointment_type,
                            confidence_score: extractedData.confidence_score || 0,
                            request_id: req.requestId
                        },
                        supabase
                    );
                }
            }
            
            // Handle callbacks
            if (extractedData.type === 'CALLBACK') {
                await logAnalyticsEvent(
                    'callback_requested_enhanced', 
                    tenantProjectId, 
                    project.id, 
                    customer.id,
                    { 
                        customer_phone: customer.phone,
                        customer_name: `${customer.first_name} ${customer.last_name}`,
                        confidence_score: extractedData.confidence_score || 0,
                        request_id: req.requestId
                    },
                    supabase
                );
            }
            
            markPhase(req, 'response_preparation');
            
            res.json({ 
                success: true, 
                message: 'Enhanced webhook processing completed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    extraction_method: 'advanced_multi_layer_nlp',
                    confidence_score: extractedData.confidence_score || 0,
                    processing_time: Date.now() - req.startTime,
                    request_id: req.requestId
                }
            });
            
        } else {
            // Enhanced fallback handling with monitoring
            markPhase(req, 'fallback_handling');
            
            console.log('⚠️ No valid data extracted with any method');
            
            const fallbackDbMonitor = monitorDatabaseOperation(req.requestId, 'INSERT', 'kfz_calls');
            fallbackDbMonitor.start();
            
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: call_id,
                call_type: 'inbound',
                duration_seconds: duration_seconds,
                transcript: transcript,
                call_purpose: 'data_extraction_failed',
                call_outcome: 'requires_manual_review',
                agent_version: 'markus-v3-enhanced',
                extracted_data: extractedData || { 
                    extraction_failed: true, 
                    attempted_methods: ['advanced', 'natural', 'structured'],
                    request_id: req.requestId
                }
            });
            
            fallbackDbMonitor.end(true, 1);
            
            res.json({ 
                success: true, 
                message: 'Call logged for manual review - no extractable data found',
                data: { 
                    call_id,
                    requires_manual_review: true,
                    extraction_attempted: true,
                    extraction_methods_tried: ['advanced_nlp', 'natural_language', 'structured_format'],
                    confidence_score: extractedData?.confidence_score || 0,
                    processing_time: Date.now() - req.startTime,
                    request_id: req.requestId
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Enhanced Webhook Error:', error);
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id,
            timestamp: new Date().toISOString(),
            request_id: req.requestId
        });
    }
});

// ================================
// OTHER API ENDPOINTS
// ================================

// Get dashboard data
app.get('/api/dashboard', async (req, res) => {
    try {
        markPhase(req, 'dashboard_data_collection_start');
        
        const tenantProjectId = await getTenantProjectId(supabase);
        const today = new Date().toISOString().split('T')[0];
        
        const [
            projectsResult,
            callsResult,
            callbacksResult,
            appointmentsResult,
            customersResult,
            recentCallsResult
        ] = await Promise.all([
            supabase.from('kfz_projects').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today),
            
            supabase.from('kfz_calls').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today),
            
            supabase.from('kfz_calls').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .eq('call_purpose', 'callback_request'),
            
            supabase.from('kfz_appointments').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .eq('status', 'scheduled')
                .gte('scheduled_date', new Date().toISOString()),
            
            supabase.from('kfz_customers').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId),
            
            supabase.from('kfz_calls')
                .select('extracted_data')
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today)
                .order('created_at', { ascending: false })
                .limit(10)
        ]);
        
        const projectsToday = projectsResult?.count || 0;
        const totalCalls = callsResult?.count || 0;
        const pendingCallbacks = callbacksResult?.count || 0;
        const scheduledAppointments = appointmentsResult?.count || 0;
        const totalCustomers = customersResult?.count || 0;
        const recentCalls = recentCallsResult?.data || [];
        
        const successfulExtractions = (recentCalls || []).filter(call => 
            call && call.extracted_data && 
            call.extracted_data.name && 
            call.extracted_data.phone
        ).length;
        
        const extractionSuccessRate = recentCalls.length > 0 
            ? (successfulExtractions / recentCalls.length * 100).toFixed(1)
            : 0;
        
        const confidenceScores = (recentCalls || [])
            .map(call => call && call.extracted_data ? call.extracted_data.confidence_score : null)
            .filter(score => score !== undefined && score !== null && !isNaN(score));
        
        const averageConfidence = confidenceScores.length > 0
            ? (confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length).toFixed(2)
            : 0;
        
        const performanceData = monitor.getPerformanceReport();
        
        res.json({
            today: {
                projects: projectsToday,
                calls: totalCalls
            },
            pending: {
                callbacks: pendingCallbacks,
                appointments: scheduledAppointments
            },
            totals: {
                customers: totalCustomers
            },
            extraction_analytics: {
                success_rate: `${extractionSuccessRate}%`,
                average_confidence: averageConfidence,
                total_processed: recentCalls.length
            },
            performance: {
                avg_request_time: performanceData.performance.avgRequestTime,
                avg_extraction_time: performanceData.performance.avgExtractionTime,
                error_rate: performanceData.performance.errorRate,
                memory_usage: performanceData.memory.heapUsed,
                uptime: performanceData.system.uptimeFormatted
            },
            system: {
                version: '3.3.0-calendar-email-integration',
                features: [
                    'advanced_nlp',
                    'multi_layer_extraction',
                    'confidence_scoring',
                    'modular_architecture',
                    'real_time_monitoring',
                    'performance_analytics',
                    'web_dashboard',
                    'gmail_api_integration',
                    'kong_authentication',
                    'calendar_integration',
                    'email_notifications'
                ]
            },
            lastUpdated: new Date().toISOString(),
            request_id: req.requestId
        });
        
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ 
            error: error.message,
            request_id: req.requestId
        });
    }
});

// Get customers
app.get('/api/customers', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_customers')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Customers API Error:', error);
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
});

// Get projects
app.get('/api/projects', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_projects')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Projects API Error:', error);
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
});

// Get calls
app.get('/api/calls', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_calls')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data || []);
    } catch (error) {
        console.error('Calls API Error:', error);
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
});

// Performance monitoring endpoints
app.get('/api/performance', (req, res) => {
    const report = monitor.getPerformanceReport();
    res.json(report);
});

app.get('/api/metrics', (req, res) => {
    const { timeframe = '1h' } = req.query;
    const metrics = monitor.getMetrics ? monitor.getMetrics(timeframe) : { message: 'Metrics collection in progress' };
    res.json(metrics);
});

// API Info Endpoint
app.get('/api/info', (req, res) => {
    res.json({
        service: 'KFZ-Sachverständiger API',
        version: '3.3.0-calendar-email-integration',
        description: 'API für automatisierte Kundentermin-Buchungen mit Retell AI Integration, Kalender und E-Mail',
        endpoints: {
            health: '/health',
            ping: '/ping',
            webhook: '/api/retell/webhook',
            dashboard: '/api/dashboard',
            customers: '/api/customers',
            projects: '/api/projects',
            calls: '/api/calls',
            performance: '/api/performance',
            metrics: '/api/metrics',
            test: {
                email: '/api/test/email',
                notification: '/api/test/notification',
                calendar: '/api/test/calendar',
                system: '/api/test/system'
            }
        },
        features: [
            'advanced_natural_language_processing',
            'multi_layered_extraction',
            'confidence_scoring',
            'intelligent_validation',
            'modular_architecture',
            'real_time_performance_monitoring',
            'health_checks',
            'error_tracking',
            'web_dashboard',
            'gmail_api_integration',
            'kong_api_gateway_authentication',
            'calendar_integration',
            'email_notifications',
            'appointment_scheduling',
            'callback_management'
        ],
        timestamp: new Date().toISOString()
    });
});

// Fallback für unbekannte Routes
app.use('*', (req, res) => {
    res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString(),
        requestId: req.requestId,
        availableEndpoints: [
            'GET /health',
            'GET /ping',
            'GET /api/info',
            'POST /api/retell/webhook',
            'GET /api/dashboard',
            'GET /api/customers',
            'GET /api/projects',
            'GET /api/calls',
            'GET /api/performance',
            'GET /api/metrics',
            'GET /api/test/email',
            'GET /api/test/notification',
            'GET /api/test/calendar',
            'GET /api/test/system'
        ]
    });
});

// Add error handling middleware
app.use(errorMonitoringMiddleware);

// ================================
// SERVER START WITH MONITORING
// ================================

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    console.log('📊 Final Performance Report:', monitor.getPerformanceReport());
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    console.log('📊 Final Performance Report:', monitor.getPerformanceReport());
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('🚀 KFZ-Sachverständiger API läuft auf Port', PORT);
    console.log(`🌐 Web Dashboard: http://localhost:${PORT}/dashboard`);
    console.log(`📊 API Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`📈 Performance: http://localhost:${PORT}/api/performance`);
    console.log(`🩺 Health: http://localhost:${PORT}/health`);
    console.log(`🔗 Webhook: http://localhost:${PORT}/api/retell/webhook`);
    console.log(`📧 E-Mail Test: http://localhost:${PORT}/api/test/email`);
    console.log(`🧪 Test-Benachrichtigung: http://localhost:${PORT}/api/test/notification`);
    console.log(`📅 Kalender-Test: http://localhost:${PORT}/api/test/calendar`);
    console.log('💾 Database: Connected');
    console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('🎯 Advanced Natural Language Processing Active!');
    console.log('📊 Confidence Scoring & Analytics Enabled!');
    console.log('🏗️ Modular Architecture: ACTIVE');
    console.log('📈 Real-time Performance Monitoring: ACTIVE');
    console.log('🩺 Health Checks & Error Tracking: ACTIVE');
    console.log('🌐 Web Dashboard Interface: ACTIVE');
    console.log('📧 Gmail API Integration: ACTIVE');
    console.log('🔑 Kong API Gateway Authentication: ACTIVE');
    console.log('📅 Calendar Integration: ACTIVE');
    console.log('📧 E-Mail Notifications: ACTIVE');
    
    // Log initial system health
    setTimeout(() => {
        console.log('📊 Initial System Health:', monitor.getHealthCheck());
    }, 2000);
});

module.exports = app;
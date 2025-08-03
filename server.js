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

// Supabase Client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

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

// ================================
// HEALTH CHECK WITH PERFORMANCE METRICS
// ================================
app.get('/health', (req, res) => {
    markPhase(req, 'health_check_start');
    
    const healthData = monitor.getHealthCheck();
    
    markPhase(req, 'health_check_complete');
    
    res.json({
        ...healthData,
        service: 'KFZ-Sachverständiger API',
        version: '3.2.0-performance-monitored',
        features: [
            'advanced_natural_language_processing', 
            'multi_layered_extraction', 
            'confidence_scoring',
            'intelligent_validation',
            'modular_architecture',
            'real_time_performance_monitoring',
            'health_checks',
            'error_tracking',
            'web_dashboard'
        ]
    });
});

// ================================
// PERFORMANCE MONITORING ENDPOINTS
// ================================

// Real-time performance dashboard
app.get('/api/performance', (req, res) => {
    markPhase(req, 'performance_report_start');
    
    const report = monitor.getPerformanceReport();
    
    markPhase(req, 'performance_report_complete');
    
    res.json(report);
});

// Performance metrics API
app.get('/api/metrics', (req, res) => {
    markPhase(req, 'metrics_start');
    
    const { timeframe = '1h' } = req.query;
    const metrics = monitor.getMetrics ? monitor.getMetrics(timeframe) : { message: 'Metrics collection in progress' };
    
    markPhase(req, 'metrics_complete');
    
    res.json(metrics);
});

// System health endpoint
app.get('/api/health/detailed', (req, res) => {
    markPhase(req, 'detailed_health_start');
    
    const detailedHealth = {
        ...monitor.getHealthCheck(),
        system_info: {
            node_version: process.version,
            platform: process.platform,
            arch: process.arch,
            uptime: process.uptime(),
            memory: process.memoryUsage(),
            cpu: process.cpuUsage()
        },
        environment: {
            node_env: process.env.NODE_ENV,
            port: process.env.PORT,
            has_supabase_url: !!process.env.SUPABASE_URL,
            has_supabase_key: !!process.env.SUPABASE_SERVICE_KEY,
            has_retell_key: !!process.env.RETELL_API_KEY
        }
    };
    
    markPhase(req, 'detailed_health_complete');
    
    res.json(detailedHealth);
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
// ENHANCED DASHBOARD API WITH MONITORING
// ================================
app.get('/api/dashboard', async (req, res) => {
    try {
        markPhase(req, 'dashboard_data_collection_start');
        
        const tenantProjectId = await getTenantProjectId(supabase);
        const today = new Date().toISOString().split('T')[0];
        
        markPhase(req, 'dashboard_queries_start');
        
        const [
            { count: projectsToday },
            { count: totalCalls },
            { count: pendingCallbacks },
            { count: scheduledAppointments },
            { count: totalCustomers },
            { data: recentCalls }
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
        
        markPhase(req, 'dashboard_calculations_start');
        
        // Calculate extraction success rate
        const successfulExtractions = recentCalls.filter(call => 
            call.extracted_data && 
            call.extracted_data.name && 
            call.extracted_data.phone
        ).length;
        
        const extractionSuccessRate = recentCalls.length > 0 
            ? (successfulExtractions / recentCalls.length * 100).toFixed(1)
            : 0;
        
        // Calculate average confidence score
        const confidenceScores = recentCalls
            .map(call => call.extracted_data?.confidence_score)
            .filter(score => score !== undefined && score !== null);
        
        const averageConfidence = confidenceScores.length > 0
            ? (confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length).toFixed(2)
            : 0;
        
        // Get performance data
        const performanceData = monitor.getPerformanceReport();
        
        markPhase(req, 'dashboard_response_preparation');
        
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
                version: '3.2.0-performance-monitored',
                features: [
                    'advanced_nlp',
                    'multi_layer_extraction',
                    'confidence_scoring',
                    'modular_architecture',
                    'real_time_monitoring',
                    'performance_analytics',
                    'web_dashboard'
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

// ================================
// OTHER MONITORED ENDPOINTS
// ================================

// Get customers with monitoring
app.get('/api/customers', async (req, res) => {
    try {
        markPhase(req, 'customers_query_start');
        
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_customers')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        markPhase(req, 'customers_query_complete');
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
});

// Get projects with monitoring  
app.get('/api/projects', async (req, res) => {
    try {
        markPhase(req, 'projects_query_start');
        
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_projects')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        markPhase(req, 'projects_query_complete');
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
});

// Get calls with monitoring
app.get('/api/calls', async (req, res) => {
    try {
        markPhase(req, 'calls_query_start');
        
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase
            .from('kfz_calls')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        markPhase(req, 'calls_query_complete');
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message, request_id: req.requestId });
    }
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
    console.log('💾 Database: Connected');
    console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('🎯 Advanced Natural Language Processing Active!');
    console.log('📊 Confidence Scoring & Analytics Enabled!');
    console.log('🏗️ Modular Architecture: ACTIVE');
    console.log('📈 Real-time Performance Monitoring: ACTIVE');
    console.log('🩺 Health Checks & Error Tracking: ACTIVE');
    console.log('🌐 Web Dashboard Interface: ACTIVE');
    
    // Log initial system health
    setTimeout(() => {
        console.log('📊 Initial System Health:', monitor.getHealthCheck());
    }, 2000);
});

module.exports = app;

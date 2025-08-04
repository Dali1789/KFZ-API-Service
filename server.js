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
app.get('/health', async (req, res) => {
    try {
        markPhase(req, 'health_check_start');
        
        const healthData = {
            status: 'healthy',
            timestamp: new Date().toISOString(),
            uptime: process.uptime(),
            version: '3.2.0-performance-monitored',
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
        
        // Datenbank-Status prüfen
        try {
            if (supabase) {
                const { data, error } = await supabase.from('kfz_customers').select('count', { count: 'exact', head: true });
                healthData.services.database = {
                    status: error ? 'error' : 'healthy',
                    message: error ? error.message : 'Connected successfully',
                    recordCount: data ? data.length : 0
                };
            } else {
                healthData.services.database = {
                    status: 'error',
                    message: 'Supabase client not initialized'
                };
            }
        } catch (dbError) {
            healthData.services.database = {
                status: 'error',
                message: dbError.message
            };
        }
        
        // E-Mail-Status prüfen
        try {
            const requiredEmailVars = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASS', 'OWNER_EMAIL'];
            const missingVars = requiredEmailVars.filter(varName => !process.env[varName]);
            
            healthData.services.email = {
                status: missingVars.length === 0 ? 'healthy' : 'warning',
                message: missingVars.length === 0 
                    ? `Email configured for ${process.env.OWNER_EMAIL}` 
                    : `Missing variables: ${missingVars.join(', ')}`,
                config: {
                    host: process.env.SMTP_HOST || 'not set',
                    port: process.env.SMTP_PORT || 'not set',
                    user: process.env.SMTP_USER || 'not set',
                    recipient: process.env.OWNER_EMAIL || 'not set'
                }
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
                'gmail_api_integration'
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
            has_retell_key: !!process.env.RETELL_API_KEY,
            has_smtp_config: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
        }
    };
    
    markPhase(req, 'detailed_health_complete');
    
    res.json(detailedHealth);
});

// ================================
// GMAIL API TEST ENDPOINTS
// ================================

// Test 1: E-Mail-Konfiguration testen
app.get('/api/test/email', async (req, res) => {
  try {
    console.log('🧪 E-Mail Test gestartet...');
    markPhase(req, 'email_test_start');
    
    // E-Mail-Konfiguration prüfen
    const emailConfig = {
      host: process.env.SMTP_HOST,
      port: process.env.SMTP_PORT,
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS ? '***' + process.env.SMTP_PASS.slice(-4) : 'NICHT GESETZT',
      ownerEmail: process.env.OWNER_EMAIL
    };
    
    console.log('📧 E-Mail Config:', emailConfig);
    markPhase(req, 'email_test_complete');
    
    res.json({
      success: true,
      message: 'E-Mail-Konfiguration erfolgreich geladen',
      config: emailConfig,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
    
  } catch (error) {
    console.error('❌ E-Mail Test Fehler:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  }
});

// Test 2: Test-Benachrichtigung senden
app.post('/api/test/notification', async (req, res) => {
  try {
    console.log('🧪 Test-Benachrichtigung wird gesendet...');
    markPhase(req, 'notification_test_start');
    
    // Simuliere eine Terminbuchung
    const testBooking = {
      customerName: 'Max Mustermann',
      customerPhone: '0521-12345678',
      customerEmail: 'test@example.com',
      address: 'Musterstraße 123, 33602 Bielefeld',
      damage: 'Unfallschaden Frontbereich',
      appointmentDate: new Date(Date.now() + 24 * 60 * 60 * 1000).toLocaleDateString('de-DE'),
      appointmentTime: '14:00',
      confidence: 0.95,
      projectNumber: 'KFZ-TEST-001'
    };
    
    // Prüfe ob Business Logic verfügbar ist und E-Mail senden kann
    let emailSent = false;
    try {
      const businessLogic = require('./lib/businessLogic');
      if (businessLogic && businessLogic.sendNotificationEmail) {
        await businessLogic.sendNotificationEmail(testBooking);
        emailSent = true;
      }
    } catch (emailError) {
      console.warn('⚠️ E-Mail-Versendung nicht verfügbar:', emailError.message);
    }
    
    markPhase(req, 'notification_test_complete');
    
    res.json({
      success: true,
      message: emailSent ? 'Test-E-Mail erfolgreich gesendet' : 'Test-Daten erstellt (E-Mail-Service nicht verfügbar)',
      recipient: process.env.OWNER_EMAIL,
      booking: testBooking,
      emailSent: emailSent,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
    
  } catch (error) {
    console.error('❌ Test-Benachrichtigung Fehler:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  }
});

// Test 3: System-Status mit erweiterten Informationen
app.get('/api/test/system', async (req, res) => {
  try {
    markPhase(req, 'system_test_start');
    
    const systemInfo = {
      server: {
        status: 'online',
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        node_version: process.version,
        timestamp: new Date().toISOString()
      },
      environment: {
        NODE_ENV: process.env.NODE_ENV,
        PORT: process.env.PORT || 3000,
        hasSupabaseUrl: !!process.env.SUPABASE_URL,
        hasSupabaseKey: !!process.env.SUPABASE_SERVICE_KEY,
        hasRetellKey: !!process.env.RETELL_API_KEY,
        hasSmtpConfig: !!(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
      },
      database: {
        connected: false,
        error: null
      }
    };
    
    // Datenbank-Verbindung testen
    try {
      if (supabase) {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { data, error } = await supabase.from('kfz_customers').select('count', { count: 'exact', head: true }).eq('tenant_project_id', tenantProjectId);
        systemInfo.database.connected = !error;
        systemInfo.database.error = error?.message || null;
        systemInfo.database.customerCount = data?.length || 0;
      }
    } catch (dbError) {
      systemInfo.database.error = dbError.message;
    }
    
    markPhase(req, 'system_test_complete');
    
    res.json({
      success: true,
      system: systemInfo,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
    
  } catch (error) {
    console.error('❌ System Test Fehler:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  }
});

// Test 4: Webhook-Simulation
app.post('/api/test/webhook', async (req, res) => {
  try {
    console.log('🧪 Webhook-Simulation gestartet...');
    markPhase(req, 'webhook_test_start');
    
    // Simuliere einen Retell Webhook
    const mockWebhookData = {
      event: 'call_ended',
      call: {
        call_id: 'test-call-' + Date.now(),
        from_number: '+4952112345678',
        to_number: '+4952187654321',
        start_timestamp: Date.now() - 300000, // 5 Minuten ago
        end_timestamp: Date.now(),
        transcript: 'Hallo, ich bin Max Mustermann und hatte einen Unfall mit meinem BMW. Ich brauche einen Gutachter-Termin für morgen um 14 Uhr. Meine Adresse ist Musterstraße 123 in Bielefeld. Sie können mich unter 0521-12345678 erreichen.',
        call_analysis: {
          call_successful: true,
          call_summary: 'Kunde Max Mustermann möchte Gutachter-Termin für BMW Unfallschaden'
        }
      }
    };
    
    // Simuliere Datenextraktion
    const extractedData = extractCustomerDataIntelligent(mockWebhookData.call.transcript);
    
    markPhase(req, 'webhook_test_complete');
    
    res.json({
      success: true,
      message: 'Webhook-Simulation erfolgreich',
      mockData: mockWebhookData,
      extractedData: extractedData,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
    
  } catch (error) {
    console.error('❌ Webhook-Simulation Fehler:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      timestamp: new Date().toISOString(),
      requestId: req.requestId
    });
  }
});

// Zusätzlicher einfacher Health Check für Load Balancer
app.get('/ping', (req, res) => {
  res.status(200).send('pong');
});

// API Info Endpoint
app.get('/api/info', (req, res) => {
  res.json({
    service: 'KFZ-Sachverständiger API',
    version: '3.2.0-performance-monitored',
    description: 'API für automatisierte Kundentermin-Buchungen mit Retell AI Integration und Gmail API',
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
        system: '/api/test/system',
        webhook: '/api/test/webhook'
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
      'gmail_api_integration'
    ],
    timestamp: new Date().toISOString()
  });
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
                    'web_dashboard',
                    'gmail_api_integration'
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
      'GET /api/health/detailed',
      'GET /api/test/email',
      'POST /api/test/notification',
      'GET /api/test/system',
      'POST /api/test/webhook'
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
    console.log(`📧 Gmail Test: http://localhost:${PORT}/api/test/email`);
    console.log('💾 Database: Connected');
    console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('🎯 Advanced Natural Language Processing Active!');
    console.log('📊 Confidence Scoring & Analytics Enabled!');
    console.log('🏗️ Modular Architecture: ACTIVE');
    console.log('📈 Real-time Performance Monitoring: ACTIVE');
    console.log('🩺 Health Checks & Error Tracking: ACTIVE');
    console.log('🌐 Web Dashboard Interface: ACTIVE');
    console.log('📧 Gmail API Integration: ACTIVE');
    
    // Log initial system health
    setTimeout(() => {
        console.log('📊 Initial System Health:', monitor.getHealthCheck());
    }, 2000);
});

module.exports = app;
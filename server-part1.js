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

// Import test routes
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
            version: '3.3.0-calendar-notifications',
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
                features: ['appointment_notifications', 'callback_alerts', 'calendar_integration']
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
                'email_notifications'
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

// Weitere Endpoints bleiben unverändert...
// [Der Rest der server.js bleibt gleich - zu lang für einen einzelnen Request]

module.exports = app;

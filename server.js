const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
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

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Supabase Client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ================================
// HEALTH CHECK
// ================================
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'KFZ-Sachverständiger API',
        version: '3.1.0-modular',
        features: [
            'advanced_natural_language_processing', 
            'multi_layered_extraction', 
            'confidence_scoring',
            'intelligent_validation',
            'modular_architecture'
        ],
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ================================
// ENHANCED RETELL WEBHOOK - MAIN ENDPOINT
// ================================
app.post('/api/retell/webhook', async (req, res) => {
    try {
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        console.log('📞 Enhanced Retell Webhook:', { 
            call_id, 
            call_status, 
            duration: duration_seconds,
            transcript_length: transcript?.length || 0
        });
        
        const tenantProjectId = await getTenantProjectId(supabase);
        if (!tenantProjectId) {
            throw new Error('KFZ-Sachverständiger Projekt nicht gefunden');
        }
        
        // 1. INTELLIGENT EXTRACTION
        let extractedData = extractCustomerDataIntelligent(transcript);
        
        // 2. PROCESS EXTRACTED DATA
        if (extractedData && extractedData.name && extractedData.phone) {
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
            const project = await createProject(customer, extractedData, tenantProjectId, supabase);
            
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
            
            // Enhanced analytics
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
                    confidence_score: extractedData.confidence_score || 0
                },
                supabase
            );
            
            // Handle appointments
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
                
                if (appointment) {
                    await logAnalyticsEvent(
                        'appointment_scheduled_enhanced', 
                        tenantProjectId, 
                        project.id, 
                        customer.id,
                        { 
                            appointment_date: appointment.scheduled_date,
                            appointment_type: appointment.appointment_type,
                            confidence_score: extractedData.confidence_score || 0
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
                        confidence_score: extractedData.confidence_score || 0
                    },
                    supabase
                );
            }
            
            res.json({ 
                success: true, 
                message: 'Enhanced webhook processing completed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    extraction_method: 'advanced_multi_layer_nlp',
                    confidence_score: extractedData.confidence_score || 0
                }
            });
            
        } else {
            // Enhanced fallback handling
            console.log('⚠️ No valid data extracted with any method');
            
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
                    attempted_methods: ['advanced', 'natural', 'structured'] 
                }
            });
            
            res.json({ 
                success: true, 
                message: 'Call logged for manual review - no extractable data found',
                data: { 
                    call_id,
                    requires_manual_review: true,
                    extraction_attempted: true,
                    extraction_methods_tried: ['advanced_nlp', 'natural_language', 'structured_format'],
                    confidence_score: extractedData?.confidence_score || 0
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Enhanced Webhook Error:', error);
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id,
            timestamp: new Date().toISOString()
        });
    }
});

// ================================
// ENHANCED DASHBOARD API
// ================================
app.get('/api/dashboard', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const today = new Date().toISOString().split('T')[0];
        
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
            system: {
                version: '3.1.0-modular',
                features: [
                    'advanced_nlp',
                    'multi_layer_extraction',
                    'confidence_scoring',
                    'modular_architecture'
                ]
            },
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================
// EXTRACTION ANALYTICS API
// ================================
app.get('/api/extraction/analytics', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId(supabase);
        const { days = 7 } = req.query;
        
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - parseInt(days));
        
        const { data: calls } = await supabase
            .from('kfz_calls')
            .select('extracted_data, created_at')
            .eq('tenant_project_id', tenantProjectId)
            .gte('created_at', sinceDate.toISOString());
        
        const analytics = {
            total_calls: calls.length,
            successful_extractions: 0,
            method_breakdown: {
                advanced_nlp: 0,
                natural_language: 0,
                structured_format: 0,
                failed: 0
            },
            confidence_distribution: {
                high: 0, // > 0.8
                medium: 0, // 0.5 - 0.8
                low: 0, // < 0.5
                unknown: 0
            },
            field_success_rates: {
                name: 0,
                phone: 0,
                address: 0,
                appointment: 0
            }
        };
        
        calls.forEach(call => {
            const data = call.extracted_data;
            
            if (data && data.name && data.phone) {
                analytics.successful_extractions++;
                
                const method = data.extraction_details?.method || 'unknown';
                if (analytics.method_breakdown[method] !== undefined) {
                    analytics.method_breakdown[method]++;
                }
                
                const confidence = data.confidence_score || 0;
                if (confidence > 0.8) {
                    analytics.confidence_distribution.high++;
                } else if (confidence >= 0.5) {
                    analytics.confidence_distribution.medium++;
                } else if (confidence > 0) {
                    analytics.confidence_distribution.low++;
                } else {
                    analytics.confidence_distribution.unknown++;
                }
                
                if (data.name) analytics.field_success_rates.name++;
                if (data.phone) analytics.field_success_rates.phone++;
                if (data.address) analytics.field_success_rates.address++;
                if (data.appointment) analytics.field_success_rates.appointment++;
            } else {
                analytics.method_breakdown.failed++;
            }
        });
        
        if (analytics.total_calls > 0) {
            analytics.success_rate = (analytics.successful_extractions / analytics.total_calls * 100).toFixed(1);
            
            Object.keys(analytics.field_success_rates).forEach(field => {
                analytics.field_success_rates[field] = 
                    (analytics.field_success_rates[field] / analytics.total_calls * 100).toFixed(1);
            });
        }
        
        res.json(analytics);
        
    } catch (error) {
        console.error('Extraction Analytics Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================
// BASIC CRUD APIs
// ================================

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
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
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
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================
// SERVER START
// ================================

const PORT = process.env.PORT || 3000;

// Graceful shutdown
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
    console.log(`📊 Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`🔗 Webhook: http://localhost:${PORT}/api/retell/webhook`);
    console.log('💾 Database: Connected');
    console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('🎯 Advanced Natural Language Processing Active!');
    console.log('📊 Confidence Scoring & Analytics Enabled!');
    console.log('🏗️ Modular Architecture: ACTIVE');
});

module.exports = app;

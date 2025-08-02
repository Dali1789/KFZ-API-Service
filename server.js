const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

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
// HELPER FUNCTIONS
// ================================

async function getTenantProjectId() {
    const { data } = await supabase
        .from('tenant_projects')
        .select('id')
        .eq('project_name', 'kfz-sachverstaendiger')
        .single();
    return data?.id;
}

async function generateProjectNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_projects')
        .select('*', { count: 'exact', head: true })
        .like('project_number', `P-${year}-%`);
    
    return `P-${year}-${(count + 1).toString().padStart(3, '0')}`;
}

async function generateCustomerNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_customers')
        .select('*', { count: 'exact', head: true })
        .like('customer_number', `K-${year}-%`);
    
    return `K-${year}-${(count + 1).toString().padStart(3, '0')}`;
}

function extractCustomerData(transcript) {
    // Suche nach der DATENERFASSUNG-Zeile
    const dataMatch = transcript.match(/DATENERFASSUNG:\s*(.+)/i);
    if (!dataMatch) return null;
    
    const dataString = dataMatch[1];
    const extractedData = {};
    
    // Parse Name=[Wert], Telefon=[Wert], etc.
    const patterns = {
        name: /Name=\[([^\]]+)\]/i,
        phone: /Telefon=\[([^\]]+)\]/i,
        address: /Adresse=\[([^\]]+)\]/i,
        appointment: /Termin=\[([^\]]+)\]/i,
        type: /Typ=([A-Z]+)/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
        const match = dataString.match(pattern);
        if (match) {
            extractedData[key] = match[1].trim();
        }
    }
    
    return Object.keys(extractedData).length > 0 ? extractedData : null;
}

function parseNameParts(fullName) {
    if (!fullName) return { first_name: '', last_name: '' };
    
    const parts = fullName.trim().split(' ');
    const first_name = parts[0] || '';
    const last_name = parts.slice(1).join(' ') || '';
    
    return { first_name, last_name };
}

function extractAddressParts(address) {
    if (!address) return { street: null, city: 'Bielefeld' };
    
    // Einfache Adress-Parsing (kann später verbessert werden)
    const parts = address.split(',').map(p => p.trim());
    
    return {
        street: parts[0] || null,
        city: parts[parts.length - 1] || 'Bielefeld',
        postal_code: null // Kann später mit Regex extrahiert werden
    };
}

function parseAppointmentDate(appointmentString) {
    // Einfaches Parsing - kann später mit moment.js verbessert werden
    const today = new Date();
    
    if (appointmentString.toLowerCase().includes('morgen')) {
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        tomorrow.setHours(10, 0, 0, 0); // Default 10:00
        return tomorrow.toISOString();
    }
    
    if (appointmentString.toLowerCase().includes('heute')) {
        const todayDate = new Date(today);
        todayDate.setHours(14, 0, 0, 0); // Default 14:00
        return todayDate.toISOString();
    }
    
    // Fallback: Morgen 10:00
    const tomorrow = new Date(today);
    tomorrow.setDate(today.getDate() + 1);
    tomorrow.setHours(10, 0, 0, 0);
    return tomorrow.toISOString();
}

// ================================
// MAIN BUSINESS LOGIC
// ================================

async function createOrUpdateCustomer(data, tenantProjectId) {
    const { first_name, last_name } = parseNameParts(data.name);
    const { street, city, postal_code } = extractAddressParts(data.address);
    
    // Kunde anhand Telefonnummer suchen
    let { data: existingCustomer } = await supabase
        .from('kfz_customers')
        .select('*')
        .eq('phone', data.phone)
        .eq('tenant_project_id', tenantProjectId)
        .single();
    
    if (existingCustomer) {
        console.log('👤 Bestehender Kunde gefunden:', existingCustomer.customer_number);
        
        // Adresse aktualisieren falls neue Daten vorhanden
        if (data.address && !existingCustomer.street) {
            await supabase
                .from('kfz_customers')
                .update({ street, city, postal_code })
                .eq('id', existingCustomer.id);
        }
        
        return existingCustomer;
    }
    
    // Neuen Kunden erstellen
    const customerNumber = await generateCustomerNumber();
    
    const { data: newCustomer, error } = await supabase
        .from('kfz_customers')
        .insert({
            tenant_project_id: tenantProjectId,
            customer_number: customerNumber,
            first_name,
            last_name,
            phone: data.phone,
            street,
            city,
            postal_code,
            source: 'retell_call',
            status: 'active'
        })
        .select()
        .single();
    
    if (error) throw error;
    
    console.log('✅ Neuer Kunde erstellt:', newCustomer.customer_number);
    return newCustomer;
}

async function createProject(customer, data, tenantProjectId) {
    const projectNumber = await generateProjectNumber();
    
    const { data: project, error } = await supabase
        .from('kfz_projects')
        .insert({
            tenant_project_id: tenantProjectId,
            project_number: projectNumber,
            name: `KFZ-Schaden ${customer.first_name} ${customer.last_name}`,
            status: 'active',
            priority: 'normal',
            storage_path: `/kfz-sachverstaendiger/${projectNumber}/`,
            metadata: {
                created_from: 'retell_call',
                initial_contact: data,
                agent_version: 'markus-v1'
            }
        })
        .select()
        .single();
    
    if (error) throw error;
    
    // Kunde mit Projekt verknüpfen
    await supabase
        .from('kfz_project_customers')
        .insert({
            project_id: project.id,
            customer_id: customer.id,
            role: 'primary'
        });
    
    console.log('🏗️ Projekt erstellt:', project.project_number);
    return project;
}

async function saveCallRecord(callId, transcript, duration, customerId, projectId, extractedData, tenantProjectId) {
    const { error } = await supabase
        .from('kfz_calls')
        .insert({
            tenant_project_id: tenantProjectId,
            project_id: projectId,
            customer_id: customerId,
            retell_call_id: callId,
            call_type: 'inbound',
            duration_seconds: duration,
            transcript: transcript,
            extracted_data: extractedData,
            call_purpose: extractedData.type === 'CALLBACK' ? 'callback_request' : 'appointment_booking',
            call_outcome: 'successful',
            agent_version: 'markus-v1'
        });
    
    if (error) throw error;
    console.log('📝 Call Record gespeichert');
}

async function scheduleAppointment(customer, project, data, tenantProjectId) {
    if (!data.appointment || data.type !== 'APPOINTMENT') return null;
    
    const { street, city } = extractAddressParts(data.address);
    
    const { data: appointment, error } = await supabase
        .from('kfz_appointments')
        .insert({
            tenant_project_id: tenantProjectId,
            project_id: project.id,
            customer_id: customer.id,
            appointment_type: 'inspection',
            scheduled_date: parseAppointmentDate(data.appointment),
            address: {
                street,
                city,
                full_address: data.address
            },
            status: 'scheduled'
        })
        .select()
        .single();
    
    if (!error) {
        console.log('📅 Termin geplant für:', data.appointment);
        return appointment;
    }
    
    return null;
}

async function logAnalyticsEvent(eventType, tenantProjectId, projectId, customerId, properties = {}) {
    await supabase
        .from('kfz_analytics_events')
        .insert({
            tenant_project_id: tenantProjectId,
            event_type: eventType,
            event_category: eventType.split('_')[0], // call, appointment, project
            project_id: projectId,
            customer_id: customerId,
            properties
        });
}

// ================================
// API ENDPOINTS
// ================================

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'KFZ-Sachverständiger API',
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// RETELL WEBHOOK - HAUPTENDPOINT
app.post('/api/retell/webhook', async (req, res) => {
    try {
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        console.log('📞 Retell Webhook empfangen:', { 
            call_id, 
            call_status, 
            duration: duration_seconds 
        });
        
        // Tenant Project ID holen
        const tenantProjectId = await getTenantProjectId();
        if (!tenantProjectId) {
            throw new Error('KFZ-Sachverständiger Projekt nicht gefunden');
        }
        
        // 1. DATENERFASSUNG aus Transkript extrahieren
        const extractedData = extractCustomerData(transcript);
        console.log('📋 Extrahierte Daten:', extractedData);
        
        if (extractedData && extractedData.name && extractedData.phone) {
            // 2. Kunde erstellen/finden
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId);
            
            // 3. Projekt erstellen
            const project = await createProject(customer, extractedData, tenantProjectId);
            
            // 4. Call Record speichern
            await saveCallRecord(
                call_id, 
                transcript, 
                duration_seconds, 
                customer.id, 
                project.id, 
                extractedData, 
                tenantProjectId
            );
            
            // 5. Analytics Event loggen
            await logAnalyticsEvent(
                'call_completed', 
                tenantProjectId, 
                project.id, 
                customer.id,
                { 
                    call_type: extractedData.type,
                    duration_seconds,
                    retell_call_id: call_id
                }
            );
            
            // 6. Bei Terminwunsch: Appointment erstellen
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT') {
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId);
                
                if (appointment) {
                    await logAnalyticsEvent(
                        'appointment_scheduled', 
                        tenantProjectId, 
                        project.id, 
                        customer.id,
                        { 
                            appointment_date: appointment.scheduled_date,
                            appointment_type: appointment.appointment_type
                        }
                    );
                }
            }
            
            // 7. Bei Callback-Wunsch: Analytics loggen
            if (extractedData.type === 'CALLBACK') {
                await logAnalyticsEvent(
                    'callback_requested', 
                    tenantProjectId, 
                    project.id, 
                    customer.id,
                    { 
                        customer_phone: customer.phone,
                        customer_name: `${customer.first_name} ${customer.last_name}`
                    }
                );
            }
            
            res.json({ 
                success: true, 
                message: 'Webhook erfolgreich verarbeitet',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment
                }
            });
            
        } else {
            // Kein strukturierter Datenextrakt - trotzdem Call loggen
            console.log('⚠️ Keine strukturierten Daten gefunden, Call trotzdem loggen');
            
            await supabase
                .from('kfz_calls')
                .insert({
                    tenant_project_id: tenantProjectId,
                    retell_call_id: call_id,
                    call_type: 'inbound',
                    duration_seconds: duration_seconds,
                    transcript: transcript,
                    call_purpose: 'unknown',
                    call_outcome: 'partial',
                    agent_version: 'markus-v1'
                });
            
            res.json({ 
                success: true, 
                message: 'Call gespeichert, aber keine strukturierten Daten gefunden',
                data: { call_id }
            });
        }
        
    } catch (error) {
        console.error('❌ Webhook Fehler:', error);
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id 
        });
    }
});

// Dashboard API
app.get('/api/dashboard', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        
        // Heute's Statistiken
        const today = new Date().toISOString().split('T')[0];
        
        const [
            { count: projectsToday },
            { count: totalCalls },
            { count: pendingCallbacks },
            { count: scheduledAppointments },
            { count: totalCustomers }
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
                .eq('tenant_project_id', tenantProjectId)
        ]);
        
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
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Projekte API
app.get('/api/projects', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const limit = parseInt(req.query.limit) || 50;
        
        const { data: projects, error } = await supabase
            .from('kfz_projects')
            .select(`
                *,
                kfz_project_customers!inner(
                    kfz_customers(*)
                )
            `)
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.json(projects);
        
    } catch (error) {
        console.error('Projects Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Einzelnes Projekt mit allen Details
app.get('/api/projects/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const tenantProjectId = await getTenantProjectId();
        
        const { data: project, error } = await supabase
            .from('kfz_projects')
            .select(`
                *,
                kfz_project_customers(
                    kfz_customers(*)
                ),
                kfz_calls(*),
                kfz_appointments(*),
                kfz_vehicles(*),
                kfz_damages(*),
                kfz_project_files(*)
            `)
            .eq('id', id)
            .eq('tenant_project_id', tenantProjectId)
            .single();
        
        if (error) throw error;
        
        res.json(project);
        
    } catch (error) {
        console.error('Project Detail Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Kunden API
app.get('/api/customers', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const limit = parseInt(req.query.limit) || 100;
        
        const { data: customers, error } = await supabase
            .from('kfz_customers')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.json(customers);
        
    } catch (error) {
        console.error('Customers Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Anrufe API
app.get('/api/calls', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const limit = parseInt(req.query.limit) || 50;
        
        const { data: calls, error } = await supabase
            .from('kfz_calls')
            .select(`
                *,
                kfz_customers(first_name, last_name, phone),
                kfz_projects(project_number, name)
            `)
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false })
            .limit(limit);
        
        if (error) throw error;
        
        res.json(calls);
        
    } catch (error) {
        console.error('Calls Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Termine API
app.get('/api/appointments', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        
        const { data: appointments, error } = await supabase
            .from('kfz_appointments')
            .select(`
                *,
                kfz_customers(first_name, last_name, phone),
                kfz_projects(project_number, name)
            `)
            .eq('tenant_project_id', tenantProjectId)
            .gte('scheduled_date', new Date().toISOString())
            .order('scheduled_date', { ascending: true });
        
        if (error) throw error;
        
        res.json(appointments);
        
    } catch (error) {
        console.error('Appointments Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Error Handler
app.use((error, req, res, next) => {
    console.error('Unhandled Error:', error);
    res.status(500).json({ 
        error: 'Internal Server Error',
        message: error.message 
    });
});

// 404 Handler
app.use('*', (req, res) => {
    res.status(404).json({ 
        error: 'Not Found',
        path: req.originalUrl 
    });
});

// Server starten
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 KFZ-Sachverständiger API läuft auf Port ${PORT}`);
    console.log(`📊 Dashboard: http://localhost:${PORT}/api/dashboard`);
    console.log(`🔗 Webhook: http://localhost:${PORT}/api/retell/webhook`);
    console.log(`💾 Database: ${process.env.SUPABASE_URL ? 'Connected' : 'Not configured'}`);
});

module.exports = app;

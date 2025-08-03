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

// ================================
// IMPROVED DATA EXTRACTION
// ================================

function extractCustomerDataNatural(transcript) {
    console.log('🧠 Versuche natürliche Datenextraktion...');
    
    const extractedData = {
        name: null,
        phone: null,
        address: null,
        appointment: null,
        type: 'CALLBACK'
    };
    
    const transcriptLower = transcript.toLowerCase();
    
    // Name extrahieren - Verschiedene natürliche Muster
    const namePatterns = [
        /(?:name ist|ich heiße|ich bin|mein name ist)\s+([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon|mein))/i,
        /(?:hallo|guten tag),?\s*(?:ich bin|mein name ist)?\s*([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon))/i,
        /(?:^|\s)([a-zäöüß]+\s+[a-zäöüß]+)(?:\s+hier|$)/i
    ];
    
    for (const pattern of namePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const name = match[1].trim();
            // Filter out common false positives
            if (name.length > 2 && 
                !['heute', 'morgen', 'termin', 'unfall', 'auto', 'fahrzeug', 'schaden'].includes(name.toLowerCase()) &&
                !name.match(/\d/)) {
                extractedData.name = name;
                console.log('👤 Name gefunden:', name);
                break;
            }
        }
    }
    
    // Telefonnummer extrahieren - Verbesserte deutsche Formate
    const phonePatterns = [
        /(?:telefon|nummer|telefonnummer|erreichbar)\s*(?:ist|unter|:)?\s*((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/i,
        /(?:meine nummer ist|sie erreichen mich unter|rufen sie mich an unter)\s*((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/i,
        /((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/
    ];
    
    for (const pattern of phonePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const phone = match[1].replace(/[\s\-\/]/g, '').trim();
            if (phone.length >= 9) {
                extractedData.phone = phone;
                console.log('📞 Telefon gefunden:', phone);
                break;
            }
        }
    }
    
    // Adresse extrahieren - Deutsche Adressformate
    const addressPatterns = [
        /(?:adresse|wohne|wohnhaft|zuhause|ich bin)\s+(?:ist|in|an|bei)?\s*([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i,
        /(?:zur besichtigung|vor ort|kommen sie)\s+(?:zu|nach|in)?\s*([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i,
        /([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i
    ];
    
    for (const pattern of addressPatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const address = match[1].trim();
            if (address.length > 5) {
                extractedData.address = address;
                console.log('🏠 Adresse gefunden:', address);
                break;
            }
        }
    }
    
    // Termin erkennen
    const appointmentPatterns = [
        /(?:termin|besichtigung|kommen|vor ort)\s*(?:für|am|um|morgen|heute|nächste woche|montag|dienstag|mittwoch|donnerstag|freitag)/i,
        /(?:morgen|heute|nächste woche)\s*(?:um|gegen)?\s*(\d{1,2}(?::\d{2})?)/i,
        /(?:um|gegen)\s*(\d{1,2}(?::\d{2})?)\s*(?:uhr)?/i
    ];
    
    for (const pattern of appointmentPatterns) {
        const match = transcript.match(pattern);
        if (match) {
            extractedData.appointment = match[0];
            console.log('📅 Termin gefunden:', match[0]);
            break;
        }
    }
    
    // Call-Type intelligenter bestimmen
    if (transcriptLower.includes('termin') || 
        transcriptLower.includes('besichtigung') || 
        transcriptLower.includes('kommen sie') ||
        transcriptLower.includes('vor ort') ||
        extractedData.address) {
        extractedData.type = 'APPOINTMENT';
        console.log('📋 Call-Type: APPOINTMENT');
    } else if (transcriptLower.includes('rückruf') || 
               transcriptLower.includes('anrufen') ||
               transcriptLower.includes('nicht parat') ||
               transcriptLower.includes('später') ||
               transcriptLower.includes('beratung')) {
        extractedData.type = 'CALLBACK';
        console.log('📋 Call-Type: CALLBACK');
    }
    
    // Qualitätsprüfung
    const hasValidData = extractedData.name && extractedData.phone;
    console.log('🎯 Natürliche Extraktion Ergebnis:', hasValidData ? 'Erfolgreich' : 'Unvollständig');
    
    return hasValidData ? extractedData : null;
}

function extractCustomerData(transcript) {
    console.log('🔍 Versuche DATENERFASSUNG-Extraktion...');
    
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
    
    console.log('📋 DATENERFASSUNG Ergebnis:', Object.keys(extractedData).length > 0 ? 'Erfolgreich' : 'Fehlgeschlagen');
    return Object.keys(extractedData).length > 0 ? extractedData : null;
}

// Intelligente Datenextraktion mit Fallback
function extractCustomerDataIntelligent(transcript) {
    console.log('🚀 Starte intelligente Datenextraktion...');
    
    // Methode 1: Natürliche Sprache (bevorzugt)
    let extractedData = extractCustomerDataNatural(transcript);
    
    // Methode 2: Fallback auf DATENERFASSUNG-Format
    if (!extractedData) {
        console.log('⚠️ Natürliche Extraktion erfolglos, versuche DATENERFASSUNG...');
        extractedData = extractCustomerData(transcript);
    }
    
    // Methode 3: Hybrid-Ansatz - Beide Methoden kombinieren
    if (extractedData) {
        const backupData = extractCustomerData(transcript);
        if (backupData) {
            // Ergänze fehlende Daten aus DATENERFASSUNG
            for (const [key, value] of Object.entries(backupData)) {
                if (!extractedData[key] || extractedData[key] === 'Nicht erfasst') {
                    extractedData[key] = value;
                    console.log(`🔄 ${key} aus DATENERFASSUNG ergänzt:`, value);
                }
            }
        }
    }
    
    if (extractedData) {
        console.log('✅ Finale extrahierte Daten:', extractedData);
    } else {
        console.log('❌ Keine strukturierten Daten extrahierbar');
    }
    
    return extractedData;
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
    
    // Verbesserte Adress-Parsing für deutsche Adressen
    const parts = address.split(',').map(p => p.trim());
    
    // Postleitzahl extrahieren
    const postalMatch = address.match(/\b(\d{5})\b/);
    const postal_code = postalMatch ? postalMatch[1] : null;
    
    // Stadt extrahieren (normalerweise nach PLZ oder am Ende)
    let city = 'Bielefeld'; // Default
    if (postalMatch) {
        const afterPostal = address.substring(address.indexOf(postalMatch[1]) + 5).trim();
        if (afterPostal) {
            city = afterPostal.split(/[,\n]/)[0].trim();
        }
    } else if (parts.length > 1) {
        city = parts[parts.length - 1];
    }
    
    // Straße ist normalerweise der erste Teil
    const street = parts[0] || null;
    
    return {
        street,
        city,
        postal_code
    };
}

function parseAppointmentDate(appointmentString) {
    if (!appointmentString) return null;
    
    const today = new Date();
    const appointmentLower = appointmentString.toLowerCase();
    
    // Zeit extrahieren
    const timeMatch = appointmentString.match(/(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
    let hour = timeMatch ? parseInt(timeMatch[1]) : 10;
    let minute = timeMatch && timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    // Default Zeit falls keine angegeben
    if (hour < 8 || hour > 18) hour = 10;
    
    let targetDate = new Date(today);
    
    // Tag bestimmen
    if (appointmentLower.includes('morgen')) {
        targetDate.setDate(today.getDate() + 1);
    } else if (appointmentLower.includes('heute')) {
        // Heute, aber mindestens 2 Stunden in der Zukunft
        if (hour <= today.getHours()) {
            hour = Math.max(today.getHours() + 2, 10);
        }
    } else if (appointmentLower.includes('montag')) {
        targetDate = getNextWeekday(today, 1);
    } else if (appointmentLower.includes('dienstag')) {
        targetDate = getNextWeekday(today, 2);
    } else if (appointmentLower.includes('mittwoch')) {
        targetDate = getNextWeekday(today, 3);
    } else if (appointmentLower.includes('donnerstag')) {
        targetDate = getNextWeekday(today, 4);
    } else if (appointmentLower.includes('freitag')) {
        targetDate = getNextWeekday(today, 5);
    } else {
        // Default: nächster Werktag
        targetDate.setDate(today.getDate() + 1);
        // Wochenende überspringen
        if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() + 1); // Sonntag -> Montag
        if (targetDate.getDay() === 6) targetDate.setDate(targetDate.getDate() + 2); // Samstag -> Montag
    }
    
    targetDate.setHours(hour, minute, 0, 0);
    return targetDate.toISOString();
}

function getNextWeekday(date, targetDay) {
    const result = new Date(date);
    const currentDay = result.getDay();
    const daysUntilTarget = (targetDay - currentDay + 7) % 7;
    
    if (daysUntilTarget === 0) {
        // Heute ist der gewünschte Tag - nächste Woche nehmen
        result.setDate(result.getDate() + 7);
    } else {
        result.setDate(result.getDate() + daysUntilTarget);
    }
    
    return result;
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
                agent_version: 'markus-v2-natural',
                extraction_method: data.extraction_method || 'natural_language'
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
            agent_version: 'markus-v2-natural'
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
        version: '2.0.0-natural',
        features: ['natural_language_extraction', 'datenerfassung_fallback', 'intelligent_parsing'],
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// RETELL WEBHOOK - HAUPTENDPOINT (Verbessert)
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
        
        // 1. INTELLIGENTE DATENEXTRAKTION (Neu!)
        const extractedData = extractCustomerDataIntelligent(transcript);
        
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
                    retell_call_id: call_id,
                    extraction_method: 'intelligent_natural'
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
                message: 'Webhook erfolgreich verarbeitet (Natural Language)',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    extraction_method: 'natural_language_processing'
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
                    agent_version: 'markus-v2-natural'
                });
            
            res.json({ 
                success: true, 
                message: 'Call gespeichert, aber keine strukturierten Daten gefunden',
                data: { 
                    call_id,
                    extraction_attempted: true,
                    extraction_successful: false
                }
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
            system: {
                version: '2.0.0-natural',
                features: ['natural_language_extraction', 'intelligent_parsing']
            },
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Dashboard Error:', error);
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
    console.log('🚀 KFZ Sachverständiger API Server gestartet!');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('🔄 Bereit für Webhook-Verarbeitung...');
    console.log('🎯 Bereit für Retell Webhooks!');
    console.log('📖 API Dokumentation verfügbar unter: /health');
});

module.exports = app;
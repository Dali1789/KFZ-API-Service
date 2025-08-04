// ================================
// BUSINESS LOGIC & HELPER FUNCTIONS WITH DATABASE INIT HOTFIX
// ================================

const { CalendarNotificationService } = require('./calendarNotificationService');
const { Client } = require('pg');

// Initialize calendar and notification service
const calendarService = new CalendarNotificationService();

// Global tenant project ID cache
let TENANT_PROJECT_ID = null;

// HOTFIX: Direct database initialization
async function initializeTenantProject() {
  if (TENANT_PROJECT_ID) return TENANT_PROJECT_ID;
  
  console.log('🔥 HOTFIX: Tenant Project Initialization...');
  
  try {
    const pgClient = new Client({
      connectionString: process.env.POSTGRES_DIRECT_URL || process.env.SUPABASE_URL,
      ssl: false
    });
    
    await pgClient.connect();
    
    // Check if project exists
    const checkQuery = `SELECT id FROM tenant_projects WHERE project_name = 'kfz-sachverstaendiger' LIMIT 1`;
    const existing = await pgClient.query(checkQuery);
    
    if (existing.rows.length > 0) {
      TENANT_PROJECT_ID = existing.rows[0].id;
      console.log('✅ HOTFIX: Tenant Project found:', TENANT_PROJECT_ID);
      await pgClient.end();
      return TENANT_PROJECT_ID;
    }
    
    // Create new project
    const insertQuery = `
      INSERT INTO tenant_projects (
        id, project_name, organization_name, owner_email, domain, settings, created_at
      ) VALUES (
        gen_random_uuid(),
        'kfz-sachverstaendiger',
        'DS-Sachverständigenbüro Bielefeld',
        'gutachter@unfallschaden-bielefeld.de',
        'unfallschaden-bielefeld.de',
        $1::jsonb,
        NOW()
      ) RETURNING id;
    `;
    
    const settings = {
      retell_agent_id: 'agent_33dd09f56fc57f5ebd9be1cdd8',
      business_type: 'kfz_expert',
      auto_create_projects: true,
      email_notifications: true
    };
    
    const result = await pgClient.query(insertQuery, [JSON.stringify(settings)]);
    TENANT_PROJECT_ID = result.rows[0].id;
    
    console.log('🎉 HOTFIX: Tenant Project created:', TENANT_PROJECT_ID);
    
    await pgClient.end();
    return TENANT_PROJECT_ID;
    
  } catch (error) {
    console.error('💥 HOTFIX Init Error:', error.message);
    return null;
  }
}

// ENHANCED getTenantProjectId with HOTFIX fallback
async function getTenantProjectId(supabase) {
    if (TENANT_PROJECT_ID) return TENANT_PROJECT_ID;
    
    try {
        // Try Supabase first
        const { data, error } = await supabase
            .from('tenant_projects')
            .select('id')
            .eq('project_name', 'kfz-sachverstaendiger')
            .single();
        
        if (data && !error) {
            TENANT_PROJECT_ID = data.id;
            return TENANT_PROJECT_ID;
        }
        
        // HOTFIX: Fallback to direct database
        console.log('🔄 HOTFIX: Fallback to direct database init...');
        return await initializeTenantProject();
        
    } catch (supabaseError) {
        console.log('🔄 HOTFIX: Direct database fallback due to:', supabaseError.message);
        return await initializeTenantProject();
    }
}

async function generateProjectNumber(supabase) {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_projects')
        .select('*', { count: 'exact', head: true })
        .like('project_number', `P-${year}-%`);
    
    return `P-${year}-${(count + 1).toString().padStart(3, '0')}`;
}

async function generateCustomerNumber(supabase) {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_customers')
        .select('*', { count: 'exact', head: true })
        .like('customer_number', `K-${year}-%`);
    
    return `K-${year}-${(count + 1).toString().padStart(3, '0')}`;
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
    
    const parts = address.split(',').map(p => p.trim());
    
    const postalMatch = address.match(/\b(\d{5})\b/);
    const postal_code = postalMatch ? postalMatch[1] : null;
    
    let city = 'Bielefeld';
    if (postalMatch) {
        const afterPostal = address.substring(address.indexOf(postalMatch[1]) + 5).trim();
        if (afterPostal) {
            city = afterPostal.split(/[,\n]/)[0].trim();
        }
    } else if (parts.length > 1) {
        city = parts[parts.length - 1];
    }
    
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
    
    const timeMatch = appointmentString.match(/(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
    let hour = timeMatch ? parseInt(timeMatch[1]) : 10;
    let minute = timeMatch && timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    if (hour < 8 || hour > 18) hour = 10;
    
    let targetDate = new Date(today);
    
    if (appointmentLower.includes('morgen')) {
        targetDate.setDate(today.getDate() + 1);
    } else if (appointmentLower.includes('heute')) {
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
        targetDate.setDate(today.getDate() + 1);
        if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() + 1);
        if (targetDate.getDay() === 6) targetDate.setDate(targetDate.getDate() + 2);
    }
    
    targetDate.setHours(hour, minute, 0, 0);
    return targetDate.toISOString();
}

function getNextWeekday(date, targetDay) {
    const result = new Date(date);
    const currentDay = result.getDay();
    const daysUntilTarget = (targetDay - currentDay + 7) % 7;
    
    if (daysUntilTarget === 0) {
        result.setDate(result.getDate() + 7);
    } else {
        result.setDate(result.getDate() + daysUntilTarget);
    }
    
    return result;
}

async function createOrUpdateCustomer(data, tenantProjectId, supabase) {
    const { first_name, last_name } = parseNameParts(data.name);
    const { street, city, postal_code } = extractAddressParts(data.address);
    
    let { data: existingCustomer } = await supabase
        .from('kfz_customers')
        .select('*')
        .eq('phone', data.phone)
        .eq('tenant_project_id', tenantProjectId)
        .single();
    
    if (existingCustomer) {
        console.log('👤 Bestehender Kunde gefunden:', existingCustomer.customer_number);
        
        if (data.address && !existingCustomer.street) {
            await supabase
                .from('kfz_customers')
                .update({ street, city, postal_code })
                .eq('id', existingCustomer.id);
        }
        
        return existingCustomer;
    }
    
    const customerNumber = await generateCustomerNumber(supabase);
    
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

async function createProject(customer, data, tenantProjectId, supabase) {
    const projectNumber = await generateProjectNumber(supabase);
    
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
                agent_version: 'markus-v3-enhanced',
                extraction_method: data.extraction_method || 'advanced_natural_language',
                confidence_score: data.confidence_score || 0
            }
        })
        .select()
        .single();
    
    if (error) throw error;
    
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

async function saveCallRecord(callId, transcript, duration, customerId, projectId, extractedData, tenantProjectId, supabase) {
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
            agent_version: 'markus-v3-enhanced'
        });
    
    if (error) throw error;
    console.log('📝 Call Record gespeichert');
}

// ================================
// ENHANCED APPOINTMENT SCHEDULING WITH CALENDAR INTEGRATION
// ================================

async function scheduleAppointment(customer, project, data, tenantProjectId, supabase) {
    if (!data.appointment || data.type !== 'APPOINTMENT') return null;
    
    try {
        console.log('📅 Starte intelligente Terminplanung...');
        
        // Parse appointment date
        const requestedDate = parseAppointmentDate(data.appointment);
        if (!requestedDate) {
            console.warn('⚠️ Termin konnte nicht geparst werden:', data.appointment);
            return null;
        }
        
        // Check availability with calendar service
        const availability = await calendarService.checkAvailability(
            new Date(requestedDate),
            60, // 60 minutes default
            supabase,
            tenantProjectId
        );
        
        let finalDate = requestedDate;
        let appointmentStatus = 'scheduled';
        let appointmentNotes = '';
        
        if (!availability.available) {
            console.log('⚠️ Gewünschter Termin nicht verfügbar:', availability.reason);
            
            // Try to use suggested times
            if (availability.suggestedTimes && availability.suggestedTimes.length > 0) {
                finalDate = availability.suggestedTimes[0].date.toISOString();
                appointmentStatus = 'tentative';
                appointmentNotes = `Original request: ${data.appointment}. Suggested alternative due to: ${availability.reason}`;
                console.log('💡 Alternative vorgeschlagen:', availability.suggestedTimes[0].formatted);
            }
        }
        
        const { street, city } = extractAddressParts(data.address);
        
        const { data: appointment, error } = await supabase
            .from('kfz_appointments')
            .insert({
                tenant_project_id: tenantProjectId,
                project_id: project.id,
                customer_id: customer.id,
                appointment_type: 'inspection',
                scheduled_date: finalDate,
                duration_minutes: 60,
                location_type: 'customer_address',
                address: {
                    street,
                    city,
                    full_address: data.address,
                    postal_code: customer.postal_code
                },
                status: appointmentStatus,
                completion_notes: appointmentNotes
            })
            .select()
            .single();
        
        if (error) {
            console.error('❌ Fehler beim Erstellen des Termins:', error);
            return null;
        }
        
        console.log('✅ Termin erstellt:', appointment.id);
        
        // ================================
        // SEND EMAIL NOTIFICATIONS
        // ================================
        
        // Send notification to owner
        console.log('📧 Sende Benachrichtigung an Sachverständigen...');
        const ownerNotification = await calendarService.sendAppointmentNotification(
            customer, 
            project, 
            appointment, 
            data
        );
        
        if (ownerNotification.success) {
            console.log('✅ Owner-Benachrichtigung gesendet:', ownerNotification.messageId);
        } else {
            console.warn('⚠️ Owner-Benachrichtigung fehlgeschlagen:', ownerNotification.reason || ownerNotification.error);
        }
        
        // Send confirmation to customer (if email available)
        if (customer.email) {
            console.log('📧 Sende Bestätigung an Kunden...');
            const customerConfirmation = await calendarService.sendCustomerConfirmation(
                customer, 
                appointment
            );
            
            if (customerConfirmation.success) {
                console.log('✅ Kundenbestätigung gesendet:', customerConfirmation.messageId);
            }
        }
        
        // Update appointment with notification status
        await supabase
            .from('kfz_appointments')
            .update({
                metadata: {
                    owner_notification_sent: ownerNotification.success,
                    customer_confirmation_sent: customer.email ? true : false,
                    availability_check: availability,
                    original_request: data.appointment
                }
            })
            .eq('id', appointment.id);
        
        return appointment;
        
    } catch (error) {
        console.error('❌ Appointment scheduling error:', error);
        return null;
    }
}

// ================================
// ENHANCED CALLBACK HANDLING WITH NOTIFICATIONS
// ================================

async function handleCallbackRequest(customer, project, data, tenantProjectId, supabase) {
    try {
        console.log('📞 Verarbeite Callback-Request...');
        
        // Send callback notification to owner
        const callbackNotification = await calendarService.sendCallbackNotification(
            customer, 
            project, 
            data
        );
        
        if (callbackNotification.success) {
            console.log('✅ Callback-Benachrichtigung gesendet:', callbackNotification.messageId);
            
            // Update project metadata with notification info
            await supabase
                .from('kfz_projects')
                .update({
                    metadata: {
                        ...project.metadata,
                        callback_notification_sent: true,
                    notification_sent_at: new Date().toISOString(),
                        requires_callback: true
                    }
                })
                .eq('id', project.id);
                
            return {
                success: true,
                notification_sent: true,
                message_id: callbackNotification.messageId
            };
        } else {
            console.warn('⚠️ Callback-Benachrichtigung fehlgeschlagen:', callbackNotification.reason || callbackNotification.error);
            return {
                success: false,
                notification_sent: false,
                error: callbackNotification.error
            };
        }
        
    } catch (error) {
        console.error('❌ Callback handling error:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function logAnalyticsEvent(eventType, tenantProjectId, projectId, customerId, properties = {}, supabase) {
    await supabase
        .from('kfz_analytics_events')
        .insert({
            tenant_project_id: tenantProjectId,
            event_type: eventType,
            event_category: eventType.split('_')[0],
            project_id: projectId,
            customer_id: customerId,
            properties
        });
}

// ================================
// CALENDAR & NOTIFICATION TEST FUNCTIONS
// ================================

async function testEmailConfiguration() {
    console.log('🧪 Teste E-Mail-Konfiguration...');
    const result = await calendarService.testEmailConfiguration();
    
    if (result.success) {
        console.log('✅ E-Mail-Service ist konfiguriert und bereit');
    } else {
        console.error('❌ E-Mail-Service Konfiguration fehlerhaft:', result.error);
        console.log('💡 Überprüfen Sie die Environment Variables:');
        console.log('   - SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS');
        console.log('   - OWNER_EMAIL (für Benachrichtigungen)');
    }
    
    return result;
}

async function sendTestNotification(type = 'appointment') {
    console.log(`🧪 Sende Test-${type}-Benachrichtigung...`);
    
    const testCustomer = {
        first_name: 'Max',
        last_name: 'Mustermann',
        phone: '0521123456',
        email: 'test@example.com',
        customer_number: 'TEST-001'
    };
    
    const testProject = {
        project_number: 'TEST-PROJECT-001',
        name: 'Test KFZ-Schaden',
        status: 'active'
    };
    
    const testAppointment = {
        scheduled_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        duration_minutes: 60,
        appointment_type: 'inspection',
        status: 'scheduled'
    };
    
    if (type === 'appointment') {
        return await calendarService.sendAppointmentNotification(
            testCustomer, 
            testProject, 
            testAppointment,
            { confidence_score: 0.95, type: 'APPOINTMENT' }
        );
    } else if (type === 'callback') {
        return await calendarService.sendCallbackNotification(
            testCustomer, 
            testProject,
            { confidence_score: 0.87, type: 'CALLBACK' }
        );
    }
}

// ================================
// EMAIL NOTIFICATION WRAPPER FUNCTION FOR TESTS
// ================================

async function sendNotificationEmail(bookingData) {
    try {
        console.log('📧 Sende Test-E-Mail mit Booking-Daten...');
        
        const testCustomer = {
            first_name: bookingData.customerName.split(' ')[0] || 'Test',
            last_name: bookingData.customerName.split(' ').slice(1).join(' ') || 'Kunde',
            phone: bookingData.customerPhone,
            email: bookingData.customerEmail,
            customer_number: bookingData.projectNumber
        };
        
        const testProject = {
            project_number: bookingData.projectNumber,
            name: `KFZ-Schaden ${bookingData.customerName}`,
            status: 'active'
        };
        
        const testAppointment = {
            scheduled_date: new Date().toISOString(),
            duration_minutes: 60,
            appointment_type: 'inspection',
            status: 'scheduled',
            address: {
                full_address: bookingData.address,
                street: bookingData.address,
                city: 'Bielefeld'
            }
        };
        
        const extractedData = {
            confidence_score: bookingData.confidence,
            type: 'APPOINTMENT',
            damage: bookingData.damage
        };
        
        return await calendarService.sendAppointmentNotification(
            testCustomer,
            testProject,
            testAppointment,
            extractedData
        );
        
    } catch (error) {
        console.error('❌ sendNotificationEmail Fehler:', error);
        throw error;
    }
}

module.exports = {
    getTenantProjectId, // ENHANCED with HOTFIX
    initializeTenantProject, // NEW HOTFIX function
    generateProjectNumber,
    generateCustomerNumber,
    parseNameParts,
    extractAddressParts,
    parseAppointmentDate,
    getNextWeekday,
    createOrUpdateCustomer,
    createProject,
    saveCallRecord,
    scheduleAppointment,
    handleCallbackRequest,
    logAnalyticsEvent,
    testEmailConfiguration,
    sendTestNotification,
    sendNotificationEmail, // Neue Funktion für Tests
    calendarService
};

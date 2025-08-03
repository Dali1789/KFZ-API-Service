// ================================
// BUSINESS LOGIC & HELPER FUNCTIONS
// ================================

async function getTenantProjectId(supabase) {
    const { data } = await supabase
        .from('tenant_projects')
        .select('id')
        .eq('project_name', 'kfz-sachverstaendiger')
        .single();
    return data?.id;
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

async function scheduleAppointment(customer, project, data, tenantProjectId, supabase) {
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

module.exports = {
    getTenantProjectId,
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
    logAnalyticsEvent
};

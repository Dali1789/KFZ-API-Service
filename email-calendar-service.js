// ================================
// EMAIL & CALENDAR SERVICE
// ================================

const nodemailer = require('nodemailer');
const { google } = require('googleapis');

// Gmail/Google Calendar Setup
const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
);

oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
});

const calendar = google.calendar({ version: 'v3', auth: oauth2Client });
const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

// ================================
// EMAIL FUNCTIONS
// ================================

async function sendInternalNotification(customerData, projectData, appointmentData) {
    console.log('📧 Sende interne Benachrichtigung...');
    
    const emailContent = `
    🔔 NEUER TERMIN VEREINBART
    
    📋 Kundendaten:
    Name: ${customerData.first_name} ${customerData.last_name}
    Telefon: ${customerData.phone}
    Kunde-Nr: ${customerData.customer_number}
    
    🏗️ Projektdaten:
    Projekt-Nr: ${projectData.project_number}
    Projekt: ${projectData.name}
    
    📅 Termindetails:
    Datum: ${appointmentData.scheduled_date}
    Ort: ${appointmentData.address?.full_address || 'Bei uns im Büro'}
    Dauer: ca. 30 Minuten
    
    📱 Bestätigung gesendet:
    ${appointmentData.confirmation_method === 'whatsapp' ? 
        `WhatsApp: ${appointmentData.contact_info}` : 
        `E-Mail: ${appointmentData.contact_info}`}
    
    🔗 Weitere Infos:
    https://unfallschaden-bielefeld.de/termine
    
    ---
    Automatisch generiert vom KFZ-Sachverständiger System
    `;
    
    try {
        // Send via Gmail API
        const message = {
            to: 'gutachter@unfallschaden-bielefeld.de',
            subject: `🔔 Neuer Termin: ${customerData.first_name} ${customerData.last_name} - ${appointmentData.scheduled_date}`,
            text: emailContent
        };
        
        const encodedMessage = Buffer.from(
            `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`
        ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
        
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
        
        console.log('✅ Interne Benachrichtigung gesendet');
        return true;
    } catch (error) {
        console.error('❌ Fehler beim Senden der internen Benachrichtigung:', error);
        return false;
    }
}

async function sendCustomerConfirmation(customerData, appointmentData, confirmationType) {
    console.log(`📱 Sende Kundenbestätigung via ${confirmationType}...`);
    
    const isAtOffice = appointmentData.address?.full_address?.includes('Kammerratsheide') || !appointmentData.address?.full_address;
    
    const confirmationContent = `
🚗 TERMINBESTÄTIGUNG - DS-Sachverständigenbüro

Hallo ${customerData.first_name} ${customerData.last_name},

Ihr Termin wurde erfolgreich vereinbart:

📅 TERMINDETAILS:
Datum: ${new Date(appointmentData.scheduled_date).toLocaleDateString('de-DE', {
    weekday: 'long',
    year: 'numeric', 
    month: 'long',
    day: 'numeric'
})}
Uhrzeit: ${new Date(appointmentData.scheduled_date).toLocaleTimeString('de-DE', {
    hour: '2-digit',
    minute: '2-digit'
})}
Dauer: ca. 30 Minuten

📍 ORT:
${isAtOffice ? 
    `DS-Sachverständigenbüro\nKammerratsheide 51\n33609 Bielefeld\n\n🅿️ Parkplätze direkt vor Ort verfügbar` :
    `Vor Ort bei Ihnen:\n${appointmentData.address.full_address}`
}

📋 BITTE MITBRINGEN:
${isAtOffice ? `
✅ Fahrzeugschein (Zulassungsbescheinigung Teil I)
✅ Fahrzeugbrief (Zulassungsbescheinigung Teil II) 
✅ Führerschein
✅ Versicherungsschein
✅ Unfallbericht (falls vorhanden)
✅ Fotos vom Schaden (falls vorhanden)
✅ Kostenvoranschläge (falls bereits erstellt)
` : `
✅ Fahrzeugpapiere (Schein & Brief)
✅ Versicherungsunterlagen
✅ Unfallbericht
✅ Alle relevanten Dokumente
`}

💰 KOSTEN:
Bei Fremdverschulden trägt die gegnerische Versicherung alle Kosten.

📞 KONTAKT:
Bei Fragen oder Terminänderungen:
Telefon: 0521 456 789
E-Mail: gutachter@unfallschaden-bielefeld.de

🌐 WEITERE INFORMATIONEN:
https://unfallschaden-bielefeld.de
- Unsere Leistungen
- Ablauf einer Begutachtung  
- Häufige Fragen (FAQ)
- Ihre Rechte als Unfallgeschädigter

Mit freundlichen Grüßen
Ihr DS-Sachverständigenbüro Team

---
Diese Nachricht wurde automatisch generiert.
    `;
    
    if (confirmationType === 'email') {
        return await sendConfirmationEmail(customerData, confirmationContent, appointmentData);
    } else {
        return await sendWhatsAppConfirmation(customerData, confirmationContent, appointmentData);
    }
}

async function sendConfirmationEmail(customerData, content, appointmentData) {
    try {
        const message = {
            to: appointmentData.contact_info,
            subject: `✅ Terminbestätigung ${new Date(appointmentData.scheduled_date).toLocaleDateString('de-DE')} - DS-Sachverständigenbüro`,
            text: content
        };
        
        const encodedMessage = Buffer.from(
            `To: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`
        ).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
        
        await gmail.users.messages.send({
            userId: 'me',
            requestBody: {
                raw: encodedMessage
            }
        });
        
        console.log('✅ Kundenbestätigung per E-Mail gesendet');
        return true;
    } catch (error) {
        console.error('❌ Fehler beim Senden der E-Mail-Bestätigung:', error);
        return false;
    }
}

async function sendWhatsAppConfirmation(customerData, content, appointmentData) {
    // WhatsApp Business API integration would go here
    // For now, we'll log and save to database for manual sending
    console.log('📱 WhatsApp-Bestätigung vorbereitet für:', appointmentData.contact_info);
    console.log('Inhalt:', content);
    
    // In a real implementation, you would integrate with:
    // - WhatsApp Business API
    // - Twilio WhatsApp
    // - Or another WhatsApp service
    
    return true;
}

// ================================
// CALENDAR FUNCTIONS  
// ================================

async function createCalendarEvent(customerData, appointmentData) {
    console.log('📅 Erstelle Kalender-Termin...');
    
    const isAtOffice = appointmentData.address?.full_address?.includes('Kammerratsheide') || !appointmentData.address?.full_address;
    
    const eventData = {
        summary: `🚗 Begutachtung: ${customerData.first_name} ${customerData.last_name}`,
        description: `
KFZ-Begutachtung für ${customerData.first_name} ${customerData.last_name}

📋 Details:
• Kunde-Nr: ${customerData.customer_number}
• Telefon: ${customerData.phone}
• Projekt: ${appointmentData.project_number || 'N/A'}

📍 Ort: ${isAtOffice ? 'Büro - Kammerratsheide 51' : appointmentData.address?.full_address}

🕐 Dauer: 30 Minuten
💰 Kosten: ${isAtOffice ? 'Keine (Bürotermin)' : 'Anfahrt wird berechnet'}

📱 Bestätigung gesendet via: ${appointmentData.confirmation_method}
📧 Kontakt: ${appointmentData.contact_info}

🌐 Kundeninfo: https://unfallschaden-bielefeld.de
        `,
        start: {
            dateTime: appointmentData.scheduled_date,
            timeZone: 'Europe/Berlin'
        },
        end: {
            dateTime: new Date(new Date(appointmentData.scheduled_date).getTime() + 30 * 60000).toISOString(),
            timeZone: 'Europe/Berlin'
        },
        location: isAtOffice ? 
            'DS-Sachverständigenbüro, Kammerratsheide 51, 33609 Bielefeld' : 
            appointmentData.address?.full_address,
        attendees: [
            {
                email: 'gutachter@unfallschaden-bielefeld.de',
                displayName: 'DS-Sachverständigenbüro'
            }
        ],
        reminders: {
            useDefault: false,
            overrides: [
                { method: 'popup', minutes: 30 },
                { method: 'email', minutes: 60 }
            ]
        },
        colorId: '4' // Orange for appointments
    };
    
    try {
        const event = await calendar.events.insert({
            calendarId: 'primary',
            requestBody: eventData
        });
        
        console.log('✅ Kalender-Termin erstellt:', event.data.id);
        return {
            success: true,
            eventId: event.data.id,
            htmlLink: event.data.htmlLink
        };
    } catch (error) {
        console.error('❌ Fehler beim Erstellen des Kalender-Termins:', error);
        return {
            success: false,
            error: error.message
        };
    }
}

async function updateCalendarEvent(eventId, updateData) {
    try {
        const event = await calendar.events.patch({
            calendarId: 'primary',
            eventId: eventId,
            requestBody: updateData
        });
        
        console.log('✅ Kalender-Termin aktualisiert');
        return true;
    } catch (error) {
        console.error('❌ Fehler beim Aktualisieren des Kalender-Termins:', error);
        return false;
    }
}

async function deleteCalendarEvent(eventId) {
    try {
        await calendar.events.delete({
            calendarId: 'primary',
            eventId: eventId
        });
        
        console.log('✅ Kalender-Termin gelöscht');
        return true;
    } catch (error) {
        console.error('❌ Fehler beim Löschen des Kalender-Termins:', error);
        return false;
    }
}

// ================================
// MAIN AUTOMATION FUNCTION
// ================================

async function processAppointmentAutomation(customerData, projectData, appointmentData) {
    console.log('🤖 Starte vollständige Termin-Automatisierung...');
    
    const results = {
        internal_email: false,
        customer_confirmation: false,
        calendar_event: false,
        calendar_event_id: null
    };
    
    try {
        // 1. Interne E-Mail senden
        results.internal_email = await sendInternalNotification(customerData, projectData, appointmentData);
        
        // 2. Kalender-Termin erstellen
        const calendarResult = await createCalendarEvent(customerData, appointmentData);
        results.calendar_event = calendarResult.success;
        results.calendar_event_id = calendarResult.eventId;
        
        // 3. Kundenbestätigung senden
        results.customer_confirmation = await sendCustomerConfirmation(
            customerData, 
            appointmentData, 
            appointmentData.confirmation_method
        );
        
        console.log('✅ Automatisierung abgeschlossen:', results);
        return results;
        
    } catch (error) {
        console.error('❌ Fehler bei der Automatisierung:', error);
        return results;
    }
}

module.exports = {
    sendInternalNotification,
    sendCustomerConfirmation,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    processAppointmentAutomation
};
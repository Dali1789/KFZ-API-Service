// ================================
// CALENDAR & NOTIFICATION MODULE
// ================================

const nodemailer = require('nodemailer');

class CalendarNotificationService {
    constructor() {
        // E-Mail Transporter konfigurieren
        this.emailTransporter = nodemailer.createTransporter({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: process.env.SMTP_PORT || 587,
            secure: false,
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });

        // Standard E-Mail-Konfiguration
        this.defaultFromEmail = process.env.NOTIFICATION_FROM_EMAIL || process.env.SMTP_USER;
        this.ownerEmail = process.env.OWNER_EMAIL; // Ihre E-Mail für Benachrichtigungen
        
        console.log('📧 E-Mail Service initialisiert für:', this.defaultFromEmail);
    }

    // ================================
    // KALENDER-INTEGRATION
    // ================================

    /**
     * Prüft Terminverfügbarkeit
     * @param {Date} requestedDate - Gewünschter Termin
     * @param {number} durationMinutes - Dauer in Minuten
     * @param {Object} supabase - Supabase Client
     * @param {string} tenantProjectId - Tenant ID
     */
    async checkAvailability(requestedDate, durationMinutes = 60, supabase, tenantProjectId) {
        try {
            const startTime = new Date(requestedDate);
            const endTime = new Date(startTime.getTime() + (durationMinutes * 60000));

            // Arbeitszeiten prüfen (Mo-Fr 8-18 Uhr)
            const dayOfWeek = startTime.getDay();
            const hour = startTime.getHours();
            
            if (dayOfWeek === 0 || dayOfWeek === 6) {
                return {
                    available: false,
                    reason: 'Termine nur Montag bis Freitag möglich',
                    suggestedTimes: await this.getSuggestedTimes(startTime, supabase, tenantProjectId)
                };
            }

            if (hour < 8 || hour >= 18) {
                return {
                    available: false,
                    reason: 'Termine nur zwischen 8:00 und 18:00 Uhr möglich',
                    suggestedTimes: await this.getSuggestedTimes(startTime, supabase, tenantProjectId)
                };
            }

            // Existierende Termine prüfen
            const { data: conflictingAppointments } = await supabase
                .from('kfz_appointments')
                .select('scheduled_date, duration_minutes')
                .eq('tenant_project_id', tenantProjectId)
                .eq('status', 'scheduled')
                .gte('scheduled_date', startTime.toISOString())
                .lt('scheduled_date', endTime.toISOString());

            if (conflictingAppointments && conflictingAppointments.length > 0) {
                return {
                    available: false,
                    reason: 'Terminkonflikt mit existierendem Termin',
                    suggestedTimes: await this.getSuggestedTimes(startTime, supabase, tenantProjectId)
                };
            }

            return {
                available: true,
                confirmedTime: startTime,
                endTime: endTime
            };

        } catch (error) {
            console.error('❌ Availability Check Error:', error);
            return {
                available: false,
                reason: 'Technischer Fehler bei Terminprüfung',
                error: error.message
            };
        }
    }

    /**
     * Schlägt alternative Termine vor
     */
    async getSuggestedTimes(requestedDate, supabase, tenantProjectId, durationMinutes = 60) {
        const suggestions = [];
        const baseDate = new Date(requestedDate);
        
        // Nächste 7 Werktage prüfen
        for (let dayOffset = 0; dayOffset < 7; dayOffset++) {
            const checkDate = new Date(baseDate);
            checkDate.setDate(baseDate.getDate() + dayOffset);
            
            // Skip Wochenenden
            if (checkDate.getDay() === 0 || checkDate.getDay() === 6) continue;
            
            // Zeitslots: 9:00, 11:00, 14:00, 16:00
            const timeSlots = [9, 11, 14, 16];
            
            for (const hour of timeSlots) {
                const slotTime = new Date(checkDate);
                slotTime.setHours(hour, 0, 0, 0);
                
                const availability = await this.checkAvailability(
                    slotTime, 
                    durationMinutes, 
                    supabase, 
                    tenantProjectId
                );
                
                if (availability.available) {
                    suggestions.push({
                        date: slotTime,
                        formatted: this.formatGermanDateTime(slotTime)
                    });
                    
                    if (suggestions.length >= 3) break;
                }
            }
            
            if (suggestions.length >= 3) break;
        }
        
        return suggestions;
    }

    // ================================
    // E-MAIL BENACHRICHTIGUNGEN
    // ================================

    /**
     * Sendet Benachrichtigung bei neuem Kundentermin
     */
    async sendAppointmentNotification(customer, project, appointment, extractedData = {}) {
        try {
            if (!this.ownerEmail) {
                console.warn('⚠️ OWNER_EMAIL nicht konfiguriert - keine Benachrichtigung gesendet');
                return { success: false, reason: 'No owner email configured' };
            }

            const appointmentDate = new Date(appointment.scheduled_date);
            const formattedDate = this.formatGermanDateTime(appointmentDate);
            
            const emailContent = this.generateAppointmentEmailHTML({
                customer,
                project,
                appointment,
                extractedData,
                formattedDate
            });

            const mailOptions = {
                from: `"DS Sachverständigenbüro System" <${this.defaultFromEmail}>`,
                to: this.ownerEmail,
                subject: `🆕 Neuer Kundentermin: ${customer.first_name} ${customer.last_name} - ${formattedDate}`,
                html: emailContent,
                priority: 'high'
            };

            const result = await this.emailTransporter.sendMail(mailOptions);
            
            console.log('✅ Appointment notification sent:', result.messageId);
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: this.ownerEmail
            };

        } catch (error) {
            console.error('❌ E-Mail notification error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sendet Callback-Benachrichtigung
     */
    async sendCallbackNotification(customer, project, extractedData = {}) {
        try {
            if (!this.ownerEmail) {
                console.warn('⚠️ OWNER_EMAIL nicht konfiguriert');
                return { success: false, reason: 'No owner email configured' };
            }

            const emailContent = this.generateCallbackEmailHTML({
                customer,
                project,
                extractedData
            });

            const mailOptions = {
                from: `"DS Sachverständigenbüro System" <${this.defaultFromEmail}>`,
                to: this.ownerEmail,
                subject: `📞 Rückruf gewünscht: ${customer.first_name} ${customer.last_name} - ${customer.phone}`,
                html: emailContent,
                priority: 'high'
            };

            const result = await this.emailTransporter.sendMail(mailOptions);
            
            console.log('✅ Callback notification sent:', result.messageId);
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: this.ownerEmail
            };

        } catch (error) {
            console.error('❌ Callback notification error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Sendet Terminbestätigung an Kunden
     */
    async sendCustomerConfirmation(customer, appointment) {
        try {
            if (!customer.email) {
                console.log('ℹ️ Keine Kunden-E-Mail verfügbar für Bestätigung');
                return { success: false, reason: 'No customer email' };
            }

            const appointmentDate = new Date(appointment.scheduled_date);
            const formattedDate = this.formatGermanDateTime(appointmentDate);
            
            const emailContent = this.generateCustomerConfirmationHTML({
                customer,
                appointment,
                formattedDate
            });

            const mailOptions = {
                from: `"DS Sachverständigenbüro" <${this.defaultFromEmail}>`,
                to: customer.email,
                subject: `Terminbestätigung DS Sachverständigenbüro - ${formattedDate}`,
                html: emailContent
            };

            const result = await this.emailTransporter.sendMail(mailOptions);
            
            console.log('✅ Customer confirmation sent:', result.messageId);
            
            return {
                success: true,
                messageId: result.messageId,
                recipient: customer.email
            };

        } catch (error) {
            console.error('❌ Customer confirmation error:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    // ================================
    // E-MAIL TEMPLATES
    // ================================

    generateAppointmentEmailHTML({ customer, project, appointment, extractedData, formattedDate }) {
        const address = appointment.address || {};
        const confidence = extractedData.confidence_score || 0;
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #4f46e5; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }
                .footer { background: #1f2937; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #10b981; border-radius: 4px; }
                .urgent { border-left-color: #ef4444 !important; }
                .confidence { display: inline-block; padding: 4px 8px; border-radius: 4px; font-size: 0.8rem; }
                .confidence-high { background: #d1fae5; color: #065f46; }
                .confidence-medium { background: #fef3c7; color: #92400e; }
                .confidence-low { background: #fee2e2; color: #991b1b; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🆕 Neuer Kundentermin</h1>
                    <p>Automatisch generiert durch Ihr KI-System</p>
                </div>
                
                <div class="content">
                    <div class="info-box">
                        <h3>👤 Kundendaten</h3>
                        <p><strong>Name:</strong> ${customer.first_name} ${customer.last_name}</p>
                        <p><strong>Telefon:</strong> ${customer.phone}</p>
                        <p><strong>E-Mail:</strong> ${customer.email || 'Nicht angegeben'}</p>
                        <p><strong>Kunden-Nr:</strong> ${customer.customer_number}</p>
                    </div>
                    
                    <div class="info-box urgent">
                        <h3>📅 Termindetails</h3>
                        <p><strong>Datum & Zeit:</strong> ${formattedDate}</p>
                        <p><strong>Dauer:</strong> ${appointment.duration_minutes || 60} Minuten</p>
                        <p><strong>Typ:</strong> ${appointment.appointment_type || 'Begutachtung'}</p>
                        <p><strong>Status:</strong> ${appointment.status || 'geplant'}</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>📍 Adresse</h3>
                        <p><strong>Straße:</strong> ${address.street || customer.street || 'Nicht angegeben'}</p>
                        <p><strong>Stadt:</strong> ${address.city || customer.city || 'Nicht angegeben'}</p>
                        <p><strong>PLZ:</strong> ${customer.postal_code || 'Nicht angegeben'}</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>🏗️ Projektinformationen</h3>
                        <p><strong>Projekt-Nr:</strong> ${project.project_number}</p>
                        <p><strong>Name:</strong> ${project.name}</p>
                        <p><strong>Status:</strong> ${project.status}</p>
                        <p><strong>Priorität:</strong> ${project.priority || 'normal'}</p>
                    </div>
                    
                    ${extractedData ? `
                    <div class="info-box">
                        <h3>🤖 KI-Extraktion</h3>
                        <p><strong>Confidence Score:</strong> 
                            <span class="confidence ${confidence > 0.8 ? 'confidence-high' : confidence > 0.5 ? 'confidence-medium' : 'confidence-low'}">
                                ${(confidence * 100).toFixed(1)}%
                            </span>
                        </p>
                        <p><strong>Methode:</strong> ${extractedData.extraction_details?.method || 'Standard'}</p>
                        ${extractedData.appointment ? `<p><strong>Original Request:</strong> "${extractedData.appointment}"</p>` : ''}
                    </div>
                    ` : ''}
                </div>
                
                <div class="footer">
                    <p>🤖 Automatisch generiert vom DS Sachverständigenbüro KI-System</p>
                    <p>Zeitpunkt: ${new Date().toLocaleString('de-DE')}</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    generateCallbackEmailHTML({ customer, project, extractedData }) {
        const confidence = extractedData.confidence_score || 0;
        
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #f59e0b; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }
                .footer { background: #1f2937; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #f59e0b; border-radius: 4px; }
                .urgent { border-left-color: #ef4444 !important; background: #fef2f2 !important; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>📞 Rückruf gewünscht</h1>
                    <p>Kunde möchte zurückgerufen werden</p>
                </div>
                
                <div class="content">
                    <div class="info-box urgent">
                        <h3>👤 Kundenkontakt</h3>
                        <p><strong>Name:</strong> ${customer.first_name} ${customer.last_name}</p>
                        <p><strong>Telefon:</strong> <a href="tel:${customer.phone}">${customer.phone}</a></p>
                        <p><strong>Kunden-Nr:</strong> ${customer.customer_number}</p>
                        <p><strong>Status:</strong> Wartet auf Rückruf</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>🏗️ Auto-generiertes Projekt</h3>
                        <p><strong>Projekt-Nr:</strong> ${project.project_number}</p>
                        <p><strong>Name:</strong> ${project.name}</p>
                        <p><strong>Erstellt:</strong> ${new Date(project.created_at).toLocaleString('de-DE')}</p>
                    </div>
                    
                    ${extractedData ? `
                    <div class="info-box">
                        <h3>🤖 KI-Analyse</h3>
                        <p><strong>Confidence:</strong> ${(confidence * 100).toFixed(1)}%</p>
                        <p><strong>Call-Type:</strong> ${extractedData.type || 'CALLBACK'}</p>
                        ${extractedData.extraction_details?.method ? `<p><strong>Methode:</strong> ${extractedData.extraction_details.method}</p>` : ''}
                    </div>
                    ` : ''}
                </div>
                
                <div class="footer">
                    <p>⏰ Rückruf so bald wie möglich erforderlich</p>
                    <p>Zeitpunkt: ${new Date().toLocaleString('de-DE')}</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    generateCustomerConfirmationHTML({ customer, appointment, formattedDate }) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                .header { background: #10b981; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
                .content { background: #f8fafc; padding: 20px; border: 1px solid #e2e8f0; }
                .footer { background: #1f2937; color: white; padding: 15px; text-align: center; border-radius: 0 0 8px 8px; }
                .info-box { background: white; padding: 15px; margin: 10px 0; border-left: 4px solid #10b981; border-radius: 4px; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>✅ Terminbestätigung</h1>
                    <p>DS Sachverständigenbüro</p>
                </div>
                
                <div class="content">
                    <p>Sehr geehrte/r ${customer.first_name} ${customer.last_name},</p>
                    
                    <p>vielen Dank für Ihr Vertrauen in unser Sachverständigenbüro. Hiermit bestätigen wir Ihren Termin:</p>
                    
                    <div class="info-box">
                        <h3>📅 Ihr Termin</h3>
                        <p><strong>Datum & Zeit:</strong> ${formattedDate}</p>
                        <p><strong>Dauer:</strong> ca. ${appointment.duration_minutes || 60} Minuten</p>
                        <p><strong>Art:</strong> Begutachtung vor Ort</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>📋 Vorbereitung</h3>
                        <p>Bitte halten Sie folgende Unterlagen bereit:</p>
                        <ul>
                            <li>Fahrzeugschein und Fahrzeugbrief</li>
                            <li>Versicherungspolice</li>
                            <li>Schadenmeldung (falls vorhanden)</li>
                            <li>Fotos vom Schaden</li>
                        </ul>
                    </div>
                </div>
                
                <div class="footer">
                    <p>DS Sachverständigenbüro</p>
                    <p>Bei Fragen erreichen Sie uns telefonisch oder per E-Mail</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    // ================================
    // UTILITY FUNCTIONS
    // ================================

    formatGermanDateTime(date) {
        if (!date) return 'Nicht angegeben';
        
        const options = {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            timeZone: 'Europe/Berlin'
        };
        
        return new Date(date).toLocaleDateString('de-DE', options);
    }

    // Test E-Mail-Konfiguration
    async testEmailConfiguration() {
        try {
            await this.emailTransporter.verify();
            console.log('✅ E-Mail-Konfiguration erfolgreich getestet');
            return { success: true };
        } catch (error) {
            console.error('❌ E-Mail-Konfiguration fehlerhaft:', error);
            return { success: false, error: error.message };
        }
    }
}

module.exports = {
    CalendarNotificationService
};

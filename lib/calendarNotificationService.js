// ================================
// CALENDAR & NOTIFICATION MODULE
// ================================

const nodemailer = require('nodemailer');

class CalendarNotificationService {
    constructor() {
        // E-Mail Transporter konfigurieren (KORRIGIERT: createTransport statt createTransporter)
        this.emailTransporter = nodemailer.createTransport({
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
        console.log('📧 Benachrichtigungen gehen an:', this.ownerEmail);
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
                from: `"Unfallschaden-Büro Bielefeld System" <${this.defaultFromEmail}>`,
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
                from: `"Unfallschaden-Büro Bielefeld System" <${this.defaultFromEmail}>`,
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

    // ================================
    // E-MAIL TEMPLATES (Verkürzt für Dateigröße)
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
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🆕 Neuer Kundentermin</h1>
                    <p>Unfallschaden-Büro Bielefeld</p>
                </div>
                
                <div class="content">
                    <div class="info-box">
                        <h3>👤 Kundendaten</h3>
                        <p><strong>Name:</strong> ${customer.first_name} ${customer.last_name}</p>
                        <p><strong>Telefon:</strong> <a href="tel:${customer.phone}">${customer.phone}</a></p>
                        <p><strong>Kunden-Nr:</strong> ${customer.customer_number}</p>
                    </div>
                    
                    <div class="info-box urgent">
                        <h3>📅 Termindetails</h3>
                        <p><strong>Datum & Zeit:</strong> ${formattedDate}</p>
                        <p><strong>Dauer:</strong> ${appointment.duration_minutes || 60} Minuten</p>
                        <p><strong>Typ:</strong> KFZ-Begutachtung</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>📍 Adresse</h3>
                        <p><strong>Straße:</strong> ${address.street || customer.street || 'Nicht angegeben'}</p>
                        <p><strong>Stadt:</strong> ${address.city || customer.city || 'Nicht angegeben'}</p>
                        <p><strong>PLZ:</strong> ${customer.postal_code || 'Nicht angegeben'}</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>🏗️ Projekt</h3>
                        <p><strong>Projekt-Nr:</strong> ${project.project_number}</p>
                        <p><strong>Name:</strong> ${project.name}</p>
                        <p><strong>KI-Confidence:</strong> ${(confidence * 100).toFixed(1)}%</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>🤖 Automatisch generiert - ${new Date().toLocaleString('de-DE')}</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    generateCallbackEmailHTML({ customer, project, extractedData }) {
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
                    <p>Unfallschaden-Büro Bielefeld</p>
                </div>
                
                <div class="content">
                    <div class="info-box urgent">
                        <h3>👤 Kundenkontakt</h3>
                        <p><strong>Name:</strong> ${customer.first_name} ${customer.last_name}</p>
                        <p><strong>Telefon:</strong> <a href="tel:${customer.phone}">${customer.phone}</a></p>
                        <p><strong>Kunden-Nr:</strong> ${customer.customer_number}</p>
                        <p><strong>Status:</strong> ⏰ Wartet auf Rückruf</p>
                    </div>
                    
                    <div class="info-box">
                        <h3>🏗️ Projekt</h3>
                        <p><strong>Projekt-Nr:</strong> ${project.project_number}</p>
                        <p><strong>Name:</strong> ${project.name}</p>
                        <p><strong>Erstellt:</strong> ${new Date().toLocaleString('de-DE')}</p>
                    </div>
                </div>
                
                <div class="footer">
                    <p>⏰ Rückruf so bald wie möglich erforderlich</p>
                    <p>🤖 Automatisch generiert - ${new Date().toLocaleString('de-DE')}</p>
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

// KORRIGIERT: Direkte Klassen-Export für Constructor-Kompatibilität
module.exports = CalendarNotificationService;

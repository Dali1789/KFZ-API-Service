// ================================
// TEST ROUTES FÜR E-MAIL & KALENDER
// ================================

const express = require('express');
const router = express.Router();

// Import der Services
const CalendarNotificationService = require('../lib/calendarNotificationService');

// Service initialisieren
const calendarService = new CalendarNotificationService();

// ================================
// E-MAIL KONFIGURATION TESTEN
// ================================

/**
 * GET /api/test/email
 * Testet die E-Mail-Konfiguration
 */
router.get('/email', async (req, res) => {
    try {
        console.log('🧪 Teste E-Mail-Konfiguration...');
        
        // Transporter-Status prüfen
        const transporterReady = await calendarService.emailTransporter.verify();
        
        const configStatus = {
            smtp_configured: !!process.env.SMTP_HOST,
            smtp_host: process.env.SMTP_HOST,
            smtp_port: process.env.SMTP_PORT,
            smtp_user: process.env.SMTP_USER ? '✅ Konfiguriert' : '❌ Fehlt',
            smtp_pass: process.env.SMTP_PASS ? '✅ Konfiguriert' : '❌ Fehlt',
            owner_email: process.env.OWNER_EMAIL ? '✅ Konfiguriert' : '❌ Fehlt',
            transporter_ready: transporterReady,
            timestamp: new Date().toISOString()
        };
        
        console.log('📧 E-Mail Status:', configStatus);
        
        res.json({
            success: true,
            message: 'E-Mail-Konfiguration geprüft',
            config: configStatus
        });
        
    } catch (error) {
        console.error('❌ E-Mail Test Fehler:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            config_status: {
                smtp_host: process.env.SMTP_HOST || 'Nicht gesetzt',
                smtp_user: process.env.SMTP_USER ? 'Gesetzt' : 'Nicht gesetzt',
                smtp_pass: process.env.SMTP_PASS ? 'Gesetzt' : 'Nicht gesetzt',
                owner_email: process.env.OWNER_EMAIL || 'Nicht gesetzt'
            }
        });
    }
});

// ================================
// TEST-BENACHRICHTIGUNG SENDEN
// ================================

/**
 * GET /api/test/notification
 * Sendet eine Test-Benachrichtigung
 */
router.get('/notification', async (req, res) => {
    try {
        console.log('🧪 Sende Test-Benachrichtigung...');
        
        // Mock-Daten für Test
        const mockCustomer = {
            first_name: 'Max',
            last_name: 'Mustermann',
            phone: '+49 521 123456',
            email: 'max.mustermann@example.com'
        };
        
        const mockProject = {
            project_number: 'K-2025-TEST',
            project_name: 'Test Unfallschaden'
        };
        
        const mockAppointment = {
            scheduled_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Morgen
            address: {
                full_address: 'Musterstraße 123, 33602 Bielefeld'
            },
            appointment_type: 'vor_ort_begutachtung',
            notes: 'Test-Termin über API generiert'
        };
        
        const mockExtractedData = {
            confidence_score: 0.95,
            damage_description: 'Frontalschaden nach Auffahrunfall',
            vehicle_info: 'BMW 320d, Bj. 2020',
            source: 'API Test'
        };
        
        // Test-Benachrichtigung senden
        const emailResult = await calendarService.sendAppointmentNotification(
            mockCustomer,
            mockProject,
            mockAppointment,
            mockExtractedData
        );
        
        res.json({
            success: true,
            message: 'Test-Benachrichtigung gesendet',
            email_result: emailResult,
            test_data: {
                customer: mockCustomer,
                project: mockProject,
                appointment: mockAppointment
            },
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Test-Benachrichtigung Fehler:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

// ================================
// KALENDER-VERFÜGBARKEIT TESTEN
// ================================

/**
 * GET /api/test/calendar?date=2025-08-05&time=14:00
 * Testet Kalender-Verfügbarkeit
 */
router.get('/calendar', async (req, res) => {
    try {
        const { date, time } = req.query;
        
        if (!date || !time) {
            return res.status(400).json({
                success: false,
                error: 'Parameter "date" (YYYY-MM-DD) und "time" (HH:MM) erforderlich',
                example: '/api/test/calendar?date=2025-08-05&time=14:00'
            });
        }
        
        const requestedDateTime = new Date(`${date}T${time}:00.000Z`);
        
        // Mock Supabase für Test
        const mockSupabase = {
            from: () => ({
                select: () => ({
                    eq: () => ({
                        gte: () => ({
                            lte: () => ({
                                data: [], // Keine Termine = verfügbar
                                error: null
                            })
                        })
                    })
                })
            })
        };
        
        const availability = await calendarService.checkAvailability(
            requestedDateTime,
            60, // 60 Minuten
            mockSupabase,
            'test-tenant'
        );
        
        res.json({
            success: true,
            message: 'Kalender-Verfügbarkeit geprüft',
            requested_datetime: requestedDateTime.toISOString(),
            availability,
            timestamp: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('❌ Kalender Test Fehler:', error);
        res.status(500).json({
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        });
    }
});

module.exports = router;

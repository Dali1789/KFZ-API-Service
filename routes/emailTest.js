// ================================
// CALENDAR & NOTIFICATION TEST ENDPOINTS
// ================================

// Test E-Mail configuration
app.get('/api/test/email', async (req, res) => {
    try {
        markPhase(req, 'email_test_start');
        
        const { testEmailConfiguration } = require('./lib/businessLogic');
        const result = await testEmailConfiguration();
        
        markPhase(req, 'email_test_complete');
        
        res.json({
            success: result.success,
            message: result.success ? 'E-Mail-Konfiguration erfolgreich' : 'E-Mail-Konfiguration fehlerhaft',
            error: result.error,
            environment_check: {
                smtp_host: !!process.env.SMTP_HOST,
                smtp_user: !!process.env.SMTP_USER,
                smtp_pass: !!process.env.SMTP_PASS,
                owner_email: !!process.env.OWNER_EMAIL
            },
            smtp_config: {
                host: process.env.SMTP_HOST,
                port: process.env.SMTP_PORT,
                user: process.env.SMTP_USER,
                owner: process.env.OWNER_EMAIL
            },
            request_id: req.requestId
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            request_id: req.requestId 
        });
    }
});

// Send test notification
app.post('/api/test/notification', async (req, res) => {
    try {
        markPhase(req, 'test_notification_start');
        
        const { sendTestNotification } = require('./lib/businessLogic');
        const { type = 'appointment' } = req.body;
        const result = await sendTestNotification(type);
        
        markPhase(req, 'test_notification_complete');
        
        res.json({
            success: result.success,
            message: result.success ? `Test-${type}-Benachrichtigung gesendet` : 'Benachrichtigung fehlgeschlagen',
            message_id: result.messageId,
            recipient: result.recipient,
            error: result.error,
            request_id: req.requestId
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            request_id: req.requestId 
        });
    }
});

// Quick GET version for easy browser testing
app.get('/api/test/notification', async (req, res) => {
    try {
        markPhase(req, 'test_notification_start');
        
        const { sendTestNotification } = require('./lib/businessLogic');
        const type = req.query.type || 'appointment';
        const result = await sendTestNotification(type);
        
        markPhase(req, 'test_notification_complete');
        
        res.json({
            success: result.success,
            message: result.success ? `Test-${type}-Benachrichtigung gesendet an ${result.recipient}` : 'Benachrichtigung fehlgeschlagen',
            message_id: result.messageId,
            recipient: result.recipient,
            error: result.error,
            type: type,
            request_id: req.requestId
        });
    } catch (error) {
        res.status(500).json({ 
            success: false, 
            error: error.message,
            request_id: req.requestId 
        });
    }
});

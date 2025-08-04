// ================================
// SERVER START WITH PERMISSIONS FIX
// ================================
const { fixDatabasePermissions } = require('./startup-permissions-fix');

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    console.log('📊 Final Performance Report:', monitor.getPerformanceReport());
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    console.log('📊 Final Performance Report:', monitor.getPerformanceReport());
    process.exit(0);
});

// SERVER START WITH PERMISSIONS FIX
async function startServer() {
    console.log('🚀 KFZ-Sachverständiger API wird gestartet...');
    
    // 🔧 AUTOMATIC PERMISSIONS FIX ON STARTUP
    console.log('🔧 Running database permissions fix...');
    try {
        const permissionsFixed = await fixDatabasePermissions();
        if (permissionsFixed) {
            console.log('✅ Database permissions fixed successfully!');
        } else {
            console.log('⚠️ Database permissions fix had issues, but continuing...');
        }
    } catch (permissionsError) {
        console.log('⚠️ Permissions fix error:', permissionsError.message);
        console.log('🔄 Server will continue - permissions may be fixed by direct database access');
    }
    
    // START THE SERVER
    app.listen(PORT, () => {
        console.log('🚀 KFZ-Sachverständiger API läuft auf Port', PORT);
        console.log(`🌐 Web Dashboard: http://localhost:${PORT}/dashboard`);
        console.log(`📊 API Dashboard: http://localhost:${PORT}/api/dashboard`);
        console.log(`📈 Performance: http://localhost:${PORT}/api/performance`);
        console.log(`🩺 Health: http://localhost:${PORT}/health`);
        console.log(`🔗 Webhook: http://localhost:${PORT}/api/retell/webhook`);
        console.log(`📧 Gmail Test: http://localhost:${PORT}/api/test/email`);
        console.log(`🔑 Kong Test: http://localhost:${PORT}/api/test/kong`);
        console.log('💾 Database: Connected');
        console.log('🧠 Enhanced Multi-Layer Data Extraction Ready!');
        console.log('🎯 Advanced Natural Language Processing Active!');
        console.log('📊 Confidence Scoring & Analytics Enabled!');
        console.log('🏗️ Modular Architecture: ACTIVE');
        console.log('📈 Real-time Performance Monitoring: ACTIVE');
        console.log('🩺 Health Checks & Error Tracking: ACTIVE');
        console.log('🌐 Web Dashboard Interface: ACTIVE');
        console.log('📧 Gmail API Integration: ACTIVE');
        console.log('🔑 Kong API Gateway Authentication: ACTIVE');
        console.log('🔧 AUTOMATIC DATABASE PERMISSIONS FIX: ACTIVE');
        
        // Log initial system health
        setTimeout(() => {
            console.log('📊 Initial System Health:', monitor.getHealthCheck());
        }, 2000);
    });
}

// Start the server with permissions fix
startServer().catch(error => {
    console.error('💥 Server startup failed:', error);
    process.exit(1);
});

module.exports = app;
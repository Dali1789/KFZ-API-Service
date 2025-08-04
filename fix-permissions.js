// KOMPAKTER PERMISSIONS AUTO-FIX
const { fixDatabasePermissions } = require('./permissions-fix');
const express = require('express');
const app = express();

// AUTO-FIX ROUTE
app.get('/fix-permissions', async (req, res) => {
  console.log('🔧 AUTO-FIX: Database Permissions werden repariert...');
  
  try {
    const result = await fixDatabasePermissions();
    
    if (result.success) {
      console.log('✅ AUTO-FIX: Permissions erfolgreich repariert!');
      res.json({
        success: true,
        message: '🎉 Database Permissions Fixed Successfully!',
        details: result,
        nextSteps: [
          'Teste jetzt einen Retell Webhook',
          'Calls sollten in Database gespeichert werden',
          'E-Mail Notifications sollten funktionieren'
        ]
      });
    } else {
      console.error('❌ AUTO-FIX: Permissions-Fix fehlgeschlagen:', result.error);
      res.status(500).json({
        success: false,
        message: 'Permissions-Fix fehlgeschlagen',
        error: result.error
      });
    }
    
  } catch (error) {
    console.error('💥 AUTO-FIX: Kritischer Fehler:', error);
    res.status(500).json({
      success: false,
      message: 'Kritischer Auto-Fix Fehler',
      error: error.message
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🔧 Auto-Fix Server läuft auf Port ${PORT}`);
  console.log(`🔗 Fix URL: http://localhost:${PORT}/fix-permissions`);
});

module.exports = app;
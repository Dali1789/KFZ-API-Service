// CRITICAL WEBHOOK FIX
// Das Problem: Call ID kommt nicht richtig an

app.post('/api/retell/webhook', async (req, res) => {
    try {
        console.log('🔍 WEBHOOK DEBUG:', JSON.stringify(req.body, null, 2));
        
        // Fix: Bessere Call ID Extraktion
        const callId = req.body.call_id || req.body.callId || `fallback_${Date.now()}`;
        const transcript = req.body.transcript || '';
        const duration = Math.round((req.body.duration_ms || 0) / 1000);
        
        console.log('📞 Extracted:', { callId, transcript: transcript.substring(0, 100) });
        
        if (transcript && transcript.length > 10) {
            // Tenant Project ID
            const tenantId = '8718ff92-0e7b-41fb-9c71-253d3d708764'; // Hardcoded fix
            
            // Direkte Database-Insert mit Service Key
            const { data, error } = await supabase
                .from('kfz_calls')
                .insert({
                    tenant_project_id: tenantId,
                    retell_call_id: callId,
                    transcript: transcript,
                    duration_seconds: duration,
                    call_type: 'inbound',
                    call_outcome: 'test_success'
                });
                
            if (error) {
                console.error('❌ DB Error:', error);
                return res.status(500).json({ error: error.message });
            }
            
            console.log('✅ Call saved successfully');
            return res.json({ success: true, callId });
        }
        
        res.json({ success: true, message: 'No transcript' });
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        res.status(500).json({ error: error.message });
    }
});

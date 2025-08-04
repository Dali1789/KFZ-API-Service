// Main Webhook
app.post('/api/retell/webhook', async (req, res) => {
    try {
        // Enhanced logging for debugging
        console.log('📞 Webhook received:', {
            headers: req.headers,
            body_keys: Object.keys(req.body),
            body: req.body
        });
        
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        // Check for different possible field names from Retell
        const actualTranscript = transcript || req.body.call_transcript || req.body.conversation || req.body.text || '';
        const actualCallId = call_id || req.body.callId || req.body.id || 'unknown';
        const actualDuration = duration_seconds || req.body.duration || req.body.call_duration || 0;
        const actualStatus = call_status || req.body.status || req.body.call_status || 'unknown';
        
        console.log('📞 Parsed webhook data:', { 
            call_id: actualCallId, 
            call_status: actualStatus, 
            transcript_length: actualTranscript?.length || 0,
            transcript_preview: actualTranscript?.substring(0, 100) || 'No transcript'
        });
        
        const tenantProjectId = await getTenantProjectId(supabase);
        if (!tenantProjectId) throw new Error('Tenant project not found');
        
        const extractedData = extractCustomerDataIntelligent(actualTranscript);
        
        if (extractedData && extractedData.name && extractedData.phone) {
            console.log('✅ Valid data extracted, creating customer and project...');
            
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
            const project = await createProject(customer, extractedData, tenantProjectId, supabase);
            
            await saveCallRecord(actualCallId, actualTranscript, actualDuration, customer.id, project.id, extractedData, tenantProjectId, supabase);
            
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                console.log('📅 Scheduling appointment...');
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            if (extractedData.type === 'CALLBACK') {
                console.log('📞 Handling callback request...');
                await handleCallbackRequest(customer, project, extractedData, tenantProjectId, supabase);
            }
            
            console.log('🎉 Webhook processing successful');
            res.json({ 
                success: true, 
                message: 'Webhook processed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    confidence_score: extractedData.confidence_score
                }
            });
        } else {
            console.log('⚠️ No valid customer data extracted, logging for manual review...');
            
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: actualCallId,
                call_type: 'inbound',
                duration_seconds: actualDuration,
                transcript: actualTranscript,
                call_purpose: 'data_extraction_failed',
                call_outcome: 'requires_manual_review',
                extracted_data: extractedData || { error: 'No valid data extracted' }
            });
            
            res.json({ 
                success: true, 
                message: 'Call logged for manual review', 
                requires_manual_review: true,
                extracted_data: extractedData,
                reason: extractedData ? 'Missing required fields (name/phone)' : 'No data extracted'
            });
        }
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Request body:', req.body);
        
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id || req.body.callId || 'unknown',
            timestamp: new Date().toISOString(),
            debug_info: {
                body_keys: Object.keys(req.body),
                error_type: error.name,
                error_stack: error.stack
            }
        });
    }
});
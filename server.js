// ENHANCED Main Webhook with Debug Logging
app.post('/api/retell/webhook', async (req, res) => {
    try {
        // Enhanced logging for debugging
        console.log('📞 Webhook received - FULL BODY:', JSON.stringify(req.body, null, 2));
        
        // Retell sends the main webhook data in different structure
        const webhookData = req.body;
        
        // Extract the actual values from the webhook
        const actualCallId = webhookData.call_id || 'unknown';
        const actualTranscript = webhookData.transcript || '';
        const actualDuration = Math.round((webhookData.duration_ms || 0) / 1000); // Convert ms to seconds
        const actualStatus = webhookData.call_status || 'unknown';
        
        console.log('📞 Extracted webhook data:', { 
            call_id: actualCallId, 
            call_status: actualStatus, 
            duration_ms: webhookData.duration_ms,
            duration_seconds: actualDuration,
            transcript_length: actualTranscript?.length || 0,
            transcript_preview: actualTranscript?.substring(0, 200) || 'No transcript found'
        });
        
        const tenantProjectId = await getTenantProjectId(supabase);
        if (!tenantProjectId) throw new Error('Tenant project not found');
        
        // Only process if we have a transcript
        if (actualTranscript && actualTranscript.length > 0) {
            console.log('📝 Processing transcript:', actualTranscript.substring(0, 300) + '...');
            
            const extractedData = extractCustomerDataIntelligent(actualTranscript);
            console.log('🎯 Extraction result:', extractedData);
            
            if (extractedData && extractedData.name && extractedData.phone) {
                console.log('✅ Valid data extracted, creating customer and project...');
                
                const customer = await createOrUpdateCustomer(extractedData, tenantProjectId, supabase);
                const project = await createProject(customer, extractedData, tenantProjectId, supabase);
                
                await saveCallRecord(actualCallId, actualTranscript, actualDuration, customer.id, project.id, extractedData, tenantProjectId, supabase);
                
                let appointment = null;
                if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                    console.log('📅 Scheduling appointment...');
                    appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId, supabase);
                    console.log('📅 Appointment result:', appointment ? 'SUCCESS' : 'FAILED');
                }
                
                if (extractedData.type === 'CALLBACK') {
                    console.log('📞 Handling callback request...');
                    const callbackResult = await handleCallbackRequest(customer, project, extractedData, tenantProjectId, supabase);
                    console.log('📞 Callback result:', callbackResult);
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
                console.log('📊 Extracted data details:', extractedData);
                
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
        } else {
            console.log('❌ No transcript found in webhook data');
            console.log('🔍 Available fields:', Object.keys(webhookData));
            
            // Still log the call even without transcript
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: actualCallId,
                call_type: 'inbound',
                duration_seconds: actualDuration,
                transcript: 'No transcript available',
                call_purpose: 'no_transcript',
                call_outcome: 'requires_manual_review',
                extracted_data: { error: 'No transcript in webhook' }
            });
            
            res.json({ 
                success: true, 
                message: 'Call logged without transcript', 
                requires_manual_review: true,
                reason: 'No transcript found in webhook data'
            });
        }
        
    } catch (error) {
        console.error('❌ Webhook Error:', error);
        console.error('❌ Error stack:', error.stack);
        console.error('❌ Request body keys:', Object.keys(req.body));
        
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id || 'unknown',
            timestamp: new Date().toISOString(),
            debug_info: {
                body_keys: Object.keys(req.body),
                error_type: error.name,
                has_transcript: !!req.body.transcript
            }
        });
    }
});
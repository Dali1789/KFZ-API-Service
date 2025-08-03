// ================================
// PERFORMANCE MIDDLEWARE
// ================================

const { monitor } = require('./performanceMonitor');

// Request monitoring middleware
function requestMonitoringMiddleware(req, res, next) {
    const requestId = monitor.generateRequestId();
    
    // Add requestId to request object
    req.requestId = requestId;
    req.startTime = Date.now();
    
    // Start monitoring
    monitor.startRequest(requestId, req.originalUrl, req.method);
    
    // Override res.json to capture response size
    const originalJson = res.json;
    res.json = function(data) {
        const responseSize = JSON.stringify(data).length;
        monitor.endRequest(requestId, res.statusCode, responseSize);
        return originalJson.call(this, data);
    };
    
    // Override res.send for non-JSON responses
    const originalSend = res.send;
    res.send = function(data) {
        const responseSize = typeof data === 'string' ? data.length : JSON.stringify(data).length;
        monitor.endRequest(requestId, res.statusCode, responseSize);
        return originalSend.call(this, data);
    };
    
    // Handle errors
    res.on('finish', () => {
        if (!res.headersSent) {
            monitor.endRequest(requestId, res.statusCode, 0);
        }
    });
    
    next();
}

// Extraction monitoring wrapper
function monitorExtraction(requestId, extractionFunction) {
    return async function(transcript) {
        monitor.startExtraction(requestId, transcript);
        
        try {
            // Call the original extraction function
            const result = await extractionFunction(transcript);
            
            // Mark successful extraction
            if (result) {
                monitor.markExtractionMethod(
                    requestId, 
                    result.extraction_details?.method || 'unknown',
                    true,
                    result.confidence_score || 0,
                    result
                );
            }
            
            monitor.endExtraction(requestId, result, 1);
            return result;
            
        } catch (error) {
            monitor.logError(requestId, error, { phase: 'extraction' });
            monitor.endExtraction(requestId, null, 1);
            throw error;
        }
    };
}

// Database operation monitoring wrapper
function monitorDatabaseOperation(requestId, operation, table) {
    return {
        start: () => monitor.startDatabaseOperation(requestId, operation, table),
        end: (success, recordsAffected = 0) => monitor.endDatabaseOperation(requestId, operation, table, success, recordsAffected)
    };
}

// Webhook monitoring wrapper
function monitorWebhook(requestId, webhookFunction) {
    return async function(payload) {
        monitor.logWebhookReceived(requestId, payload);
        
        try {
            const result = await webhookFunction(payload);
            monitor.logWebhookProcessed(requestId, result);
            return result;
            
        } catch (error) {
            monitor.logError(requestId, error, { phase: 'webhook_processing' });
            monitor.logWebhookProcessed(requestId, { success: false, error: error.message });
            throw error;
        }
    };
}

// Error handling middleware
function errorMonitoringMiddleware(err, req, res, next) {
    if (req.requestId) {
        monitor.logError(req.requestId, err, {
            url: req.originalUrl,
            method: req.method,
            userAgent: req.get('User-Agent'),
            ip: req.ip
        });
    }
    
    // Continue with error handling
    next(err);
}

// Performance helper functions
function markPhase(req, phaseName) {
    if (req.requestId) {
        monitor.markPhase(req.requestId, phaseName);
    }
}

function logCustomMetric(req, metricName, value, context = {}) {
    if (req.requestId) {
        monitor.logError(req.requestId, new Error(`Custom Metric: ${metricName} = ${value}`), {
            type: 'custom_metric',
            metric: metricName,
            value,
            ...context
        });
    }
}

module.exports = {
    requestMonitoringMiddleware,
    errorMonitoringMiddleware,
    monitorExtraction,
    monitorDatabaseOperation,
    monitorWebhook,
    markPhase,
    logCustomMetric,
    monitor
};

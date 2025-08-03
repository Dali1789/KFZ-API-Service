// ================================
// PERFORMANCE MONITORING MODULE
// ================================

class PerformanceMonitor {
    constructor() {
        this.metrics = {
            requests: new Map(),
            extraction: new Map(),
            database: new Map(),
            errors: new Map(),
            webhooks: new Map()
        };
        
        this.startTime = Date.now();
        this.requestCount = 0;
        this.errorCount = 0;
        
        // Real-time metrics
        this.realtimeStats = {
            extractionTimes: [],
            databaseTimes: [],
            webhookTimes: [],
            memoryUsage: [],
            cpuUsage: []
        };
        
        // Start monitoring intervals
        this.startSystemMonitoring();
    }
    
    // ================================
    // REQUEST MONITORING
    // ================================
    
    startRequest(requestId, endpoint, method) {
        this.requestCount++;
        this.metrics.requests.set(requestId, {
            endpoint,
            method,
            startTime: Date.now(),
            startMemory: process.memoryUsage().heapUsed,
            phases: new Map()
        });
        
        console.log(`📊 [${requestId}] Request started: ${method} ${endpoint}`);
    }
    
    markPhase(requestId, phaseName) {
        const request = this.metrics.requests.get(requestId);
        if (request) {
            request.phases.set(phaseName, Date.now() - request.startTime);
            console.log(`⏱️ [${requestId}] ${phaseName}: ${request.phases.get(phaseName)}ms`);
        }
    }
    
    endRequest(requestId, statusCode, responseSize = 0) {
        const request = this.metrics.requests.get(requestId);
        if (!request) return;
        
        const totalTime = Date.now() - request.startTime;
        const memoryDelta = process.memoryUsage().heapUsed - request.startMemory;
        
        const finalMetrics = {
            ...request,
            endTime: Date.now(),
            totalTime,
            statusCode,
            responseSize,
            memoryDelta,
            success: statusCode < 400
        };
        
        this.metrics.requests.set(requestId, finalMetrics);
        
        // Update real-time stats
        this.updateRealtimeStats('request', totalTime);
        
        console.log(`✅ [${requestId}] Request completed: ${totalTime}ms, Status: ${statusCode}, Memory: ${this.formatBytes(memoryDelta)}`);
        
        // Clean up old requests (keep last 100)
        if (this.metrics.requests.size > 100) {
            const oldestKey = this.metrics.requests.keys().next().value;
            this.metrics.requests.delete(oldestKey);
        }
    }
    
    // ================================
    // EXTRACTION MONITORING
    // ================================
    
    startExtraction(requestId, transcript) {
        const extractionId = `${requestId}_extraction`;
        this.metrics.extraction.set(extractionId, {
            requestId,
            startTime: Date.now(),
            transcriptLength: transcript?.length || 0,
            methods: []
        });
        
        console.log(`🧠 [${extractionId}] Extraction started: ${transcript?.length || 0} chars`);
    }
    
    markExtractionMethod(requestId, method, success, confidence, data) {
        const extractionId = `${requestId}_extraction`;
        const extraction = this.metrics.extraction.get(extractionId);
        
        if (extraction) {
            extraction.methods.push({
                method,
                success,
                confidence,
                timestamp: Date.now() - extraction.startTime,
                extractedFields: data ? Object.keys(data).filter(k => data[k]) : []
            });
            
            console.log(`🎯 [${extractionId}] Method ${method}: ${success ? '✅' : '❌'}, Confidence: ${confidence}`);
        }
    }
    
    endExtraction(requestId, finalData, totalMethods) {
        const extractionId = `${requestId}_extraction`;
        const extraction = this.metrics.extraction.get(extractionId);
        
        if (extraction) {
            const totalTime = Date.now() - extraction.startTime;
            
            extraction.endTime = Date.now();
            extraction.totalTime = totalTime;
            extraction.success = !!(finalData && finalData.name && finalData.phone);
            extraction.finalConfidence = finalData?.confidence_score || 0;
            extraction.methodsUsed = totalMethods;
            extraction.extractedFieldCount = finalData ? Object.keys(finalData).filter(k => finalData[k]).length : 0;
            
            // Update real-time stats
            this.updateRealtimeStats('extraction', totalTime);
            this.realtimeStats.extractionTimes.push({
                time: totalTime,
                success: extraction.success,
                confidence: extraction.finalConfidence,
                timestamp: Date.now()
            });
            
            console.log(`🏁 [${extractionId}] Extraction completed: ${totalTime}ms, Success: ${extraction.success}, Fields: ${extraction.extractedFieldCount}`);
        }
    }
    
    // ================================
    // DATABASE MONITORING
    // ================================
    
    startDatabaseOperation(requestId, operation, table) {
        const dbId = `${requestId}_db_${operation}_${table}`;
        this.metrics.database.set(dbId, {
            requestId,
            operation,
            table,
            startTime: Date.now()
        });
        
        console.log(`💾 [${dbId}] Database operation started: ${operation} on ${table}`);
    }
    
    endDatabaseOperation(requestId, operation, table, success, recordsAffected = 0) {
        const dbId = `${requestId}_db_${operation}_${table}`;
        const dbOp = this.metrics.database.get(dbId);
        
        if (dbOp) {
            const totalTime = Date.now() - dbOp.startTime;
            
            dbOp.endTime = Date.now();
            dbOp.totalTime = totalTime;
            dbOp.success = success;
            dbOp.recordsAffected = recordsAffected;
            
            // Update real-time stats
            this.updateRealtimeStats('database', totalTime);
            this.realtimeStats.databaseTimes.push({
                time: totalTime,
                operation,
                table,
                success,
                timestamp: Date.now()
            });
            
            console.log(`💾 [${dbId}] Database operation completed: ${totalTime}ms, Success: ${success}, Records: ${recordsAffected}`);
        }
    }
    
    // ================================
    // ERROR MONITORING
    // ================================
    
    logError(requestId, error, context = {}) {
        this.errorCount++;
        const errorId = `error_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        
        this.metrics.errors.set(errorId, {
            requestId,
            error: {
                message: error.message,
                stack: error.stack,
                name: error.name
            },
            context,
            timestamp: Date.now()
        });
        
        console.error(`❌ [${errorId}] Error logged:`, error.message);
        
        // Keep only last 50 errors
        if (this.metrics.errors.size > 50) {
            const oldestErrorKey = this.metrics.errors.keys().next().value;
            this.metrics.errors.delete(oldestErrorKey);
        }
    }
    
    // ================================
    // WEBHOOK MONITORING
    // ================================
    
    logWebhookReceived(requestId, payload) {
        const webhookId = `${requestId}_webhook`;
        this.metrics.webhooks.set(webhookId, {
            requestId,
            startTime: Date.now(),
            payloadSize: JSON.stringify(payload).length,
            callId: payload.call_id,
            transcriptLength: payload.transcript?.length || 0,
            duration: payload.duration_seconds || 0
        });
        
        console.log(`🔗 [${webhookId}] Webhook received: Call ${payload.call_id}, Duration: ${payload.duration_seconds}s`);
    }
    
    logWebhookProcessed(requestId, result) {
        const webhookId = `${requestId}_webhook`;
        const webhook = this.metrics.webhooks.get(requestId);
        
        if (webhook) {
            webhook.endTime = Date.now();
            webhook.totalTime = webhook.endTime - webhook.startTime;
            webhook.success = result.success;
            webhook.customerCreated = result.data?.customer;
            webhook.projectCreated = result.data?.project;
            webhook.appointmentScheduled = result.data?.appointment_scheduled;
            
            // Update real-time stats
            this.updateRealtimeStats('webhook', webhook.totalTime);
            this.realtimeStats.webhookTimes.push({
                time: webhook.totalTime,
                success: webhook.success,
                timestamp: Date.now()
            });
            
            console.log(`🔗 [${webhookId}] Webhook processed: ${webhook.totalTime}ms, Success: ${webhook.success}`);
        }
    }
    
    // ================================
    // SYSTEM MONITORING
    // ================================
    
    startSystemMonitoring() {
        // Monitor system metrics every 30 seconds
        setInterval(() => {
            const memUsage = process.memoryUsage();
            const cpuUsage = process.cpuUsage();
            
            this.realtimeStats.memoryUsage.push({
                heapUsed: memUsage.heapUsed,
                heapTotal: memUsage.heapTotal,
                external: memUsage.external,
                rss: memUsage.rss,
                timestamp: Date.now()
            });
            
            this.realtimeStats.cpuUsage.push({
                user: cpuUsage.user,
                system: cpuUsage.system,
                timestamp: Date.now()
            });
            
            // Keep only last 120 entries (1 hour)
            if (this.realtimeStats.memoryUsage.length > 120) {
                this.realtimeStats.memoryUsage.shift();
            }
            if (this.realtimeStats.cpuUsage.length > 120) {
                this.realtimeStats.cpuUsage.shift();
            }
            
        }, 30000);
    }
    
    updateRealtimeStats(type, value) {
        const statKey = `${type}Times`;
        if (this.realtimeStats[statKey]) {
            this.realtimeStats[statKey].push({
                value,
                timestamp: Date.now()
            });
            
            // Keep only last 100 entries
            if (this.realtimeStats[statKey].length > 100) {
                this.realtimeStats[statKey].shift();
            }
        }
    }
    
    // ================================
    // ANALYTICS & REPORTING
    // ================================
    
    getPerformanceReport() {
        const now = Date.now();
        const uptime = now - this.startTime;
        
        // Calculate averages
        const recentRequests = Array.from(this.metrics.requests.values())
            .filter(r => r.endTime && (now - r.endTime) < 3600000); // Last hour
        
        const recentExtractions = Array.from(this.metrics.extraction.values())
            .filter(e => e.endTime && (now - e.endTime) < 3600000);
        
        const recentErrors = Array.from(this.metrics.errors.values())
            .filter(e => (now - e.timestamp) < 3600000);
        
        const avgRequestTime = recentRequests.length > 0 
            ? recentRequests.reduce((sum, r) => sum + r.totalTime, 0) / recentRequests.length 
            : 0;
            
        const avgExtractionTime = recentExtractions.length > 0 
            ? recentExtractions.reduce((sum, e) => sum + e.totalTime, 0) / recentExtractions.length 
            : 0;
        
        const extractionSuccessRate = recentExtractions.length > 0 
            ? (recentExtractions.filter(e => e.success).length / recentExtractions.length * 100).toFixed(1) 
            : 0;
        
        const currentMemory = process.memoryUsage();
        
        return {
            system: {
                uptime: uptime,
                uptimeFormatted: this.formatDuration(uptime),
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch
            },
            performance: {
                totalRequests: this.requestCount,
                totalErrors: this.errorCount,
                errorRate: this.requestCount > 0 ? (this.errorCount / this.requestCount * 100).toFixed(2) : 0,
                avgRequestTime: Math.round(avgRequestTime),
                avgExtractionTime: Math.round(avgExtractionTime),
                extractionSuccessRate: `${extractionSuccessRate}%`
            },
            memory: {
                heapUsed: this.formatBytes(currentMemory.heapUsed),
                heapTotal: this.formatBytes(currentMemory.heapTotal),
                external: this.formatBytes(currentMemory.external),
                rss: this.formatBytes(currentMemory.rss)
            },
            recent: {
                requests: recentRequests.length,
                extractions: recentExtractions.length,
                errors: recentErrors.length,
                successfulExtractions: recentExtractions.filter(e => e.success).length
            },
            realtime: {
                lastHourRequestTimes: this.realtimeStats.extractionTimes.slice(-60),
                lastHourMemoryUsage: this.realtimeStats.memoryUsage.slice(-60),
                extractionMethodBreakdown: this.getExtractionMethodBreakdown(recentExtractions)
            }
        };
    }
    
    getExtractionMethodBreakdown(extractions) {
        const breakdown = {
            advanced_nlp: { total: 0, successful: 0 },
            natural_language: { total: 0, successful: 0 },
            structured_format: { total: 0, successful: 0 }
        };
        
        extractions.forEach(extraction => {
            extraction.methods?.forEach(method => {
                if (breakdown[method.method]) {
                    breakdown[method.method].total++;
                    if (method.success) {
                        breakdown[method.method].successful++;
                    }
                }
            });
        });
        
        // Calculate success rates
        Object.keys(breakdown).forEach(method => {
            const data = breakdown[method];
            data.successRate = data.total > 0 ? (data.successful / data.total * 100).toFixed(1) : 0;
        });
        
        return breakdown;
    }
    
    getHealthCheck() {
        const report = this.getPerformanceReport();
        const memUsage = process.memoryUsage();
        const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal * 100).toFixed(1);
        
        const status = {
            status: 'healthy',
            checks: {
                memory: heapUsagePercent < 80 ? 'ok' : 'warning',
                errorRate: parseFloat(report.performance.errorRate) < 5 ? 'ok' : 'warning',
                extractionRate: parseFloat(report.performance.extractionSuccessRate) > 70 ? 'ok' : 'warning',
                responseTime: report.performance.avgRequestTime < 2000 ? 'ok' : 'warning'
            }
        };
        
        // Determine overall status
        const warningCount = Object.values(status.checks).filter(check => check === 'warning').length;
        if (warningCount > 0) {
            status.status = warningCount > 2 ? 'unhealthy' : 'degraded';
        }
        
        return {
            ...status,
            metrics: report,
            timestamp: new Date().toISOString()
        };
    }
    
    // ================================
    // UTILITY METHODS
    // ================================
    
    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        const days = Math.floor(hours / 24);
        
        if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
        if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
        return `${seconds}s`;
    }
    
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }
}

// Create singleton instance
const performanceMonitor = new PerformanceMonitor();

module.exports = {
    monitor: performanceMonitor,
    PerformanceMonitor
};

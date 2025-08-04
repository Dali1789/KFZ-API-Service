// ================================
// ENHANCED DATA EXTRACTION MODULE
// ================================

// Validation Helper Functions
function isValidName(name) {
    if (!name || name.length < 2) return false;
    
    const invalidNames = [
        'heute', 'morgen', 'termin', 'unfall', 'auto', 'fahrzeug', 'schaden',
        'herr', 'frau', 'hallo', 'guten tag', 'ja', 'nein', 'okay', 'gut',
        'telefon', 'nummer', 'adresse', 'straße', 'haus', 'nummer'
    ];
    
    if (invalidNames.includes(name.toLowerCase())) return false;
    if (name.match(/\d/)) return false;
    if (name.length > 50) return false;
    if (!name.match(/[a-zäöüß]/i)) return false;
    
    return true;
}

function normalizePhoneNumber(phone) {
    let normalized = phone.replace(/[^\d+]/g, '');
    
    if (normalized.startsWith('+49')) {
        normalized = '0' + normalized.substring(3);
    }
    
    if (!normalized.startsWith('0')) {
        normalized = '0' + normalized;
    }
    
    return normalized;
}

function isValidGermanPhone(phone) {
    if (!phone) return false;
    
    const normalized = normalizePhoneNumber(phone);
    
    if (normalized.length < 10 || normalized.length > 12) return false;
    if (!normalized.startsWith('0')) return false;
    
    const validAreaCodes = ['030', '040', '069', '089', '0521', '0211', '0221', '0231'];
    const hasValidAreaCode = validAreaCodes.some(code => normalized.startsWith(code));
    
    return hasValidAreaCode || normalized.match(/^0[1-9]\d{8,10}$/);
}

function cleanAddress(address) {
    return address
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/,\s*,/g, ',')
        .replace(/^\s*,\s*/, '')
        .replace(/\s*,\s*$/, '');
}

function isValidAddress(address) {
    if (!address || address.length < 5) return false;
    
    const hasStreetType = /(?:straße|str\.?|weg|platz|allee|ring|damm|gasse)/i.test(address);
    const hasNumber = /\d+/.test(address);
    
    return hasStreetType && hasNumber;
}

// Advanced Data Extraction
function extractCustomerDataAdvanced(transcript) {
    console.log('🧠 Advanced Natural Language Processing gestartet...');
    
    // CRITICAL FIX: Check if transcript exists and is valid
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        console.log('❌ No valid transcript provided');
        return null;
    }
    
    const extractedData = {
        name: null,
        phone: null,
        address: null,
        appointment: null,
        type: 'CALLBACK',
        confidence_score: 0,
        extraction_details: {}
    };
    
    const transcriptLower = transcript.toLowerCase();
    let totalConfidence = 0;
    
    // ENHANCED NAME EXTRACTION
    const nameExtractionMethods = [
        {
            pattern: /(?:name ist|ich heiße|ich bin|mein name ist)\s+([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon|mein))/i,
            confidence: 0.9,
            description: 'Direct name introduction'
        },
        {
            pattern: /(?:hallo|guten tag),?\s*(?:ich bin|mein name ist)?\s*([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon))/i,
            confidence: 0.8,
            description: 'Greeting with name'
        },
        {
            pattern: /(?:hier ist|hier spricht)\s+([a-zäöüß\s]+?)(?:\.|,|$)/i,
            confidence: 0.85,
            description: 'Phone introduction'
        },
        {
            pattern: /von\s+([a-zäöüß]+\s+[a-zäöüß]+)(?:\s|$)/i,
            confidence: 0.7,
            description: 'From name pattern'
        }
    ];
    
    for (const method of nameExtractionMethods) {
        const match = transcript.match(method.pattern);
        if (match) {
            const name = match[1].trim();
            if (isValidName(name)) {
                extractedData.name = name;
                extractedData.extraction_details.name_method = method.description;
                extractedData.extraction_details.name_confidence = method.confidence;
                totalConfidence += method.confidence;
                console.log(`👤 Name gefunden (${method.confidence}): ${name}`);
                break;
            }
        }
    }
    
    // ENHANCED PHONE EXTRACTION
    const phoneExtractionMethods = [
        {
            pattern: /(?:telefon|nummer|telefonnummer|erreichbar|anrufen|melden)\s*(?:ist|unter|:|\s)*\s*((?:\+49|0)[0-9\s\-\/]{8,})/i,
            confidence: 0.95,
            description: 'Direct phone mention'
        },
        {
            pattern: /(?:null|0)\s*([0-9]{3,4})\s*([0-9]{6,8})/i,
            confidence: 0.8,
            description: 'Spoken digit format'
        },
        {
            pattern: /((?:\+49|0)[0-9\s\-\/]{8,})/g,
            confidence: 0.7,
            description: 'Phone number pattern'
        }
    ];
    
    for (const method of phoneExtractionMethods) {
        const match = transcript.match(method.pattern);
        if (match) {
            const phone = normalizePhoneNumber(match[1]);
            if (isValidGermanPhone(phone)) {
                extractedData.phone = phone;
                extractedData.extraction_details.phone_method = method.description;
                extractedData.extraction_details.phone_confidence = method.confidence;
                totalConfidence += method.confidence;
                console.log(`📞 Telefon gefunden (${method.confidence}): ${phone}`);
                break;
            }
        }
    }
    
    // ENHANCED ADDRESS EXTRACTION
    const addressExtractionMethods = [
        {
            pattern: /(?:adresse|wohne|wohnhaft|zuhause|ich bin|bei mir|zu mir)[\s\w]*?(?:ist|in|an|bei|:)?\s*([a-zäöüß\s]+(?:straße|str\.?|weg|platz|allee|ring|damm|gasse)[\s\d\w,-]+)/i,
            confidence: 0.9,
            description: 'Direct address mention'
        },
        {
            pattern: /(?:zur besichtigung|vor ort|kommen sie|fahren sie|besuchen sie)[\s\w]*?(?:zu|nach|in|an)?\s*([a-zäöüß\s]+(?:straße|str\.?|weg|platz|allee|ring|damm|gasse)[\s\d\w,-]+)/i,
            confidence: 0.85,
            description: 'Appointment location'
        },
        {
            pattern: /([a-zäöüß\s]+(?:straße|str\.?|weg|platz|allee|ring|damm|gasse)\s*\d+[a-z]?(?:[,\s]*\d{5})?[,\s]*[a-zäöüß\s]*)/i,
            confidence: 0.75,
            description: 'Standard German address format'
        }
    ];
    
    for (const method of addressExtractionMethods) {
        const match = transcript.match(method.pattern);
        if (match) {
            const address = cleanAddress(match[1]);
            if (isValidAddress(address)) {
                extractedData.address = address;
                extractedData.extraction_details.address_method = method.description;
                extractedData.extraction_details.address_confidence = method.confidence;
                totalConfidence += method.confidence;
                console.log(`🏠 Adresse gefunden (${method.confidence}): ${address}`);
                break;
            }
        }
    }
    
    // APPOINTMENT DETECTION
    const appointmentMethods = [
        {
            pattern: /(?:termin|besichtigung|vor ort|begutachtung)[\s\w]*?(?:für|am|um|morgen|heute|nächste woche|montag|dienstag|mittwoch|donnerstag|freitag|samstag)/i,
            confidence: 0.9,
            description: 'Direct appointment request'
        },
        {
            pattern: /(?:kommen sie|fahren sie|besuchen sie|schauen sie)[\s\w]*?(?:vorbei|zu mir|bei mir)/i,
            confidence: 0.8,
            description: 'Visit request'
        }
    ];
    
    for (const method of appointmentMethods) {
        const match = transcript.match(method.pattern);
        if (match) {
            extractedData.appointment = match[0];
            extractedData.extraction_details.appointment_method = method.description;
            extractedData.extraction_details.appointment_confidence = method.confidence;
            console.log(`📅 Termin erkannt (${method.confidence}): ${match[0]}`);
            break;
        }
    }
    
    // CALL TYPE DETERMINATION
    const typeIndicators = {
        APPOINTMENT: [
            'termin', 'besichtigung', 'kommen sie', 'vor ort', 'begutachtung', 
            'schauen sie', 'fahren sie', 'besuchen sie', 'bei mir', 'zu mir'
        ],
        CALLBACK: [
            'rückruf', 'anrufen', 'melden sie sich', 'nicht parat', 
            'später', 'beratung', 'sprechen sie', 'kontakt'
        ],
        QUOTE: [
            'kostenvoranschlag', 'angebot', 'preis', 'kosten', 'was kostet',
            'kalkulation', 'schätzung'
        ]
    };
    
    let typeScores = { APPOINTMENT: 0, CALLBACK: 0, QUOTE: 0 };
    
    for (const [type, keywords] of Object.entries(typeIndicators)) {
        for (const keyword of keywords) {
            if (transcriptLower.includes(keyword)) {
                typeScores[type]++;
            }
        }
    }
    
    if (extractedData.address) typeScores.APPOINTMENT += 3;
    if (extractedData.appointment) typeScores.APPOINTMENT += 2;
    
    const maxScore = Math.max(...Object.values(typeScores));
    if (maxScore > 0) {
        extractedData.type = Object.keys(typeScores).find(key => typeScores[key] === maxScore);
    }
    
    // Calculate confidence
    const fieldCount = [extractedData.name, extractedData.phone, extractedData.address].filter(Boolean).length;
    extractedData.confidence_score = Math.min(1.0, (totalConfidence / 3) * (fieldCount / 3));
    
    console.log(`🎯 Advanced Extraction - Confidence: ${extractedData.confidence_score.toFixed(2)}`);
    console.log(`📋 Call Type: ${extractedData.type}`);
    
    return extractedData.confidence_score > 0.3 ? extractedData : null;
}

// Natural Language Extraction (Fallback)
function extractCustomerDataNatural(transcript) {
    console.log('🧠 Versuche natürliche Datenextraktion...');
    
    // CRITICAL FIX: Check if transcript exists
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        console.log('❌ No valid transcript for natural extraction');
        return null;
    }
    
    const extractedData = {
        name: null,
        phone: null,
        address: null,
        appointment: null,
        type: 'CALLBACK'
    };
    
    const transcriptLower = transcript.toLowerCase();
    
    // Basic name patterns
    const namePatterns = [
        /(?:name ist|ich heiße|ich bin|mein name ist)\s+([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon|mein))/i,
        /(?:hallo|guten tag),?\s*(?:ich bin|mein name ist)?\s*([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon))/i
    ];
    
    for (const pattern of namePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const name = match[1].trim();
            if (name.length > 2 && !name.match(/\d/)) {
                extractedData.name = name;
                break;
            }
        }
    }
    
    // Basic phone patterns
    const phonePatterns = [
        /(?:telefon|nummer|telefonnummer|erreichbar)\s*(?:ist|unter|:)?\s*((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/i,
        /((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/
    ];
    
    for (const pattern of phonePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const phone = match[1].replace(/[\s\-\/]/g, '').trim();
            if (phone.length >= 9) {
                extractedData.phone = phone;
                break;
            }
        }
    }
    
    // Basic address patterns
    const addressPatterns = [
        /(?:adresse|wohne|wohnhaft)\s+(?:ist|in|an|bei)?\s*([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i
    ];
    
    for (const pattern of addressPatterns) {
        const match = transcript.match(pattern);
        if (match) {
            extractedData.address = match[1].trim();
            break;
        }
    }
    
    // Basic appointment detection
    if (transcriptLower.includes('termin') || transcriptLower.includes('besichtigung')) {
        extractedData.type = 'APPOINTMENT';
    }
    
    const hasValidData = extractedData.name && extractedData.phone;
    return hasValidData ? extractedData : null;
}

// Structured format extraction (legacy support)
function extractCustomerData(transcript) {
    console.log('🔍 Versuche DATENERFASSUNG-Extraktion...');
    
    // CRITICAL FIX: Check if transcript exists
    if (!transcript || typeof transcript !== 'string') {
        console.log('❌ No valid transcript for structured extraction');
        return null;
    }
    
    const dataMatch = transcript.match(/DATENERFASSUNG:\s*(.+)/i);
    if (!dataMatch) return null;
    
    const dataString = dataMatch[1];
    const extractedData = {};
    
    const patterns = {
        name: /Name=\[([^\]]+)\]/i,
        phone: /Telefon=\[([^\]]+)\]/i,
        address: /Adresse=\[([^\]]+)\]/i,
        appointment: /Termin=\[([^\]]+)\]/i,
        type: /Typ=([A-Z]+)/i
    };
    
    for (const [key, pattern] of Object.entries(patterns)) {
        const match = dataString.match(pattern);
        if (match) {
            extractedData[key] = match[1].trim();
        }
    }
    
    return Object.keys(extractedData).length > 0 ? extractedData : null;
}

// Main intelligent extraction function
function extractCustomerDataIntelligent(transcript) {
    console.log('🚀 Starte intelligente Datenextraktion...');
    
    // CRITICAL FIX: Validate transcript input
    if (!transcript || typeof transcript !== 'string' || transcript.trim().length === 0) {
        console.log('❌ Invalid transcript provided:', typeof transcript, transcript);
        return {
            name: null,
            phone: null,
            address: null,
            appointment: null,
            type: 'CALLBACK',
            confidence_score: 0,
            extraction_details: { error: 'Invalid or empty transcript' }
        };
    }
    
    console.log('📝 Transcript length:', transcript.length, 'chars');
    console.log('📝 Transcript preview:', transcript.substring(0, 100) + '...');
    
    // Method 1: Advanced Natural Language (preferred)
    let extractedData = extractCustomerDataAdvanced(transcript);
    
    // Method 2: Standard Natural Language
    if (!extractedData || (extractedData.confidence_score && extractedData.confidence_score < 0.5)) {
        console.log('⚠️ Advanced extraction low confidence, trying standard natural...');
        const naturalData = extractCustomerDataNatural(transcript);
        if (naturalData) {
            extractedData = {
                ...naturalData,
                confidence_score: 0.6,
                extraction_details: { method: 'standard_natural' }
            };
        }
    }
    
    // Method 3: Fallback to structured format
    if (!extractedData) {
        console.log('⚠️ Natural extraction failed, trying DATENERFASSUNG...');
        const legacyData = extractCustomerData(transcript);
        if (legacyData) {
            extractedData = {
                ...legacyData,
                confidence_score: 0.8,
                extraction_details: { method: 'structured_format' }
            };
        }
    }
    
    // Method 4: Hybrid approach
    if (extractedData) {
        const backupData = extractCustomerData(transcript);
        if (backupData) {
            for (const [key, value] of Object.entries(backupData)) {
                if (!extractedData[key] || extractedData[key] === 'Nicht erfasst') {
                    extractedData[key] = value;
                    console.log(`🔄 ${key} aus DATENERFASSUNG ergänzt:`, value);
                }
            }
        }
    }
    
    // Final fallback - return minimal structure
    if (!extractedData) {
        console.log('❌ Keine strukturierten Daten extrahierbar - returning fallback');
        extractedData = {
            name: null,
            phone: null,
            address: null,
            appointment: null,
            type: 'CALLBACK',
            confidence_score: 0,
            extraction_details: { 
                method: 'fallback',
                transcript_length: transcript.length,
                attempted_methods: ['advanced', 'natural', 'structured']
            }
        };
    }
    
    console.log('✅ Finale extrahierte Daten:', extractedData);
    
    return extractedData;
}

module.exports = {
    extractCustomerDataIntelligent,
    extractCustomerDataAdvanced,
    extractCustomerDataNatural,
    extractCustomerData,
    isValidName,
    isValidGermanPhone,
    isValidAddress,
    normalizePhoneNumber,
    cleanAddress
};
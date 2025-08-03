const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const { createClient } = require('@supabase/supabase-js');
require('dotenv').config();

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(morgan('combined'));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Supabase Client
const supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY
);

// ================================
// HELPER FUNCTIONS
// ================================

async function getTenantProjectId() {
    const { data } = await supabase
        .from('tenant_projects')
        .select('id')
        .eq('project_name', 'kfz-sachverstaendiger')
        .single();
    return data?.id;
}

async function generateProjectNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_projects')
        .select('*', { count: 'exact', head: true })
        .like('project_number', `P-${year}-%`);
    
    return `P-${year}-${(count + 1).toString().padStart(3, '0')}`;
}

async function generateCustomerNumber() {
    const year = new Date().getFullYear();
    const { count } = await supabase
        .from('kfz_customers')
        .select('*', { count: 'exact', head: true })
        .like('customer_number', `K-${year}-%`);
    
    return `K-${year}-${(count + 1).toString().padStart(3, '0')}`;
}

// ================================
// ENHANCED VALIDATION HELPER FUNCTIONS
// ================================

function isValidName(name) {
    if (!name || name.length < 2) return false;
    
    // Filter out common false positives
    const invalidNames = [
        'heute', 'morgen', 'termin', 'unfall', 'auto', 'fahrzeug', 'schaden',
        'herr', 'frau', 'hallo', 'guten tag', 'ja', 'nein', 'okay', 'gut',
        'telefon', 'nummer', 'adresse', 'straße', 'haus', 'nummer'
    ];
    
    if (invalidNames.includes(name.toLowerCase())) return false;
    if (name.match(/\d/)) return false; // No numbers in names
    if (name.length > 50) return false; // Too long
    
    // Must contain at least one letter
    if (!name.match(/[a-zäöüß]/i)) return false;
    
    return true;
}

function normalizePhoneNumber(phone) {
    // Remove all non-digit characters except +
    let normalized = phone.replace(/[^\d+]/g, '');
    
    // Convert +49 to 0
    if (normalized.startsWith('+49')) {
        normalized = '0' + normalized.substring(3);
    }
    
    // Ensure it starts with 0
    if (!normalized.startsWith('0')) {
        normalized = '0' + normalized;
    }
    
    return normalized;
}

function isValidGermanPhone(phone) {
    if (!phone) return false;
    
    const normalized = normalizePhoneNumber(phone);
    
    // German phone numbers: 0XXX XXXXXXX (10-12 digits total)
    if (normalized.length < 10 || normalized.length > 12) return false;
    if (!normalized.startsWith('0')) return false;
    
    // Common German area codes validation
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
    
    // Must contain street indicator and number
    const hasStreetType = /(?:straße|str\.?|weg|platz|allee|ring|damm|gasse)/i.test(address);
    const hasNumber = /\d+/.test(address);
    
    return hasStreetType && hasNumber;
}

// ================================
// ENHANCED DATA EXTRACTION FUNCTIONS
// ================================

function extractCustomerDataAdvanced(transcript) {
    console.log('🧠 Advanced Natural Language Processing gestartet...');
    
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
    
    // ENHANCED NAME EXTRACTION - Mehrschichtig
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
            // Enhanced validation
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
    
    // ENHANCED PHONE EXTRACTION - Multiple German formats
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
    
    // ENHANCED ADDRESS EXTRACTION - German address standards
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
    
    // ENHANCED APPOINTMENT DETECTION
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
        },
        {
            pattern: /(?:zeit|verfügbar|möglich)[\s\w]*?(?:für|am|um)\s*([a-z\s\d:]+)/i,
            confidence: 0.7,
            description: 'Time availability'
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
    
    // INTELLIGENT CALL TYPE DETERMINATION
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
    
    // Address presence strongly indicates appointment
    if (extractedData.address) typeScores.APPOINTMENT += 3;
    if (extractedData.appointment) typeScores.APPOINTMENT += 2;
    
    // Determine final type
    const maxScore = Math.max(...Object.values(typeScores));
    if (maxScore > 0) {
        extractedData.type = Object.keys(typeScores).find(key => typeScores[key] === maxScore);
    }
    
    // Calculate overall confidence
    const fieldCount = [extractedData.name, extractedData.phone, extractedData.address].filter(Boolean).length;
    extractedData.confidence_score = Math.min(1.0, (totalConfidence / 3) * (fieldCount / 3));
    
    console.log(`🎯 Advanced Extraction - Confidence: ${extractedData.confidence_score.toFixed(2)}`);
    console.log(`📋 Call Type determined: ${extractedData.type} (scores: ${JSON.stringify(typeScores)})`);
    
    return extractedData.confidence_score > 0.3 ? extractedData : null;
}

function extractCustomerDataNatural(transcript) {
    console.log('🧠 Versuche natürliche Datenextraktion...');
    
    const extractedData = {
        name: null,
        phone: null,
        address: null,
        appointment: null,
        type: 'CALLBACK'
    };
    
    const transcriptLower = transcript.toLowerCase();
    
    // Name extrahieren - Verschiedene natürliche Muster
    const namePatterns = [
        /(?:name ist|ich heiße|ich bin|mein name ist)\s+([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon|mein))/i,
        /(?:hallo|guten tag),?\s*(?:ich bin|mein name ist)?\s*([a-zäöüß\s]+?)(?:\.|,|$|\s+(?:und|meine|telefon))/i,
        /(?:^|\s)([a-zäöüß]+\s+[a-zäöüß]+)(?:\s+hier|$)/i
    ];
    
    for (const pattern of namePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const name = match[1].trim();
            // Filter out common false positives
            if (name.length > 2 && 
                !['heute', 'morgen', 'termin', 'unfall', 'auto', 'fahrzeug', 'schaden'].includes(name.toLowerCase()) &&
                !name.match(/\d/)) {
                extractedData.name = name;
                console.log('👤 Name gefunden:', name);
                break;
            }
        }
    }
    
    // Telefonnummer extrahieren - Verbesserte deutsche Formate
    const phonePatterns = [
        /(?:telefon|nummer|telefonnummer|erreichbar)\s*(?:ist|unter|:)?\s*((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/i,
        /(?:meine nummer ist|sie erreichen mich unter|rufen sie mich an unter)\s*((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/i,
        /((?:\+49|0)[\s\-]?[\d\s\-\/]{8,})/
    ];
    
    for (const pattern of phonePatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const phone = match[1].replace(/[\s\-\/]/g, '').trim();
            if (phone.length >= 9) {
                extractedData.phone = phone;
                console.log('📞 Telefon gefunden:', phone);
                break;
            }
        }
    }
    
    // Adresse extrahieren - Deutsche Adressformate
    const addressPatterns = [
        /(?:adresse|wohne|wohnhaft|zuhause|ich bin)\s+(?:ist|in|an|bei)?\s*([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i,
        /(?:zur besichtigung|vor ort|kommen sie)\s+(?:zu|nach|in)?\s*([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i,
        /([a-zäöüß\s]+(?:straße|str\.|weg|platz|allee)\s*\d+[a-z]?[,\s]*\d*\s*[a-zäöüß\s]*)/i
    ];
    
    for (const pattern of addressPatterns) {
        const match = transcript.match(pattern);
        if (match) {
            const address = match[1].trim();
            if (address.length > 5) {
                extractedData.address = address;
                console.log('🏠 Adresse gefunden:', address);
                break;
            }
        }
    }
    
    // Termin erkennen
    const appointmentPatterns = [
        /(?:termin|besichtigung|kommen|vor ort)\s*(?:für|am|um|morgen|heute|nächste woche|montag|dienstag|mittwoch|donnerstag|freitag)/i,
        /(?:morgen|heute|nächste woche)\s*(?:um|gegen)?\s*(\d{1,2}(?::\d{2})?)/i,
        /(?:um|gegen)\s*(\d{1,2}(?::\d{2}))\s*(?:uhr)?/i
    ];
    
    for (const pattern of appointmentPatterns) {
        const match = transcript.match(pattern);
        if (match) {
            extractedData.appointment = match[0];
            console.log('📅 Termin gefunden:', match[0]);
            break;
        }
    }
    
    // Call-Type intelligenter bestimmen
    if (transcriptLower.includes('termin') || 
        transcriptLower.includes('besichtigung') || 
        transcriptLower.includes('kommen sie') ||
        transcriptLower.includes('vor ort') ||
        extractedData.address) {
        extractedData.type = 'APPOINTMENT';
        console.log('📋 Call-Type: APPOINTMENT');
    } else if (transcriptLower.includes('rückruf') || 
               transcriptLower.includes('anrufen') ||
               transcriptLower.includes('nicht parat') ||
               transcriptLower.includes('später') ||
               transcriptLower.includes('beratung')) {
        extractedData.type = 'CALLBACK';
        console.log('📋 Call-Type: CALLBACK');
    }
    
    // Qualitätsprüfung
    const hasValidData = extractedData.name && extractedData.phone;
    console.log('🎯 Natürliche Extraktion Ergebnis:', hasValidData ? 'Erfolgreich' : 'Unvollständig');
    
    return hasValidData ? extractedData : null;
}

function extractCustomerData(transcript) {
    console.log('🔍 Versuche DATENERFASSUNG-Extraktion...');
    
    // Suche nach der DATENERFASSUNG-Zeile
    const dataMatch = transcript.match(/DATENERFASSUNG:\s*(.+)/i);
    if (!dataMatch) return null;
    
    const dataString = dataMatch[1];
    const extractedData = {};
    
    // Parse Name=[Wert], Telefon=[Wert], etc.
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
    
    console.log('📋 DATENERFASSUNG Ergebnis:', Object.keys(extractedData).length > 0 ? 'Erfolgreich' : 'Fehlgeschlagen');
    return Object.keys(extractedData).length > 0 ? extractedData : null;
}

// Intelligente Datenextraktion mit Fallback
function extractCustomerDataIntelligent(transcript) {
    console.log('🚀 Starte intelligente Datenextraktion...');
    
    // Methode 1: Advanced Natural Language (bevorzugt)
    let extractedData = extractCustomerDataAdvanced(transcript);
    
    // Methode 2: Standard Natürliche Sprache
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
    
    // Methode 3: Fallback auf DATENERFASSUNG-Format
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
    
    // Methode 4: Hybrid-Ansatz - Alle Methoden kombinieren
    if (extractedData) {
        const backupData = extractCustomerData(transcript);
        if (backupData) {
            // Ergänze fehlende Daten aus DATENERFASSUNG
            for (const [key, value] of Object.entries(backupData)) {
                if (!extractedData[key] || extractedData[key] === 'Nicht erfasst') {
                    extractedData[key] = value;
                    console.log(`🔄 ${key} aus DATENERFASSUNG ergänzt:`, value);
                }
            }
        }
    }
    
    if (extractedData) {
        console.log('✅ Finale extrahierte Daten:', extractedData);
    } else {
        console.log('❌ Keine strukturierten Daten extrahierbar');
    }
    
    return extractedData;
}

function parseNameParts(fullName) {
    if (!fullName) return { first_name: '', last_name: '' };
    
    const parts = fullName.trim().split(' ');
    const first_name = parts[0] || '';
    const last_name = parts.slice(1).join(' ') || '';
    
    return { first_name, last_name };
}

function extractAddressParts(address) {
    if (!address) return { street: null, city: 'Bielefeld' };
    
    // Verbesserte Adress-Parsing für deutsche Adressen
    const parts = address.split(',').map(p => p.trim());
    
    // Postleitzahl extrahieren
    const postalMatch = address.match(/\b(\d{5})\b/);
    const postal_code = postalMatch ? postalMatch[1] : null;
    
    // Stadt extrahieren (normalerweise nach PLZ oder am Ende)
    let city = 'Bielefeld'; // Default
    if (postalMatch) {
        const afterPostal = address.substring(address.indexOf(postalMatch[1]) + 5).trim();
        if (afterPostal) {
            city = afterPostal.split(/[,\n]/)[0].trim();
        }
    } else if (parts.length > 1) {
        city = parts[parts.length - 1];
    }
    
    // Straße ist normalerweise der erste Teil
    const street = parts[0] || null;
    
    return {
        street,
        city,
        postal_code
    };
}

function parseAppointmentDate(appointmentString) {
    if (!appointmentString) return null;
    
    const today = new Date();
    const appointmentLower = appointmentString.toLowerCase();
    
    // Zeit extrahieren
    const timeMatch = appointmentString.match(/(\d{1,2})(?::(\d{2}))?\s*(?:uhr)?/i);
    let hour = timeMatch ? parseInt(timeMatch[1]) : 10;
    let minute = timeMatch && timeMatch[2] ? parseInt(timeMatch[2]) : 0;
    
    // Default Zeit falls keine angegeben
    if (hour < 8 || hour > 18) hour = 10;
    
    let targetDate = new Date(today);
    
    // Tag bestimmen
    if (appointmentLower.includes('morgen')) {
        targetDate.setDate(today.getDate() + 1);
    } else if (appointmentLower.includes('heute')) {
        // Heute, aber mindestens 2 Stunden in der Zukunft
        if (hour <= today.getHours()) {
            hour = Math.max(today.getHours() + 2, 10);
        }
    } else if (appointmentLower.includes('montag')) {
        targetDate = getNextWeekday(today, 1);
    } else if (appointmentLower.includes('dienstag')) {
        targetDate = getNextWeekday(today, 2);
    } else if (appointmentLower.includes('mittwoch')) {
        targetDate = getNextWeekday(today, 3);
    } else if (appointmentLower.includes('donnerstag')) {
        targetDate = getNextWeekday(today, 4);
    } else if (appointmentLower.includes('freitag')) {
        targetDate = getNextWeekday(today, 5);
    } else {
        // Default: nächster Werktag
        targetDate.setDate(today.getDate() + 1);
        // Wochenende überspringen
        if (targetDate.getDay() === 0) targetDate.setDate(targetDate.getDate() + 1); // Sonntag -> Montag
        if (targetDate.getDay() === 6) targetDate.setDate(targetDate.getDate() + 2); // Samstag -> Montag
    }
    
    targetDate.setHours(hour, minute, 0, 0);
    return targetDate.toISOString();
}

function getNextWeekday(date, targetDay) {
    const result = new Date(date);
    const currentDay = result.getDay();
    const daysUntilTarget = (targetDay - currentDay + 7) % 7;
    
    if (daysUntilTarget === 0) {
        // Heute ist der gewünschte Tag - nächste Woche nehmen
        result.setDate(result.getDate() + 7);
    } else {
        result.setDate(result.getDate() + daysUntilTarget);
    }
    
    return result;
}

// ================================
// MAIN BUSINESS LOGIC
// ================================

async function createOrUpdateCustomer(data, tenantProjectId) {
    const { first_name, last_name } = parseNameParts(data.name);
    const { street, city, postal_code } = extractAddressParts(data.address);
    
    // Kunde anhand Telefonnummer suchen
    let { data: existingCustomer } = await supabase
        .from('kfz_customers')
        .select('*')
        .eq('phone', data.phone)
        .eq('tenant_project_id', tenantProjectId)
        .single();
    
    if (existingCustomer) {
        console.log('👤 Bestehender Kunde gefunden:', existingCustomer.customer_number);
        
        // Adresse aktualisieren falls neue Daten vorhanden
        if (data.address && !existingCustomer.street) {
            await supabase
                .from('kfz_customers')
                .update({ street, city, postal_code })
                .eq('id', existingCustomer.id);
        }
        
        return existingCustomer;
    }
    
    // Neuen Kunden erstellen
    const customerNumber = await generateCustomerNumber();
    
    const { data: newCustomer, error } = await supabase
        .from('kfz_customers')
        .insert({
            tenant_project_id: tenantProjectId,
            customer_number: customerNumber,
            first_name,
            last_name,
            phone: data.phone,
            street,
            city,
            postal_code,
            source: 'retell_call',
            status: 'active'
        })
        .select()
        .single();
    
    if (error) throw error;
    
    console.log('✅ Neuer Kunde erstellt:', newCustomer.customer_number);
    return newCustomer;
}

async function createProject(customer, data, tenantProjectId) {
    const projectNumber = await generateProjectNumber();
    
    const { data: project, error } = await supabase
        .from('kfz_projects')
        .insert({
            tenant_project_id: tenantProjectId,
            project_number: projectNumber,
            name: `KFZ-Schaden ${customer.first_name} ${customer.last_name}`,
            status: 'active',
            priority: 'normal',
            storage_path: `/kfz-sachverstaendiger/${projectNumber}/`,
            metadata: {
                created_from: 'retell_call',
                initial_contact: data,
                agent_version: 'markus-v3-enhanced',
                extraction_method: data.extraction_method || 'advanced_natural_language',
                confidence_score: data.confidence_score || 0
            }
        })
        .select()
        .single();
    
    if (error) throw error;
    
    // Kunde mit Projekt verknüpfen
    await supabase
        .from('kfz_project_customers')
        .insert({
            project_id: project.id,
            customer_id: customer.id,
            role: 'primary'
        });
    
    console.log('🏗️ Projekt erstellt:', project.project_number);
    return project;
}

async function saveCallRecord(callId, transcript, duration, customerId, projectId, extractedData, tenantProjectId) {
    const { error } = await supabase
        .from('kfz_calls')
        .insert({
            tenant_project_id: tenantProjectId,
            project_id: projectId,
            customer_id: customerId,
            retell_call_id: callId,
            call_type: 'inbound',
            duration_seconds: duration,
            transcript: transcript,
            extracted_data: extractedData,
            call_purpose: extractedData.type === 'CALLBACK' ? 'callback_request' : 'appointment_booking',
            call_outcome: 'successful',
            agent_version: 'markus-v3-enhanced'
        });
    
    if (error) throw error;
    console.log('📝 Call Record gespeichert');
}

async function scheduleAppointment(customer, project, data, tenantProjectId) {
    if (!data.appointment || data.type !== 'APPOINTMENT') return null;
    
    const { street, city } = extractAddressParts(data.address);
    
    const { data: appointment, error } = await supabase
        .from('kfz_appointments')
        .insert({
            tenant_project_id: tenantProjectId,
            project_id: project.id,
            customer_id: customer.id,
            appointment_type: 'inspection',
            scheduled_date: parseAppointmentDate(data.appointment),
            address: {
                street,
                city,
                full_address: data.address
            },
            status: 'scheduled'
        })
        .select()
        .single();
    
    if (!error) {
        console.log('📅 Termin geplant für:', data.appointment);
        return appointment;
    }
    
    return null;
}

async function logAnalyticsEvent(eventType, tenantProjectId, projectId, customerId, properties = {}) {
    await supabase
        .from('kfz_analytics_events')
        .insert({
            tenant_project_id: tenantProjectId,
            event_type: eventType,
            event_category: eventType.split('_')[0], // call, appointment, project
            project_id: projectId,
            customer_id: customerId,
            properties
        });
}

// ================================
// API ENDPOINTS
// ================================

// Health Check
app.get('/health', (req, res) => {
    res.json({ 
        status: 'OK', 
        service: 'KFZ-Sachverständiger API',
        version: '3.0.0-enhanced',
        features: [
            'advanced_natural_language_processing', 
            'multi_layered_extraction', 
            'confidence_scoring',
            'intelligent_validation',
            'enhanced_phone_handling',
            'german_address_standards'
        ],
        timestamp: new Date().toISOString(),
        uptime: process.uptime()
    });
});

// ENHANCED RETELL WEBHOOK - HAUPTENDPOINT
app.post('/api/retell/webhook', async (req, res) => {
    try {
        const { call_id, transcript, duration_seconds, call_status } = req.body;
        
        console.log('📞 Enhanced Retell Webhook:', { 
            call_id, 
            call_status, 
            duration: duration_seconds,
            transcript_length: transcript?.length || 0
        });
        
        const tenantProjectId = await getTenantProjectId();
        if (!tenantProjectId) {
            throw new Error('KFZ-Sachverständiger Projekt nicht gefunden');
        }
        
        // 1. ENHANCED INTELLIGENT EXTRACTION
        let extractedData = extractCustomerDataIntelligent(transcript);
        
        // 2. PROCESS EXTRACTED DATA
        if (extractedData && extractedData.name && extractedData.phone) {
            const customer = await createOrUpdateCustomer(extractedData, tenantProjectId);
            const project = await createProject(customer, extractedData, tenantProjectId);
            
            await saveCallRecord(
                call_id, 
                transcript, 
                duration_seconds, 
                customer.id, 
                project.id, 
                extractedData, 
                tenantProjectId
            );
            
            // Enhanced analytics with confidence scoring
            await logAnalyticsEvent(
                'call_completed_enhanced', 
                tenantProjectId, 
                project.id, 
                customer.id,
                { 
                    call_type: extractedData.type,
                    duration_seconds,
                    retell_call_id: call_id,
                    extraction_method: 'advanced_multi_layer',
                    confidence_score: extractedData.confidence_score || 0,
                    extraction_details: extractedData.extraction_details || {}
                }
            );
            
            // Handle appointments with enhanced logic
            let appointment = null;
            if (extractedData.type === 'APPOINTMENT' && extractedData.address) {
                appointment = await scheduleAppointment(customer, project, extractedData, tenantProjectId);
                
                if (appointment) {
                    await logAnalyticsEvent(
                        'appointment_scheduled_enhanced', 
                        tenantProjectId, 
                        project.id, 
                        customer.id,
                        { 
                            appointment_date: appointment.scheduled_date,
                            appointment_type: appointment.appointment_type,
                            confidence_score: extractedData.confidence_score || 0
                        }
                    );
                }
            }
            
            // Handle callbacks
            if (extractedData.type === 'CALLBACK') {
                await logAnalyticsEvent(
                    'callback_requested_enhanced', 
                    tenantProjectId, 
                    project.id, 
                    customer.id,
                    { 
                        customer_phone: customer.phone,
                        customer_name: `${customer.first_name} ${customer.last_name}`,
                        confidence_score: extractedData.confidence_score || 0
                    }
                );
            }
            
            res.json({ 
                success: true, 
                message: 'Enhanced webhook processing completed successfully',
                data: {
                    customer: customer.customer_number,
                    project: project.project_number,
                    type: extractedData.type,
                    appointment_scheduled: !!appointment,
                    extraction_method: 'advanced_multi_layer_nlp',
                    confidence_score: extractedData.confidence_score || 0,
                    extraction_details: extractedData.extraction_details || {}
                }
            });
            
        } else {
            // Enhanced fallback handling
            console.log('⚠️ No valid data extracted with any method');
            
            await supabase.from('kfz_calls').insert({
                tenant_project_id: tenantProjectId,
                retell_call_id: call_id,
                call_type: 'inbound',
                duration_seconds: duration_seconds,
                transcript: transcript,
                call_purpose: 'data_extraction_failed',
                call_outcome: 'requires_manual_review',
                agent_version: 'markus-v3-enhanced',
                extracted_data: extractedData || { extraction_failed: true, attempted_methods: ['advanced', 'natural', 'structured'] }
            });
            
            res.json({ 
                success: true, 
                message: 'Call logged for manual review - no extractable data found',
                data: { 
                    call_id,
                    requires_manual_review: true,
                    extraction_attempted: true,
                    extraction_methods_tried: ['advanced_nlp', 'natural_language', 'structured_format'],
                    confidence_score: extractedData?.confidence_score || 0
                }
            });
        }
        
    } catch (error) {
        console.error('❌ Enhanced Webhook Error:', error);
        res.status(500).json({ 
            error: error.message,
            call_id: req.body.call_id,
            timestamp: new Date().toISOString()
        });
    }
});

// Enhanced Dashboard API
app.get('/api/dashboard', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        
        // Heute's Statistiken
        const today = new Date().toISOString().split('T')[0];
        
        const [
            { count: projectsToday },
            { count: totalCalls },
            { count: pendingCallbacks },
            { count: scheduledAppointments },
            { count: totalCustomers },
            { data: recentCalls }
        ] = await Promise.all([
            supabase.from('kfz_projects').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today),
            
            supabase.from('kfz_calls').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today),
            
            supabase.from('kfz_calls').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .eq('call_purpose', 'callback_request'),
            
            supabase.from('kfz_appointments').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId)
                .eq('status', 'scheduled')
                .gte('scheduled_date', new Date().toISOString()),
            
            supabase.from('kfz_customers').select('*', { count: 'exact', head: true })
                .eq('tenant_project_id', tenantProjectId),
            
            supabase.from('kfz_calls')
                .select('extracted_data')
                .eq('tenant_project_id', tenantProjectId)
                .gte('created_at', today)
                .order('created_at', { ascending: false })
                .limit(10)
        ]);
        
        // Calculate extraction success rate
        const successfulExtractions = recentCalls.filter(call => 
            call.extracted_data && 
            call.extracted_data.name && 
            call.extracted_data.phone
        ).length;
        
        const extractionSuccessRate = recentCalls.length > 0 
            ? (successfulExtractions / recentCalls.length * 100).toFixed(1)
            : 0;
        
        // Calculate average confidence score
        const confidenceScores = recentCalls
            .map(call => call.extracted_data?.confidence_score)
            .filter(score => score !== undefined && score !== null);
        
        const averageConfidence = confidenceScores.length > 0
            ? (confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length).toFixed(2)
            : 0;
        
        res.json({
            today: {
                projects: projectsToday,
                calls: totalCalls
            },
            pending: {
                callbacks: pendingCallbacks,
                appointments: scheduledAppointments
            },
            totals: {
                customers: totalCustomers
            },
            extraction_analytics: {
                success_rate: `${extractionSuccessRate}%`,
                average_confidence: averageConfidence,
                total_processed: recentCalls.length
            },
            system: {
                version: '3.0.0-enhanced',
                features: [
                    'advanced_nlp',
                    'multi_layer_extraction',
                    'confidence_scoring',
                    'intelligent_validation'
                ]
            },
            lastUpdated: new Date().toISOString()
        });
        
    } catch (error) {
        console.error('Dashboard Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// New endpoint for extraction analytics
app.get('/api/extraction/analytics', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const { days = 7 } = req.query;
        
        const sinceDate = new Date();
        sinceDate.setDate(sinceDate.getDate() - parseInt(days));
        
        const { data: calls } = await supabase
            .from('kfz_calls')
            .select('extracted_data, created_at')
            .eq('tenant_project_id', tenantProjectId)
            .gte('created_at', sinceDate.toISOString());
        
        const analytics = {
            total_calls: calls.length,
            successful_extractions: 0,
            method_breakdown: {
                advanced_nlp: 0,
                natural_language: 0,
                structured_format: 0,
                failed: 0
            },
            confidence_distribution: {
                high: 0, // > 0.8
                medium: 0, // 0.5 - 0.8
                low: 0, // < 0.5
                unknown: 0
            },
            field_success_rates: {
                name: 0,
                phone: 0,
                address: 0,
                appointment: 0
            }
        };
        
        calls.forEach(call => {
            const data = call.extracted_data;
            
            if (data && data.name && data.phone) {
                analytics.successful_extractions++;
                
                // Method tracking
                const method = data.extraction_details?.method || 'unknown';
                if (analytics.method_breakdown[method] !== undefined) {
                    analytics.method_breakdown[method]++;
                }
                
                // Confidence tracking
                const confidence = data.confidence_score || 0;
                if (confidence > 0.8) {
                    analytics.confidence_distribution.high++;
                } else if (confidence >= 0.5) {
                    analytics.confidence_distribution.medium++;
                } else if (confidence > 0) {
                    analytics.confidence_distribution.low++;
                } else {
                    analytics.confidence_distribution.unknown++;
                }
                
                // Field success rates
                if (data.name) analytics.field_success_rates.name++;
                if (data.phone) analytics.field_success_rates.phone++;
                if (data.address) analytics.field_success_rates.address++;
                if (data.appointment) analytics.field_success_rates.appointment++;
            } else {
                analytics.method_breakdown.failed++;
            }
        });
        
        // Calculate percentages
        if (analytics.total_calls > 0) {
            analytics.success_rate = (analytics.successful_extractions / analytics.total_calls * 100).toFixed(1);
            
            Object.keys(analytics.field_success_rates).forEach(field => {
                analytics.field_success_rates[field] = 
                    (analytics.field_success_rates[field] / analytics.total_calls * 100).toFixed(1);
            });
        }
        
        res.json(analytics);
        
    } catch (error) {
        console.error('Extraction Analytics Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// ================================
// ADDITIONAL API ENDPOINTS
// ================================

// Get customers
app.get('/api/customers', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const { data, error } = await supabase
            .from('kfz_customers')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get projects
app.get('/api/projects', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const { data, error } = await supabase
            .from('kfz_projects')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get calls
app.get('/api/calls', async (req, res) => {
    try {
        const tenantProjectId = await getTenantProjectId();
        const { data, error } = await supabase
            .from('kfz_calls')
            .select('*')
            .eq('tenant_project_id', tenantProjectId)
            .order('created_at', { ascending: false });
        
        if (error) throw error;
        res.json(data);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// ================================
// SERVER START
// ================================

const PORT = process.env.PORT || 3000;

// Graceful shutdown
process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, shutting down gracefully...');
    process.exit(0);
});

process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, shutting down gracefully...');
    process.exit(0);
});

app.listen(PORT, () => {
    console.log('🚀 KFZ Sachverständiger API Server gestartet!');
    console.log(`📡 Port: ${PORT}`);
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log('🔄 Enhanced Multi-Layer Data Extraction Ready!');
    console.log('🎯 Advanced Natural Language Processing Active!');
    console.log('📊 Confidence Scoring & Analytics Enabled!');
    console.log('📖 API Dokumentation: /health');
    console.log('📈 Extraction Analytics: /api/extraction/analytics');
});

module.exports = app;
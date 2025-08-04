// database-init.js - Kompakte Database Initialization für Railway
const { Client } = require('pg');

let TENANT_PROJECT_ID = null;

// Hotfix: Direct Database Initialization
async function initializeTenantProject() {
  if (TENANT_PROJECT_ID) return TENANT_PROJECT_ID;
  
  console.log('🔥 HOTFIX: Tenant Project Initialization...');
  
  try {
    const pgClient = new Client({
      connectionString: process.env.POSTGRES_DIRECT_URL || process.env.SUPABASE_URL,
      ssl: false
    });
    
    await pgClient.connect();
    
    // Check if project exists
    const checkQuery = `SELECT id FROM tenant_projects WHERE project_name = 'kfz-sachverstaendiger' LIMIT 1`;
    const existing = await pgClient.query(checkQuery);
    
    if (existing.rows.length > 0) {
      TENANT_PROJECT_ID = existing.rows[0].id;
      console.log('✅ Tenant Project found:', TENANT_PROJECT_ID);
      await pgClient.end();
      return TENANT_PROJECT_ID;
    }
    
    // Create new project
    const insertQuery = `
      INSERT INTO tenant_projects (
        id, project_name, organization_name, owner_email, domain, settings, created_at
      ) VALUES (
        gen_random_uuid(),
        'kfz-sachverstaendiger',
        'DS-Sachverständigenbüro Bielefeld',
        'gutachter@unfallschaden-bielefeld.de',
        'unfallschaden-bielefeld.de',
        $1::jsonb,
        NOW()
      ) RETURNING id;
    `;
    
    const settings = {
      retell_agent_id: 'agent_33dd09f56fc57f5ebd9be1cdd8',
      business_type: 'kfz_expert',
      auto_create_projects: true,
      email_notifications: true
    };
    
    const result = await pgClient.query(insertQuery, [JSON.stringify(settings)]);
    TENANT_PROJECT_ID = result.rows[0].id;
    
    console.log('🎉 HOTFIX: Tenant Project created:', TENANT_PROJECT_ID);
    
    await pgClient.end();
    return TENANT_PROJECT_ID;
    
  } catch (error) {
    console.error('💥 HOTFIX Init Error:', error.message);
    return null;
  }
}

// Enhanced getTenantProjectId function
async function getTenantProjectIdEnhanced(supabase, requestId) {
  if (TENANT_PROJECT_ID) return TENANT_PROJECT_ID;
  
  try {
    // Try Supabase first
    const { data, error } = await supabase
      .from('tenant_projects')
      .select('id')
      .eq('project_name', 'kfz-sachverstaendiger')
      .single();
    
    if (data && !error) {
      TENANT_PROJECT_ID = data.id;
      return TENANT_PROJECT_ID;
    }
    
    // Fallback to direct database
    console.log(`🔄 [${requestId}] Fallback to direct database init...`);
    return await initializeTenantProject();
    
  } catch (error) {
    console.log(`🔄 [${requestId}] Direct database fallback...`);
    return await initializeTenantProject();
  }
}

module.exports = {
  initializeTenantProject,
  getTenantProjectIdEnhanced,
  getTenantProjectId: getTenantProjectIdEnhanced // Compatibility
};

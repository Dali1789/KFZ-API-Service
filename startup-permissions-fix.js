// startup-permissions-fix.js - Automatischer Permissions Fix beim Server-Start
const { Client } = require('pg');

async function fixDatabasePermissions() {
  console.log('🔧 Starting Database Permissions Fix...');
  
  try {
    const pgClient = new Client({
      connectionString: process.env.POSTGRES_DIRECT_URL || process.env.SUPABASE_URL,
      ssl: false
    });
    
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL directly');
    
    // Fix 1: Disable RLS for all tables
    const disableRLS = [
      'tenant_projects', 'kfz_users', 'kfz_customers', 'kfz_projects', 
      'kfz_project_customers', 'kfz_calls', 'kfz_appointments', 'kfz_vehicles',
      'kfz_damages', 'kfz_insurance_companies', 'kfz_insurance_claims',
      'kfz_accident_reports', 'kfz_project_files', 'kfz_analytics_events',
      'kfz_chatbot_conversations', 'kfz_chatbot_messages', 'kfz_knowledge_articles',
      'kfz_scraped_sources', 'kfz_scraped_content', 'kfz_scraping_jobs'
    ];
    
    for (const table of disableRLS) {
      try {
        await pgClient.query(`ALTER TABLE ${table} DISABLE ROW LEVEL SECURITY;`);
        console.log(`✅ RLS disabled for ${table}`);
      } catch (error) {
        console.log(`⚠️ RLS fix for ${table}: ${error.message}`);
      }
    }
    
    // Fix 2: Grant permissions
    try {
      await pgClient.query('GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;');
      await pgClient.query('GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;');
      await pgClient.query('GRANT USAGE ON SCHEMA public TO service_role;');
      await pgClient.query('GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO anon;');
      console.log('✅ Permissions granted to service_role and anon');
    } catch (error) {
      console.log('⚠️ Permission grant error:', error.message);
    }
    
    // Fix 3: Create tenant project if not exists
    try {
      const checkQuery = `SELECT id FROM tenant_projects WHERE project_name = 'kfz-sachverstaendiger' LIMIT 1`;
      const existing = await pgClient.query(checkQuery);
      
      if (existing.rows.length === 0) {
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
        console.log('🎉 Tenant project created:', result.rows[0].id);
      } else {
        console.log('✅ Tenant project already exists:', existing.rows[0].id);
      }
    } catch (error) {
      console.log('⚠️ Tenant project creation error:', error.message);
    }
    
    await pgClient.end();
    console.log('🎉 Database Permissions Fix completed successfully!');
    return true;
    
  } catch (error) {
    console.error('💥 Database Permissions Fix failed:', error.message);
    return false;
  }
}

module.exports = { fixDatabasePermissions };

// Auto-run if called directly
if (require.main === module) {
  fixDatabasePermissions()
    .then(success => {
      console.log(success ? '✅ Fix completed' : '❌ Fix failed');
      process.exit(success ? 0 : 1);
    });
}
